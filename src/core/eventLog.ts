/**
 * changelog/insights 规范事件块解析器（T-M0b-02；基准 3.5 / S2.1-04 / P-09 / R-02）。
 *
 * 在 T-M0a-03（信封 schema）与 T-M0a-04（收据验证）之上提供事件日志的两个面：
 *
 *  1. 投影（projectEventLog）：解析文档全部事件块 → 结合收据库与本地锚点逐事件裁定：
 *       - verified            ：收据链登记且内容/顺序/锚点全部验真（有效 integrity=verified）；
 *       - external-unverified ：格式合法但未在收据链登记（S2.1-04；有效 integrity=unknown，
 *                               不驱动状态——manual/managed-api 事件天然落在此类，属正常态）；
 *       - invalid             ：内容与收据不符（B-10）或锚点/链完整性破坏（B-11）；
 *       - malformed           ：信封存在致命缺陷（含缺少合法 event_id）不产信封，
 *                               原文保留于 blocks，诊断逐块透传（有效 integrity=unknown）。
 *     链级问题（B-11 需处理）透传为 needsAttention，调用方不得静默忽略。
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

/** 事件在日志中的有效地位（T-M0b-02 投影口径） */
export type EventLogStatus = 'verified' | 'external-unverified' | 'invalid' | 'malformed';

export interface EventLogEntry {
  /** 事件 id；malformed（含缺少合法 event_id）为 null */
  eventId: string | null;
  kind: EventKind | null;
  origin: EventOrigin | null;
  status: EventLogStatus;
  /** 投影消费方应采用的有效完整性（status 的 integrity 投影） */
  effectiveIntegrity: EventIntegrity;
  /** verified 事件的收据链序号（可信 sequence，B-16） */
  seq?: number;
  /** malformed 事件的信封诊断（该块内的缺陷全集） */
  diagnostics?: EnvelopeDiagnostic[];
}

export interface EventLogProjection {
  /** 文档序全部事件（含 malformed）；人类说明不在其中（块外自由文本） */
  entries: EventLogEntry[];
  /** true = 存在链级问题（B-11 需处理），调用方不得静默忽略 */
  needsAttention: boolean;
  /** 链级问题全集（锚点/内容/缺失/顺序等，eventReceipt 产出） */
  chainIssues: ChainIssue[];
  /** 底层块解析结果（span/raw 保留，供 reconstruct 与追加复用） */
  blocks: WbsParseResult;
}

/** 与 parseEventBlocks 相同的逐块构建：致命块直接落 malformed，块↔信封归属天然精确 */
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
 * 「缺少合法 event_id」双口径：ULID 格式非法或缺字段者不产信封 → malformed；
 * 格式合法但未在收据链登记者 → external-unverified（S2.1-04）。
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
  for (const b of perBlock) {
    if (b.envelope === null) {
      entries.push({
        eventId: null,
        kind: null,
        origin: null,
        status: 'malformed',
        effectiveIntegrity: 'unknown', // 不产信封即不参与推导；unknown 表示「不可验证」而非「已证伪」
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
      });
    } else if (verdict.verdict === 'verified') {
      entries.push({
        eventId: env.event_id,
        kind: env.kind,
        origin: env.origin,
        status: 'verified',
        effectiveIntegrity: 'verified',
        ...(verdict.seq !== undefined ? { seq: verdict.seq } : {}),
      });
    } else if (verdict.verdict === 'unregistered') {
      entries.push({
        eventId: env.event_id,
        kind: env.kind,
        origin: env.origin,
        status: 'external-unverified',
        effectiveIntegrity: 'unknown',
      });
    } else {
      entries.push({
        eventId: env.event_id,
        kind: env.kind,
        origin: env.origin,
        status: 'invalid',
        effectiveIntegrity: 'invalid',
      });
    }
  }

  return {
    entries,
    needsAttention: verification.issues.length > 0,
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
  let out = md;
  if (out.length > 0 && !out.endsWith('\n')) out += '\n';
  if (out.length > 0 && !out.endsWith('\n\n')) out += '\n';
  if (humanNote !== undefined && humanNote.trim() !== '') {
    out += humanNote.trimEnd() + '\n';
  }
  out += serializeEventBlock(envelope); // serializeEventBlock 末尾自带一个空行
  return { ok: true, text: out };
}
