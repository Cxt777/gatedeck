import { describe, expect, it } from 'vitest';

import {
  abortOperation,
  assessRecovery,
  commitOperation,
  markApplied,
  markLogged,
  prepareOperation,
  type OperationJournal,
  type OperationTarget,
} from './operationRecovery.js';

const T1 = '2026-10-22T23:00:00+08:00';
const T2 = '2026-10-22T23:01:00+08:00';
const T3 = '2026-10-22T23:02:00+08:00';
const T4 = '2026-10-22T23:03:00+08:00';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

const TARGETS: OperationTarget[] = [
  { path: 'pm/wbs.md', baseHash: A, nextHash: B },
  { path: 'pm/changelog.md', baseHash: C, nextHash: 'd'.repeat(64) },
];

function prepared(): OperationJournal {
  return prepareOperation({
    operationId: 'OP-1',
    eventId: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
    targets: TARGETS,
    now: T1,
  });
}

const NEXT1 = TARGETS[0]!.nextHash;
const NEXT2 = TARGETS[1]!.nextHash;
const BASE1 = TARGETS[0]!.baseHash!;
const BASE2 = TARGETS[1]!.baseHash!;

const obs = (pairs: Array<[string, string | null]>) => pairs.map(([path, hash]) => ({ path, hash }));

describe('T-M0b-04 · 相位迁移（不跳相）', () => {
  it('prepare 生成 prepared journal，目标与时间戳完整，无中止原因', () => {
    const j = prepared();
    expect(j.phase).toBe('prepared');
    expect(j.targets).toHaveLength(2);
    expect(j.created_at).toBe(T1);
    expect(j.abort_reason).toBeNull();
    // 不可变：返回的是新数组副本
    expect(j.targets).not.toBe(TARGETS);
  });

  it('正常四相：prepared → applied → logged → committed，每相更新时间戳', () => {
    const a = markApplied(prepared(), T2);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.journal.phase).toBe('applied');
    expect(a.journal.updated_at).toBe(T2);

    const l = markLogged(a.journal, T3);
    expect(l.ok).toBe(true);
    if (!l.ok) return;
    expect(l.journal.phase).toBe('logged');

    const c = commitOperation(l.journal, T4);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.journal.phase).toBe('committed');
    expect(c.journal.updated_at).toBe(T4);
  });

  it('跳相被拒：prepared 直接 markLogged / applied 直接 commit', () => {
    const l = markLogged(prepared(), T2);
    expect(l.ok).toBe(false);
    if (l.ok) return;
    expect(l.code).toBe('invalid-phase');

    const a = markApplied(prepared(), T2);
    if (!a.ok) return;
    const c = commitOperation(a.journal, T3);
    expect(c.ok).toBe(false);
    if (c.ok) return;
    expect(c.code).toBe('invalid-phase');
  });

  it('日志写入后不允许 abort（append-only 不可撤回），必须 commit 或人工复核', () => {
    const a = markApplied(prepared(), T2);
    if (!a.ok) return;
    const l = markLogged(a.journal, T3);
    if (!l.ok) return;
    const abort = abortOperation(l.journal, T4, '想放弃');
    expect(abort.ok).toBe(false);
    if (abort.ok) return;
    expect(abort.code).toBe('invalid-phase');
    expect(abort.message).toContain('append-only');
  });

  it('abort 必须写原因；原因空白被拒，合规原因写入 journal', () => {
    const blank = abortOperation(prepared(), T2, '   ');
    expect(blank.ok).toBe(false);
    if (blank.ok) return;
    expect(blank.code).toBe('missing-abort-reason');

    const aborted = abortOperation(prepared(), T2, '外部冲突：目标被其他编辑器修改');
    expect(aborted.ok).toBe(true);
    if (!aborted.ok) return;
    expect(aborted.journal.phase).toBe('aborted');
    expect(aborted.journal.abort_reason).toBe('外部冲突：目标被其他编辑器修改');
  });
});

describe('T-M0b-04 · 中断点恢复（B-2）', () => {
  it('中断点①：prepared 且未写入 → resume-apply 全部目标，材料保留', () => {
    const r = assessRecovery(prepared(), obs([
      ['pm/wbs.md', BASE1],
      ['pm/changelog.md', BASE2],
    ]), { eventLogged: false });
    expect(r.action).toBe('resume-apply');
    expect(r.pendingPaths).toEqual(['pm/wbs.md', 'pm/changelog.md']);
    expect(r.needsAttention).toBe(false);
    expect(r.retainedMaterial.targets).toEqual(TARGETS);
    expect(r.retainedMaterial.observations).toHaveLength(2);
  });

  it('中断点②：prepared 且只写了第一个文件 → resume-apply 仅剩余目标（已写不重复覆盖）', () => {
    const r = assessRecovery(prepared(), obs([
      ['pm/wbs.md', NEXT1],
      ['pm/changelog.md', BASE2],
    ]), { eventLogged: false });
    expect(r.action).toBe('resume-apply');
    expect(r.pendingPaths).toEqual(['pm/changelog.md']);
    expect(r.targets[0]!.state).toBe('applied');
    expect(r.targets[1]!.state).toBe('base');
  });

  it('中断点③：prepared 但全部已写（中断于相位推进前）→ mark-applied，不重复写', () => {
    const r = assessRecovery(prepared(), obs([
      ['pm/wbs.md', NEXT1],
      ['pm/changelog.md', NEXT2],
    ]), { eventLogged: false });
    expect(r.action).toBe('mark-applied');
    expect(r.pendingPaths).toHaveLength(0);
  });

  it('中断点④：applied 且日志未写 → resume-log', () => {
    const a = markApplied(prepared(), T2);
    if (!a.ok) return;
    const r = assessRecovery(a.journal, obs([
      ['pm/wbs.md', NEXT1],
      ['pm/changelog.md', NEXT2],
    ]), { eventLogged: false });
    expect(r.action).toBe('resume-log');
    expect(r.needsAttention).toBe(false);
    expect(r.messages.join()).toContain('补写');
  });

  it('中断点⑤：applied 且日志其实已写（中断于相位推进前）→ 幂等跳过重复追加并推进 logged', () => {
    const a = markApplied(prepared(), T2);
    if (!a.ok) return;
    const r = assessRecovery(a.journal, obs([
      ['pm/wbs.md', NEXT1],
      ['pm/changelog.md', NEXT2],
    ]), { eventLogged: true });
    expect(r.action).toBe('resume-log');
    expect(r.needsAttention).toBe(false);
    expect(r.messages.join()).toContain('幂等');
  });

  it('中断点⑥：applied 且部分文件仍为基线 → resume-apply 剩余目标', () => {
    const a = markApplied(prepared(), T2);
    if (!a.ok) return;
    const r = assessRecovery(a.journal, obs([
      ['pm/wbs.md', BASE1],
      ['pm/changelog.md', NEXT2],
    ]), { eventLogged: false });
    expect(r.action).toBe('resume-apply');
    expect(r.pendingPaths).toEqual(['pm/wbs.md']);
  });

  it('中断点⑦：logged 且文件与日志齐备 → commit', () => {
    const a = markApplied(prepared(), T2);
    if (!a.ok) return;
    const l = markLogged(a.journal, T3);
    if (!l.ok) return;
    const r = assessRecovery(l.journal, obs([
      ['pm/wbs.md', NEXT1],
      ['pm/changelog.md', NEXT2],
    ]), { eventLogged: true });
    expect(r.action).toBe('commit');
    expect(r.needsAttention).toBe(false);
  });

  it('中断点⑧：committed → noop；aborted 且全部目标仍在基线 → 干净中止 noop 且回显中止原因', () => {
    const a = markApplied(prepared(), T2);
    if (!a.ok) return;
    const l = markLogged(a.journal, T3);
    if (!l.ok) return;
    const c = commitOperation(l.journal, T4);
    if (!c.ok) return;
    const rc = assessRecovery(c.journal, obs([
      ['pm/wbs.md', NEXT1],
      ['pm/changelog.md', NEXT2],
    ]), { eventLogged: true });
    expect(rc.action).toBe('noop');

    const ab = abortOperation(prepared(), T2, '用户取消');
    if (!ab.ok) return;
    const ra = assessRecovery(ab.journal, obs([
      ['pm/wbs.md', BASE1],
      ['pm/changelog.md', BASE2],
    ]), { eventLogged: false });
    expect(ra.action).toBe('noop');
    expect(ra.needsAttention).toBe(false);
    expect(ra.messages.join()).toContain('用户取消');
    expect(ra.messages.join()).toContain('干净中止');
  });

  it('评审中·1：applied 相中止（文件已写、事件未记）→ 孤儿终态不再静默 noop，manual-review 要求前向修正', () => {
    const a = markApplied(prepared(), T2);
    if (!a.ok) return;
    const ab = abortOperation(a.journal, T3, '上游需求撤销');
    if (!ab.ok) return;
    // 两文件均已落盘为计划内容，但事件从未写入 changelog
    const r = assessRecovery(ab.journal, obs([
      ['pm/wbs.md', NEXT1],
      ['pm/changelog.md', NEXT2],
    ]), { eventLogged: false });
    expect(r.action).toBe('manual-review');
    expect(r.needsAttention).toBe(true);
    expect(r.messages.join()).toContain('孤儿终态');
    expect(r.messages.join()).toContain('correction'); // 前向修正走追加事件，不回滚不撤销
    expect(r.retainedMaterial.eventId).toBe('01HZZZZZZZZZZZZZZZZZZZZZZZ');
  });

  it('评审中·1：prepared 相中止但有文件已部分写入 → 同样判定孤儿终态，不静默', () => {
    const ab = abortOperation(prepared(), T2, '中途取消');
    if (!ab.ok) return;
    const r = assessRecovery(ab.journal, obs([
      ['pm/wbs.md', NEXT1], // prepared 相就中断，但 wbs 已被写成计划内容
      ['pm/changelog.md', BASE2],
    ]), { eventLogged: false });
    expect(r.action).toBe('manual-review');
    expect(r.needsAttention).toBe(true);
    expect(r.messages.join()).toContain('孤儿终态');
  });

  it('评审中·1：aborted 相存在外部修改/不可观察目标 → 不声称干净中止，manual-review', () => {
    const ab = abortOperation(prepared(), T2, '用户取消');
    if (!ab.ok) return;
    const conflict = assessRecovery(ab.journal, obs([
      ['pm/wbs.md', 'e'.repeat(64)],
      ['pm/changelog.md', BASE2],
    ]), { eventLogged: false });
    expect(conflict.action).toBe('manual-review');
    expect(conflict.needsAttention).toBe(true);
    expect(conflict.messages.join()).toContain('无法确证干净');

    const unobservable = assessRecovery(ab.journal, obs([['pm/wbs.md', BASE1]]), { eventLogged: false });
    expect(unobservable.action).toBe('manual-review');
    expect(unobservable.needsAttention).toBe(true);
    expect(unobservable.targets[1]!.state).toBe('unknown');
  });
});

describe('T-M0b-04 · 外部冲突与不可静默提交（B-2）', () => {
  it('prepared 阶段发现外部修改 → abort，绝不覆盖外部内容，材料保留', () => {
    const r = assessRecovery(prepared(), obs([
      ['pm/wbs.md', 'e'.repeat(64)],
      ['pm/changelog.md', BASE2],
    ]), { eventLogged: false });
    expect(r.action).toBe('abort');
    expect(r.conflictPaths).toEqual(['pm/wbs.md']);
    expect(r.needsAttention).toBe(true);
    expect(r.retainedMaterial.targets).toEqual(TARGETS);
    expect(r.targets[0]!.state).toBe('conflict');
  });

  it('目标文件被删除（基线存在但盘上为 null）→ conflict', () => {
    const r = assessRecovery(prepared(), obs([
      ['pm/wbs.md', null],
      ['pm/changelog.md', BASE2],
    ]), { eventLogged: false });
    expect(r.targets[0]!.state).toBe('conflict');
    expect(r.action).toBe('abort');
  });

  it('新建文件（baseHash=null）尚未创建 → base，不是冲突', () => {
    const j = prepareOperation({
      operationId: 'OP-2',
      eventId: '01HYYYYYYYYYYYYYYYYYYYYYYY',
      targets: [{ path: 'pm/new.md', baseHash: null, nextHash: B }],
      now: T1,
    });
    const r = assessRecovery(j, obs([['pm/new.md', null]]), { eventLogged: false });
    expect(r.targets[0]!.state).toBe('base');
    expect(r.action).toBe('resume-apply');
  });

  it('applied 阶段有冲突 → manual-review（不自动回滚、不覆盖、不静默继续）', () => {
    const a = markApplied(prepared(), T2);
    if (!a.ok) return;
    const r = assessRecovery(a.journal, obs([
      ['pm/wbs.md', 'f'.repeat(64)],
      ['pm/changelog.md', NEXT2],
    ]), { eventLogged: false });
    expect(r.action).toBe('manual-review');
    expect(r.needsAttention).toBe(true);
    expect(r.messages.join()).toContain('不自动回滚');
  });

  it('logged 阶段文件被外部改回基线 → 禁止 commit，人工前向修正（日志不可撤回）', () => {
    const a = markApplied(prepared(), T2);
    if (!a.ok) return;
    const l = markLogged(a.journal, T3);
    if (!l.ok) return;
    const r = assessRecovery(l.journal, obs([
      ['pm/wbs.md', BASE1],
      ['pm/changelog.md', NEXT2],
    ]), { eventLogged: true });
    expect(r.action).toBe('manual-review');
    expect(r.needsAttention).toBe(true);
    expect(r.messages.join()).toContain('append-only');
  });

  it('评审中·2：相位 logged 但日志不存在 → 不自动补写疑似删除，manual-review 人工核实', () => {
    const a = markApplied(prepared(), T2);
    if (!a.ok) return;
    const l = markLogged(a.journal, T3);
    if (!l.ok) return;
    const r = assessRecovery(l.journal, obs([
      ['pm/wbs.md', NEXT1],
      ['pm/changelog.md', NEXT2],
    ]), { eventLogged: false });
    expect(r.action).toBe('manual-review');
    expect(r.needsAttention).toBe(true);
    // 不再以 resume-log 自动补写消解疑似删除/回滚（B-11 疑似完整性异常）
    expect(r.messages.join()).toContain('不自动补写');
    expect(r.messages.join()).toContain('B-11');
  });
});

describe('T-M0b-04 · 未知如实展示（P-08）', () => {
  it('未提供盘上观察 → unknown，不假设状态，转人工复核', () => {
    const r = assessRecovery(prepared(), obs([['pm/wbs.md', BASE1]]), { eventLogged: false });
    expect(r.targets[1]!.state).toBe('unknown');
    expect(r.action).toBe('manual-review');
    expect(r.needsAttention).toBe(true);
    expect(r.messages.join()).toContain('保留');
  });

  it('applied 阶段日志存在性未知 → 仍按幂等补写，但标记需处理（不按存在处理）', () => {
    const a = markApplied(prepared(), T2);
    if (!a.ok) return;
    const r = assessRecovery(a.journal, obs([
      ['pm/wbs.md', NEXT1],
      ['pm/changelog.md', NEXT2],
    ]), { eventLogged: null });
    expect(r.action).toBe('resume-log');
    expect(r.needsAttention).toBe(true);
    expect(r.eventLogged).toBeNull();
  });

  it('logged 阶段日志存在性未知 → 提交前必须核实，转人工复核', () => {
    const a = markApplied(prepared(), T2);
    if (!a.ok) return;
    const l = markLogged(a.journal, T3);
    if (!l.ok) return;
    const r = assessRecovery(l.journal, obs([
      ['pm/wbs.md', NEXT1],
      ['pm/changelog.md', NEXT2],
    ]), { eventLogged: null });
    expect(r.action).toBe('manual-review');
    expect(r.needsAttention).toBe(true);
  });

  it('未登记目标文件 → manual-review（不产生"空操作已恢复"的假结论）', () => {
    const j = prepareOperation({ operationId: 'OP-3', eventId: '01HXXXXXXXXXXXXXXXXXXXXXXX', targets: [], now: T1 });
    const r = assessRecovery(j, [], { eventLogged: false });
    expect(r.action).toBe('manual-review');
    expect(r.needsAttention).toBe(true);
  });
});
