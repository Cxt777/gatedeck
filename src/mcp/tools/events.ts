/**
 * gatedeck-mcp 类型化事件动作 handler（W-S3-2 事件 3；T-M1-08 名单 record_note /
 * submit_evidence / report_usage）。
 *
 * 事件权威性落点（R-09 / B-17 / D-19）：
 *  - 本通道只产生 origin=managed-api、integrity=unknown 的事件：外部通道事件未经收据
 *    链验证，不参与状态推导（P-09），验真由本机 CLI 建立收据链后经 eventLog 投影裁定；
 *  - **kind 白名单**：本文件只产生 managed-api 白名单内的事件 kind（note /
 *    evidence.submitted / authorization.requested / usage.reported，core eventEnvelope
 *    编码）；绝不声明检查完成类与授权终态类 core 专属 kind（B-4/B-17）——该禁令除
 *    CI 源码文本守卫外，另由写入前**信封回验**结构保证（见 verifyEnvelopeSerializes：
 *    任何过不了 buildEnvelope 的 kind×origin 组合在写入前即被拒绝）；
 *  - submit_evidence 只产生**待验**证据事件（validation_status=pending 置于 payload，
 *    属检查事实维度、不进信封）；record_note 只产生非权威备注事件（不驱动状态）；
 *  - 归因只记本地不透明 ID（D-19/W-02）：actor_id/session_id 由调用方声明，本层不采集
 *    邮箱/用户名/对话文本；
 *  - 落盘位置（唯一权威位置，基准 3.1）：note / usage.reported → pm/insights.md（用量与
 *    活动原始记录）；evidence.submitted → pm/changelog.md（检查/授权记录）。追加一律走
 *    core eventLog.appendEventBlock（append-only，R-02；重复 event_id 拒绝）+ 内容 hash
 *    CAS（T-M0b-03）。
 *
 * 时钟/随机：由 server.ts 顶层注入（McpToolDeps），本文件不取系统时间、不取随机。
 */

import { join } from 'node:path';

import { appendEventBlock, renderEventBlock } from '../../core/eventLog.js';
import {
  ENVELOPE_SCHEMA_VERSION,
  parseEventBlocks,
  type EnvelopeDiagnostic,
  type EventActor,
  type EventEnvelope,
  type EventSubject,
  type ManagedApiKind,
} from '../../core/eventEnvelope.js';
import { readTextIfExists, writeError, writeViaCas, type McpToolDeps, type WriterHandler } from './writers.js';
import { resolveProjectContext } from '../context.js';

/* ---------------------------------------------------------------- *
 * 信封构造与写入前回验（B-4/B-17 的写入侧结构性防线）
 * ---------------------------------------------------------------- */

/** 信封致命诊断码全集（core FATAL 集合的镜像；出现任一 → 事件不入信封序列） */
const FATAL_DIAGNOSTIC_CODES: ReadonlySet<EnvelopeDiagnostic['code']> = new Set([
  'missing-field',
  'bad-format',
  'bad-enum',
  'bad-json',
  'kind-origin-mismatch',
]);

/** 事件动作公共参数：归因本地不透明 ID（D-19）+ 内容基线 CAS */
export interface EventActorParams {
  actor_id: string;
  session_id: string;
  expected_hash: string;
  /** 人类说明：置于事件块之前的块外自由文本（不驱动状态，基准 3.5/R-09） */
  human_note?: string;
}

/**
 * 构造 managed-api 事件信封：origin=managed-api、integrity=unknown（外部通道事件未经
 * 收据验证，不驱动状态直到 CLI 建链验真）；actor.tool 固定 gatedeck-mcp。
 */
export function buildManagedEnvelope(input: {
  kind: ManagedApiKind;
  nowIso: string;
  eventId: string;
  operationId?: string;
  actorId: string;
  sessionId: string;
  subject: EventSubject;
  payload: Record<string, unknown>;
}): EventEnvelope {
  const actor: EventActor = { actor_id: input.actorId, session_id: input.sessionId, tool: 'gatedeck-mcp' };
  return {
    event_id: input.eventId,
    schema_version: ENVELOPE_SCHEMA_VERSION,
    kind: input.kind,
    occurred_at: input.nowIso,
    recorded_at: input.nowIso,
    actor,
    origin: 'managed-api',
    integrity: 'unknown',
    subject: input.subject,
    ...(input.operationId !== undefined ? { operation_id: input.operationId } : {}),
    payload: input.payload,
  };
}

/**
 * 写入前信封回验：把信封序列化回规范事件块并经 core parseEventBlocks 重建，
 * 重建失败或出现致命诊断（含 kind×origin 矩阵违规）即拒绝写入——任何本通道
 * 不允许产生的 kind 在此被结构性拦截（B-4/B-17 的第二道防线，第一道是 CI 源码守卫）。
 */
function verifyEnvelopeSerializes(envelope: EventEnvelope): { ok: true } | { ok: false; message: string } {
  const rebuilt = parseEventBlocks(renderEventBlock(envelope));
  const fatal = rebuilt.diagnostics.filter((d) => FATAL_DIAGNOSTIC_CODES.has(d.code));
  if (rebuilt.envelopes.length !== 1 || fatal.length > 0) {
    return {
      ok: false,
      message:
        `事件信封未通过 core 回验（写入拒绝，B-4/B-17 结构防线）：kind=${envelope.kind} 重建失败或存在致命诊断 ` +
        fatal.map((d) => `${d.code}(${d.message})`).join('；') +
        '。',
    };
  }
  const back = rebuilt.envelopes[0]!;
  if (back.kind !== envelope.kind || back.origin !== envelope.origin) {
    return {
      ok: false,
      message: `事件信封回验不一致（写入拒绝）：kind/origin 往返失真 ${envelope.kind}→${back.kind}。`,
    };
  }
  return { ok: true };
}

export type AppendTypedEventResult =
  | { ok: true; nextHash: string; eventId: string }
  | { ok: false; code: string; message: string; currentHash?: string };

/**
 * 类型化事件追加落盘（append-only R-02 + 内容 hash CAS T-M0b-03）：
 * ① 信封回验（kind×origin 结构防线）→ ② core appendEventBlock（重复 event_id 拒绝、
 * 前缀字节不动）→ ③ compareAndSet 落盘。任一步失败均不写盘并如实返回。
 */
export function appendTypedEventViaCas(input: {
  targetPath: string;
  currentText: string;
  expectedHash: string;
  envelope: EventEnvelope;
  humanNote?: string;
}): AppendTypedEventResult {
  const verify = verifyEnvelopeSerializes(input.envelope);
  if (!verify.ok) {
    return { ok: false, code: 'envelope-invalid', message: verify.message };
  }
  const appended = appendEventBlock(input.currentText, input.envelope, input.humanNote);
  if (!appended.ok) {
    return { ok: false, code: appended.error, message: appended.message };
  }
  const commit = writeViaCas(input.targetPath, input.currentText, input.expectedHash, appended.text);
  if (!commit.ok) {
    return {
      ok: false,
      code: commit.code,
      message: commit.message,
      currentHash: commit.currentHash,
    };
  }
  return { ok: true, nextHash: commit.nextHash, eventId: input.envelope.event_id };
}

/** 事件 3 名单（与 tools/registry.ts 的 TOOL_ALLOWLIST 事件区一致） */
export const EVENT_TOOL_NAMES = ['record_note', 'submit_evidence', 'report_usage'] as const;

export type EventToolName = (typeof EVENT_TOOL_NAMES)[number];

/** 非权威信封公共注记（各工具返回复用，措辞不漂移） */
const NON_AUTHORITY_NOTE =
  '本事件 origin=managed-api、integrity=unknown：未经收据链验证，不参与状态推导（P-09）；' +
  '验真由本机 CLI 建立收据链后经 eventLog 投影裁定。';

/** 解析项目 slug（object_id 缺省构造用；缺失如实用占位并注明） */
function projectSlugOrUnknown(rootDir: string, deps: McpToolDeps): { slug: string; note?: string } {
  const ctx = resolveProjectContext(rootDir, deps.nowIso());
  if (!ctx.ok) return { slug: '(unknown)', note: '项目上下文不可用（pm/ 缺失），object_id 使用占位。' };
  if (ctx.project.slug === null) return { slug: '(unnamed)', note: 'project.md 未解析出 slug，object_id 使用占位。' };
  return { slug: ctx.project.slug };
}

/* ---------------------------------------------------------------- *
 * record_note：非权威备注 → pm/insights.md
 * ---------------------------------------------------------------- */

/** record_note 参数 */
export interface RecordNoteParams extends EventActorParams {
  note: string;
  /** 事件对象 id；缺省为 project:<slug> */
  subject?: string;
}

/** record_note handler：只产生非权威 note 事件（不驱动状态，P-09），追加至 pm/insights.md */
export const recordNote: WriterHandler<RecordNoteParams> = (rootDir, args, deps) => {
  const insightsPath = join(rootDir, 'pm', 'insights.md');
  const current = readTextIfExists(insightsPath);
  if (current === null) {
    return writeError('not-initialized', 'pm/insights.md 不存在：先运行 gatedeck init 生成契约文件骨架，再使用本工具。');
  }
  const note = args.note.trim();
  if (note === '') {
    return writeError('invalid-input', 'note 必填（trim 后非空）：空备注不落盘。');
  }
  if (/[\r\n]/.test(args.subject ?? '')) {
    return writeError('invalid-input', 'subject 不得含换行符（信封字段为一行式）。');
  }
  const slugInfo = projectSlugOrUnknown(rootDir, deps);
  const envelope = buildManagedEnvelope({
    kind: 'note',
    nowIso: deps.nowIso(),
    eventId: deps.newUlid(),
    actorId: args.actor_id.trim(),
    sessionId: args.session_id.trim(),
    subject: { object_id: args.subject?.trim() || `project:${slugInfo.slug}` },
    payload: { note },
  });
  const result = appendTypedEventViaCas({
    targetPath: insightsPath,
    currentText: current,
    expectedHash: args.expected_hash,
    envelope,
    ...(args.human_note !== undefined ? { humanNote: args.human_note } : {}),
  });
  if (!result.ok) {
    return writeError(result.code, result.message, result.currentHash !== undefined ? { current_hash: result.currentHash } : {});
  }
  return {
    ok: true,
    tool: 'record_note',
    eventId: result.eventId,
    kind: envelope.kind,
    origin: envelope.origin,
    integrity: envelope.integrity,
    file: 'pm/insights.md',
    nextHash: result.nextHash,
    ...(slugInfo.note !== undefined ? { notes: [slugInfo.note, NON_AUTHORITY_NOTE] } : { notes: [NON_AUTHORITY_NOTE] }),
  };
};

/* ---------------------------------------------------------------- *
 * submit_evidence：待验证据 → pm/changelog.md
 * ---------------------------------------------------------------- */

/** submit_evidence 参数（(gate_id, rule_id) 成对必填——与 core checkFacts.parsePair 同口径） */
export interface SubmitEvidenceParams extends EventActorParams {
  gate_id: string;
  rule_id: string;
  summary?: string;
  /** 提交时可附检查对象指纹（check_gate 产出），供后续检查事件关联比对 */
  manifest_hash?: string;
}

/**
 * submit_evidence handler：只产生**待验**证据事件（validation_status=pending 置于
 * payload——检查事实维度由检查完成类 core 专属事件的投影裁定，本通道不代裁定，B-17），
 * 追加至 pm/changelog.md（检查/授权记录唯一权威位置）。
 */
export const submitEvidence: WriterHandler<SubmitEvidenceParams> = (rootDir, args, deps) => {
  const changelogPath = join(rootDir, 'pm', 'changelog.md');
  const current = readTextIfExists(changelogPath);
  if (current === null) {
    return writeError('not-initialized', 'pm/changelog.md 不存在：先运行 gatedeck init 生成契约文件骨架，再使用本工具。');
  }
  const gateId = args.gate_id.trim();
  const ruleId = args.rule_id.trim();
  if (gateId === '' || ruleId === '') {
    return writeError('invalid-input', 'gate_id 与 rule_id 必填（成对定位检查对象，缺一不猜——core checkFacts 同口径）。');
  }
  if (/[\r\n]/.test(gateId) || /[\r\n]/.test(ruleId)) {
    return writeError('invalid-input', 'gate_id/rule_id 不得含换行符（信封字段为一行式）。');
  }
  const payload: Record<string, unknown> = { validation_status: 'pending', gate_id: gateId, rule_id: ruleId };
  if (args.summary !== undefined && args.summary.trim() !== '') payload['summary'] = args.summary.trim();
  if (args.manifest_hash !== undefined && args.manifest_hash.trim() !== '') payload['manifest_hash'] = args.manifest_hash.trim();
  const envelope = buildManagedEnvelope({
    kind: 'evidence.submitted',
    nowIso: deps.nowIso(),
    eventId: deps.newUlid(),
    actorId: args.actor_id.trim(),
    sessionId: args.session_id.trim(),
    subject: { object_id: `gate:${gateId}`, ...(args.manifest_hash !== undefined && args.manifest_hash.trim() !== '' ? { manifest_hash: args.manifest_hash.trim() } : {}) },
    payload,
  });
  const result = appendTypedEventViaCas({
    targetPath: changelogPath,
    currentText: current,
    expectedHash: args.expected_hash,
    envelope,
    ...(args.human_note !== undefined ? { humanNote: args.human_note } : {}),
  });
  if (!result.ok) {
    return writeError(result.code, result.message, result.currentHash !== undefined ? { current_hash: result.currentHash } : {});
  }
  return {
    ok: true,
    tool: 'submit_evidence',
    eventId: result.eventId,
    kind: envelope.kind,
    origin: envelope.origin,
    integrity: envelope.integrity,
    validationStatus: 'pending',
    file: 'pm/changelog.md',
    nextHash: result.nextHash,
    notes: [
      '证据为待验（validation_status=pending，属检查事实维度置于 payload）：本通道绝不代裁定检查完成或任务状态迁移（B-17/R-09）。',
      NON_AUTHORITY_NOTE,
    ],
  };
};

/* ---------------------------------------------------------------- *
 * report_usage：用量上报 → pm/insights.md（MOD-08 契约字段）
 * ---------------------------------------------------------------- */

/** report_usage 参数（MOD-08 用量契约字段；归因只记本地不透明 ID，D-19/W-02） */
export interface ReportUsageParams extends EventActorParams {
  /** 日期（YYYY-MM-DD） */
  date: string;
  /** 项目标识；缺省为 project.md 解析出的 slug */
  project?: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  /** 关联任务 id（可选） */
  task_id?: string;
  /** 来源（如 mcp/cli/web；调用方声明） */
  source: string;
}

/** report_usage handler：usage.reported 事件（context.ts 用量聚合消费 payload 的 model/input_tokens/output_tokens 键） */
export const reportUsage: WriterHandler<ReportUsageParams> = (rootDir, args, deps) => {
  const insightsPath = join(rootDir, 'pm', 'insights.md');
  const current = readTextIfExists(insightsPath);
  if (current === null) {
    return writeError('not-initialized', 'pm/insights.md 不存在：先运行 gatedeck init 生成契约文件骨架，再使用本工具。');
  }
  const date = args.date.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return writeError('invalid-input', `date 须为 YYYY-MM-DD 形态，收到「${date}」（R-08 不猜语义）。`);
  }
  const model = args.model.trim();
  const source = args.source.trim();
  if (model === '' || source === '') {
    return writeError('invalid-input', 'model 与 source 必填（trim 后非空）。');
  }
  if (!Number.isInteger(args.input_tokens) || args.input_tokens < 0 || !Number.isInteger(args.output_tokens) || args.output_tokens < 0) {
    return writeError('invalid-input', 'input_tokens/output_tokens 须为非负整数。');
  }
  const taskId = args.task_id?.trim();
  if (taskId !== undefined && /[\r\n]/.test(taskId)) {
    return writeError('invalid-input', 'task_id 不得含换行符（信封字段为一行式）。');
  }
  const slugInfo = projectSlugOrUnknown(rootDir, deps);
  const project = args.project?.trim() || slugInfo.slug;
  const payload: Record<string, unknown> = {
    date,
    project,
    model,
    input_tokens: args.input_tokens,
    output_tokens: args.output_tokens,
    source,
    actor_id: args.actor_id.trim(),
    session_id: args.session_id.trim(),
  };
  if (taskId !== undefined && taskId !== '') payload['task_id'] = taskId;
  const envelope = buildManagedEnvelope({
    kind: 'usage.reported',
    nowIso: deps.nowIso(),
    eventId: deps.newUlid(),
    actorId: args.actor_id.trim(),
    sessionId: args.session_id.trim(),
    subject: { object_id: `usage:${date}` },
    payload,
  });
  const result = appendTypedEventViaCas({
    targetPath: insightsPath,
    currentText: current,
    expectedHash: args.expected_hash,
    envelope,
    ...(args.human_note !== undefined ? { humanNote: args.human_note } : {}),
  });
  if (!result.ok) {
    return writeError(result.code, result.message, result.currentHash !== undefined ? { current_hash: result.currentHash } : {});
  }
  return {
    ok: true,
    tool: 'report_usage',
    eventId: result.eventId,
    kind: envelope.kind,
    origin: envelope.origin,
    integrity: envelope.integrity,
    file: 'pm/insights.md',
    nextHash: result.nextHash,
    ...(slugInfo.note !== undefined ? { notes: [slugInfo.note, NON_AUTHORITY_NOTE] } : { notes: [NON_AUTHORITY_NOTE] }),
  };
};

/** 事件 3 handler 注册表（键由 EVENT_TOOL_NAMES 类型收窄，漏实现编译期报错） */
export const EVENT_HANDLERS: Readonly<
  Record<EventToolName, (rootDir: string, args: never, deps: McpToolDeps) => unknown>
> = {
  record_note: (rootDir, args, deps) => recordNote(rootDir, args as RecordNoteParams, deps),
  submit_evidence: (rootDir, args, deps) => submitEvidence(rootDir, args as SubmitEvidenceParams, deps),
  report_usage: (rootDir, args, deps) => reportUsage(rootDir, args as ReportUsageParams, deps),
};
