/**
 * 事件来源收据机制（T-M0a-04；基准 3.5「持久来源收据」/ D-21 v2.1a / P-09 / B-10 / B-11）。
 *
 * 定稿要点：
 *  - 收据只为 core 权威事件生成（origin=core）；managed-api / manual 事件不入链，
 *    加载时按 S2.1-04 判定 external-unverified（有效 integrity=unknown，不驱动状态）；
 *  - 收据条目：{ event_id, seq, content_hash, prev_hash, receipt_hash }
 *      content_hash = sha256(规范事件块序列化文本)——与 serializeEventBlock 同源，杜绝双口径；
 *      receipt_hash = sha256(prev_hash | event_id | seq | content_hash)——链式绑定内容与顺序；
 *      seq 从 1 起严格递增，是 B-16「可信 sequence 折叠」的 sequence 来源；
 *  - 锚点：{ schema_version, algorithm, chain_head, length, generated_at }，存 git 忽略的
 *    本地安全位置；位置与读写由存储层（M0b）承接，core 只定义 schema 与验证语义；
 *  - 加载时验证内容+顺序；验证失败 → integrity=invalid，不参与折叠、进入「需处理」状态、
 *    不静默重算（B-10/B-11）；
 *  - 锚点缺失 ≠ 锚点不符：换机/本地锚点丢失走基准「来源未知」恢复流程——链上事件一律
 *    降为 unknown（不参与推导）并进入「需处理」，等待项目负责人重新锚定，绝不静默重算。
 *
 * 纯字符串计算，无 IO（core 纯度约束）。
 */

import { sha256Hex } from './hash.js';
import { serializeEventBlock, type EventEnvelope } from './eventEnvelope.js';

/** 收据/锚点 schema 版本（当前 v1；升级走契约迁移 T-M3-03，不静默变更） */
export const RECEIPT_SCHEMA_VERSION = '1';

/** 哈希算法标识（固定 sha256；收据与锚点均携带，防静默换算法） */
export const RECEIPT_ALGORITHM = 'sha256';

/** 链首 prev_hash（全零），使首条收据与空链锚点均有确定值 */
export const GENESIS_PREV_HASH = '0'.repeat(64);

/** 单条收据（core 权威事件的来源证明，append-only） */
export interface EventReceipt {
  event_id: string;
  /** 链内序号，1 起始严格递增（B-16 折叠的可信 sequence） */
  seq: number;
  /** 事件规范序列化文本的 SHA-256（64 hex） */
  content_hash: string;
  /** 前一条收据的 receipt_hash；首条为 GENESIS_PREV_HASH */
  prev_hash: string;
  /** 本条收据的链哈希（64 hex） */
  receipt_hash: string;
}

/** 本地锚点（对收据链链头的承诺；存 git 忽略的本地安全位置，不在被管 Markdown 内） */
export interface ReceiptAnchor {
  schema_version: string;
  algorithm: string;
  /** 链头 receipt_hash；空链为 GENESIS_PREV_HASH */
  chain_head: string;
  /** 链长（收据条数） */
  length: number;
  /** 锚点生成时间（ISO 8601 带时区；由调用方注入时钟） */
  generated_at: string;
}

/**
 * 按事件顺序构建收据链（仅接受 origin=core 的事件；写入方应在生成事件时同步追加）。
 * 混入非 core 事件 → 抛出（写入方 bug，不静默忽略）。
 */
export function buildReceiptChain(envelopes: readonly EventEnvelope[]): EventReceipt[] {
  const receipts: EventReceipt[] = [];
  let prevHash = GENESIS_PREV_HASH;
  for (const [i, ev] of envelopes.entries()) {
    if (ev.origin !== 'core') {
      throw new Error(`收据链仅接受 origin=core 的事件，收到 origin=${ev.origin}（event_id=${ev.event_id}）`);
    }
    const contentHash = sha256Hex(serializeEventBlock(ev));
    const receiptHash = sha256Hex(`${prevHash}|${ev.event_id}|${i + 1}|${contentHash}`);
    receipts.push({
      event_id: ev.event_id,
      seq: i + 1,
      content_hash: contentHash,
      prev_hash: prevHash,
      receipt_hash: receiptHash,
    });
    prevHash = receiptHash;
  }
  return receipts;
}

/** 由收据链生成锚点（generated_at 由调用方注入时钟，core 不取系统时间） */
export function buildAnchor(receipts: readonly EventReceipt[], generatedAt: string): ReceiptAnchor {
  const last = receipts[receipts.length - 1];
  return {
    schema_version: RECEIPT_SCHEMA_VERSION,
    algorithm: RECEIPT_ALGORITHM,
    chain_head: last ? last.receipt_hash : GENESIS_PREV_HASH,
    length: receipts.length,
    generated_at: generatedAt,
  };
}

/** 有效完整性判定（信封自述 integrity 之外、经收据验证后的裁定值） */
export type ReceiptVerdict = 'verified' | 'invalid' | 'unregistered';

/** 链验证问题码（全部进入「需处理」，不静默重算） */
export type ChainIssueCode =
  | 'content-hash-mismatch'      // B-10：事件内容与收据不符（伪造/篡改）
  | 'receipt-chain-broken'       // 收据链自身断裂（prev_hash/receipt_hash 复算不符）
  | 'duplicate-receipt'          // 同 event_id 或同 seq 收据重复（收据库异常）
  | 'missing-event-in-document'  // B-11：收据存在但文档中事件被删除
  | 'anchor-mismatch'            // B-11：锚点与复算链头不符（收据库或锚点被改）
  | 'anchor-missing'             // 有收据无锚点：走「来源未知」恢复流程（换机/密钥丢失）
  | 'document-order-mismatch';   // 文档顺序 ≠ 链序：可观察的异常（投影仍按链序，如实标注）

export interface ChainIssue {
  code: ChainIssueCode;
  message: string;
  seq?: number;
  event_id?: string;
}

/** 每个解析出的事件块（按文档顺序）的裁定 */
export interface EventVerdict {
  event_id: string;
  verdict: ReceiptVerdict;
  /** verified 事件对应的链内序号 */
  seq?: number;
}

export interface ChainVerificationResult {
  /** 与输入 envelopes 同序，逐块裁定 */
  perEvent: EventVerdict[];
  /** 全部链问题（含文档级异常） */
  issues: ChainIssue[];
  /** true = 投影进入「需处理」状态（B-11），调用方不得静默忽略 */
  needsAttention: boolean;
  /** 复算后的链头（锚点比对基准；空链为 GENESIS_PREV_HASH） */
  recomputedHead: string;
}

const isHex64 = (s: string): boolean => /^[0-9a-f]{64}$/.test(s);

/**
 * 加载时验证：文档中解析出的事件（文档序）× 收据库 × 本地锚点。
 *
 * 裁定规则：
 *  - event_id 未在收据链登记 → unregistered（S2.1-04 external-unverified → 有效 integrity=unknown）；
 *  - 事件内容哈希 ≠ 收据 content_hash → invalid（B-10 伪造 / 内容篡改）；
 *  - 收据链复算断裂 / 锚点不符 → 全链事件 invalid（B-11，宁严勿漏）；
 *  - 有收据无锚点 → 全链事件 unknown（「来源未知」恢复流程，不静默重算）；
 *  - 同一 event_id 在文档中出现多块：逐块按内容独立裁定（相同内容同验真，篡改块判 invalid）。
 */
export function verifyEventChain(
  envelopes: readonly EventEnvelope[],
  receipts: readonly EventReceipt[],
  anchor: ReceiptAnchor | null,
): ChainVerificationResult {
  const issues: ChainIssue[] = [];

  // 1) 收据库自身完整性：复算 receipt_hash 与链式结构
  let prevHash = GENESIS_PREV_HASH;
  const byEventId = new Map<string, EventReceipt>();
  const bySeq = new Map<number, EventReceipt>();
  for (const [i, r] of receipts.entries()) {
    const expectHash = sha256Hex(`${r.prev_hash}|${r.event_id}|${r.seq}|${r.content_hash}`);
    const shapeOk =
      isHex64(r.content_hash) && isHex64(r.receipt_hash) && isHex64(r.prev_hash) &&
      r.seq === i + 1 && r.prev_hash === prevHash && r.receipt_hash === expectHash;
    if (!shapeOk) {
      issues.push({
        code: 'receipt-chain-broken',
        message: `收据链在第 ${i + 1} 条处断裂（receipt_hash 复算不符或顺序异常），全链事件降级`,
        seq: r.seq,
        event_id: r.event_id,
      });
      prevHash = r.receipt_hash; // 继续向后复算，尽量暴露后续更多断点
    } else {
      prevHash = r.receipt_hash;
    }
    if (byEventId.has(r.event_id)) {
      issues.push({ code: 'duplicate-receipt', message: `收据库中 event_id 重复登记：${r.event_id}`, seq: r.seq, event_id: r.event_id });
    } else {
      byEventId.set(r.event_id, r);
    }
    if (bySeq.has(r.seq)) {
      issues.push({ code: 'duplicate-receipt', message: `收据库中 seq 重复：${r.seq}`, seq: r.seq, event_id: r.event_id });
    } else {
      bySeq.set(r.seq, r);
    }
  }
  const recomputedHead = prevHash;

  // 2) 锚点判定（决定全链置信基调）；收据链断裂 = 收据库完整性已破，与锚点不符同严处理
  const chainBroken = issues.some((i) => i.code === 'receipt-chain-broken');
  let anchorState: 'ok' | 'mismatch' | 'missing' = 'ok';
  if (receipts.length > 0 && anchor === null) {
    anchorState = 'missing';
    issues.push({
      code: 'anchor-missing',
      message: '存在收据但本地锚点缺失（换机或锚点丢失）：按「来源未知」恢复流程处理，链上事件不参与推导，待项目负责人重新锚定，不静默重算',
    });
  } else if (anchor !== null && (anchor.chain_head !== recomputedHead || anchor.length !== receipts.length)) {
    anchorState = 'mismatch';
    issues.push({
      code: 'anchor-mismatch',
      message: `锚点与复算链头不符（锚点 head=${anchor.chain_head.slice(0, 8)}…/len=${anchor.length}，复算 head=${recomputedHead.slice(0, 8)}…/len=${receipts.length}）：疑似收据库或锚点被改（B-11），全链降级且进入需处理`,
    });
  }

  // 3) 逐块裁定（文档序，与输入同序返回）
  const seenInDoc = new Set<string>();
  const perEvent: EventVerdict[] = [];
  for (const ev of envelopes) {
    const receipt = byEventId.get(ev.event_id);
    let verdict: ReceiptVerdict;
    let seq: number | undefined;
    if (!receipt) {
      verdict = 'unregistered'; // S2.1-04：未登记 → external-unverified（有效 integrity=unknown）
    } else {
      // 先做内容比对（锚点异常时伪造事件同样要暴露），再按锚点状态降级
      const actual = sha256Hex(serializeEventBlock(ev));
      if (actual !== receipt.content_hash) {
        verdict = 'invalid'; // B-10：内容与收据不符
        issues.push({
          code: 'content-hash-mismatch',
          message: `事件 ${ev.event_id} 内容与收据不符（疑似伪造或篡改，B-10）：integrity=invalid，不参与状态推导`,
          seq: receipt.seq,
          event_id: ev.event_id,
        });
      } else if (anchorState === 'mismatch' || chainBroken) {
        verdict = 'invalid'; // B-11：链头与锚点不符或收据链断裂，宁严勿漏，全链降级
      } else if (anchorState === 'missing') {
        verdict = 'unregistered'; // 「来源未知」恢复流程：内容验真但无锚点背书，不参与推导
      } else {
        verdict = 'verified';
        seq = receipt.seq;
      }
    }
    if (seenInDoc.has(ev.event_id)) {
      issues.push({
        code: 'document-order-mismatch',
        message: `事件 ${ev.event_id} 在文档中重复出现（幂等折叠取首笔，B-13 口径），如实标注`,
        event_id: ev.event_id,
      });
    }
    seenInDoc.add(ev.event_id);
    perEvent.push({ event_id: ev.event_id, verdict, ...(seq !== undefined ? { seq } : {}) });
  }

  // 4) 文档缺失事件（B-11 删除）与文档序 ≠ 链序（可观察异常）
  const presentIds = new Set(envelopes.map((e) => e.event_id));
  for (const r of receipts) {
    if (!presentIds.has(r.event_id)) {
      issues.push({
        code: 'missing-event-in-document',
        message: `收据 seq=${r.seq}（event_id=${r.event_id}）对应事件在文档中缺失：疑似删除历史事件（B-11），进入需处理`,
        seq: r.seq,
        event_id: r.event_id,
      });
    }
  }
  const verifiedSorted = perEvent
    .filter((v): v is EventVerdict & { seq: number } => v.verdict === 'verified')
    .sort((a, b) => a.seq - b.seq);
  const docOrderVerified = perEvent.filter((v) => v.verdict === 'verified');
  const orderMismatch = verifiedSorted.some((v, i) => docOrderVerified[i] !== undefined && docOrderVerified[i]!.event_id !== v.event_id);
  if (orderMismatch) {
    issues.push({
      code: 'document-order-mismatch',
      message: '文档中事件顺序与收据链序不一致：内容均验真，投影仍按可信 sequence 折叠（B-16），顺序异常如实标注',
    });
  }

  return {
    perEvent,
    issues,
    needsAttention: issues.length > 0,
    recomputedHead,
  };
}
