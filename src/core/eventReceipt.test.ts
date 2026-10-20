import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { sha256Hex, sha256HexBytes } from './hash.js';
import {
  GENESIS_PREV_HASH,
  buildAnchor,
  buildReceiptChain,
  verifyEventChain,
  type EventReceipt,
  type ReceiptAnchor,
} from './eventReceipt.js';
import { serializeEventBlock, type EventEnvelope } from './eventEnvelope.js';

/* ---------------------------------------------------------------- *
 * hash：已知向量 + 与 node:crypto 对拍（W-06：验证可复核，不用自证）
 * ---------------------------------------------------------------- */

describe('sha256Hex（纯实现，T-M0a-04）', () => {
  const cases: Array<[string, string]> = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ];

  for (const [input, expected] of cases) {
    it(`已知向量：${JSON.stringify(input)}`, () => {
      expect(sha256Hex(input)).toBe(expected);
    });
  }

  // 覆盖多字节中文、跨块长度、56 mod 64 填充边界（需额外填充块）等情形
  const crossCheck = ['一休PM（Gatedeck）事件收据', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64), 'w'.repeat(1000)];
  for (const input of crossCheck) {
    it(`与 node:crypto 对拍：长度 ${Buffer.byteLength(input)} 字节`, () => {
      expect(sha256Hex(input)).toBe(createHash('sha256').update(input, 'utf8').digest('hex'));
    });
  }

  it('sha256HexBytes 与字符串入口一致（UTF-8 编码）', () => {
    const bytes = new TextEncoder().encode('一休PM');
    expect(sha256HexBytes(bytes)).toBe(sha256Hex('一休PM'));
  });
});

/* ---------------------------------------------------------------- *
 * 收据链构建与验证
 * ---------------------------------------------------------------- */

// 合法 ULID 夹具（26 位 Crockford Base32，避开 I/L/O/U）
const ACTOR = { actor_id: '01HXA8T0R00000000000000000', session_id: '01HXSESSN00000000000000000' };

let ulidCounter = 0;
function nextUlid(): string {
  ulidCounter++;
  return `01J9EVT${String(ulidCounter).padStart(4, '0')}000000000000000`;
}

/** 造一个 core 权威事件（默认 project.initialized / promotion.completed） */
function coreEvent(kind: EventEnvelope['kind'], payload: Record<string, unknown>, occurredAt: string): EventEnvelope {
  return {
    event_id: nextUlid(),
    schema_version: '1',
    kind,
    occurred_at: occurredAt,
    recorded_at: occurredAt,
    actor: ACTOR,
    origin: 'core',
    integrity: 'verified',
    subject: { object_id: 'proj:gatedeck' },
    payload,
  };
}

const STAGES = ['M0a', 'M0b', 'M1', 'M2a', 'M2b', 'M3'];

/** 标准样本：初始化 + 两次合法推进（occurred_at 故意乱序，验证折叠只认链序） */
function sampleStream(): EventEnvelope[] {
  return [
    coreEvent('project.initialized', { project_id: 'proj:gatedeck', stage_order: STAGES }, '2026-10-20T01:00:00Z'),
    coreEvent('promotion.completed', { from: 'M0a', to: 'M0b', expected_sequence: 2 }, '2026-10-20T03:00:00Z'),
    coreEvent('promotion.completed', { from: 'M0b', to: 'M1', expected_sequence: 3 }, '2026-10-20T02:00:00Z'),
  ];
}

describe('buildReceiptChain / buildAnchor（T-M0a-04）', () => {
  it('链式结构：seq 严格递增、首条 prev 为 GENESIS、receipt_hash 可复算', () => {
    const events = sampleStream();
    const receipts = buildReceiptChain(events);
    expect(receipts.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(receipts[0]!.prev_hash).toBe(GENESIS_PREV_HASH);
    let prev = GENESIS_PREV_HASH;
    for (const [i, r] of receipts.entries()) {
      expect(r.prev_hash).toBe(prev);
      const contentHash = createHash('sha256').update(serializeEventBlock(events[i]!), 'utf8').digest('hex');
      expect(r.content_hash).toBe(contentHash);
      expect(r.receipt_hash).toBe(
        createHash('sha256').update(`${prev}|${r.event_id}|${r.seq}|${contentHash}`, 'utf8').digest('hex'),
      );
      prev = r.receipt_hash;
    }
  });

  it('拒绝非 core 事件入链（收据只为权威事件生成）', () => {
    const manual = { ...coreEvent('note', {}, '2026-10-20T01:00:00Z'), origin: 'manual' as const, integrity: 'unknown' as const };
    expect(() => buildReceiptChain([manual as EventEnvelope])).toThrow(/origin=manual/);
  });

  it('锚点 = 链头承诺；空链为 GENESIS', () => {
    const receipts = buildReceiptChain(sampleStream());
    const anchor = buildAnchor(receipts, '2026-10-20T03:30:00Z');
    expect(anchor.chain_head).toBe(receipts[receipts.length - 1]!.receipt_hash);
    expect(anchor.length).toBe(receipts.length);
    expect(anchor.algorithm).toBe('sha256');
    expect(buildAnchor([], '2026-10-20T03:30:00Z').chain_head).toBe(GENESIS_PREV_HASH);
  });
});

describe('verifyEventChain（加载时验证，B-10/B-11）', () => {
  it('全链健康：逐块 verified、无问题、不需处理', () => {
    const events = sampleStream();
    const receipts = buildReceiptChain(events);
    const anchor = buildAnchor(receipts, '2026-10-20T03:30:00Z');
    const result = verifyEventChain(events, receipts, anchor);
    expect(result.perEvent.map((v) => v.verdict)).toEqual(['verified', 'verified', 'verified']);
    expect(result.perEvent.map((v) => v.seq)).toEqual([1, 2, 3]);
    expect(result.issues).toEqual([]);
    expect(result.needsAttention).toBe(false);
  });

  it('B-10 手工伪造：复制合法事件并改 payload → 内容与收据不符 → invalid，不参与推导', () => {
    const events = sampleStream();
    const receipts = buildReceiptChain(events);
    const anchor = buildAnchor(receipts, '2026-10-20T03:30:00Z');
    const forged: EventEnvelope = {
      ...events[1]!,
      payload: { from: 'M0a', to: 'M3', expected_sequence: 2 }, // 越级伪造推进
    };
    const result = verifyEventChain([events[0]!, forged, events[2]!], receipts, anchor);
    expect(result.perEvent[1]!.verdict).toBe('invalid');
    expect(result.issues.some((i) => i.code === 'content-hash-mismatch' && i.event_id === forged.event_id)).toBe(true);
    expect(result.needsAttention).toBe(true);
  });

  it('B-11 删除历史事件：收据存在而文档缺失 → 需处理，不静默重算', () => {
    const events = sampleStream();
    const receipts = buildReceiptChain(events);
    const anchor = buildAnchor(receipts, '2026-10-20T03:30:00Z');
    const result = verifyEventChain([events[0]!, events[2]!], receipts, anchor); // 删掉 seq=2
    expect(result.issues.some((i) => i.code === 'missing-event-in-document' && i.seq === 2)).toBe(true);
    expect(result.needsAttention).toBe(true);
    expect(result.recomputedHead).toBe(anchor.chain_head); // 链自身完好，缺的是文档事件
  });

  it('B-11 文档重排：内容均验真但文档序 ≠ 链序 → 如实标注（投影仍按链序）', () => {
    const events = sampleStream();
    const receipts = buildReceiptChain(events);
    const anchor = buildAnchor(receipts, '2026-10-20T03:30:00Z');
    const result = verifyEventChain([events[2]!, events[0]!, events[1]!], receipts, anchor);
    expect(result.perEvent.every((v) => v.verdict === 'verified')).toBe(true);
    expect(result.issues.some((i) => i.code === 'document-order-mismatch')).toBe(true);
  });

  it('锚点不符：全链降级 invalid（收据库或锚点被改，宁严勿漏）', () => {
    const events = sampleStream();
    const receipts = buildReceiptChain(events);
    const tampered: ReceiptAnchor = { ...buildAnchor(receipts, '2026-10-20T03:30:00Z'), chain_head: 'f'.repeat(64) };
    const result = verifyEventChain(events, receipts, tampered);
    expect(result.perEvent.every((v) => v.verdict === 'invalid')).toBe(true);
    expect(result.issues.some((i) => i.code === 'anchor-mismatch')).toBe(true);
    expect(result.needsAttention).toBe(true);
  });

  it('锚点缺失：走「来源未知」恢复流程 → 链上事件 unknown（unregistered），不静默重算', () => {
    const events = sampleStream();
    const receipts = buildReceiptChain(events);
    const result = verifyEventChain(events, receipts, null);
    expect(result.perEvent.every((v) => v.verdict === 'unregistered')).toBe(true);
    expect(result.issues.some((i) => i.code === 'anchor-missing')).toBe(true);
    expect(result.needsAttention).toBe(true);
  });

  it('S2.1-04 未登记事件：manual 追加 / 外部事件 → unregistered（有效 integrity=unknown）', () => {
    const events = sampleStream();
    const receipts = buildReceiptChain(events);
    const anchor = buildAnchor(receipts, '2026-10-20T03:30:00Z');
    const manual: EventEnvelope = {
      ...coreEvent('promotion.completed', { from: 'M1', to: 'M3', expected_sequence: 4 }, '2026-10-20T04:00:00Z'),
      origin: 'manual',
      integrity: 'unknown',
    };
    const result = verifyEventChain([...events, manual], receipts, anchor);
    expect(result.perEvent[3]!.verdict).toBe('unregistered');
    expect(result.perEvent.slice(0, 3).every((v) => v.verdict === 'verified')).toBe(true);
  });

  it('同一 event_id 文档内重复出现：逐块独立裁定，重复如实标注', () => {
    const events = sampleStream();
    const receipts = buildReceiptChain(events);
    const anchor = buildAnchor(receipts, '2026-10-20T03:30:00Z');
    const tamperedCopy: EventEnvelope = { ...events[1]!, payload: { from: 'M0a', to: 'M2a', expected_sequence: 2 } };
    const result = verifyEventChain([...events, tamperedCopy], receipts, anchor);
    expect(result.perEvent[1]!.verdict).toBe('verified');
    expect(result.perEvent[3]!.verdict).toBe('invalid'); // 同 id 篡改副本单独判 invalid
    expect(result.issues.filter((i) => i.event_id === events[1]!.event_id).length).toBeGreaterThanOrEqual(2);
  });

  it('收据链自身断裂：复算不符 → 全链 invalid（防收据库整体伪造）', () => {
    const events = sampleStream();
    const receipts: EventReceipt[] = buildReceiptChain(events).map((r, i) =>
      i === 1 ? { ...r, content_hash: 'a'.repeat(64) } : r, // 篡改中间条目 content_hash，链复算断裂
    );
    const anchor = buildAnchor(buildReceiptChain(events), '2026-10-20T03:30:00Z');
    const result = verifyEventChain(events, receipts, anchor);
    expect(result.issues.some((i) => i.code === 'receipt-chain-broken')).toBe(true);
    expect(result.perEvent.every((v) => v.verdict === 'invalid')).toBe(true);
  });
});
