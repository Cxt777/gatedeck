import { describe, expect, it } from 'vitest';

import {
  CHECK_COMPLETED_KIND,
  CHECK_EVIDENCE_NOTICE,
  assessStaleness,
  checkFactKey,
  projectLatestCheckFacts,
  type CheckEventInput,
} from './checkFacts.js';

// 固定 manifest 指纹常量（本模块只做相等性比对，取 64 位 hex 形态以贴近真实凭证）
const M1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const M2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const T1 = '2026-10-24T10:00:00Z';
const T2 = '2026-10-24T11:00:00Z';

/** 构造 check.completed 宽接口事件（payload 缺省给全契约字段，按需裁剪） */
const check = (overrides: {
  gateId?: string;
  ruleId?: string;
  recordedAt?: string;
  payload?: Record<string, unknown>;
}): CheckEventInput => ({
  kind: CHECK_COMPLETED_KIND,
  recordedAt: overrides.recordedAt ?? T1,
  payload: {
    gateId: overrides.gateId ?? 'gate-build',
    ruleId: overrides.ruleId ?? 'rule-lint',
    outcome: 'passed',
    exitCode: 0,
    durationMs: 1200,
    summary: '全部通过',
    subjectManifestHash: M1,
    ...overrides.payload,
  },
});

describe('projectLatestCheckFacts · 投影最近一笔', () => {
  it('单笔 check.completed：全字段投影（含凭证与证据契约字段）', () => {
    const facts = projectLatestCheckFacts([check({})]);
    expect(facts.size).toBe(1);
    const f = facts.get(checkFactKey('gate-build', 'rule-lint'));
    expect(f).toEqual({
      gateId: 'gate-build',
      ruleId: 'rule-lint',
      status: 'passed',
      checkedAt: T1,
      exitCode: 0,
      durationMs: 1200,
      summary: '全部通过',
      subjectManifestHash: M1,
    });
  });

  it('多笔同组合：按事件流顺序取最后一笔（不按 occurred_at 排序，B-16）', () => {
    const facts = projectLatestCheckFacts([
      check({ payload: { outcome: 'failed', exitCode: 1, subjectManifestHash: M1 } }),
      check({ recordedAt: T2, payload: { outcome: 'passed', exitCode: 0, summary: '复验通过', subjectManifestHash: M2 } }),
    ]);
    const f = facts.get(checkFactKey('gate-build', 'rule-lint'));
    expect(f?.status).toBe('passed');
    expect(f?.checkedAt).toBe(T2); // 取最后一笔的 recorded_at
    expect(f?.subjectManifestHash).toBe(M2);
    expect(f?.summary).toBe('复验通过');
    expect(f?.exitCode).toBe(0);
  });

  it('gateId/ruleId 取自 payload（优先）或顶层（回退）；两者齐备才成对', () => {
    // payload 缺失 → 回退顶层
    const facts = projectLatestCheckFacts([
      { kind: CHECK_COMPLETED_KIND, recordedAt: T1, gateId: 'gate-ci', ruleId: 'rule-test', payload: { outcome: 'failed' } },
    ]);
    expect(facts.get(checkFactKey('gate-ci', 'rule-test'))?.status).toBe('failed');
    // payload 与顶层均缺 ruleId → 不猜键，不进投影
    const skipped = projectLatestCheckFacts([
      { kind: CHECK_COMPLETED_KIND, recordedAt: T1, gateId: 'gate-ci', payload: { outcome: 'passed' } },
    ]);
    expect(skipped.size).toBe(0);
  });

  it('无 check.completed 记录（非 check 事件引用该组合）→ not-checked', () => {
    const facts = projectLatestCheckFacts([
      { kind: 'note', recordedAt: T1, gateId: 'gate-build', ruleId: 'rule-lint', payload: {} },
    ]);
    expect(facts.get(checkFactKey('gate-build', 'rule-lint'))).toEqual({
      gateId: 'gate-build',
      ruleId: 'rule-lint',
      status: 'not-checked',
      checkedAt: null,
      subjectManifestHash: null,
    });
    // 非 check 事件不覆盖已有事实（先 completed 后 note，仍为 completed 事实）
    const mixed = projectLatestCheckFacts([
      check({}),
      { kind: 'note', recordedAt: T2, gateId: 'gate-build', ruleId: 'rule-lint', payload: {} },
    ]);
    expect(mixed.get(checkFactKey('gate-build', 'rule-lint'))?.status).toBe('passed');
  });

  it('payload 缺字段容错：outcome 缺失/非法 → error；非法形态证据字段略去不虚构', () => {
    // outcome 缺失
    const noOutcome = projectLatestCheckFacts([check({ payload: { outcome: undefined } })]);
    const f1 = noOutcome.get(checkFactKey('gate-build', 'rule-lint'));
    expect(f1?.status).toBe('error');
    expect(f1?.checkedAt).toBe(T1); // 其余字段照常投影
    expect(f1?.subjectManifestHash).toBe(M1);
    // outcome 非法值（不猜为通过，P-08）
    const badOutcome = projectLatestCheckFacts([check({ payload: { outcome: 'ok' } })]);
    expect(badOutcome.get(checkFactKey('gate-build', 'rule-lint'))?.status).toBe('error');
    // exitCode 非数字 / durationMs 负数 / summary 非字符串 → 字段略去，不虚构
    const junk = projectLatestCheckFacts([
      check({ payload: { outcome: 'failed', exitCode: '1', durationMs: -5, summary: 42 } }),
    ]);
    const f3 = junk.get(checkFactKey('gate-build', 'rule-lint'));
    expect(f3?.status).toBe('failed');
    expect(f3?.exitCode).toBeUndefined();
    expect(f3?.durationMs).toBeUndefined();
    expect(f3?.summary).toBeUndefined();
    // subjectManifestHash 缺失 → null（凭证缺锚，交由 assessStaleness 判 stale）
    const noHash = projectLatestCheckFacts([check({ payload: { subjectManifestHash: undefined } })]);
    expect(noHash.get(checkFactKey('gate-build', 'rule-lint'))?.subjectManifestHash).toBeNull();
  });

  it('空事件流 → 空 Map；未被任何事件引用的组合不凭空出现', () => {
    expect(projectLatestCheckFacts([]).size).toBe(0);
    expect(projectLatestCheckFacts([check({})]).has(checkFactKey('gate-other', 'rule-x'))).toBe(false);
  });

  it('中文摘要原样保留（不改写、不转写）', () => {
    const zh = 'lint：3 条告警（规则 no-unused-vars），详见本地日志';
    const facts = projectLatestCheckFacts([check({ payload: { outcome: 'failed', exitCode: 1, summary: zh } })]);
    expect(facts.get(checkFactKey('gate-build', 'rule-lint'))?.summary).toBe(zh);
  });
});

describe('assessStaleness · B-3 失效判定', () => {
  it('manifest 一致：passed/failed 保持原状态，staleKeys 为空', () => {
    const facts = new Map([
      [checkFactKey('g1', 'r1'), { gateId: 'g1', ruleId: 'r1', status: 'passed' as const, checkedAt: T1, subjectManifestHash: M1 }],
      [checkFactKey('g1', 'r2'), { gateId: 'g1', ruleId: 'r2', status: 'failed' as const, checkedAt: T1, subjectManifestHash: M1 }],
    ]);
    const r = assessStaleness(facts, M1);
    expect(r.staleKeys).toEqual([]);
    expect(r.facts.get(checkFactKey('g1', 'r1'))?.status).toBe('passed');
    expect(r.facts.get(checkFactKey('g1', 'r2'))?.status).toBe('failed');
  });

  it('manifest 不一致：passed/failed 改判 stale 并列入 staleKeys，凭证与证据字段原样保留', () => {
    const key1 = checkFactKey('g1', 'r1');
    const key2 = checkFactKey('g2', 'r2');
    const facts = new Map([
      [key1, { gateId: 'g1', ruleId: 'r1', status: 'passed' as const, checkedAt: T1, exitCode: 0, durationMs: 100, summary: '通过', subjectManifestHash: M1 }],
      [key2, { gateId: 'g2', ruleId: 'r2', status: 'failed' as const, checkedAt: T2, exitCode: 1, subjectManifestHash: M2 }],
    ]);
    const r = assessStaleness(facts, M2);
    expect(r.staleKeys).toEqual([key1]); // 只有 M1 锚的那条失效
    const f = r.facts.get(key1);
    expect(f?.status).toBe('stale');
    expect(f?.subjectManifestHash).toBe(M1); // 凭证保留（只是不再适用）
    expect(f?.checkedAt).toBe(T1);
    expect(f?.summary).toBe('通过');
    expect(f?.exitCode).toBe(0);
    expect(f?.durationMs).toBe(100);
    expect(r.facts.get(key2)?.status).toBe('failed'); // 锚与当前一致 → 不动
  });

  it('error 与 not-checked 不参与比对（error 本身要复验，not-checked 本身没查过）', () => {
    const keyE = checkFactKey('g1', 'r-e');
    const keyN = checkFactKey('g1', 'r-n');
    const facts = new Map([
      [keyE, { gateId: 'g1', ruleId: 'r-e', status: 'error' as const, checkedAt: T1, subjectManifestHash: M1 }],
      [keyN, { gateId: 'g1', ruleId: 'r-n', status: 'not-checked' as const, checkedAt: null, subjectManifestHash: null }],
    ]);
    const r = assessStaleness(facts, M2);
    expect(r.staleKeys).toEqual([]);
    expect(r.facts.get(keyE)?.status).toBe('error');
    expect(r.facts.get(keyN)?.status).toBe('not-checked');
  });

  it('凭证缺锚（subjectManifestHash=null）的 passed/failed 同样改判 stale（P-08 不假设一致）', () => {
    const key = checkFactKey('g1', 'r1');
    const facts = new Map([
      [key, { gateId: 'g1', ruleId: 'r1', status: 'passed' as const, checkedAt: T1, subjectManifestHash: null }],
    ]);
    const r = assessStaleness(facts, M1);
    expect(r.staleKeys).toEqual([key]);
    expect(r.facts.get(key)?.status).toBe('stale');
  });

  it('输入已为 stale：原样保留不回填翻案（复验走新事件），也不重复计入 staleKeys', () => {
    const key = checkFactKey('g1', 'r1');
    const facts = new Map([
      [key, { gateId: 'g1', ruleId: 'r1', status: 'stale' as const, checkedAt: T1, subjectManifestHash: M1 }],
    ]);
    const r = assessStaleness(facts, M1); // hash 已恢复一致也不翻案
    expect(r.staleKeys).toEqual([]);
    expect(r.facts.get(key)?.status).toBe('stale');
  });

  it('纯函数性：输入 Map 不被改写；空 facts → 空结果', () => {
    const key = checkFactKey('g1', 'r1');
    const facts = new Map([
      [key, { gateId: 'g1', ruleId: 'r1', status: 'passed' as const, checkedAt: T1, subjectManifestHash: M1 }],
    ]);
    const r = assessStaleness(facts, M2);
    expect(facts.get(key)?.status).toBe('passed'); // 输入原样
    expect(r.facts.get(key)?.status).toBe('stale');
    const empty = assessStaleness(new Map(), M1);
    expect(empty.facts.size).toBe(0);
    expect(empty.staleKeys).toEqual([]);
  });
});

describe('契约常量与提示', () => {
  it('CHECK_COMPLETED_KIND 与信封层 core kind 约定一致；证据提示覆盖 D-26 与信任边界', () => {
    expect(CHECK_COMPLETED_KIND).toBe('check.completed');
    expect(CHECK_EVIDENCE_NOTICE).toContain('退出码/时长/摘要');
    expect(CHECK_EVIDENCE_NOTICE).toContain('D-26');
    expect(CHECK_EVIDENCE_NOTICE).toContain('MCP/discover/doctor 永不执行门禁命令');
  });

  it('checkFactKey：\u0000 分隔，不同 (gateId, ruleId) 不串键', () => {
    expect(checkFactKey('g1', 'r1')).toBe('g1\u0000r1');
    expect(checkFactKey('g1', 'r1')).not.toBe(checkFactKey('g1r1', 'x'));
    expect(checkFactKey('g1', 'r1')).not.toBe(checkFactKey('g', '1r1'));
  });
});
