import { describe, expect, it } from 'vitest';

import { serializeEventBlock, type EventEnvelope } from './eventEnvelope.js';
import { buildAnchor, buildReceiptChain, type EventReceipt, type ReceiptAnchor } from './eventReceipt.js';
import { reconstruct } from './wbsSyntax.js';
import {
  appendEventBlock,
  projectEventLog,
  renderEventBlock,
} from './eventLog.js';

/** 合法 ULID（26 位 Crockford Base32） */
const ID_1 = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ID_2 = '01ARZ3NDEKTSV4RRFFQ69G5FAW';

function env(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    event_id: ID_1,
    schema_version: '1',
    kind: 'task.transitioned',
    occurred_at: '2026-10-21T23:30:00+08:00',
    recorded_at: '2026-10-21T23:30:00+08:00',
    actor: { actor_id: 'a-local-01', session_id: 's-local-01' },
    origin: 'core',
    integrity: 'verified',
    subject: { object_id: 'wbs:T-A' },
    payload: { from: 'todo', to: 'doing' },
    ...overrides,
  };
}

const TS = '2026-10-21T23:30:00+08:00';

function chained(...events: EventEnvelope[]): { receipts: EventReceipt[]; anchor: ReceiptAnchor } {
  const receipts = buildReceiptChain(events);
  return { receipts, anchor: buildAnchor(receipts, TS) };
}

describe('T-M0b-02 · 事件日志投影', () => {
  it('core 事件在收据链且锚点验真 → verified + 可信 seq；无链问题', () => {
    const e1 = env();
    const { receipts, anchor } = chained(e1);
    const p = projectEventLog(serializeEventBlock(e1), receipts, anchor);
    expect(p.entries).toHaveLength(1);
    expect(p.entries[0]).toMatchObject({
      eventId: ID_1,
      kind: 'task.transitioned',
      origin: 'core',
      status: 'verified',
      effectiveIntegrity: 'verified',
      seq: 1,
    });
    expect(p.needsAttention).toBe(false);
    expect(p.chainIssues).toHaveLength(0);
  });

  it('manual 事件未登记 → external-unverified（S2.1-04，正常态非异常）', () => {
    const manual = env({ event_id: ID_2, origin: 'manual', kind: 'note', integrity: 'unknown', payload: { text: '手工记录' } });
    const p = projectEventLog(serializeEventBlock(manual), [], null);
    expect(p.entries[0]).toMatchObject({ eventId: ID_2, status: 'external-unverified', effectiveIntegrity: 'unknown' });
    expect(p.needsAttention).toBe(false); // 无收据库时未登记不算链问题
  });

  it('core 事件未在收据链登记 → external-unverified（降权不驱动状态）', () => {
    const e1 = env();
    const p = projectEventLog(serializeEventBlock(e1), [], null);
    expect(p.entries[0]!.status).toBe('external-unverified');
    expect(p.entries[0]!.effectiveIntegrity).toBe('unknown');
  });

  it('事件内容与收据不符 → invalid（B-10）+ needsAttention', () => {
    const e1 = env();
    const { receipts, anchor } = chained(e1);
    const tampered = serializeEventBlock(e1).replace('"from":"todo"', '"from":"draft"');
    const p = projectEventLog(tampered, receipts, anchor);
    expect(p.entries[0]!.status).toBe('invalid');
    expect(p.entries[0]!.effectiveIntegrity).toBe('invalid');
    expect(p.needsAttention).toBe(true);
    expect(p.chainIssues.some((i) => i.code === 'content-hash-mismatch')).toBe(true);
  });

  it('有收据无锚点（换机/丢失）→ 来源未知：core 事件降 external-unverified + needsAttention，不静默重算', () => {
    const e1 = env();
    const receipts = buildReceiptChain([e1]);
    const p = projectEventLog(serializeEventBlock(e1), receipts, null);
    expect(p.entries[0]!.status).toBe('external-unverified');
    expect(p.needsAttention).toBe(true);
    expect(p.chainIssues.some((i) => i.code === 'anchor-missing')).toBe(true);
  });

  it('锚点与复算链头不符 → invalid（B-11 宁严勿漏）+ needsAttention', () => {
    const e1 = env();
    const { receipts, anchor } = chained(e1);
    const badAnchor: ReceiptAnchor = { ...anchor, length: anchor.length + 1 };
    const p = projectEventLog(serializeEventBlock(e1), receipts, badAnchor);
    expect(p.entries[0]!.status).toBe('invalid');
    expect(p.chainIssues.some((i) => i.code === 'anchor-mismatch')).toBe(true);
  });

  it('event_id 非法 ULID → external-unverified（S2.1-04「缺少合法 event_id」）+ malformed 子标记，原文保留', () => {
    const e1 = env();
    const badBlock = serializeEventBlock(e1).replace(`event_id: ${ID_1}`, 'event_id: NOT-A-ULID');
    const p = projectEventLog(badBlock, [], null);
    expect(p.entries).toHaveLength(1);
    expect(p.entries[0]!.status).toBe('external-unverified');
    expect(p.entries[0]!.effectiveIntegrity).toBe('unknown');
    expect(p.entries[0]!.malformed).toBe(true);
    expect(p.entries[0]!.eventId).toBeNull();
    expect(p.entries[0]!.diagnostics!.some((d) => d.code === 'bad-format')).toBe(true);
    // 信封致命缺陷不得静默忽略（P-08）
    expect(p.malformedCount).toBe(1);
    expect(p.needsAttention).toBe(true);
    // 原文保留于 blocks（round-trip 不丢字节）
    expect(reconstruct(badBlock, p.blocks)).toBe(badBlock);
  });

  it('块内完全缺失 event_id 字段 → external-unverified + malformed（missing-field）', () => {
    const e1 = env();
    const noId = serializeEventBlock(e1).replace(`event_id: ${ID_1}\n`, '');
    const p = projectEventLog(noId, [], null);
    expect(p.entries[0]!.status).toBe('external-unverified');
    expect(p.entries[0]!.malformed).toBe(true);
    expect(p.entries[0]!.diagnostics!.some((d) => d.code === 'missing-field')).toBe(true);
    expect(p.needsAttention).toBe(true);
  });

  it('混合文档：malformed 块不干扰其他事件裁定（文档序保持）', () => {
    const e1 = env();
    const manual = env({ event_id: ID_2, origin: 'manual', kind: 'note', integrity: 'unknown', payload: {} });
    const badBlock = serializeEventBlock(e1).replace(`event_id: ${ID_1}`, 'event_id: 残缺');
    const md = badBlock + '\n' + serializeEventBlock(manual);
    const p = projectEventLog(md, [], null);
    expect(p.entries.map((e) => e.status)).toEqual(['external-unverified', 'external-unverified']);
    expect(p.entries[0]!.malformed).toBe(true);
    expect(p.entries[1]!.malformed).toBe(false);
    expect(p.entries[1]!.eventId).toBe(ID_2);
    expect(p.malformedCount).toBe(1);
  });

  it('块外人类说明不产生条目；空文档投影为空', () => {
    const e1 = env();
    const md = '项目负责人批注：本次状态迁移已口头确认。\n\n' + serializeEventBlock(e1);
    const p1 = projectEventLog(md, [], null);
    expect(p1.entries).toHaveLength(1);
    const p2 = projectEventLog('', [], null);
    expect(p2.entries).toHaveLength(0);
    expect(p2.needsAttention).toBe(false);
  });

  it('投影携带 blocks：解析→重建字节级一致（LF 与 CRLF）', () => {
    const e1 = env();
    const lf = '前文说明。\n\n' + serializeEventBlock(e1);
    expect(reconstruct(lf, projectEventLog(lf, [], null).blocks)).toBe(lf);
    const crlf = lf.replace(/\n/g, '\r\n');
    expect(reconstruct(crlf, projectEventLog(crlf, [], null).blocks)).toBe(crlf);
  });
});

describe('T-M0b-02 · append-only 追加（R-02）', () => {
  it('正常追加：前缀字节不动，新块在末尾且可解析回信封', () => {
    const e1 = env();
    const e2 = env({ event_id: ID_2, origin: 'manual', kind: 'note', integrity: 'unknown', payload: { note: '追加记录' } });
    const base = serializeEventBlock(e1);
    const r = appendEventBlock(base, e2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text.startsWith(base)).toBe(true);
    // base 以单换行结尾 → 追加侧补一个空行分隔，再接新事件块
    expect(r.text.slice(base.length)).toBe('\n' + serializeEventBlock(e2));
    const p = projectEventLog(r.text, [], null);
    expect(p.entries.map((e) => e.eventId)).toEqual([ID_1, ID_2]);
  });

  it('原文不以换行结尾时补足空行分隔，前缀仍逐字节保留', () => {
    const e2 = env({ event_id: ID_2, origin: 'manual', kind: 'note', integrity: 'unknown', payload: {} });
    const r = appendEventBlock('末行无换行', e2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text.startsWith('末行无换行\n\n')).toBe(true);
  });

  it('空文档追加：结果即事件块本身', () => {
    const e2 = env({ event_id: ID_2, origin: 'manual', kind: 'note', integrity: 'unknown', payload: {} });
    const r = appendEventBlock('', e2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toBe(serializeEventBlock(e2));
  });

  it('humanNote 置于事件块之前的块外自由文本', () => {
    const e2 = env({ event_id: ID_2, origin: 'manual', kind: 'note', integrity: 'unknown', payload: {} });
    const r = appendEventBlock('', e2, '人工补充说明：补录昨晚的验证结论。');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain('人工补充说明：补录昨晚的验证结论。\n```gatedeck-event');
    const p = projectEventLog(r.text, [], null);
    expect(p.entries).toHaveLength(1); // 人类说明不产生条目
  });

  it('重复 event_id 拒绝追加（duplicate-event-id）', () => {
    const e1 = env();
    const dup = env({ payload: { from: 'done', to: 'todo' } });
    const r = appendEventBlock(serializeEventBlock(e1), dup);
    expect(r).toMatchObject({ ok: false, error: 'duplicate-event-id' });
  });

  it('连续多次追加保持 append-only（每次前缀一致）', () => {
    const a = env({ event_id: ID_1, origin: 'manual', kind: 'note', integrity: 'unknown', payload: { n: 1 } });
    const b = env({ event_id: ID_2, origin: 'manual', kind: 'note', integrity: 'unknown', payload: { n: 2 } });
    const r1 = appendEventBlock('', a);
    const t1 = r1.ok ? r1.text : '';
    const r2 = appendEventBlock(t1, b);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.text.startsWith(t1)).toBe(true);
    expect(t1.startsWith(serializeEventBlock(a))).toBe(true);
  });

  it('CRLF 文档追加：分隔符与新块沿用 CRLF，不引入裸 LF（低·2）', () => {
    const e1 = env();
    const e2 = env({ event_id: ID_2, origin: 'manual', kind: 'note', integrity: 'unknown', payload: {} });
    const base = serializeEventBlock(e1).replace(/\n/g, '\r\n');
    const r = appendEventBlock(base, e2, '第一行说明\n第二行说明');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text.startsWith(base)).toBe(true);
    // 前缀逐字节保留；追加区无「非 \r 的裸 \n」
    expect(/[^\r]\n/.test(r.text.slice(base.length))).toBe(false);
    expect(r.text.slice(base.length)).toContain('第一行说明\r\n第二行说明\r\n');
    const p = projectEventLog(r.text, [], null);
    expect(p.entries.map((e) => e.eventId)).toEqual([ID_1, ID_2]);
  });
});

describe('T-M0b-02 · renderEventBlock', () => {
  it('与 serializeEventBlock 同源（杜绝双口径）', () => {
    const e1 = env();
    expect(renderEventBlock(e1)).toBe(serializeEventBlock(e1));
  });
});
