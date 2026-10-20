import { describe, expect, it } from 'vitest';

import { foldStage, type FoldEvent } from './stageFold.js';
import type { EventEnvelope } from './eventEnvelope.js';

const STAGES = ['M0a', 'M0b', 'M1', 'M2a', 'M2b', 'M3'];
const ACTOR = { actor_id: '01HXA8T0R00000000000000000', session_id: '01HXSESSN00000000000000000' };

let n = 0;
function coreEvent(kind: EventEnvelope['kind'], payload: Record<string, unknown>, occurredAt: string): EventEnvelope {
  n++;
  return {
    event_id: `01J9F0LD${String(n).padStart(4, '0')}000000000000000`,
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

/** 折叠输入速记：seq 即参数，默认有效 integrity=verified */
function fe(envelope: EventEnvelope, seq: number, effectiveIntegrity: FoldEvent['effectiveIntegrity'] = 'verified'): FoldEvent {
  return { envelope, effectiveIntegrity, ...(seq !== undefined ? { seq } : {}) };
}

describe('foldStage（当前阶段派生，T-M0a-05 / D-24）', () => {
  it('初始化派生初始阶段 = stage_order 首阶段（gates.md 首阶段）', () => {
    const init = coreEvent('project.initialized', { project_id: 'proj:gatedeck', stage_order: STAGES }, '2026-10-20T01:00:00Z');
    const p = foldStage([fe(init, 1)]);
    expect(p.currentStage).toBe('M0a');
    expect(p.stageOrder).toEqual(STAGES);
    expect(p.transitions).toEqual([{ event_id: init.event_id, seq: 1, kind: 'project.initialized', from: null, to: 'M0a' }]);
    expect(p.sourceVersion).toBe(1);
    expect(p.asOf).toBe('2026-10-20T01:00:00Z');
  });

  it('未初始化：currentStage=null，promotion 被拒绝', () => {
    const promo = coreEvent('promotion.completed', { from: 'M0a', to: 'M0b', expected_sequence: 1 }, '2026-10-20T02:00:00Z');
    const p = foldStage([fe(promo, 1)]);
    expect(p.currentStage).toBeNull();
    expect(p.diagnostics[0]!.code).toBe('promotion-rejected');
  });

  it('B-16 乱序时间戳：occurred_at 相反的两笔推进，最终状态按链序（seq）', () => {
    const init = coreEvent('project.initialized', { stage_order: STAGES }, '2026-10-20T09:00:00Z');
    // 后写入的事件 occurred_at 更早；正确链序推进 M0a→M0b→M1
    const p1 = coreEvent('promotion.completed', { from: 'M0a', to: 'M0b', expected_sequence: 2 }, '2026-10-20T08:00:00Z');
    const p2 = coreEvent('promotion.completed', { from: 'M0b', to: 'M1', expected_sequence: 3 }, '2026-10-20T07:00:00Z');
    const p = foldStage([fe(p2, 3), fe(init, 1), fe(p1, 2)]); // 输入乱序传入也应按 seq 折叠
    expect(p.currentStage).toBe('M1');
    expect(p.transitions.map((t) => t.to)).toEqual(['M0a', 'M0b', 'M1']);
  });

  it('B-13 重复 event_id：幂等取首笔，不产生二次推进', () => {
    const init = coreEvent('project.initialized', { stage_order: STAGES }, '2026-10-20T01:00:00Z');
    const promo = coreEvent('promotion.completed', { from: 'M0a', to: 'M0b', expected_sequence: 2 }, '2026-10-20T02:00:00Z');
    const duplicate: EventEnvelope = { ...promo }; // 同 id 同内容（重复追加场景）
    const p = foldStage([fe(init, 1), fe(promo, 2), fe(duplicate, 3)]);
    expect(p.currentStage).toBe('M0b');
    expect(p.transitions.filter((t) => t.to === 'M0b')).toHaveLength(1);
    expect(p.diagnostics.some((d) => d.code === 'duplicate-event-id' && d.event_id === promo.event_id)).toBe(true);
  });

  it('非法跳跃拒绝：跳过下一阶段直接 to=M1，推进不生效且事件保留诊断', () => {
    const init = coreEvent('project.initialized', { stage_order: STAGES }, '2026-10-20T01:00:00Z');
    const jump = coreEvent('promotion.completed', { from: 'M0a', to: 'M1', expected_sequence: 2 }, '2026-10-20T02:00:00Z');
    const p = foldStage([fe(init, 1), fe(jump, 2)]);
    expect(p.currentStage).toBe('M0a'); // 停留原阶段
    expect(p.diagnostics[0]!.code).toBe('promotion-rejected');
    expect(p.diagnostics[0]!.message).toContain('非法跳跃');
  });

  it('from 不符 / 序号重放：拒绝并给出原因', () => {
    const init = coreEvent('project.initialized', { stage_order: STAGES }, '2026-10-20T01:00:00Z');
    const staleFrom = coreEvent('promotion.completed', { from: 'M2a', to: 'M2b', expected_sequence: 2 }, '2026-10-20T02:00:00Z');
    const replay = coreEvent('promotion.completed', { from: 'M0a', to: 'M0b', expected_sequence: 99 }, '2026-10-20T03:00:00Z');
    const p = foldStage([fe(init, 1), fe(staleFrom, 2), fe(replay, 3)]);
    expect(p.currentStage).toBe('M0a');
    expect(p.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining('不符'), expect.stringContaining('重放')]);
  });

  it('P-09：integrity=invalid/unknown 的事件不参与推导', () => {
    const init = coreEvent('project.initialized', { stage_order: STAGES }, '2026-10-20T01:00:00Z');
    const forged = coreEvent('promotion.completed', { from: 'M0a', to: 'M3', expected_sequence: 2 }, '2026-10-20T02:00:00Z');
    const p1 = foldStage([fe(init, 1), fe(forged, 2, 'invalid')]);
    expect(p1.currentStage).toBe('M0a');
    expect(p1.sourceVersion).toBe(1); // 仅 init 参与推导致版本计数

    const manual = { ...coreEvent('promotion.completed', { from: 'M0a', to: 'M3', expected_sequence: 2 }, '2026-10-20T03:00:00Z'), origin: 'manual' as const };
    const p2 = foldStage([fe(init, 1), { envelope: manual, effectiveIntegrity: 'unregistered' }]);
    expect(p2.currentStage).toBe('M0a');
  });

  it('补偿走追加事件：correction 引用原 promotion 退回 from 阶段', () => {
    const init = coreEvent('project.initialized', { stage_order: STAGES }, '2026-10-20T01:00:00Z');
    const promo = coreEvent('promotion.completed', { from: 'M0a', to: 'M0b', expected_sequence: 2 }, '2026-10-20T02:00:00Z');
    const fix = coreEvent('correction', { target_event_id: promo.event_id, revert_to: 'M0a' }, '2026-10-20T04:00:00Z');
    const p = foldStage([fe(init, 1), fe(promo, 2), fe(fix, 3)]);
    expect(p.currentStage).toBe('M0a');
    expect(p.transitions[2]).toEqual({ event_id: fix.event_id, seq: 3, kind: 'correction', from: 'M0b', to: 'M0a' });
  });

  it('补偿越权拒绝：revert_to ≠ 原 promotion 的 from，或引用不存在的目标', () => {
    const init = coreEvent('project.initialized', { stage_order: STAGES }, '2026-10-20T01:00:00Z');
    const promo = coreEvent('promotion.completed', { from: 'M0a', to: 'M0b', expected_sequence: 2 }, '2026-10-20T02:00:00Z');
    const badTarget = coreEvent('correction', { target_event_id: '01J9NOTEXIST00000000000000', revert_to: 'M0a' }, '2026-10-20T04:00:00Z');
    const badValue = coreEvent('correction', { target_event_id: promo.event_id, revert_to: 'M1' }, '2026-10-20T05:00:00Z');
    const p = foldStage([fe(init, 1), fe(promo, 2), fe(badTarget, 3), fe(badValue, 4)]);
    expect(p.currentStage).toBe('M0b'); // 两次补偿都被拒绝
    expect(p.diagnostics.filter((d) => d.code === 'correction-rejected')).toHaveLength(2);
  });

  it('init payload 缺 stage_order：不可派生，进入需处理', () => {
    const init = coreEvent('project.initialized', { project_id: 'proj:gatedeck' }, '2026-10-20T01:00:00Z');
    const p = foldStage([fe(init, 1)]);
    expect(p.currentStage).toBeNull();
    expect(p.diagnostics[0]!.code).toBe('init-payload-invalid');
    expect(p.attention.some((a) => a.source === 'fold')).toBe(true);
  });

  it('B-11 联动：链级问题透传为需处理，投影不静默', () => {
    const init = coreEvent('project.initialized', { stage_order: STAGES }, '2026-10-20T01:00:00Z');
    const p = foldStage([fe(init, 1)], {
      chainIssues: [{ code: 'missing-event-in-document', message: '收据 seq=2 对应事件在文档中缺失', seq: 2 }],
    });
    expect(p.currentStage).toBe('M0a');
    expect(p.attention).toEqual([{ source: 'chain', message: '[missing-event-in-document] 收据 seq=2 对应事件在文档中缺失' }]);
  });

  it('as_of 随最后消费事件推进（含被拒绝事件），sourceVersion 相应递增', () => {
    const init = coreEvent('project.initialized', { stage_order: STAGES }, '2026-10-20T01:00:00Z');
    const rejected = coreEvent('promotion.completed', { from: 'M0a', to: 'M1', expected_sequence: 2 }, '2026-10-20T02:00:00Z');
    const p = foldStage([fe(init, 1), fe(rejected, 2)]);
    expect(p.asOf).toBe('2026-10-20T02:00:00Z');
    expect(p.sourceVersion).toBe(2);
  });
});
