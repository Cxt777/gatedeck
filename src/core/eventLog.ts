/**
 * changelog/insights 规范事件块解析器（T-M0b-02；基准 3.5 / S2.1-04 / P-09 / R-02）。
 *
 * 在 T-M0a-03（信封 schema）与 T-M0a-04（收据验证）之上提供事件日志的两个面：
 *
 *  1. 投影（projectEventLog）：解析文档全部事件块 → 结合收据库与本地锚点逐事件裁定：
 *       - verified            ：收据链登记且内容/顺序/锚点全部验真（有效 integrity=verified）；
 *       - external-unverified ：未在收据链登记（S2.1-04；有效 integrity=unknown，不驱动状态）
 *                               ——**包括缺少合法 event_id / 信封存在致命缺陷的块**
 *                               （基准 3.5 S2.1-04「一律按 external-unverified 处理」）；
 *                               此类块另带 `malformed: true` 子标记与逐块诊断，原文保留于
 *                               blocks，公开状态词表不额外扩展（评审 2026-10-22 中·1 闭环）；
 *       - invalid             ：内容与收据不符（B-10）或锚点/链完整性破坏（B-11）。
 *     链级问题（B-11）与 malformed 块均使 needsAttention=true，调用方不得静默忽略。
 *
 *  2. append-only 追加（appendEventBlock）：只在文档末尾追加新事件块，前缀字节不动
 *     （R-02）；重复 event_id 拒绝追加（写入侧保持日志干净；读取侧幂等由折叠层兜底）；
 *     人类说明置于块外自由文本。
 *
 * 纯字符串计算，无 IO（core 纯度约束）。
 */

import {
  buildEnvelope,
  serializeEventBlock,
  EVENT_BLOCK_INFO,
  type EnvelopeDiagnostic,
  type EventEnvelope,
  type EventIntegrity,
  type EventKind,
  type EventOrigin,
} from './eventEnvelope.js';
import {
  verifyEventChain,
  type ChainIssue,
  type EventReceipt,
  type ReceiptAnchor,
} from './eventReceipt.js';
import { parseFencedTaskBlocks, type WbsParseResult } from './wbsSyntax.js';

/**
 * 事件在日志中的有效地位（T-M0b-02 投影口径，S2.1-04 三态）。
 * 「缺少合法 event_id / 信封致命缺陷」归入 external-unverified，不单列第四态。
 */
export type EventLogStatus = 'verified' | 'external-unverified' | 'invalid';

export interface EventLogEntry {
  /** 事件 id；信封不成立（含缺少合法 event_id）为 null */
  eventId: string | null;
  kind: EventKind | null;
  origin: EventOrigin | null;
  status: EventLogStatus;
  /** 投影消费方应采用的有效完整性（status 的 integrity 投影） */
  effectiveIntegrity: EventIntegrity;
  /** verified 事件的收据链序号（可信 sequence，B-16） */
  seq?: number;
  /** true = 该块信封存在致命缺陷（含缺少合法 event_id）；对外仍按 external-unverified 处理 */
  malformed: boolean;
  /** 信封缺陷全集（仅 malformed 块有值） */
  diagnostics?: EnvelopeDiagnostic[];
}

export interface EventLogProjection {
  /** 文档序全部事件（含 malformed）；人类说明不在其中（块外自由文本） */
  entries: EventLogEntry[];
  /** true = 存在链级问题（B-11）或信封致命缺陷块（malformed），调用方不得静默忽略 */
  needsAttention: boolean;
  /** 信封致命缺陷块数量（公开状态仍为 external-unverified） */
  malformedCount: number;
  /** 链级问题全集（锚点/内容/缺失/顺序等，eventReceipt 产出） */
  chainIssues: ChainIssue[];
  /** 底层块解析结果（span/raw 保留，供 reconstruct 与追加复用） */
  blocks: WbsParseResult;
}

/** 与 parseEventBlocks 相同的逐块构建：信封不成立者直接落空信封，块↔诊断归属天然精确 */
function buildPerBlock(
  md: string,
): Array<{ envelope: EventEnvelope | null; diagnostics: EnvelopeDiagnostic[] }> {
  const blocks = parseFencedTaskBlocks(md, EVENT_BLOCK_INFO);
  return blocks.nodes.map((node) => {
    const rawStartLine = md.slice(0, node.rawSpan.start).split('\n').length;
    const lineOf = (key: string): number => {
      const idx = node.raw.split('\n').findIndex((l) => l.trimStart().startsWith(key));
      return idx === -1 ? rawStartLine : rawStartLine + idx;
    };
    return buildEnvelope(node.fields, lineOf);
  });
}

/**
 * 事件日志投影：解析 + 收据裁定一步完成。
 * 「缺少合法 event_id」统一按 S2.1-04 归入 external-unverified（另带 malformed 子标记），
 * 不单列第四态；未登记但格式合法者同样为 external-unverified（两者均不驱动状态）。
 */
export function projectEventLog(
  md: string,
  receipts: readonly EventReceipt[],
  anchor: ReceiptAnchor | null,
): EventLogProjection {
  const perBlock = buildPerBlock(md);
  const blocks = parseFencedTaskBlocks(md, EVENT_BLOCK_INFO);
  const envelopes = perBlock.map((b) => b.envelope).filter((e): e is EventEnvelope => e !== null);
  const verification = verifyEventChain(envelopes, receipts, anchor);
  const verdictById = new Map(verification.perEvent.map((v) => [v.event_id, v]));

  const entries: EventLogEntry[] = [];
  let malformedCount = 0;
  for (const b of perBlock) {
    if (b.envelope === null) {
      malformedCount++;
      entries.push({
        eventId: null,
        kind: null,
        origin: null,
        status: 'external-unverified', // S2.1-04：缺少合法 event_id 一律 external-unverified
        effectiveIntegrity: 'unknown', // 不产信封即不参与推导；unknown 表示「不可验证」而非「已证伪」
        malformed: true,
        ...(b.diagnostics.length > 0 ? { diagnostics: b.diagnostics } : {}),
      });
      continue;
    }
    const env = b.envelope;
    const verdict = verdictById.get(env.event_id);
    if (verdict === undefined) {
      // 理论不可达（verifyEventChain 对每个输入事件都有裁定）；防御性归为 external-unverified
      entries.push({
        eventId: env.event_id,
        kind: env.kind,
        origin: env.origin,
        status: 'external-unverified',
        effectiveIntegrity: 'unknown',
        malformed: false,
      });
    } else if (verdict.verdict === 'verified') {
      entries.push({
        eventId: env.event_id,
        kind: env.kind,
        origin: env.origin,
        status: 'verified',
        effectiveIntegrity: 'verified',
        malformed: false,
        ...(verdict.seq !== undefined ? { seq: verdict.seq } : {}),
      });
    } else if (verdict.verdict === 'unregistered') {
      entries.push({
        eventId: env.event_id,
        kind: env.kind,
        origin: env.origin,
        status: 'external-unverified',
        effectiveIntegrity: 'unknown',
        malformed: false,
      });
    } else {
      entries.push({
        eventId: env.event_id,
        kind: env.kind,
        origin: env.origin,
        status: 'invalid',
        effectiveIntegrity: 'invalid',
        malformed: false,
      });
    }
  }

  return {
    entries,
    needsAttention: verification.issues.length > 0 || malformedCount > 0,
    malformedCount,
    chainIssues: verification.issues,
    blocks,
  };
}

/* ---------------------------------------------------------------- *
 * append-only 追加
 * ---------------------------------------------------------------- */

export type AppendEventError = 'duplicate-event-id';

export type AppendEventResult =
  | { ok: true; /** 追加后的完整文档文本 */ text: string }
  | { ok: false; error: AppendEventError; message: string };

/** 事件块文本（含开闭 fence 与尾随空行）；导出供测试与展示层复用 */
export function renderEventBlock(envelope: EventEnvelope): string {
  return serializeEventBlock(envelope);
}

/**
 * 向 changelog/insights 末尾追加一个规范事件块（R-02 append-only）：
 *  - 原文前缀字节不动，仅尾部追加（原文不以换行结尾时先补足一个空行分隔）；
 *  - 追加的分隔符与新块沿用原文行终止符风格（CRLF 文档不再引入裸 LF，评审 2026-10-22 低·2）；
 *  - humanNote 为人类说明，置于事件块之前的块外自由文本（不驱动状态）；
 *  - 同 event_id 已存在于文档 → 拒绝（duplicate-event-id），不产生重复块。
 */
export function appendEventBlock(
  md: string,
  envelope: EventEnvelope,
  humanNote?: string,
): AppendEventResult {
  const parsed = parseFencedTaskBlocks(md, EVENT_BLOCK_INFO);
  for (const node of parsed.nodes) {
    const id = node.fields.find((f) => f.key === 'event_id')?.value.trim().toUpperCase();
    if (id === envelope.event_id.toUpperCase()) {
      return {
        ok: false,
        error: 'duplicate-event-id',
        message: `event_id ${envelope.event_id} 已存在于文档中，append-only 日志拒绝重复追加（B-13 幂等由读取侧保证，写入侧保持日志干净）`,
      };
    }
  }
  const eol = detectEol(md);
  let out = md;
  if (out.length > 0 && !out.endsWith(eol)) out += eol;
  if (out.length > 0 && !out.endsWith(eol + eol)) out += eol;
  if (humanNote !== undefined && humanNote.trim() !== '') {
    out += humanNote.trimEnd().replace(/\r?\n/g, eol) + eol;
  }
  out += serializeEventBlock(envelope).replace(/\n/g, eol); // serializeEventBlock 末尾自带一个空行
  return { ok: true, text: out };
}

/** 文档行终止符风格：优先看最后一个换行，无换行则看首个换行，全无则 LF */
function detectEol(md: string): '\n' | '\r\n' {
  const last = md.lastIndexOf('\n');
  if (last > 0 && md[last - 1] === '\r') return '\r\n';
  const first = md.indexOf('\n');
  if (first > 0 && md[first - 1] === '\r') return '\r\n';
  return '\n';
}
