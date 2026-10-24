import { describe, expect, it } from 'vitest';

import {
  decideBoard,
  STAGE_ATTENTION_ID,
  type BoardGate,
  type BoardInput,
  type BoardTask,
} from './decisionBoard.js';

/** 任务速记：todo 默认无 deps 无阶段标注 */
function task(partial: Partial<BoardTask> & { id: string }): BoardTask {
  return {
    title: partial.id,
    status: 'todo',
    deps: [],
    ...partial,
  };
}

/** 门禁速记：默认三标志全 false */
function gate(partial: Partial<BoardGate> & { id: string }): BoardGate {
  return {
    title: partial.id,
    readyForReview: false,
    hasPendingRequest: false,
    hasStaleEvidence: false,
    ...partial,
  };
}

function board(partial: Partial<BoardInput>): BoardInput {
  return {
    tasks: [],
    gates: [],
    stage: { current: null, asOf: null, sourceVersion: 0, needsAttention: [] },
    currentStageName: null,
    ...partial,
  };
}

describe('decideBoard 规则①：待验收门禁/待审申请 → 等您决定', () => {
  it('readyForReview=true → awaiting-decision，reason=门禁待验收', () => {
    const p = decideBoard(board({ gates: [gate({ id: 'G-M1', readyForReview: true })] }));
    expect(p.counts['awaiting-decision']).toBe(1);
    const item = p.items[0]!;
    expect(item.zone).toBe('awaiting-decision');
    expect(item.reason).toBe('门禁待验收');
    expect(item.gate?.id).toBe('G-M1');
    expect(item.task).toBeUndefined();
  });

  it('hasPendingRequest=true（未 ready）→ awaiting-decision，reason=存在待审推进申请', () => {
    const p = decideBoard(board({ gates: [gate({ id: 'G-M1', hasPendingRequest: true })] }));
    expect(p.counts['awaiting-decision']).toBe(1);
    expect(p.items[0]!.zone).toBe('awaiting-decision');
    expect(p.items[0]!.reason).toBe('存在待审推进申请');
  });

  it('readyForReview 优先于 hasPendingRequest（同 gate 只出一条等您决定卡）', () => {
    const p = decideBoard(
      board({ gates: [gate({ id: 'G-M1', readyForReview: true, hasPendingRequest: true })] }),
    );
    expect(p.items.filter((i) => i.zone === 'awaiting-decision')).toHaveLength(1);
    expect(p.items[0]!.reason).toBe('门禁待验收');
  });

  it('反例：三标志全 false 的门禁不产生任何条目', () => {
    const p = decideBoard(board({ gates: [gate({ id: 'G-M1' })] }));
    expect(p.items).toEqual([]);
    expect(p.counts).toEqual({
      'awaiting-decision': 0,
      'needs-attention': 0,
      'can-proceed': 0,
      'in-progress': 0,
    });
  });
});

describe('decideBoard 规则②：blocked → 需要关注', () => {
  it('blocked 任务 → needs-attention，reason=任务阻塞', () => {
    const t = task({ id: 'T-1', status: 'blocked' });
    const p = decideBoard(board({ tasks: [t] }));
    expect(p.counts['needs-attention']).toBe(1);
    expect(p.items[0]!.zone).toBe('needs-attention');
    expect(p.items[0]!.reason).toBe('任务阻塞');
    expect(p.items[0]!.task?.id).toBe('T-1');
  });

  it('反例：todo 任务不产生「任务阻塞」条目（无 deps 无阶段标注时按规则④进 can-proceed）', () => {
    const p = decideBoard(board({ tasks: [task({ id: 'T-1', status: 'todo' })] }));
    expect(p.items.filter((i) => i.zone === 'needs-attention')).toEqual([]);
    expect(p.counts['can-proceed']).toBe(1); // 规则④正常接管，不误报「需要关注」
  });
});

describe('decideBoard 规则③：证据过期/待复验 → 需要关注', () => {
  it('hasStaleEvidence=true → needs-attention，reason=证据过期/待复验', () => {
    const p = decideBoard(board({ gates: [gate({ id: 'G-M1', hasStaleEvidence: true })] }));
    expect(p.counts['needs-attention']).toBe(1);
    expect(p.items[0]!.zone).toBe('needs-attention');
    expect(p.items[0]!.reason).toBe('证据过期/待复验');
    expect(p.items[0]!.gate?.id).toBe('G-M1');
  });

  it('同一门禁 readyForReview + hasStaleEvidence → 两区各出一条（规则逐条独立判定）', () => {
    const p = decideBoard(
      board({ gates: [gate({ id: 'G-M1', readyForReview: true, hasStaleEvidence: true })] }),
    );
    expect(p.counts['awaiting-decision']).toBe(1);
    expect(p.counts['needs-attention']).toBe(1);
    const zones = p.items.map((i) => i.zone).sort();
    expect(zones).toEqual(['awaiting-decision', 'needs-attention']);
    for (const item of p.items) expect(item.gate?.id).toBe('G-M1');
  });
});

describe('decideBoard 规则④：前置满足的可领取任务 → 可以推进', () => {
  it('todo + deps 全 done → can-proceed，reason=前置满足，可领取', () => {
    const p = decideBoard(
      board({
        tasks: [task({ id: 'T-0', status: 'done' }), task({ id: 'T-1', deps: ['T-0'] })],
      }),
    );
    expect(p.counts['can-proceed']).toBe(1);
    expect(p.items[0]!.zone).toBe('can-proceed');
    expect(p.items[0]!.reason).toBe('前置满足，可领取');
    expect(p.items[0]!.task?.id).toBe('T-1');
  });

  it('dropped 前置同样算满足；dropped 任务本身不入墙；stage 未标不限阶段', () => {
    const p = decideBoard(
      board({
        tasks: [task({ id: 'T-0', status: 'dropped' }), task({ id: 'T-1', deps: ['T-0'] })],
        currentStageName: 'G-M1',
      }),
    );
    // 仅 T-1 可领取；T-0 为 dropped 不入墙（counts 不计）
    expect(p.counts['can-proceed']).toBe(1);
    expect(p.items).toHaveLength(1);
    expect(p.items[0]!.task?.id).toBe('T-1');
  });

  it('反例：前置 doing 未完成 → 依赖方不进 can-proceed，doing 本身按其余规则进 in-progress', () => {
    const p = decideBoard(
      board({
        tasks: [task({ id: 'T-0', status: 'doing' }), task({ id: 'T-1', deps: ['T-0'] })],
      }),
    );
    expect(p.items.filter((i) => i.zone === 'can-proceed')).toEqual([]);
    expect(p.counts['in-progress']).toBe(1); // T-0（规格：其余 doing → in-progress）
    expect(p.counts['can-proceed']).toBe(0); // T-1 前置未满足
  });

  it('反例：deps 引用不存在的任务 id 视为未满足（P-08 不假设）', () => {
    const p = decideBoard(board({ tasks: [task({ id: 'T-1', deps: ['T-ghost'] })] }));
    expect(p.items).toEqual([]);
  });

  it('反例：跨阶段 todo（标注其他阶段，currentStageName 非空）→ 不进 can-proceed', () => {
    const p = decideBoard(
      board({
        tasks: [task({ id: 'T-1', stage: 'G-M2a' })],
        currentStageName: 'G-M1',
      }),
    );
    expect(p.items).toEqual([]);
  });

  it('标注阶段 == 当前阶段 → 进 can-proceed', () => {
    const p = decideBoard(
      board({
        tasks: [task({ id: 'T-1', stage: 'G-M1' })],
        currentStageName: 'G-M1',
      }),
    );
    expect(p.counts['can-proceed']).toBe(1);
  });

  it('currentStageName 为 null 而任务标注了阶段 → 不进 can-proceed（不猜阶段）', () => {
    const p = decideBoard(board({ tasks: [task({ id: 'T-1', stage: 'G-M1' })] }));
    expect(p.items).toEqual([]);
  });
});

describe('decideBoard：进行中与不入墙', () => {
  it('doing → in-progress，reason=进行中；done/dropped 不入墙且不计 counts', () => {
    const p = decideBoard(
      board({
        tasks: [
          task({ id: 'T-1', status: 'doing' }),
          task({ id: 'T-2', status: 'done' }),
          task({ id: 'T-3', status: 'dropped' }),
        ],
      }),
    );
    expect(p.items).toHaveLength(1);
    expect(p.items[0]!.zone).toBe('in-progress');
    expect(p.items[0]!.reason).toBe('进行中');
    expect(p.items[0]!.task?.id).toBe('T-1');
    expect(p.counts['in-progress']).toBe(1);
    expect(p.counts['needs-attention']).toBe(0);
  });
});

describe('decideBoard：counts 汇总、事件链合成项、版本戳携带、空输入', () => {
  it('counts 按四区汇总（各规则混合输入）', () => {
    const p = decideBoard(
      board({
        tasks: [
          task({ id: 'T-1', status: 'blocked' }),
          task({ id: 'T-2' }),
          task({ id: 'T-3', status: 'doing' }),
          task({ id: 'T-4', status: 'done' }),
        ],
        gates: [gate({ id: 'G-1', hasPendingRequest: true }), gate({ id: 'G-2', hasStaleEvidence: true })],
      }),
    );
    expect(p.counts).toEqual({
      'awaiting-decision': 1,
      'needs-attention': 2, // blocked + 证据过期
      'can-proceed': 1,
      'in-progress': 1,
    });
  });

  it('stage.needsAttention 非空 → 追加一条 needs-attention 合成项（stageIssue=stage-attention，task/gate 均空）', () => {
    const p = decideBoard(
      board({
        stage: {
          current: 'G-M1',
          asOf: '2026-10-24T01:00:00Z',
          sourceVersion: 3,
          needsAttention: [{ source: 'chain', message: '[anchor-missing] 锚点缺失' }],
        },
      }),
    );
    expect(p.counts['needs-attention']).toBe(1);
    const item = p.items[0]!;
    expect(item.zone).toBe('needs-attention');
    expect(item.reason).toBe('事件链需处理');
    expect(item.stageIssue).toBe(STAGE_ATTENTION_ID);
    expect(item.task).toBeUndefined();
    expect(item.gate).toBeUndefined();
  });

  it('stage.needsAttention 为空数组 → 不产生合成项', () => {
    const p = decideBoard(board({}));
    expect(p.items).toEqual([]);
  });

  it('as_of 与源版本透传（T-M1-06 携带口径），含空流 null/0', () => {
    const withEvents = decideBoard(
      board({
        stage: { current: 'G-M1', asOf: '2026-10-24T09:30:00+08:00', sourceVersion: 7, needsAttention: [] },
      }),
    );
    expect(withEvents.asOf).toBe('2026-10-24T09:30:00+08:00');
    expect(withEvents.sourceVersion).toBe(7);

    const emptyStream = decideBoard(board({}));
    expect(emptyStream.asOf).toBeNull();
    expect(emptyStream.sourceVersion).toBe(0);
  });

  it('空输入 → 空墙 + 四区零计数 + 版本戳为空流', () => {
    const p = decideBoard(board({}));
    expect(p.items).toEqual([]);
    expect(p.counts).toEqual({
      'awaiting-decision': 0,
      'needs-attention': 0,
      'can-proceed': 0,
      'in-progress': 0,
    });
    expect(p.asOf).toBeNull();
    expect(p.sourceVersion).toBe(0);
  });
});
