import { describe, expect, it } from 'vitest';

import {
  B12_REJECT_MESSAGE,
  isTtyInteractive,
  nextPromotionPhase,
  PROMOTION_EVENT_KINDS,
  PROMOTION_NOTICE,
  type PromotionFlowEvent,
} from './promotionFlow.js';

const GATE = 'gate-m1';
const OP = 'op-20261024-01';

/** 构造装配方投影后的轻量事件（默认归属 GATE；operationId 未传则不写字段，exactOptionalPropertyTypes 兼容） */
function ev(
  kind: string,
  operationId?: string,
  payload: Record<string, unknown> = {},
): PromotionFlowEvent {
  return {
    kind,
    payload: { gate_id: GATE, ...payload },
    ...(operationId !== undefined ? { operationId } : {}),
  };
}

const REQUESTED = 'authorization.requested';
const CONFIRMED = 'authorization.locally_confirmed';
const TRANSITIONED = 'task.transitioned';

describe('nextPromotionPhase（T-M1-05 三步编排状态机）', () => {
  it('三步正序 → applied，trace 按出现序完整保留，problem 为 null', () => {
    const r = nextPromotionPhase(
      [ev(REQUESTED, OP), ev(CONFIRMED, OP), ev(TRANSITIONED, OP)],
      { gateId: GATE, operationId: OP },
    );
    expect(r.phase).toBe('applied');
    expect(r.trace).toEqual([REQUESTED, CONFIRMED, TRANSITIONED]);
    expect(r.problem).toBeNull();
  });

  it('空事件流 → none / 空 trace / problem null', () => {
    const r = nextPromotionPhase([], { gateId: GATE, operationId: OP });
    expect(r.phase).toBe('none');
    expect(r.trace).toEqual([]);
    expect(r.problem).toBeNull();
  });

  it('仅 requested → requested', () => {
    const r = nextPromotionPhase([ev(REQUESTED, OP)], { gateId: GATE, operationId: OP });
    expect(r.phase).toBe('requested');
    expect(r.problem).toBeNull();
  });

  it('requested + locally_confirmed → locally-confirmed', () => {
    const r = nextPromotionPhase([ev(REQUESTED, OP), ev(CONFIRMED, OP)], {
      gateId: GATE,
      operationId: OP,
    });
    expect(r.phase).toBe('locally-confirmed');
    expect(r.problem).toBeNull();
  });

  it('跳步①：confirmed 无 requested → problem 非空且 phase=none（trace 仍如实保留）', () => {
    const r = nextPromotionPhase([ev(CONFIRMED, OP)], { gateId: GATE, operationId: OP });
    expect(r.phase).toBe('none');
    expect(r.problem).not.toBeNull();
    expect(r.problem).toContain('confirmed 无 requested');
    expect(r.problem).toContain('P-08');
    expect(r.trace).toEqual([CONFIRMED]);
  });

  it('跳步②：requested + transitioned（缺 confirmed）→ problem 非空且 phase=none', () => {
    const r = nextPromotionPhase([ev(REQUESTED, OP), ev(TRANSITIONED, OP)], {
      gateId: GATE,
      operationId: OP,
    });
    expect(r.phase).toBe('none');
    expect(r.problem).not.toBeNull();
    expect(r.problem).toContain('transitioned 无前两步');
  });

  it('孤立的 transitioned（无任何前步）同样拒绝', () => {
    const r = nextPromotionPhase([ev(TRANSITIONED, OP)], { gateId: GATE, operationId: OP });
    expect(r.phase).toBe('none');
    expect(r.problem).not.toBeNull();
    expect(r.problem).toContain('transitioned 无前两步');
  });

  it('终态后追加：locally_confirmed 在 transitioned 后又出现 → problem 非空且 phase=none', () => {
    const r = nextPromotionPhase(
      [ev(REQUESTED, OP), ev(CONFIRMED, OP), ev(TRANSITIONED, OP), ev(CONFIRMED, OP)],
      { gateId: GATE, operationId: OP },
    );
    expect(r.phase).toBe('none');
    expect(r.problem).not.toBeNull();
    expect(r.problem).toContain('终态不可追加');
    expect(r.trace).toEqual([REQUESTED, CONFIRMED, TRANSITIONED, CONFIRMED]);
  });

  it('同 operationId 过滤：其他操作的 confirmed/transitioned 不串扰本操作相位', () => {
    const r = nextPromotionPhase(
      [
        ev(REQUESTED, OP),
        ev(CONFIRMED, 'op-other'),
        ev(TRANSITIONED, 'op-other'),
      ],
      { gateId: GATE, operationId: OP },
    );
    expect(r.phase).toBe('requested');
    expect(r.problem).toBeNull();
    expect(r.trace).toEqual([REQUESTED]);
  });

  it('重复事件幂等：第二次 confirmed 不改相位、不报错', () => {
    const r = nextPromotionPhase([ev(REQUESTED, OP), ev(CONFIRMED, OP), ev(CONFIRMED, OP)], {
      gateId: GATE,
      operationId: OP,
    });
    expect(r.phase).toBe('locally-confirmed');
    expect(r.problem).toBeNull();
  });

  it('requested 重复回放幂等：requested×2 仍为 requested、problem null', () => {
    const r = nextPromotionPhase([ev(REQUESTED, OP), ev(REQUESTED, OP)], {
      gateId: GATE,
      operationId: OP,
    });
    expect(r.phase).toBe('requested');
    expect(r.problem).toBeNull();
    expect(r.trace).toEqual([REQUESTED, REQUESTED]);
  });

  it('回放不影响正序判定：requested, confirmed, requested(回放), transitioned → applied', () => {
    const r = nextPromotionPhase(
      [ev(REQUESTED, OP), ev(CONFIRMED, OP), ev(REQUESTED, OP), ev(TRANSITIONED, OP)],
      { gateId: GATE, operationId: OP },
    );
    expect(r.phase).toBe('applied');
    expect(r.problem).toBeNull();
  });

  it('operationId 缺失容错：皆缺者不归属、不崩溃；payload.operationId 回退可归属', () => {
    // 无 operationId 字段也无 payload.operationId 的 confirmed：无法归属 → 不驱动本操作
    const orphan: PromotionFlowEvent = { kind: CONFIRMED, payload: { gate_id: GATE } };
    // 仅 payload.operationId（装配方未映射字段）：core 回退读取，正常归属
    const viaPayload: PromotionFlowEvent = {
      kind: REQUESTED,
      payload: { gate_id: GATE, operationId: OP },
    };
    const r = nextPromotionPhase([orphan, viaPayload], { gateId: GATE, operationId: OP });
    expect(r.phase).toBe('requested');
    expect(r.problem).toBeNull();
    expect(r.trace).toEqual([REQUESTED]);
  });

  it('payload 声明不同 gate_id 的事件（即使同 operationId）不驱动本 gate 相位', () => {
    const otherGate = ev(TRANSITIONED, OP, { gate_id: 'gate-other' });
    const r = nextPromotionPhase([otherGate], { gateId: GATE, operationId: OP });
    expect(r.phase).toBe('none');
    expect(r.trace).toEqual([]);
    expect(r.problem).toBeNull();
  });

  it('非三步编排 kind（如 check.completed）不进 trace、不影响相位', () => {
    const r = nextPromotionPhase([ev('check.completed', OP), ev(REQUESTED, OP)], {
      gateId: GATE,
      operationId: OP,
    });
    expect(r.phase).toBe('requested');
    expect(r.trace).toEqual([REQUESTED]);
    expect(r.problem).toBeNull();
  });

  it('PROMOTION_EVENT_KINDS 白名单恰为三类且顺序为 requested → locally_confirmed → transitioned', () => {
    expect(PROMOTION_EVENT_KINDS).toEqual([REQUESTED, CONFIRMED, TRANSITIONED]);
  });
});

describe('isTtyInteractive（B-12 伪 TTY 防线）', () => {
  it('CI 环境（envCi 非空）即使 stdin 为 TTY 也拒绝，message 为固定文案', () => {
    for (const envCi of ['true', '1', 'GITHUB_ACTIONS']) {
      const r = isTtyInteractive(true, envCi);
      expect(r.interactive).toBe(false);
      expect(r.message).toBe(B12_REJECT_MESSAGE);
      expect(r.message).toBe('非交互环境拒绝 confirm/apply：本地确认必须真人 TTY（B-12）');
    }
  });

  it('stdin 非 TTY（无 CI）拒绝', () => {
    const r = isTtyInteractive(false, undefined);
    expect(r.interactive).toBe(false);
    expect(r.message).toBe('非交互环境拒绝 confirm/apply：本地确认必须真人 TTY（B-12）');
  });

  it('stdin 非 TTY 且 CI 环境同样拒绝（两条件独立生效）', () => {
    const r = isTtyInteractive(false, 'true');
    expect(r.interactive).toBe(false);
    expect(r.message).toBe(B12_REJECT_MESSAGE);
  });

  it('TTY + 无 CI 环境变量 → 放行', () => {
    const r = isTtyInteractive(true, undefined);
    expect(r.interactive).toBe(true);
    expect(r.message).toContain('允许真人执行');
  });

  it('TTY + envCi 为空串（未设置语义）→ 放行', () => {
    const r = isTtyInteractive(true, '');
    expect(r.interactive).toBe(true);
  });
});

describe('PROMOTION_NOTICE（通道分工告示）', () => {
  it('包含 MCP 只能 request、CLI TTY 真人执行（D-22）、不产生 authorization.granted（B-4）', () => {
    expect(PROMOTION_NOTICE).toContain('MCP');
    expect(PROMOTION_NOTICE).toContain('authorization.requested');
    expect(PROMOTION_NOTICE).toContain('CLI');
    expect(PROMOTION_NOTICE).toContain('TTY');
    expect(PROMOTION_NOTICE).toContain('D-22');
    expect(PROMOTION_NOTICE).toContain('不产生 authorization.granted');
    expect(PROMOTION_NOTICE).toContain('B-4');
  });
});
