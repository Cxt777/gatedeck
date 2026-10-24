/**
 * gatedeck-mcp 写工具 handler（W-S3-2 写 3；T-M1-08 名单 create_task / update_task / move_task，MOD-06 权威名单）。
 *
 * 分层与红线落点：
 *  - IO 装配（读 pm/ 文件、CAS 后写盘）在本文件（mcp 壳层允许 IO）；业务判定一律调
 *    core 既有导出：wbsKernel（解析/校验/局部修改）、optimisticWrite（内容 hash CAS，
 *    T-M0b-03）、derivedVersion（投影版本 compare-and-set，T-M0b-06）——本文件只做
 *    粘合与如实转译，不实现任何判定规则（注册表收编属 CLI adopt，MCP 名单外）；
 *  - **不产事件块**：写 3 是内容写动作，事件只能由类型化事件动作（events.ts）与
 *    门禁动作（gates.ts）按 kind 白名单产生；本文件不 import 事件序列化原语，
 *    「写 3 不产事件」由 allowlist.test.ts 的源码文本守卫机器保证；
 *  - **永不执行任何命令**（R-07/D-26）：本文件无子进程、无 shell、无 eval；
 *  - 写入三步纪律（每工具一致）：① core 校验通过（新增诊断为空）→ ② 投影版本
 *    compare-and-set（参数提供时，T-M0b-06）→ ③ 内容 hash compare-and-set（必做，
 *    基线不一致拒绝并返回当前 hash 供客户端重读，B-1 不覆盖他人修改）→ 全部通过才写盘；
 *  - 边界（W-06 如实）：update_task 只改节点中**已存在**的字段（core 局部修改契约：
 *    不静默产生新字段，新增字段属模板演进）；task.transitioned 权威事件按 D-22/B-4
 *    通道分工仅由本机 CLI 真人确认流程产生，本通道不代产（kind×origin 矩阵，core
 *    eventEnvelope 编码），状态变更以 wbs.md 落盘为唯一权威记录（基准 3.1）。
 *
 * 时钟/随机：由 server.ts 顶层注入（McpToolDeps），本文件不取系统时间、不取随机。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkFreshSubmission, type FreshnessResult } from '../../core/derivedVersion.js';
import { compareAndSet } from '../../core/optimisticWrite.js';
import { getNodeField, validateWbsDocument, updateTaskFieldById } from '../../core/wbsKernel.js';
import { parseFencedTaskBlocks, type WbsParseResult } from '../../core/wbsSyntax.js';
import { resolveProjectContext } from '../context.js';

/* ---------------------------------------------------------------- *
 * 依赖注入与公共辅助
 * ---------------------------------------------------------------- */

/** mcp 工具公共依赖（server.ts 顶层注入；其余文件不取时钟/随机） */
export interface McpToolDeps {
  /** 当前时间（ISO 8601 带时区；server.ts 顶层时钟） */
  nowIso: () => string;
  /** ULID 生成（26 位 Crockford Base32 大写；server.ts 顶层 node:crypto 随机） */
  newUlid: () => string;
}

/** 写 3 名单（与 tools/registry.ts 的 TOOL_ALLOWLIST 写区一致；Record 类型强制全实现） */
export const WRITER_TOOL_NAMES = ['create_task', 'update_task', 'move_task'] as const;

export type WriterToolName = (typeof WRITER_TOOL_NAMES)[number];

/** 写工具 handler 统一签名（同步；返回值须可 JSON 序列化） */
export type WriterHandler<A = Record<string, unknown>> = (
  rootDir: string,
  args: A,
  deps: McpToolDeps,
) => unknown;

/** 读受管文本：不存在返回 null；读取异常向上抛（调用方按如实错误转译） */
export function readTextIfExists(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

/** 统一失败返回形态（ok=false + error 码 + 中文说明 + 可选补充字段，W-06 不静默） */
export function writeError(
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return { ok: false, error: code, message, ...(extra ?? {}) };
}

/**
 * CAS 落盘：core compareAndSet（T-M0b-03）通过后写入。
 * 基线不一致 → 拒绝并返回磁盘当前 hash（客户端重读重试，B-1）。
 */
export function writeViaCas(
  path: string,
  currentText: string,
  expectedHash: string,
  nextText: string,
): { ok: true; nextHash: string } | { ok: false; code: string; message: string; currentHash: string; expectedHash: string | null } {
  const result = compareAndSet(currentText, { expectedHash, nextContent: nextText });
  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      message: result.message,
      currentHash: result.actual.contentHash,
      expectedHash: result.expectedHash,
    };
  }
  writeFileSync(path, result.nextContent, 'utf8');
  return { ok: true, nextHash: result.next.contentHash };
}

/** 文档行终止符风格（与 core eventLog.detectEol 同判据，读侧判定） */
function detectEol(md: string): '\n' | '\r\n' {
  const last = md.lastIndexOf('\n');
  if (last > 0 && md[last - 1] === '\r') return '\r\n';
  const first = md.indexOf('\n');
  if (first > 0 && md[first - 1] === '\r') return '\r\n';
  return '\n';
}

/** 确保文本以一个空行结尾（与 core 追加口径一致：恰好以「空行」收尾，前缀字节不动） */
function ensureTrailingBlankLine(md: string, eol: '\n' | '\r\n'): string {
  let out = md;
  if (out.length > 0 && !out.endsWith(eol)) out += eol;
  if (out.length > 0 && !out.endsWith(eol + eol)) out += eol;
  return out;
}

/** 单条 wbs 诊断的比对键（code + 关联任务 + 消息；行号随插入位置变化，不参与比对） */
function diagKey(d: { code: string; message: string; taskId?: string }): string {
  return `${d.code}|${d.taskId ?? ''}|${d.message}`;
}

/** 全量解析诊断键集（语法层 + 语义层，与 context.ts 装配口径同源） */
function allDiagnosticKeys(md: string, parsed: WbsParseResult): Set<string> {
  const validation = validateWbsDocument(md, parsed);
  return new Set(
    [...parsed.diagnostics, ...validation.diagnostics].map((d) => diagKey(d)),
  );
}

/** 受管字段值防御：值内禁止换行（会破坏「一行式 key: value」结构，R-04） */
function rejectLineBreak(value: string): boolean {
  return /[\r\n]/.test(value);
}

/* ---------------------------------------------------------------- *
 * update_task：局部修改任务字段（R-04 + 双 CAS）
 * ---------------------------------------------------------------- */

/** update_task 参数（server.ts 以 zod 校验后传入） */
export interface UpdateTaskParams {
  id: string;
  expected_hash: string;
  title?: string;
  status?: string;
  deps?: string;
  gate?: string;
  owner?: string;
  acceptance?: string;
  scope?: string;
  /** 投影版本 compare-and-set（T-M0b-06）：提供任一即执行校验 */
  expected_as_of?: string;
  expected_source_version?: number;
}

/** update_task 可修改的受管字段（MOD-02 已知字段去掉机器不可改的 id） */
const UPDATABLE_KEYS = ['title', 'status', 'deps', 'gate', 'owner', 'acceptance', 'scope'] as const;

/** MCP 通道不代产状态迁移权威事件的通道分工说明（D-22/B-4；kind×origin 矩阵） */
export const TRANSITION_EVENT_NOTICE =
  'status 变更已直接落盘 pm/wbs.md（任务状态唯一权威位置，基准 3.1）。' +
  'task.transitioned 权威事件按 D-22/B-4 通道分工仅由本机 CLI 真人确认流程产生，' +
  '本通道（origin=managed-api）按 kind×origin 矩阵（core eventEnvelope 编码）不可产生该 kind，' +
  '故本次不追加事件块、不伪装留痕。';

/**
 * update_task handler：按 id 定位节点 → 逐字段 wbsKernel.updateTaskFieldById 局部修改
 * （只改目标字段行的值文本，区间外字节不动）→ 投影版本 CAS（可选）→ 内容 hash CAS 落盘。
 * 写前与写后诊断比对：本次修改不得引入新诊断（如悬空 deps），引入即拒绝。
 */
export function updateTask(rootDir: string, args: UpdateTaskParams, deps: McpToolDeps): unknown {
  const wbsPath = join(rootDir, 'pm', 'wbs.md');
  const current = readTextIfExists(wbsPath);
  if (current === null) {
    return writeError('not-initialized', 'pm/wbs.md 不存在：先运行 gatedeck init 生成契约文件骨架，再使用本工具。');
  }

  // 收集待改字段（参数提供的非空项；空串视为未提供，避免把字段行清空）
  const updates: Array<{ key: string; value: string }> = [];
  for (const key of UPDATABLE_KEYS) {
    const value = (args as unknown as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim() !== '') {
      if (rejectLineBreak(value)) {
        return writeError('invalid-input', `字段 ${key} 的值含换行符：受管字段为「一行式 key: value」结构，拒绝多行值（R-04）。`);
      }
      updates.push({ key, value: value.trim() });
    }
  }
  if (updates.length === 0) {
    return writeError(
      'invalid-input',
      `未提供任何待更新字段：请至少提供 ${UPDATABLE_KEYS.join('/')} 之一（空串不视为更新）。`,
    );
  }

  // 解析与定位（目标节点必须存在；字段必须已在节点中——core 局部修改契约不新增字段）
  let text = current;
  let working = parseFencedTaskBlocks(text, 'gatedeck-task');
  const beforeKeys = allDiagnosticKeys(text, working);
  for (const u of updates) {
    const node = working.nodes.find((n) => getNodeField(n, 'id')?.trim() === args.id.trim());
    if (node === undefined) {
      return writeError(
        'not-found',
        `未找到任务 id=${args.id}：get_wbs 可列出全部可解析任务；无法解析的节点只出现在诊断中（W-06 不编造）。`,
      );
    }
    if (getNodeField(node, u.key) === undefined) {
      return writeError(
        'field-absent',
        `任务 ${args.id} 节点中不存在字段「${u.key}」：MCP 局部修改不静默新增字段（core 契约：新增字段属模板演进）；` +
          '可用 get_task 查看现有字段，或由主理人人工编辑节点补齐字段后再改值。',
      );
    }
    const next = updateTaskFieldById(text, working, args.id.trim(), u.key, u.value);
    if (next === null) {
      return writeError('modify-rejected', `字段修改被 core 拒绝：${args.id}.${u.key}（节点或字段定位失败，W-06 如实上报）。`);
    }
    text = next;
    working = parseFencedTaskBlocks(text, 'gatedeck-task');
  }

  // 本次修改不得引入新诊断（零新增诊断方可落盘；既有诊断原样保留并如实附列）
  const afterKeys = allDiagnosticKeys(text, working);
  const introduced = [...afterKeys].filter((k) => !beforeKeys.has(k));
  if (introduced.length > 0) {
    return writeError(
      'invalid-task',
      '本次修改将引入新的 wbsKernel 诊断（如悬空 deps / 非法格式），拒绝落盘；请先确保被引用任务存在后再修改。',
      { introducedDiagnostics: introduced.map((k) => k.split('|')) },
    );
  }

  // 投影版本 compare-and-set（T-M0b-06；参数提供任一版本字段即执行）
  let projectionCheck: 'skipped' | 'passed' = 'skipped';
  if (args.expected_as_of !== undefined || args.expected_source_version !== undefined) {
    const ctx = resolveProjectContext(rootDir, deps.nowIso());
    if (!ctx.ok) {
      return writeError('not-initialized', ctx.hint);
    }
    const fresh: FreshnessResult = checkFreshSubmission(ctx.stage, {
      asOf: args.expected_as_of ?? null,
      sourceVersion: args.expected_source_version ?? 0,
    });
    if (!fresh.ok) {
      return writeError(fresh.code, fresh.message, { current: fresh.current });
    }
    projectionCheck = 'passed';
  }

  // 内容 hash compare-and-set（T-M0b-03，必做）→ 落盘
  const commit = writeViaCas(wbsPath, current, args.expected_hash, text);
  if (!commit.ok) {
    return writeError(commit.code, commit.message, {
      current_hash: commit.currentHash,
      expected_hash: commit.expectedHash,
    });
  }

  return {
    ok: true,
    tool: 'update_task',
    id: args.id.trim(),
    updatedFields: updates.map((u) => u.key),
    files: [{ path: 'pm/wbs.md', expectedHash: args.expected_hash.toLowerCase(), nextHash: commit.nextHash }],
    projectionVersionCheck: projectionCheck,
    diagnostics: validateWbsDocument(text, working).diagnostics.map((d) => ({
      code: d.code,
      message: d.message,
    })),
    notes: [TRANSITION_EVENT_NOTICE],
  };
}

/* ---------------------------------------------------------------- *
 * create_task：追加新任务节点（契约模板语法 + 追加内容零新增诊断 + CAS）
 * ---------------------------------------------------------------- */

/** create_task 参数 */
export interface CreateTaskParams {
  id: string;
  title: string;
  status?: string;
  deps?: string;
  gate?: string;
  owner?: string;
  acceptance?: string;
  scope?: string;
  expected_hash: string;
}

/**
 * create_task handler：按契约模板语法（contractTemplates/wbsSyntax 定稿）组装 fenced block
 * 节点文本，追加到 wbs.md 文档末尾（前缀字节不动，R-02/R-04）；合并文档经
 * validateWbsDocument 校验，**本次追加不得引入新诊断**（名单契约「追加内容零诊断」），
 * 通过后内容 hash CAS 落盘。不产事件（M1 最小：任务内容以 wbs.md 为唯一权威位置）。
 */
export function createTask(rootDir: string, args: CreateTaskParams, _deps: McpToolDeps): unknown {
  const wbsPath = join(rootDir, 'pm', 'wbs.md');
  const current = readTextIfExists(wbsPath);
  if (current === null) {
    return writeError('not-initialized', 'pm/wbs.md 不存在：先运行 gatedeck init 生成契约文件骨架，再使用本工具。');
  }

  const id = args.id.trim();
  const title = args.title.trim();
  if (id === '' || title === '') {
    return writeError('invalid-input', 'id 与 title 必填（trim 后非空）。');
  }
  if (rejectLineBreak(id) || rejectLineBreak(title)) {
    return writeError('invalid-input', 'id/title 不得含换行符（一行式结构，R-04）。');
  }

  // 可选字段归一（空串视为未提供）+ 换行防御
  const optional = ['deps', 'gate', 'owner', 'acceptance', 'scope'] as const;
  const fields: Array<{ key: string; value: string }> = [];
  for (const key of optional) {
    const value = (args as unknown as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim() !== '') {
      if (rejectLineBreak(value)) {
        return writeError('invalid-input', `字段 ${key} 的值含换行符：受管字段为「一行式 key: value」结构，拒绝多行值（R-04）。`);
      }
      fields.push({ key, value: value.trim() });
    }
  }
  const status = typeof args.status === 'string' && args.status.trim() !== '' ? args.status.trim() : 'todo';

  // 组装节点文本（contractTemplates 示例语法：### 标题行 + 空行 + 围栏块；块外为人类说明层；
  // deps 行恒存在与模板对齐：有值行「deps: X」，无值为空值行「deps:」）
  const eol = detectEol(current);
  const depLine = fields.find((f) => f.key === 'deps');
  const otherLines = fields.filter((f) => f.key !== 'deps').map((f) => `${f.key}: ${f.value}`);
  const nodeBlock = [
    `### ${id} ${title}`,
    '',
    '```gatedeck-task',
    `id: ${id}`,
    `title: ${title}`,
    `status: ${status}`,
    depLine === undefined ? 'deps:' : `deps: ${depLine.value}`,
    ...otherLines,
    '```',
    '',
  ];
  const merged = ensureTrailingBlankLine(current, eol) + nodeBlock.join(eol);

  // 合并校验：追加内容零新增诊断方可落盘（wbsKernel 语法层 + 语义层全量比对）
  const beforeParsed = parseFencedTaskBlocks(current, 'gatedeck-task');
  const beforeKeys = allDiagnosticKeys(current, beforeParsed);
  const mergedParsed = parseFencedTaskBlocks(merged, 'gatedeck-task');
  const mergedKeys = allDiagnosticKeys(merged, mergedParsed);
  const introduced = [...mergedKeys].filter((k) => !beforeKeys.has(k));
  if (introduced.length > 0) {
    return writeError(
      'invalid-task',
      '新节点未通过 wbsKernel 校验（追加内容零新增诊断方可落盘）：请检查 id 重复、deps 引用与字段格式。',
      { introducedDiagnostics: introduced.map((k) => k.split('|')) },
    );
  }

  const commit = writeViaCas(wbsPath, current, args.expected_hash, merged);
  if (!commit.ok) {
    return writeError(commit.code, commit.message, {
      current_hash: commit.currentHash,
      expected_hash: commit.expectedHash,
    });
  }

  const afterValidation = validateWbsDocument(merged, mergedParsed);
  return {
    ok: true,
    tool: 'create_task',
    id,
    files: [{ path: 'pm/wbs.md', expectedHash: args.expected_hash.toLowerCase(), nextHash: commit.nextHash }],
    diagnostics: afterValidation.diagnostics.map((d) => ({ code: d.code, message: d.message })),
    notes: [
      '任务节点已按契约模板语法追加至 wbs.md 末尾（既有字节不动，R-02/R-04）；不产事件（任务内容以 wbs.md 为唯一权威位置）。',
    ],
  };
}

/* ---------------------------------------------------------------- *
 * move_task：移动任务（阶段归属 gate / 前置 deps；MOD-06 名单语义）
 * ---------------------------------------------------------------- */

/** move_task 参数 */
export interface MoveTaskParams {
  id: string;
  expected_hash: string;
  /** 目标阶段门禁 id（阶段归属移动；字段须已存在于节点，不静默新增） */
  gate?: string;
  /** 新前置列表（逗号分隔；字段须已存在于节点，不静默新增） */
  deps?: string;
  /** 投影版本 compare-and-set（T-M0b-06）：提供任一即执行校验 */
  expected_as_of?: string;
  expected_source_version?: number;
}

/**
 * move_task handler：语义为「移动」的字段受限写入——只接受 gate（阶段归属）与
 * deps（前置），与 update_task 同 core 路径（wbsKernel.updateTaskFieldById 局部
 * 修改 + 零新增诊断 + 内容 hash CAS）；目标字段须已存在于节点（缺失如实拒绝，
 * 提示人工补字段）。注册表收编（adopt）不属本工具——CLI adopt 与 MCP 名单分工。
 */
export function moveTask(rootDir: string, args: MoveTaskParams, deps: McpToolDeps): unknown {
  if (args.gate === undefined && args.deps === undefined) {
    return writeError('invalid-input', 'move_task 须提供 gate（阶段归属）与 deps（前置）至少一项。');
  }
  const params: UpdateTaskParams = {
    id: args.id,
    expected_hash: args.expected_hash,
    ...(args.gate !== undefined ? { gate: args.gate } : {}),
    ...(args.deps !== undefined ? { deps: args.deps } : {}),
    ...(args.expected_as_of !== undefined ? { expected_as_of: args.expected_as_of } : {}),
    ...(args.expected_source_version !== undefined
      ? { expected_source_version: args.expected_source_version }
      : {}),
  };
  const result = updateTask(rootDir, params, deps);
  if (
    typeof result === 'object' &&
    result !== null &&
    (result as Record<string, unknown>).ok === true
  ) {
    return { ...(result as Record<string, unknown>), tool: 'move_task', movedFields: (result as Record<string, unknown>).updatedFields };
  }
  return result;
}

/** 写 3 handler 注册表（键由 WRITER_TOOL_NAMES 类型收窄，漏实现编译期报错） */
export const WRITER_HANDLERS: Readonly<
  Record<WriterToolName, (rootDir: string, args: never, deps: McpToolDeps) => unknown>
> = {
  create_task: (rootDir, args, deps) => createTask(rootDir, args as CreateTaskParams, deps),
  update_task: (rootDir, args, deps) => updateTask(rootDir, args as UpdateTaskParams, deps),
  move_task: (rootDir, args, deps) => moveTask(rootDir, args as MoveTaskParams, deps),
};
