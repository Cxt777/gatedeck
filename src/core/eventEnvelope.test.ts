import { describe, expect, it } from 'vitest';

import {
  buildEnvelope,
  parseEventBlocks,
  reconstructEvents,
  serializeEventBlock,
  type EventEnvelope,
} from './eventEnvelope.js';

const VALID: EventEnvelope = {
  event_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  schema_version: '1',
  kind: 'task.transitioned',
  occurred_at: '2026-10-19T23:45:00+08:00',
  recorded_at: '2026-10-19T23:45:00+08:00',
  actor: { actor_id: 'a-01', session_id: 's-01', tool: 'gatedeck-cli', model: 'glm-5.3' },
  origin: 'core',
  integrity: 'verified',
  subject: { object_id: 'T-M0a-03', manifest_hash: 'sha256:abc' },
  operation_id: '01ARZ3NDEKTSV4RRFFQ69G5FBW',
  payload: { from: 'doing', to: 'done' },
};

/** 带人类说明的真实样本：块外自由文本不参与状态推导 */
function docOf(...blocks: string[]): string {
  return [
    '# 变更留痕（人类说明可自由书写）',
    '',
    '> 本行是人类说明：机器权威字段只在事件块内。',
    '',
    ...blocks,
    '',
    '结束后还可以有自由文本。',
    '',
  ].join('\n');
}

describe('事件块语法 + 信封 schema（T-M0a-03）', () => {
  it('serialize → parse 深度等价；带人类说明的文档 round-trip 字节级一致', () => {
    const md = docOf(serializeEventBlock(VALID));
    const r = parseEventBlocks(md);
    expect(r.diagnostics).toEqual([]);
    expect(r.envelopes).toHaveLength(1);
    expect(r.envelopes[0]).toEqual(VALID);
    expect(reconstructEvents(md, r)).toBe(md);
  });

  it('人类说明留在块外：不出现在任何节点 raw 中', () => {
    const md = docOf(serializeEventBlock(VALID));
    const r = parseEventBlocks(md);
    for (const node of r.blocks.nodes) {
      expect(node.raw).not.toContain('人类说明');
    }
  });

  it('两个事件块共存时逐个解析、区间互不干扰', () => {
    const other: EventEnvelope = {
      ...VALID,
      event_id: '01ARZ3NDEKTSV4RRFFQ69G5FCX',
      kind: 'check.completed',
      payload: { gate: 'G-M0a', validation_status: '待验' },
    };
    const md = docOf(serializeEventBlock(VALID), '中间的人类说明。', serializeEventBlock(other));
    const r = parseEventBlocks(md);
    expect(r.diagnostics).toEqual([]);
    expect(r.envelopes).toHaveLength(2);
    expect(r.envelopes[1]!.kind).toBe('check.completed');
    expect(r.envelopes[1]!.payload).toEqual({ gate: 'G-M0a', validation_status: '待验' });
    expect(reconstructEvents(md, r)).toBe(md);
  });

  it('致命：缺失 event_id 事件不入信封序列，原文保留', () => {
    const block = serializeEventBlock(VALID).replace('event_id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n', '');
    const md = docOf(block);
    const r = parseEventBlocks(md);
    expect(r.envelopes).toHaveLength(0);
    expect(r.diagnostics.some((d) => d.code === 'missing-field' && d.message.includes('event_id'))).toBe(true);
    expect(reconstructEvents(md, r)).toBe(md);
  });

  it('致命：event_id 非 ULID 拒绝（26 位 Crockford 校验）', () => {
    const built = buildEnvelope([{ key: 'event_id', value: 'not-ulid' }, ...Object.entries(VALID).slice(1).map(([k, v]) => ({ key: k, value: typeof v === 'string' ? v : JSON.stringify(v) }))], () => 1);
    expect(built.envelope).toBeNull();
    expect(built.diagnostics.some((d) => d.code === 'bad-format' && d.message.includes('ULID'))).toBe(true);
  });

  it('致命：occurred_at/recorded_at 无时区拒绝，Z 与 ±HH:MM 均接受', () => {
    const noTz = { ...VALID, occurred_at: '2026-10-19T23:45:00' };
    const r1 = parseEventBlocks(docOf(serializeEventBlock(noTz)));
    expect(r1.envelopes).toHaveLength(0);
    expect(r1.diagnostics.some((d) => d.code === 'bad-format' && d.message.includes('occurred_at'))).toBe(true);

    const zulu = { ...VALID, occurred_at: '2026-10-19T15:45:00.500Z' };
    expect(parseEventBlocks(docOf(serializeEventBlock(zulu))).envelopes).toHaveLength(1);
  });

  it('致命：origin/integrity/kind 枚举越界拒绝', () => {
    const badOrigin = serializeEventBlock({ ...VALID, origin: 'ai' as never });
    const r1 = parseEventBlocks(docOf(badOrigin));
    expect(r1.envelopes).toHaveLength(0);
    expect(r1.diagnostics.some((d) => d.code === 'bad-enum' && d.message.includes('origin'))).toBe(true);

    const badIntegrity = serializeEventBlock({ ...VALID, integrity: 'ok' as never });
    const r2 = parseEventBlocks(docOf(badIntegrity));
    expect(r2.envelopes).toHaveLength(0);

    const badKind = serializeEventBlock({ ...VALID, kind: 'check.passed' as never });
    const r3 = parseEventBlocks(docOf(badKind));
    expect(r3.envelopes).toHaveLength(0);
    expect(r3.diagnostics.some((d) => d.code === 'bad-enum' && d.message.includes('kind'))).toBe(true);
  });

  it('B-4/B-17 口径：外部通道不可声明 core 专属 kind（kind-origin 兼容矩阵）', () => {
    const forged = serializeEventBlock({ ...VALID, origin: 'managed-api', kind: 'check.completed' });
    const r = parseEventBlocks(docOf(forged));
    expect(r.envelopes).toHaveLength(0);
    expect(r.diagnostics.some((d) => d.code === 'kind-origin-mismatch' && d.message.includes('B-4/B-17'))).toBe(true);

    const coreNote = serializeEventBlock({ ...VALID, origin: 'core', kind: 'evidence.submitted' });
    const r2 = parseEventBlocks(docOf(coreNote));
    expect(r2.envelopes).toHaveLength(0);
  });

  it('manual 来源任何已知 kind 均可解析（是否生效由折叠层裁决为 external-unverified）', () => {
    const manual = serializeEventBlock({ ...VALID, origin: 'manual', kind: 'check.completed', integrity: 'unknown' });
    const r = parseEventBlocks(docOf(manual));
    expect(r.envelopes).toHaveLength(1);
    expect(r.envelopes[0]!.origin).toBe('manual');
  });

  it('嵌套对象字段坏 JSON / 缺必填项拒绝', () => {
    const badActor = serializeEventBlock({ ...VALID, actor: { actor_id: '', session_id: 's-01' } });
    const r1 = parseEventBlocks(docOf(badActor));
    expect(r1.envelopes).toHaveLength(0);
    expect(r1.diagnostics.some((d) => d.code === 'bad-format' && d.message.includes('actor'))).toBe(true);

    const badSubject = serializeEventBlock({ ...VALID, subject: { object_id: 42 as never } });
    const r2 = parseEventBlocks(docOf(badSubject));
    expect(r2.envelopes).toHaveLength(0);
    expect(r2.diagnostics.some((d) => d.code === 'bad-format' && d.message.includes('subject'))).toBe(true);
  });

  it('payload 缺失为致命；payload 坏 JSON 拒绝', () => {
    const block = serializeEventBlock(VALID).replace(/payload: .*\n/, '');
    const r1 = parseEventBlocks(docOf(block));
    expect(r1.envelopes).toHaveLength(0);
    expect(r1.diagnostics.some((d) => d.code === 'missing-field' && d.message.includes('payload'))).toBe(true);

    const md2 = docOf('```gatedeck-event\npayload: {not json}\n```\n');
    const r2 = parseEventBlocks(md2);
    expect(r2.envelopes).toHaveLength(0);
    expect(r2.diagnostics.some((d) => d.code === 'bad-json')).toBe(true);
  });

  it('非致命：未知字段（含 validation_status）保留 + 诊断，事件照常产出', () => {
    // 在闭合 fence 前插入一行未知字段（开 fence 为 ` ```gatedeck-event `，不受影响）
    const block = serializeEventBlock(VALID).replace('```\n', 'validation_status: 通过\n```\n');
    const md = docOf(block);
    const r = parseEventBlocks(md);
    expect(r.envelopes).toHaveLength(1);
    expect(r.diagnostics.some((d) => d.code === 'unknown-field' && d.message.includes('validation_status'))).toBe(true);
    expect(reconstructEvents(md, r)).toBe(md);
  });

  it('CRLF 文档 round-trip 字节级一致', () => {
    const crlf = docOf(serializeEventBlock(VALID)).replace(/\n/g, '\r\n');
    const r = parseEventBlocks(crlf);
    expect(r.envelopes).toHaveLength(1);
    expect(reconstructEvents(crlf, r)).toBe(crlf);
  });

  it('operation_id 缺省合法（单文件操作）；空白值拒绝', () => {
    const noOp: EventEnvelope = { ...VALID };
    delete (noOp as { operation_id?: string }).operation_id;
    const r1 = parseEventBlocks(docOf(serializeEventBlock(noOp)));
    expect(r1.envelopes).toHaveLength(1);
    expect(r1.envelopes[0]!.operation_id).toBeUndefined();

    const blank = serializeEventBlock({ ...VALID, operation_id: ' ' });
    const r2 = parseEventBlocks(docOf(blank));
    expect(r2.envelopes).toHaveLength(0);
    expect(r2.diagnostics.some((d) => d.code === 'bad-format' && d.message.includes('operation_id'))).toBe(true);
  });
});
