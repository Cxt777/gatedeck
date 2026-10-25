#!/usr/bin/env node
/**
 * gatedeck-mcp 冒烟脚本（W-S3-4）—— Node 22 原生 ESM，零依赖。
 *
 * 用法：
 *   1. 先构建：pnpm build（产出 dist/mcp/server.js）；
 *   2. 在仓库根运行：node scripts/mcp-smoke.mjs。
 *
 * 动线：spawn node dist/mcp/server.js（stdio pipe，stdout 为 JSON-RPC 通道、
 * stderr 为启动横幅与诊断）→ initialize → notifications/initialized →
 * tools/list → tools/call get_overview（参数 {}）。
 *
 * 硬断言（任一不过即退出 1 并打印差异）：
 *   A. JSON-RPC id 匹配：每条响应的 id 与在途请求一一对应；
 *   B. initialize 返回 serverInfo.name === 'gatedeck-mcp'（src/mcp/server.ts:53）；
 *   C. tools/list 恰 15 个，且与 src/mcp/tools/registry.ts 的 TOOL_ALLOWLIST
 *      名单逐一相等（无缺漏、无私增——名单漂移冒烟应红）；
 *   D. 不含 pass_gate / append_changelog（B-4/B-17 永久禁名，registry.ts:30）；
 *   E. tools/call get_overview({}) 返回 ok 形态（决策台投影）或
 *      not-initialized（裸仓无 pm/ 属正常）——两者都算通过。
 *
 * 全部通过 → 退出 0，打印「MCP 冒烟通过：15 工具，无禁名」。
 *
 * 诚实边界（W-06）：本脚本只冒烟「协议通 + 名单对 + 首工具可用」，不冒充全量
 * 测试；单元/机器守卫见 vitest（allowlist.test.ts 等）。
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** server 入口（相对本脚本：scripts/../dist/mcp/server.js） */
const SERVER_PATH = fileURLToPath(new URL('../dist/mcp/server.js', import.meta.url));

/** 每条响应的等待上限（ms）；超时按失败处理并附 stderr 摘要 */
const TIMEOUT_MS = 30_000;

/**
 * 15 工具期望名单：唯一事实源为 src/mcp/tools/registry.ts 的 TOOL_ALLOWLIST
 * （读 7 + 写 3 + 门禁 2 + 事件 3）。此处刻意硬编码而非 import 编译产物——
 * 若 server 实际名单漂移（增删改名），冒烟必须变红而不是静默跟随。
 */
const EXPECTED_TOOLS = [
  // 读 7
  'list_projects',
  'get_overview',
  'get_wbs',
  'get_task',
  'list_gates',
  'query',
  'get_report',
  // 写 3
  'create_task',
  'update_task',
  'move_task',
  // 门禁 2
  'check_gate',
  'request_promotion',
  // 事件 3
  'record_note',
  'submit_evidence',
  'report_usage',
];

/** B-4/B-17 永久禁名（与 registry.ts:30 FORBIDDEN_TOOL_NAMES 一致） */
const FORBIDDEN_TOOLS = ['pass_gate', 'append_changelog'];

/* ---------------------------------------------------------------- *
 * 运行状态与失败收集
 * ---------------------------------------------------------------- */

/** 内容性断言失败（不中断，跑完汇总） */
const failures = [];

/** 硬失败（协议层无法继续：超时 / server 提前退出 / stdout 非 JSON） */
function hardFail(reason) {
  console.error(`[mcp-smoke] 冒烟失败：${reason}`);
  if (failures.length > 0) {
    console.error('[mcp-smoke] 此前已收集的断言失败：');
    for (const f of failures) console.error(`  - ✗ ${f}`);
  }
  const tail = stderrTail();
  if (tail !== '') console.error(`[mcp-smoke] stderr 摘要（启动横幅在 stderr 属正常，此处为诊断）：\n${tail}`);
  try {
    child.kill();
  } catch {
    /* 进程已退出时 kill 报错可忽略 */
  }
  process.exit(1);
}

/** 内容性断言：条件不成立记一条失败（继续跑，最后统一裁决） */
function check(cond, message) {
  if (!cond) failures.push(message);
}

let stderrBuf = '';
function stderrTail() {
  const lines = stderrBuf.split(/\r?\n/).filter((l) => l.trim() !== '');
  return lines.slice(-10).join('\n');
}

/* ---------------------------------------------------------------- *
 * server 子进程与 JSON-RPC 收发（stdio：换行分隔 JSON）
 * ---------------------------------------------------------------- */

if (!existsSync(SERVER_PATH)) {
  console.error(`[mcp-smoke] 未找到 ${SERVER_PATH}`);
  console.error('[mcp-smoke] 请先运行 pnpm build 再冒烟（用法见脚本头部注释）。');
  process.exit(1);
}

const child = spawn(process.execPath, [SERVER_PATH], { stdio: ['pipe', 'pipe', 'pipe'] });
child.on('error', (e) => hardFail(`server 进程启动失败：${e.message}`));

let queue = []; // 已解析但未被消费的 JSON-RPC 消息
let waiter = null; // 当前等待者（收发动线是串行的，同时最多一个）
let exited = null; // server 退出信息（提前退出时置位）

child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  stderrBuf += chunk;
});

child.on('exit', (code, signal) => {
  exited = { code, signal };
  if (waiter) {
    const w = waiter;
    waiter = null;
    clearTimeout(w.timer);
    w.reject(new Error(`server 提前退出（code=${code} signal=${signal}）；stderr 摘要：\n${stderrTail()}`));
  }
});

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line === '') continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      hardFail(`stdout 出现无法解析为 JSON 的行（stdout 是 JSON-RPC 通道，出现杂讯即异常）：${line.slice(0, 200)}`);
      return;
    }
    feed(msg);
  }
});

let buffer = '';

/** 分发一条入站消息：匹配等待者 / 入队；带 id 但不匹配在途请求 → 记 id 失配 */
function feed(msg) {
  if (waiter && msg.id === waiter.id) {
    const w = waiter;
    waiter = null;
    clearTimeout(w.timer);
    w.resolve(msg);
    return;
  }
  if (waiter && typeof msg.id !== 'undefined' && msg.id !== waiter.id) {
    check(false, `JSON-RPC id 失配：在途请求 id=${waiter.id}，实收 id=${msg.id}（method=${msg.method ?? '响应'}）`);
  }
  queue.push(msg);
}

/** 等待指定 id 的响应（串行动线；超时/提前退出即硬失败） */
function nextMessage(id, label) {
  const queuedIdx = queue.findIndex((m) => m.id === id);
  if (queuedIdx >= 0) return Promise.resolve(queue.splice(queuedIdx, 1)[0]);
  if (exited) return Promise.reject(new Error(`server 已退出（code=${exited.code}），未收到 ${label}（id=${id}）响应`));
  if (waiter) return Promise.reject(new Error('内部错误：上一次等待尚未结束（动线应为串行）'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiter = null;
      reject(new Error(`等待 ${label}（id=${id}）响应超时（${TIMEOUT_MS} ms）；stderr 摘要：\n${stderrTail()}`));
    }, TIMEOUT_MS);
    waiter = { id, resolve, reject, timer };
  });
}

/** 发送一条 JSON-RPC 消息（换行分隔） */
function send(msg) {
  child.stdin.write(JSON.stringify(msg) + '\n');
}

/* ---------------------------------------------------------------- *
 * 冒烟动线
 * ---------------------------------------------------------------- */

async function main() {
  // ① initialize
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'gatedeck-smoke', version: '0.0.0' },
    },
  });
  const initRes = await nextMessage(1, 'initialize');
  const serverName = initRes?.result?.serverInfo?.name;
  check(serverName === 'gatedeck-mcp', `initialize serverInfo.name 期望 'gatedeck-mcp'，实得 ${JSON.stringify(serverName ?? null)}`);

  // ② notifications/initialized（通知，无 id、无响应）
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  // ③ tools/list
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const listRes = await nextMessage(2, 'tools/list');
  const tools = listRes?.result?.tools;
  if (!Array.isArray(tools)) {
    hardFail(`tools/list 返回缺少 result.tools 数组：${JSON.stringify(listRes).slice(0, 300)}`);
    return;
  }
  const names = tools.map((t) => t?.name);
  check(names.length === 15, `工具数量期望恰 15，实得 ${names.length}：${JSON.stringify(names)}`);
  for (const f of FORBIDDEN_TOOLS) {
    check(!names.includes(f), `出现永久禁名 ${f}（B-4/B-17：门禁开启与通用事件追加不由 MCP 提供）`);
  }
  const missing = EXPECTED_TOOLS.filter((n) => !names.includes(n));
  const extra = names.filter((n) => !EXPECTED_TOOLS.includes(n));
  if (missing.length > 0) check(false, `名单缺漏（对照 registry.ts TOOL_ALLOWLIST）：${missing.join('、')}`);
  if (extra.length > 0) check(false, `名单私增（不在 15 工具全集）：${extra.join('、')}`);

  // ④ tools/call get_overview（参数 {}）——ok 或 not-initialized 都算通
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_overview', arguments: {} } });
  const callRes = await nextMessage(3, 'tools/call get_overview');
  if (callRes?.result?.isError === true) {
    hardFail(`get_overview 以 isError=true 返回：${JSON.stringify(callRes.result).slice(0, 300)}`);
    return;
  }
  const text = callRes?.result?.content?.find((c) => c?.type === 'text')?.text;
  if (typeof text !== 'string') {
    hardFail(`get_overview 返回缺少 content[0].text：${JSON.stringify(callRes).slice(0, 300)}`);
    return;
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    hardFail(`get_overview 的 text 不是合法 JSON（工具结果应为结构化 JSON 文本）：${text.slice(0, 200)}`);
    return;
  }
  let overviewBranch;
  if (payload && payload.error === 'not-initialized') {
    overviewBranch = 'not-initialized（裸仓无 pm/，属正常：工具应引导先 gatedeck init）';
  } else if (payload && payload.error === undefined && payload.zones !== undefined && payload.counts !== undefined) {
    overviewBranch = 'ok（决策台四区投影）';
  } else {
    hardFail(`get_overview 返回既非 ok 形态（应含 zones/counts）也非 not-initialized：${text.slice(0, 300)}`);
    return;
  }

  // 裁决
  if (failures.length > 0) {
    console.error('[mcp-smoke] 冒烟失败，共 ' + failures.length + ' 处差异：');
    for (const f of failures) console.error(`  - ✗ ${f}`);
    try {
      child.kill();
    } catch {
      /* 同 hardFail */
    }
    process.exit(1);
  }

  console.log('MCP 冒烟通过：15 工具，无禁名');
  console.log(`  - serverInfo：${serverName} ${initRes?.result?.serverInfo?.version ?? ''}`);
  console.log(`  - get_overview 分支：${overviewBranch}`);
  try {
    child.kill();
  } catch {
    /* 进程可能已自行退出 */
  }
  process.exit(0);
}

main().catch((e) => hardFail(e instanceof Error ? e.message : String(e)));
