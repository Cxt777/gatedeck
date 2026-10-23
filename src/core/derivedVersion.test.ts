import { describe, expect, it } from 'vitest';

import {
  EMPTY_DERIVED_VERSION,
  checkFreshSubmission,
  formatVersion,
  versionOf,
} from './derivedVersion.js';
import { foldStage, type FoldEvent } from './stageFold.js';
import type { EventEnvelope } from './eventEnvelope.js';

const STAGES = ['M0a', 'M0b', 'M1'];
const ACTOR = { actor_id: '01HXA8T0R00000000000000000', session_id: '01HXSESSN00000000000000000' };

let n = 0;
function coreEvent(kind: EventEnvelope['kind'], payload: Record<string, unknown>, recordedAt: string): EventEnvelope {
  n++;
  return {
    event_id: `01J9F0LD${String(n).padStart(4, '0')}000000000000000`,
    schema_version: '1',
    kind,
    occurred_at: recordedAt,
    recorded_at: recordedAt,
    actor: ACTOR,
    origin: 'core',
    integrity: 'verified',
    subject: { object_id: 'proj:gatedeck' },
    payload,
  };
}

const fe = (envelope: EventEnvelope, seq: number): FoldEvent => ({ envelope, effectiveIntegrity: 'verified', seq });

describe('versionOf / formatVersion（T-M0b-06）', () => {
  it('从 stageFold 投影提取版本戳（as_of + 源版本同源）', () => {
    const init = coreEvent('project.initialized', { stage_order: STAGES }, '2026-10-23T20:00:00Z');
    const p = foldStage([fe(init, 1)]);
    expect(versionOf(p)).toEqual({ asOf: '2026-10-23T20:00:00Z', sourceVersion: 1 });
  });

  it('空流版本戳：as_of=null、源版本 0', () => {
    expect(versionOf(foldStage([]))).toEqual(EMPTY_DERIVED_VERSION);
    expect(EMPTY_DERIVED_VERSION).toEqual({ asOf: null, sourceVersion: 0 });
  });

  it('formatVersion：有事件与空流两种展示口径', () => {
    expect(formatVersion({ asOf: '2026-10-23T20:00:00+08:00', sourceVersion: 12 })).toBe(
      'as_of=2026-10-23T20:00:00+08:00 · 源版本=12',
    );
    expect(formatVersion(EMPTY_DERIVED_VERSION)).toBe('as_of=（无参与事件） · 源版本=0');
  });
});

describe('checkFreshSubmission（版本 compare-and-set，过期投影提交被拒）', () => {
  it('版本一致 → 放行', () => {
    const current = { asOf: '2026-10-23T20:00:00+08:00', sourceVersion: 3 };
    const r = checkFreshSubmission(current, { asOf: '2026-10-23T20:00:00+08:00', sourceVersion: 3 });
    expect(r.ok).toBe(true);
    expect(r.code).toBe('ok');
  });

  it('空流对空流 → 放行', () => {
    const r = checkFreshSubmission(EMPTY_DERIVED_VERSION, EMPTY_DERIVED_VERSION);
    expect(r.ok).toBe(true);
  });

  it('源版本落后 → stale-projection 拒绝，提示重读重算', () => {
    const current = { asOf: '2026-10-23T22:00:00+08:00', sourceVersion: 5 };
    const r = checkFreshSubmission(current, { asOf: '2026-10-23T20:00:00+08:00', sourceVersion: 3 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('stale-projection');
    expect(r.message).toContain('过期');
    expect(r.message).toContain('重读');
    expect(r.submitted).toEqual({ asOf: '2026-10-23T20:00:00+08:00', sourceVersion: 3 });
    expect(r.current).toEqual(current);
  });

  it('源版本超前 → version-ahead 拒绝（跨流/伪造不放行，P-08）', () => {
    const current = { asOf: '2026-10-23T20:00:00+08:00', sourceVersion: 3 };
    const r = checkFreshSubmission(current, { asOf: '2026-10-23T23:00:00+08:00', sourceVersion: 9 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('version-ahead');
    expect(r.message).toContain('并非来自当前事件流');
  });

  it('源版本相同而 as_of 不同 → as-of-mismatch 拒绝（同长度改写）', () => {
    const current = { asOf: '2026-10-23T20:00:00+08:00', sourceVersion: 3 };
    const r = checkFreshSubmission(current, { asOf: '2026-10-23T21:00:00+08:00', sourceVersion: 3 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('as-of-mismatch');
    expect(r.message).toContain('改写');
  });

  it('非法版本形态 → invalid-version 拒绝且 submitted=null', () => {
    const current = { asOf: '2026-10-23T20:00:00+08:00', sourceVersion: 3 };
    const cases: Array<{ asOf: string | null; sourceVersion: number }> = [
      { asOf: '2026-10-23T20:00:00+08:00', sourceVersion: -1 }, // 负数
      { asOf: '2026-10-23T20:00:00+08:00', sourceVersion: 2.5 }, // 非整数
      { asOf: '昨天下午', sourceVersion: 3 }, // as_of 非法
      { asOf: '2026-10-23T20:00:00+08:00', sourceVersion: 0 }, // 空流不得携带 as_of
      { asOf: null, sourceVersion: 3 }, // 有参与事件必有 recorded_at
    ];
    for (const submitted of cases) {
      const r = checkFreshSubmission(current, submitted);
      expect(r.ok).toBe(false);
      expect(r.code).toBe('invalid-version');
      expect(r.submitted).toBeNull();
    }
  });

  it('端到端：事件流追加后旧投影提交被拒，重读重算后放行（过期投影不能提交）', () => {
    const init = coreEvent('project.initialized', { stage_order: STAGES }, '2026-10-23T20:00:00Z');
    const p1 = foldStage([fe(init, 1)]);
    const stamp1 = versionOf(p1);

    const promo = coreEvent('promotion.completed', { from: 'M0a', to: 'M0b', expected_sequence: 2 }, '2026-10-23T21:00:00Z');
    const p2 = foldStage([fe(init, 1), fe(promo, 2)]);
    const stamp2 = versionOf(p2);

    // 基于旧投影的提交在事件流前进后被拒
    const stale = checkFreshSubmission(stamp2, stamp1);
    expect(stale.ok).toBe(false);
    expect(stale.code).toBe('stale-projection');

    // 重读重算后的同版本提交放行
    expect(checkFreshSubmission(stamp2, stamp2).ok).toBe(true);
  });
});
