/**
 * gate check 纯函数测试（W-S2-4 = T-M1-04 CLI 装配）。
 *
 * 覆盖口径（任务规格 ≥6 项；全部不依赖真实文件，构造事件数组直接测）：
 *  - parseGateCheckArgs：--gate 过滤参数（合法/非法形态）；
 *  - toCheckEventInput：信封 → checkFacts 宽接口映射（完整 / 缺字段 / 下划线键归一）；
 *  - not-checked：非检查事件携带 (门禁, 规则) 的如实登记；
 *  - collectVerifiedCheckEvents：P-09 只收 verified + B-16 按链序喂入 + 未验真计数；
 *  - assessStaleness 改判透传：指纹不符 → 待复验、相符 → 保持通过、not-checked 不参与；
 *  - filterByGate：null / 指定门禁 / 无命中 三种过滤口径；
 *  - renderGateCheck：关键状态文案、尾部 manifest 指纹与 as_of 行、R-07/D-26 诚实声明。
 */
import { describe, expect, it } from 'vitest';

import {
  collectVerifiedCheckEvents,
  filterByGate,
  parseGateCheckArgs,
  renderGateCheck,
  toCheckEventInput,
  toRows,
  type GateCheckView,
} from './gate.js';
import {
  CHECK_EVIDENCE_NOTICE,
  assessStaleness,
  checkFactKey,
  projectLatestCheckFacts,
  type CheckFact,
} from '../../core/checkFacts.js';
import type { EventEnvelope, EventKind } from '../../core/eventEnvelope.js';
import type { EventVerdict } from '../../core/eventReceipt.js';

/* ---------------------------------------------------------------- *
 * 构造辅助（不依赖真实文件）
 * ---------------------------------------------------------------- */

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const ULID_1 = '01J' + '0'.repeat(22) + 'A';
const ULID_2 = '01J' + '0'.repeat(22) + 'B';
const ULID_EARLY = '01J' + '0'.repeat(22) + 'C';
const ULID_LATE = '01J' + '0'.repeat(22) + 'D';

/** 构造信封（字段均为合法形态；仅按需覆盖测试关注位） */
function env(o: { eventId?: string; kind?: EventKind; recordedAt?: string; payload?: Record<string, unknown> } = {}): EventEnvelope {
  return {
    event_id: o.eventId ?? ULID_1,
    schema_version: '1',
    kind: o.kind ?? 'check.completed',
    occurred_at: '2026-10-25T08:00:00Z',
    recorded_at: o.recordedAt ?? '2026-10-25T08:00:01Z',
    actor: { actor_id: 'actor-1', session_id: 'session-1' },
    origin: 'core',
    integrity: 'verified',
    subject: { object_id: 'gate:G1' },
    payload: o.payload ?? {},
  };
}

/** 构造逐块裁定（verifyEventChain.perEvent 与 envelopes 同序的契约形状） */
function verdict(eventId: string, v: EventVerdict['verdict'], seq?: number): EventVerdict {
  return { event_id: eventId, verdict: v, ...(seq !== undefined ? { seq } : {}) };
}

/** 构造检查事实（必填字段齐全；可选凭证字段按需显式给出） */
function fact(o: { gateId: string; ruleId: string; status: CheckFact['status']; checkedAt: string | null; subjectManifestHash: string | null; summary?: string }): CheckFact {
  return {
    gateId: o.gateId,
    ruleId: o.ruleId,
    status: o.status,
    checkedAt: o.checkedAt,
    subjectManifestHash: o.subjectManifestHash,
    ...(o.summary !== undefined ? { summary: o.summary } : {}),
  };
}

/* ---------------------------------------------------------------- *
 * 参数解析
 * ---------------------------------------------------------------- */

describe('parseGateCheckArgs（--gate 过滤参数，纯函数）', () => {
  it('check 子命令 + --gate 两种写法（空格/等号）均解析出过滤值；无 --gate 为 null', () => {
    expect(parseGateCheckArgs(['check'])).toEqual({ ok: true, gateId: null });
    expect(parseGateCheckArgs(['check', '--gate', 'G-M1'])).toEqual({ ok: true, gateId: 'G-M1' });
    expect(parseGateCheckArgs(['check', '--gate=G-M1'])).toEqual({ ok: true, gateId: 'G-M1' });
  });

  it('非 check 子命令 / 缺值 / 空值 / 重复 --gate / 未知参数一律拒绝并给用法（W-06/P-08）', () => {
    expect(parseGateCheckArgs([]).ok).toBe(false);
    expect(parseGateCheckArgs(['status']).ok).toBe(false);
    expect(parseGateCheckArgs(['check', '--gate']).ok).toBe(false);
    expect(parseGateCheckArgs(['check', '--gate', '   ']).ok).toBe(false);
    expect(parseGateCheckArgs(['check', '--gate=A', '--gate=B']).ok).toBe(false);
    expect(parseGateCheckArgs(['check', '--all']).ok).toBe(false);
    const bad = parseGateCheckArgs(['check', '--gate']);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain('用法：gatedeck gate check');
  });
});

/* ---------------------------------------------------------------- *
 * 事件映射（完整 / 缺字段 / not-checked）
 * ---------------------------------------------------------------- */

describe('toCheckEventInput（信封 → checkFacts 宽接口映射，纯函数）', () => {
  it('完整映射：下划线 payload 键归一到顶层 gateId/ruleId，其余字段透传；投影为「通过」事实且凭证齐全', () => {
    const e = env({
      payload: { gate_id: 'G-M1', rule_id: 'typecheck', outcome: 'passed', exitCode: 0, durationMs: 1200, summary: '全绿', subjectManifestHash: HASH_A },
    });
    const input = toCheckEventInput(e);
    expect(input.kind).toBe('check.completed');
    expect(input.recordedAt).toBe('2026-10-25T08:00:01Z');
    expect(input.gateId).toBe('G-M1');
    expect(input.ruleId).toBe('typecheck');
    expect(input.payload).toBe(e.payload); // payload 原样透传（core 自行读取凭证字段）
    const fact = projectLatestCheckFacts([input]).get(checkFactKey('G-M1', 'typecheck'));
    expect(fact).toBeDefined();
    expect(fact!).toMatchObject({
      status: 'passed',
      checkedAt: '2026-10-25T08:00:01Z',
      exitCode: 0,
      durationMs: 1200,
      summary: '全绿',
      subjectManifestHash: HASH_A,
    });
  });

  it('缺字段：gateId/ruleId 双缺不进投影（P-08 不猜键）；check.completed 缺 outcome 如实按 error「需复验」（不猜通过）', () => {
    const noPair = toCheckEventInput(env({ payload: { outcome: 'passed' } }));
    expect(noPair.gateId).toBeUndefined();
    expect(noPair.ruleId).toBeUndefined();
    expect(projectLatestCheckFacts([noPair]).size).toBe(0);

    const noOutcome = toCheckEventInput(env({ payload: { gate_id: 'G1', rule_id: 'r' } }));
    const fact = projectLatestCheckFacts([noOutcome]).get(checkFactKey('G1', 'r'));
    expect(fact).toBeDefined();
    expect(fact!.status).toBe('error');
  });

  it('not-checked：非检查事件携带 (门禁, 规则) → 如实登记「未检查」（checkedAt/凭证锚为 null，不与通过混同）', () => {
    const input = toCheckEventInput(env({ kind: 'evidence.submitted', payload: { gate_id: 'G1', rule_id: 'lint' } }));
    const fact = projectLatestCheckFacts([input]).get(checkFactKey('G1', 'lint'));
    expect(fact).toBeDefined();
    expect(fact!).toMatchObject({ status: 'not-checked', checkedAt: null, subjectManifestHash: null });
  });
});

/* ---------------------------------------------------------------- *
 * 验真收集（P-09 + B-16 链序）
 * ---------------------------------------------------------------- */

describe('collectVerifiedCheckEvents（验真收集 + 链序喂入，纯函数）', () => {
  it('按收据链 seq 重排：链序最后一笔在投影中胜出（不按文档序、不按 occurred_at，B-16）', () => {
    const early = env({
      eventId: ULID_EARLY,
      recordedAt: '2026-10-25T07:00:00Z',
      payload: { gate_id: 'G1', rule_id: 'lint', outcome: 'failed', subjectManifestHash: HASH_A },
    });
    const late = env({
      eventId: ULID_LATE,
      recordedAt: '2026-10-25T08:00:00Z',
      payload: { gate_id: 'G1', rule_id: 'lint', outcome: 'passed', subjectManifestHash: HASH_A },
    });
    // 文档序 [late, early]；链序 early=1 / late=2 → 投影「最近」应取链序最后的 late（passed）
    const { events, unverifiedCount } = collectVerifiedCheckEvents(
      [late, early],
      [verdict(ULID_LATE, 'verified', 2), verdict(ULID_EARLY, 'verified', 1)],
    );
    expect(unverifiedCount).toBe(0);
    const fact = projectLatestCheckFacts(events).get(checkFactKey('G1', 'lint'));
    expect(fact).toBeDefined();
    expect(fact!.status).toBe('passed');
  });

  it('只收 verified（P-09）：unregistered/invalid 不进事件集且 unverifiedCount 如实计数（W-06）', () => {
    const a = env({ eventId: ULID_1, payload: { gate_id: 'G1', rule_id: 'lint', outcome: 'passed' } });
    const b = env({ eventId: ULID_2, payload: { gate_id: 'G1', rule_id: 'lint', outcome: 'failed' } });
    const { events, unverifiedCount } = collectVerifiedCheckEvents(
      [a, b],
      [verdict(ULID_1, 'verified', 1), verdict(ULID_2, 'unregistered')],
    );
    expect(events).toHaveLength(1);
    expect(unverifiedCount).toBe(1);
    const fact = projectLatestCheckFacts(events).get(checkFactKey('G1', 'lint'));
    expect(fact).toBeDefined();
    expect(fact!.status).toBe('passed'); // 未验真的 failed 不覆盖验真的 passed
  });
});

/* ---------------------------------------------------------------- *
 * 失效改判透传 + 门禁过滤
 * ---------------------------------------------------------------- */

describe('staleness 改判透传与 --gate 过滤（B-3，纯函数链路）', () => {
  const events = [
    toCheckEventInput(env({ payload: { gate_id: 'G1', rule_id: 'lint', outcome: 'passed', subjectManifestHash: HASH_A } })),
    toCheckEventInput(env({ kind: 'note', payload: { gateId: 'G2', ruleId: 'docs' } })),
  ];

  it('manifest 指纹变化 → passed 改判 stale；指纹一致 → 保持 passed；not-checked 不参与比对；输入 Map 不被改写', () => {
    const facts = projectLatestCheckFacts(events);
    const changed = assessStaleness(facts, HASH_B);
    expect(changed.staleKeys).toEqual([checkFactKey('G1', 'lint')]);
    expect(changed.facts.get(checkFactKey('G1', 'lint'))!.status).toBe('stale');
    expect(changed.facts.get(checkFactKey('G2', 'docs'))!.status).toBe('not-checked');
    expect(facts.get(checkFactKey('G1', 'lint'))!.status).toBe('passed'); // 原输入不被改写（R-04 精神）

    const unchanged = assessStaleness(facts, HASH_A);
    expect(unchanged.staleKeys).toEqual([]);
    expect(unchanged.facts.get(checkFactKey('G1', 'lint'))!.status).toBe('passed');
  });

  it('改判透传到渲染行（statusZh=待复验）；filterByGate 按 null/指定门禁/无命中三种口径过滤', () => {
    const judged = assessStaleness(projectLatestCheckFacts(events), HASH_B);
    const rows = toRows(filterByGate(judged.facts, null));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.gateId === 'G1')).toMatchObject({ status: 'stale', statusZh: '待复验' });
    expect(toRows(filterByGate(judged.facts, 'G1')).map((r) => r.gateId)).toEqual(['G1']);
    expect(toRows(filterByGate(judged.facts, 'G-MISSING'))).toEqual([]);
  });
});

/* ---------------------------------------------------------------- *
 * 渲染关键文案
 * ---------------------------------------------------------------- */

describe('renderGateCheck（渲染含关键状态文案，纯函数）', () => {
  const base: GateCheckView = {
    cwd: 'D:/demo',
    gateId: null,
    rows: [],
    manifestHash: HASH_A,
    manifestEntryCount: 4,
    missingManifestFiles: [],
    asOf: null,
    sourceVersion: 0,
    notes: [],
  };

  it('五状态中文文案与合计齐全；检查时间/摘要按基线行格式内嵌（缺失则省略不编造）', () => {
    const rows = toRows([
      fact({ gateId: 'G1', ruleId: 'r1', status: 'not-checked', checkedAt: null, subjectManifestHash: null }),
      fact({ gateId: 'G1', ruleId: 'r2', status: 'passed', checkedAt: '2026-10-25T08:00:00Z', subjectManifestHash: HASH_A, summary: 'ok' }),
      fact({ gateId: 'G1', ruleId: 'r3', status: 'failed', checkedAt: null, subjectManifestHash: HASH_A }),
      fact({ gateId: 'G2', ruleId: 'r4', status: 'error', checkedAt: null, subjectManifestHash: null }),
      fact({ gateId: 'G2', ruleId: 'r5', status: 'stale', checkedAt: '2026-10-25T07:00:00Z', subjectManifestHash: HASH_B, summary: '旧凭证' }),
    ]);
    const text = renderGateCheck({ ...base, rows }).join('\n');
    for (const w of ['未检查', '通过', '失败', '错误', '待复验']) expect(text).toContain(w);
    expect(text).toContain('合计：通过 1 ｜ 失败 1 ｜ 错误 1 ｜ 待复验 1 ｜ 未检查 1');
    expect(text).toContain('通过（2026-10-25T08:00:00Z） —— ok');
    expect(text).toContain('待复验（2026-10-25T07:00:00Z） —— 旧凭证');
    expect(text).toContain('[G1 / r1] 未检查'); // 无时刻/无摘要：省略不编造（W-06）
  });

  it('尾部 manifest 指纹与 as_of 行 + R-07/D-26 诚实声明（CHECK_EVIDENCE_NOTICE 措辞复用 core 常量）+ 过滤头 + 空记录提示 + 数据说明', () => {
    const text = renderGateCheck({
      ...base,
      gateId: 'G-M1',
      asOf: '2026-10-25T08:00:01Z',
      sourceVersion: 3,
      notes: ['changelog 中 2 笔事件未通过收据链验真：不参与检查事实推导（P-09）。'],
    }).join('\n');
    expect(text).toContain('过滤：仅门禁 G-M1');
    expect(text).toContain('（无检查事实记录——全部未检查）');
    expect(text).toContain(`manifest 指纹：${HASH_A}`);
    expect(text).toContain('as_of=2026-10-25T08:00:01Z · 源版本=3');
    expect(text).toContain('本版不执行命令——检查事实来自事件流凭证（R-07）；命令执行能力随信任机制（D-26）后补。');
    expect(text).toContain(`说明：${CHECK_EVIDENCE_NOTICE}`);
    expect(text).toContain('未通过收据链验真');
  });
});
