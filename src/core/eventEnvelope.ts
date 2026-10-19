/**
 * 规范事件块语法 + 事件信封 schema（T-M0a-03；基准 3.5 / D-21 / P-09/R-09）。
 *
 * 定稿要点：
 *   - 事件块复用 T-M0a-02 定稿的 fenced block 包裹机制，info string 固定 `gatedeck-event`；
 *   - 信封字段固定 11 项，机器权威字段一行式呈现（`key: value`，嵌套对象为紧凑 JSON）；
 *   - 人类说明为块外自由文本，不参与状态推导（与机器权威字段物理分离）；
 *   - kind 白名单 × origin 兼容矩阵在 schema 层编码 B-4/B-17 口径：
 *     外部通道（managed-api）不可声明 core 专属 kind（如 check.completed / authorization.*）；
 *   - `validation_status`（待验/通过/失败）**不进信封**：它属于检查事实维度，由
 *     `check.completed` 的 payload 承载并经投影派生（见设计文档 3.4 节裁决）；
 *   - event_id 缺失/非法、kind 越权等致命诊断 → 事件不入信封序列；
 *     「未在收据链登记 → external-unverified」的判定归 T-M0a-04/T-M0b-02（需收据机制）。
 *
 * 纯字符串计算，无 IO（core 纯度约束）。
 */

import { parseFencedTaskBlocks, reconstruct, type WbsField, type WbsParseResult } from './wbsSyntax.js';

/** 事件块 fence 的 info string（与 wbs 节点 `gatedeck-task` 同构） */
export const EVENT_BLOCK_INFO = 'gatedeck-event';

/** 信封 schema 版本（当前为 v1；契约升级走 T-M3-03 migrate，不静默变更） */
export const ENVELOPE_SCHEMA_VERSION = '1';

/** 事件来源：core=受管内核 / managed-api=受管类型化动作 / manual=手工追加或未知来源（基准 3.5 术语三分） */
export type EventOrigin = 'core' | 'managed-api' | 'manual';

/** 事件完整性：verified=通过来源收据验证 / unknown=未验证 / invalid=验证失败（收据机制归 T-M0a-04） */
export type EventIntegrity = 'verified' | 'unknown' | 'invalid';

/** core 受管操作专属 kind（基准 3.5 白名单第一行；仅 core 通道可产生） */
export const CORE_KINDS = [
  'task.transitioned',
  'check.completed',
  'authorization.granted',
  'authorization.denied',
  'authorization.locally_confirmed',
  'promotion.completed',
  'project.initialized',
  'correction',
  'operation.recovery',
] as const;

/** managed-api 类型化动作 kind（record_note / submit_evidence / request_promotion / report_usage） */
export const MANAGED_API_KINDS = [
  'note',
  'evidence.submitted',
  'authorization.requested',
  'usage.reported',
] as const;

export type CoreKind = (typeof CORE_KINDS)[number];
export type ManagedApiKind = (typeof MANAGED_API_KINDS)[number];
export type EventKind = CoreKind | ManagedApiKind;

const ALL_KINDS: ReadonlySet<string> = new Set([...CORE_KINDS, ...MANAGED_API_KINDS]);
const CORE_KIND_SET: ReadonlySet<string> = new Set(CORE_KINDS);
const MANAGED_API_KIND_SET: ReadonlySet<string> = new Set(MANAGED_API_KINDS);

/** 归因四元组（D-19：actor_id/session_id 为本地不透明 ID，不记邮箱/用户名/对话文本） */
export interface EventActor {
  actor_id: string;
  session_id: string;
  tool?: string;
  model?: string;
}

/** 事件对象：对象 ID + 指纹引用（指纹本体由 canonical manifest 承载，D-25） */
export interface EventSubject {
  object_id: string;
  manifest_hash?: string;
}

/** 事件信封（机器权威字段，固定 schema；基准 3.5） */
export interface EventEnvelope {
  event_id: string;
  schema_version: string;
  kind: EventKind;
  /** ISO 8601，必须带时区（Z 或 ±HH:MM） */
  occurred_at: string;
  recorded_at: string;
  actor: EventActor;
  origin: EventOrigin;
  integrity: EventIntegrity;
  subject: EventSubject;
  /** 跨文件操作关联（P-06 四相恢复）；单文件操作可缺省 */
  operation_id?: string;
  /** 结构化载荷（自由 schema，随 kind 定义）；validation_status 由 check.completed 的 payload 承载 */
  payload: Record<string, unknown>;
}

export type EnvelopeDiagnosticCode =
  | 'missing-field'
  | 'bad-format'
  | 'bad-enum'
  | 'bad-json'
  | 'kind-origin-mismatch'
  | 'unknown-field';

export interface EnvelopeDiagnostic {
  code: EnvelopeDiagnosticCode;
  message: string;
  /** 1-based 行号（相对整个输入文本） */
  line: number;
}

/** 致命诊断集合：出现任一条则该事件不进入信封序列（原文仍保留，round-trip 不丢字节） */
const FATAL: ReadonlySet<EnvelopeDiagnosticCode> = new Set([
  'missing-field',
  'bad-format',
  'bad-enum',
  'bad-json',
  'kind-origin-mismatch',
]);

/** event_id 采用 ULID（26 位 Crockford Base32，大小写不敏感接受，规范化输出大写） */
export function isUlid(s: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(s);
}

/** ISO 8601 日期时间，必须显式带时区（Z 或 ±HH:MM）——无时区时间戳拒绝（R-08：不猜语义） */
export function isIsoDateTimeWithTz(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(s);
}

function diag(code: EnvelopeDiagnosticCode, message: string, line: number): EnvelopeDiagnostic {
  return { code, message, line };
}

function parseJsonObjectField(value: string): { ok: true; obj: Record<string, unknown> } | { ok: false } {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ok: true, obj: parsed as Record<string, unknown> };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function asOptionalString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * 从字段行构建并校验信封。致命缺陷 → envelope=null + 诊断；
 * 非致命未知字段 → 保留并出 unknown-field 诊断（F-06），信封照常产出。
 */
export function buildEnvelope(fields: readonly WbsField[], lineOf: (key: string) => number): {
  envelope: EventEnvelope | null;
  diagnostics: EnvelopeDiagnostic[];
} {
  const diagnostics: EnvelopeDiagnostic[] = [];
  const map = new Map<string, string>();
  for (const f of fields) {
    if (!map.has(f.key)) map.set(f.key, f.value);
  }
  const get = (key: string): string | undefined => map.get(key);
  const line = (key: string): number => lineOf(key);

  // 必需字段齐全性（信封固定 11 项，operation_id 可缺省）
  const required = ['event_id', 'schema_version', 'kind', 'occurred_at', 'recorded_at', 'actor', 'origin', 'integrity', 'subject', 'payload'] as const;
  for (const key of required) {
    if (get(key) === undefined || get(key) === '') {
      diagnostics.push(diag('missing-field', `信封必需字段缺失：${key}（基准 3.5 固定 schema）`, line(key)));
    }
  }
  // 未知字段：保留 + 诊断（含 validation_status——按裁决不入信封，属检查事实维度）
  const KNOWN = new Set([...required, 'operation_id']);
  for (const f of fields) {
    if (!KNOWN.has(f.key)) {
      diagnostics.push(
        diag(
          'unknown-field',
          `信封未知字段「${f.key}」已原样保留、不参与状态推导（F-06；validation_status 属检查事实维度，不进信封）`,
          line(f.key),
        ),
      );
    }
  }
  // 格式与枚举校验：字段缺失已由 missing-field 覆盖，此处仅在字段存在时校验，
  // 全量收集诊断（不提前返回），保证单条事件可一次性暴露全部缺陷。
  const eventId = get('event_id');
  if (eventId !== undefined && !isUlid(eventId)) {
    diagnostics.push(diag('bad-format', `event_id 不是合法 ULID（26 位 Crockford Base32）：${eventId}`, line('event_id')));
  }
  const schemaVersion = get('schema_version');
  if (schemaVersion !== undefined && !/^\d+$/.test(schemaVersion)) {
    diagnostics.push(diag('bad-format', `schema_version 须为数字字符串：${schemaVersion}`, line('schema_version')));
  }
  for (const key of ['occurred_at', 'recorded_at'] as const) {
    const v = get(key);
    if (v !== undefined && !isIsoDateTimeWithTz(v)) {
      diagnostics.push(diag('bad-format', `${key} 须为带时区（Z 或 ±HH:MM）的 ISO 8601 时间：${v}`, line(key)));
    }
  }

  // 枚举
  const kind = get('kind');
  const origin = get('origin');
  const integrity = get('integrity');
  if (kind !== undefined && !ALL_KINDS.has(kind)) {
    diagnostics.push(diag('bad-enum', `kind 不在白名单：${kind}（基准 3.5 kind 白名单）`, line('kind')));
  }
  if (origin !== undefined && origin !== 'core' && origin !== 'managed-api' && origin !== 'manual') {
    diagnostics.push(diag('bad-enum', `origin 取值非法：${origin}（core/managed-api/manual）`, line('origin')));
  }
  if (integrity !== undefined && integrity !== 'verified' && integrity !== 'unknown' && integrity !== 'invalid') {
    diagnostics.push(diag('bad-enum', `integrity 取值非法：${integrity}（verified/unknown/invalid）`, line('integrity')));
  }

  // kind × origin 兼容矩阵（B-4/B-17 的 schema 层口径）
  if (kind !== undefined && origin !== undefined && ALL_KINDS.has(kind) && (origin === 'core' || origin === 'managed-api')) {
    const allowed = origin === 'core' ? CORE_KIND_SET : MANAGED_API_KIND_SET;
    if (!allowed.has(kind)) {
      const b = kind === 'check.completed' || kind.startsWith('authorization.')
        ? '（B-4/B-17：外部通道不可声明 core 专属 kind）'
        : '';
      diagnostics.push(diag('kind-origin-mismatch', `kind「${kind}」不允许由 origin=${origin} 产生${b}`, line('kind')));
    }
  }

  // 嵌套对象字段
  let actor: EventActor | null = null;
  const actorRaw = get('actor');
  if (actorRaw !== undefined) {
    const actorParsed = parseJsonObjectField(actorRaw);
    if (!actorParsed.ok) {
      diagnostics.push(diag('bad-json', `actor 须为紧凑 JSON 对象：${actorRaw}`, line('actor')));
    } else {
      const actorId = asNonEmptyString(actorParsed.obj['actor_id']);
      const sessionId = asNonEmptyString(actorParsed.obj['session_id']);
      const tool = asOptionalString(actorParsed.obj['tool']);
      const model = asOptionalString(actorParsed.obj['model']);
      if (actorId === null || sessionId === null) {
        diagnostics.push(diag('bad-format', 'actor.actor_id 与 actor.session_id 为必填非空字符串（本地不透明 ID，D-19）', line('actor')));
      } else {
        actor = { actor_id: actorId, session_id: sessionId, ...(tool !== undefined ? { tool } : {}), ...(model !== undefined ? { model } : {}) };
      }
    }
  }

  let subject: EventSubject | null = null;
  const subjectRaw = get('subject');
  if (subjectRaw !== undefined) {
    const subjectParsed = parseJsonObjectField(subjectRaw);
    if (!subjectParsed.ok) {
      diagnostics.push(diag('bad-json', `subject 须为紧凑 JSON 对象：${subjectRaw}`, line('subject')));
    } else {
      const objectId = asNonEmptyString(subjectParsed.obj['object_id']);
      const manifestHash = asOptionalString(subjectParsed.obj['manifest_hash']);
      if (objectId === null) {
        diagnostics.push(diag('bad-format', 'subject.object_id 为必填非空字符串', line('subject')));
      } else {
        subject = { object_id: objectId, ...(manifestHash !== undefined ? { manifest_hash: manifestHash } : {}) };
      }
    }
  }

  let payload: Record<string, unknown> | null = null;
  const payloadRaw = get('payload');
  if (payloadRaw !== undefined) {
    const payloadParsed = parseJsonObjectField(payloadRaw);
    if (!payloadParsed.ok) {
      diagnostics.push(diag('bad-json', `payload 须为紧凑 JSON 对象：${payloadRaw}`, line('payload')));
    } else {
      payload = payloadParsed.obj;
    }
  }

  const operationId = get('operation_id');
  if (operationId !== undefined && operationId.trim() === '') {
    diagnostics.push(diag('bad-format', 'operation_id 若出现须为非空字符串', line('operation_id')));
  }

  if (
    diagnostics.some((d) => FATAL.has(d.code)) ||
    eventId === undefined ||
    schemaVersion === undefined ||
    kind === undefined ||
    origin === undefined ||
    integrity === undefined ||
    actor === null ||
    subject === null ||
    payload === null
  ) {
    return { envelope: null, diagnostics };
  }
  const envelope: EventEnvelope = {
    event_id: eventId.toUpperCase(),
    schema_version: schemaVersion,
    kind: kind as EventKind,
    occurred_at: get('occurred_at')!,
    recorded_at: get('recorded_at')!,
    actor,
    origin: origin as EventOrigin,
    integrity: integrity as EventIntegrity,
    subject,
    ...(operationId !== undefined ? { operation_id: operationId } : {}),
    payload,
  };
  return { envelope, diagnostics };
}

export interface EventParseResult {
  /** 成功构建的信封（致命缺陷的事件不在此列，但原文保留在 blocks 中） */
  envelopes: EventEnvelope[];
  /** 信封层诊断（致命 + 非致命未知字段） */
  diagnostics: EnvelopeDiagnostic[];
  /** 底层块解析结果（span/raw 保留，供 reconstruct 与 T-M0b-02 复用） */
  blocks: WbsParseResult;
}

/** 解析文档中的全部规范事件块（info=gatedeck-event），人类说明留在块外不动 */
export function parseEventBlocks(md: string): EventParseResult {
  const blocks = parseFencedTaskBlocks(md, EVENT_BLOCK_INFO);
  const envelopes: EventEnvelope[] = [];
  const diagnostics: EnvelopeDiagnostic[] = [];
  for (const node of blocks.nodes) {
    // 行号定位：raw 起始行 + 字段在 raw 中的行偏移（1-based，供诊断精确定位）
    const rawStartLine = md.slice(0, node.rawSpan.start).split('\n').length;
    const lineOf = (key: string): number => {
      const idx = node.raw.split('\n').findIndex((l) => l.trimStart().startsWith(key));
      return idx === -1 ? rawStartLine : rawStartLine + idx;
    };
    const built = buildEnvelope(node.fields, lineOf);
    diagnostics.push(...built.diagnostics);
    if (built.envelope !== null) envelopes.push(built.envelope);
  }
  return { envelopes, diagnostics, blocks };
}

/** 信封字段输出顺序（固定，保证序列化确定性） */
const SERIALIZE_ORDER = [
  'event_id',
  'schema_version',
  'kind',
  'occurred_at',
  'recorded_at',
  'actor',
  'origin',
  'integrity',
  'subject',
  'operation_id',
  'payload',
] as const;

/** 将单个信封序列化为规范事件块（不含人类说明；人类说明由调用方追加在块外） */
export function serializeEventBlock(envelope: EventEnvelope): string {
  const record = envelope as unknown as Record<string, unknown>;
  const lines: string[] = [];
  for (const key of SERIALIZE_ORDER) {
    const v = record[key];
    if (v === undefined) continue;
    const text = typeof v === 'string' ? v : JSON.stringify(v);
    lines.push(`${key}: ${text}`);
  }
  return ['```' + EVENT_BLOCK_INFO, ...lines, '```', ''].join('\n');
}

/** 文档重建：事件块区间原样回填，块外一字节不动（R-04） */
export function reconstructEvents(md: string, result: EventParseResult): string {
  return reconstruct(md, result.blocks);
}
