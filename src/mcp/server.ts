#!/usr/bin/env node
/**
 * gatedeck-mcp —— 一休PM 对外 MCP server 入口（W-S3-1/W-S3-2；T-M1-08 / DP-1 单包三 bin 之三）。
 *
 * 结构（红线落点）：
 *  - 传输：SDK StdioServerTransport（本地优先 B-7；不采集、不上报，W-01/W-02）；
 *  - 注册：全量 15 工具（读 7 + 写 3 + 门禁 2 + 事件 3），名单唯一事实源为
 *    tools/registry.ts 的 TOOL_ALLOWLIST；写/门禁/事件 handler 分驻 tools/ 下三个模块；
 *  - **结构性白名单守卫（B-4/B-17）**：注册完成后立即 assertAllowlist 自检，实际注册
 *    名单 ∉ TOOL_ALLOWLIST 或含 pass_gate/append_changelog 即 throw 拒绝启动；
 *    CI 侧另有 allowlist.test.ts 机器守卫（含 gates.ts/events.ts 源码文本守卫），两层互为保险；
 *  - R-07/D-26：任何工具永不执行门禁/shell 命令（读 7 纯投影；check_gate=事实查询与
 *    失效判定；写工具走 core 校验层 + 内容 hash CAS）；
 *  - 时钟/随机注入点：仅本文件顶层（nowIso / newUlid 闭包），以参数传入 handler——
 *    其余 mcp 文件不直接取时钟或随机（core 纯度约束在 mcp 层的对应纪律）。
 *
 * 输出纪律：stdout 是 JSON-RPC 通道，启动横幅只写 stderr（console.error）。
 */

import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { resolveProjectContext } from './context.js';
import { assertAllowlist, TOOL_ALLOWLIST } from './tools/registry.js';
import { READER_HANDLERS, READER_TOOL_NAMES, type ReaderParams } from './tools/readers.js';
import {
  moveTask,
  createTask,
  updateTask,
  type MoveTaskParams,
  type CreateTaskParams,
  type McpToolDeps,
  type UpdateTaskParams,
  WRITER_TOOL_NAMES,
} from './tools/writers.js';
import { checkGate, requestPromotion, type CheckGateParams, type RequestPromotionParams, GATE_TOOL_NAMES } from './tools/gates.js';
import {
  recordNote,
  reportUsage,
  submitEvidence,
  type RecordNoteParams,
  type ReportUsageParams,
  type SubmitEvidenceParams,
  EVENT_TOOL_NAMES,
} from './tools/events.js';
import { WBS_STATUS_VALUES } from '../core/wbsKernel.js';

/** server 名（DP-1 终裁命名；曾拟名 workBuddy 因商标混淆弃用，R2） */
const SERVER_NAME = 'gatedeck-mcp';

/** 版本自 package.json 读取（相对本模块解析：dist/mcp/../../package.json 或 src/mcp/../../） */
function readOwnVersion(): string {
  const require = createRequire(import.meta.url);
  const pkg = require('../../package.json') as { version?: unknown };
  const version = pkg.version;
  if (typeof version !== 'string' || version === '') {
    throw new Error('无法从 package.json 读取 version 字段（W-06：缺什么说什么，不编造版本号）');
  }
  return version;
}

/** 时钟注入（本文件是 mcp 层唯一取时钟的位置；以参数传入 handler） */
const nowIso = (): string => new Date().toISOString();

/** ULID 字母表（Crockford Base32，剔除 I/L/O/U；与 cli adopt 同字母表口径，mcp 层不 import cli） */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * 随机 ULID 生成（本文件是 mcp 层唯一取随机的位置）：10 字符 48 位毫秒时间戳段 +
 * 16 字符 80 位 node:crypto 随机段 = 26 位大写，满足 core isUlid 校验。
 * 用途：事件 event_id / operation_id / adopt 登记 workspace_id。
 */
const newUlid = (): string => {
  const MAX48 = (1n << 48n) - 1n;
  let t = BigInt(Math.trunc(Date.now()));
  if (t < 0n) t = 0n;
  if (t > MAX48) t = MAX48;
  let timePart = '';
  for (let i = 0; i < 10; i++) {
    timePart = CROCKFORD[Number(t & 31n)]! + timePart;
    t >>= 5n;
  }
  let r = 0n;
  for (const b of randomBytes(10)) r = (r << 8n) | BigInt(b);
  let randPart = '';
  for (let i = 0; i < 16; i++) {
    randPart = CROCKFORD[Number(r & 31n)]! + randPart;
    r >>= 5n;
  }
  return timePart + randPart;
};

/** 工具公共依赖（时钟/随机均在本文件顶层注入，以参数传入 handler） */
const MCP_DEPS: McpToolDeps = { nowIso, newUlid };

/** 工具返回的统一信封：结构化结果序列化为 JSON 文本（MCP content 规范） */
function toToolResult(result: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

/** 从 TOOL_ALLOWLIST 取描述（唯一事实源；名单缺失即编程错误，拒绝启动） */
function allowlistDef(name: string): { name: string; description: string } {
  const def = TOOL_ALLOWLIST.find((t) => t.name === name);
  if (def === undefined) {
    throw new Error(`工具「${name}」不在 TOOL_ALLOWLIST 名单中：注册表以 tools/registry.ts 为唯一事实源，禁止在 server 侧私增工具。`);
  }
  return def;
}

/**
 * 构建 gatedeck-mcp server 实例（注册读 7 + allowlist 自检）。
 * 独立成函数便于将来测试装配逻辑；本阶段入口直接调用。
 */
function buildServer(version: string): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version });

  // —— 读 7 注册（zod 简单参数：id/status/stage；无参工具不设 inputSchema） ——
  server.registerTool('list_projects', { description: allowlistDef('list_projects').description }, async () => {
    const ctx = resolveProjectContext(process.cwd(), nowIso());
    return toToolResult(READER_HANDLERS.list_projects(ctx, {}));
  });

  server.registerTool('get_overview', { description: allowlistDef('get_overview').description }, async () => {
    const ctx = resolveProjectContext(process.cwd(), nowIso());
    return toToolResult(READER_HANDLERS.get_overview(ctx, {}));
  });

  server.registerTool('get_wbs', { description: allowlistDef('get_wbs').description }, async () => {
    const ctx = resolveProjectContext(process.cwd(), nowIso());
    return toToolResult(READER_HANDLERS.get_wbs(ctx, {}));
  });

  server.registerTool(
    'get_task',
    {
      description: allowlistDef('get_task').description,
      inputSchema: { id: z.string().min(1, '任务 id 必填') },
    },
    async (args) => {
      const ctx = resolveProjectContext(process.cwd(), nowIso());
      return toToolResult(READER_HANDLERS.get_task(ctx, args as ReaderParams));
    },
  );

  server.registerTool('list_gates', { description: allowlistDef('list_gates').description }, async () => {
    const ctx = resolveProjectContext(process.cwd(), nowIso());
    return toToolResult(READER_HANDLERS.list_gates(ctx, {}));
  });

  server.registerTool(
    'query',
    {
      description: allowlistDef('query').description,
      inputSchema: {
        status: z.enum(WBS_STATUS_VALUES).optional(),
        stage: z.string().min(1).optional(),
      },
    },
    async (args) => {
      const ctx = resolveProjectContext(process.cwd(), nowIso());
      return toToolResult(READER_HANDLERS.query(ctx, args as ReaderParams));
    },
  );

  server.registerTool('get_report', { description: allowlistDef('get_report').description }, async () => {
    const ctx = resolveProjectContext(process.cwd(), nowIso());
    return toToolResult(READER_HANDLERS.get_report(ctx, {}));
  });

  // —— 写 3 注册（输入含 expected_hash 实现内容 hash CAS；update_task 另支持投影版本 CAS） ——
  server.registerTool(
    'update_task',
    {
      description: allowlistDef('update_task').description,
      inputSchema: {
        id: z.string().min(1, '任务 id 必填'),
        expected_hash: z.string().regex(/^[0-9a-fA-F]{64}$/, 'expected_hash 须为 64 位十六进制 SHA-256（wbs.md 内容基线）'),
        title: z.string().optional(),
        status: z.enum(WBS_STATUS_VALUES).optional(),
        deps: z.string().optional(),
        gate: z.string().optional(),
        owner: z.string().optional(),
        acceptance: z.string().optional(),
        scope: z.string().optional(),
        expected_as_of: z.string().optional(),
        expected_source_version: z.number().int().nonnegative().optional(),
      },
    },
    async (args) => {
      return toToolResult(updateTask(process.cwd(), args as UpdateTaskParams, MCP_DEPS));
    },
  );

  server.registerTool(
    'create_task',
    {
      description: allowlistDef('create_task').description,
      inputSchema: {
        id: z.string().min(1, '任务 id 必填'),
        title: z.string().min(1, 'title 必填'),
        status: z.enum(WBS_STATUS_VALUES).optional(),
        deps: z.string().optional(),
        gate: z.string().optional(),
        owner: z.string().optional(),
        acceptance: z.string().optional(),
        scope: z.string().optional(),
        expected_hash: z.string().regex(/^[0-9a-fA-F]{64}$/, 'expected_hash 须为 64 位十六进制 SHA-256（wbs.md 内容基线）'),
      },
    },
    async (args) => {
      return toToolResult(createTask(process.cwd(), args as CreateTaskParams, MCP_DEPS));
    },
  );

  server.registerTool(
    'move_task',
    {
      description: allowlistDef('move_task').description,
      inputSchema: {
        id: z.string().min(1, '任务 id 必填'),
        expected_hash: z.string().regex(/^[0-9a-fA-F]{64}$/, 'expected_hash 须为 64 位十六进制 SHA-256（wbs.md 内容基线）'),
        gate: z.string().optional(),
        deps: z.string().optional(),
        expected_as_of: z.string().optional(),
        expected_source_version: z.number().int().nonnegative().optional(),
      },
    },
    async (args) => {
      return toToolResult(moveTask(process.cwd(), args as MoveTaskParams, MCP_DEPS));
    },
  );

  // —— 门禁 2 注册（check_gate 只读永不执行命令；request_promotion 只产待审申请事件） ——
  server.registerTool(
    'check_gate',
    {
      description: allowlistDef('check_gate').description,
      inputSchema: {
        gate_id: z.string().min(1).optional(),
      },
    },
    async (args) => {
      return toToolResult(checkGate(process.cwd(), args as CheckGateParams, MCP_DEPS));
    },
  );

  server.registerTool(
    'request_promotion',
    {
      description: allowlistDef('request_promotion').description,
      inputSchema: {
        from: z.string().min(1, 'from（当前阶段）必填'),
        to: z.string().min(1, 'to（目标阶段）必填'),
        expected_sequence: z.number().int().nonnegative(),
        manifest_hash: z.string().regex(/^[0-9a-fA-F]{64}$/, 'manifest_hash 须为 64 位十六进制 SHA-256（check_gate 产出）'),
        gate_id: z.string().min(1).optional(),
        actor_id: z.string().min(1, 'actor_id 必填（本地不透明 ID，D-19）'),
        session_id: z.string().min(1, 'session_id 必填（本地不透明 ID，D-19）'),
        expected_hash: z.string().regex(/^[0-9a-fA-F]{64}$/, 'expected_hash 须为 64 位十六进制 SHA-256（changelog.md 内容基线）'),
        note: z.string().optional(),
      },
    },
    async (args) => {
      return toToolResult(requestPromotion(process.cwd(), args as RequestPromotionParams, MCP_DEPS));
    },
  );

  // —— 类型化事件动作 3 注册（只产 managed-api 白名单 kind；写入前信封回验结构拦截） ——
  server.registerTool(
    'record_note',
    {
      description: allowlistDef('record_note').description,
      inputSchema: {
        note: z.string().min(1, 'note 必填'),
        subject: z.string().min(1).optional(),
        actor_id: z.string().min(1, 'actor_id 必填（本地不透明 ID，D-19）'),
        session_id: z.string().min(1, 'session_id 必填（本地不透明 ID，D-19）'),
        expected_hash: z.string().regex(/^[0-9a-fA-F]{64}$/, 'expected_hash 须为 64 位十六进制 SHA-256（insights.md 内容基线）'),
        human_note: z.string().optional(),
      },
    },
    async (args) => {
      return toToolResult(recordNote(process.cwd(), args as RecordNoteParams, MCP_DEPS));
    },
  );

  server.registerTool(
    'submit_evidence',
    {
      description: allowlistDef('submit_evidence').description,
      inputSchema: {
        gate_id: z.string().min(1, 'gate_id 必填（与 rule_id 成对定位检查对象）'),
        rule_id: z.string().min(1, 'rule_id 必填（与 gate_id 成对定位检查对象）'),
        summary: z.string().min(1).optional(),
        manifest_hash: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
        actor_id: z.string().min(1, 'actor_id 必填（本地不透明 ID，D-19）'),
        session_id: z.string().min(1, 'session_id 必填（本地不透明 ID，D-19）'),
        expected_hash: z.string().regex(/^[0-9a-fA-F]{64}$/, 'expected_hash 须为 64 位十六进制 SHA-256（changelog.md 内容基线）'),
        human_note: z.string().optional(),
      },
    },
    async (args) => {
      return toToolResult(submitEvidence(process.cwd(), args as SubmitEvidenceParams, MCP_DEPS));
    },
  );

  server.registerTool(
    'report_usage',
    {
      description: allowlistDef('report_usage').description,
      inputSchema: {
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date 须为 YYYY-MM-DD'),
        project: z.string().min(1).optional(),
        model: z.string().min(1, 'model 必填'),
        input_tokens: z.number().int().nonnegative(),
        output_tokens: z.number().int().nonnegative(),
        task_id: z.string().min(1).optional(),
        source: z.string().min(1, 'source 必填（如 mcp/cli）'),
        actor_id: z.string().min(1, 'actor_id 必填（本地不透明 ID，D-19）'),
        session_id: z.string().min(1, 'session_id 必填（本地不透明 ID，D-19）'),
        expected_hash: z.string().regex(/^[0-9a-fA-F]{64}$/, 'expected_hash 须为 64 位十六进制 SHA-256（insights.md 内容基线）'),
        human_note: z.string().optional(),
      },
    },
    async (args) => {
      return toToolResult(reportUsage(process.cwd(), args as ReportUsageParams, MCP_DEPS));
    },
  );

  // —— 结构性白名单自检（B-4/B-17）：注册名单越界即拒绝启动 ——
  const registered: string[] = [...READER_TOOL_NAMES, ...WRITER_TOOL_NAMES, ...GATE_TOOL_NAMES, ...EVENT_TOOL_NAMES];
  if (new Set(registered).size !== registered.length) {
    throw new Error('MCP 工具注册表存在重名（拒绝启动）：注册名单必须恰好等于 15 工具全集且不重名。');
  }
  if (registered.length !== TOOL_ALLOWLIST.length) {
    throw new Error(
      `MCP 工具注册数量 ${registered.length} ≠ 名单全集 ${TOOL_ALLOWLIST.length}（拒绝启动）：读 7 + 写 3 + 门禁 2 + 事件 3 必须全部注册。`,
    );
  }
  const check = assertAllowlist(registered);
  if (!check.ok) {
    throw new Error(
      `MCP 工具注册表违反 B-4/B-17 白名单（拒绝启动）：\n${check.violations.map((v) => `  - ${v}`).join('\n')}`,
    );
  }

  return server;
}

/** 入口：构建 → 横幅（stderr）→ stdio 连接。 */
async function main(): Promise<void> {
  const version = readOwnVersion();
  const server = buildServer(version);
  console.error(`${SERVER_NAME} ${version} ready (stdio; 15 工具: 读7+写3+门禁2+事件3, 白名单自检通过 B-4/B-17)`);
  await server.connect(new StdioServerTransport());
}

main().catch((e: unknown) => {
  // 启动失败必须可见（W-06）：错误走 stderr，非零退出；不吞异常
  console.error(`${SERVER_NAME} 启动失败：${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
