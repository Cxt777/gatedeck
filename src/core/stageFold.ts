/**
 * 状态折叠规则：当前阶段派生投影（T-M0a-05；基准 D-24 v2.1a / P-09 / B-13 / B-16）。
 *
 * 定稿要点（基准第八节 M0 表「每事实唯一权威位置 + 冲突显示规则」的折叠口径）：
 *  - **按可信 sequence 折叠，不按 occurred_at**（B-16）：sequence 来自收据链
 *    （T-M0a-04 receipt.seq），occurred_at 仅展示不排序；
 *  - **integrity=unknown/invalid 不参与授权/检查/进展推导**（P-09）：只有
 *    有效 integrity=verified 且 origin=core 的事件参与折叠；manual/外部内容永不驱动状态；
 *  - **project.initialized 派生初始阶段**：payload.stage_order = gates.md 阶段序
 *    （初始化时由 core 从 gates.md 读入写入，fold 只消费）；初始阶段 = stage_order[0]；
 *  - **promotion.completed** 携带 { from, to, expected_sequence, manifest_hash? }：
 *      from ≠ 当前阶段 / expected_sequence ≠ 本事件链序 / to 非下一阶段 → 非法，拒绝推进
 *      （事件保留在流中、投影记拒绝原因，不静默丢弃——「非法跳跃拒绝」）；
 *      expected_sequence 提供重放防护：同一事件被复制到其他链位置时序号对不上即拒绝；
 *  - **重复 event_id 幂等**（B-13）：首笔参与折叠，后续同 id 事件出诊断、不产生二次推进；
 *  - **补偿/撤销走追加事件**：correction 引用原 promotion 事件并声明 revert_to，
 *      revert_to 必须等于原 promotion 的 from（只能退回推进前阶段），不改写历史；
 *  - **派生态携带 as_of + sourceVersion**（T-M0b-06 前置）：as_of = 最后参与推导事件的
 *      recorded_at；sourceVersion = 参与推导的事件笔数。
 *
 * 投影为纯派生态：不落 project.md（D-24），随时可由事件流 + 收据重算。
 * 纯函数，无 IO（core 纯度约束）。
 */

import type { ChainIssue } from './eventReceipt.js';
import type { EventEnvelope } from './eventEnvelope.js';

/** 折叠输入：信封 + 收据验证后的有效 integrity + 链序（由 T-M0a-04 验证产出） */
export interface FoldEvent {
  envelope: EventEnvelope;
  /** 收据验证的有效完整性（verified/invalid/unregistered → 后两者不参与推导） */
  effectiveIntegrity: 'verified' | 'invalid' | 'unregistered';
  /** 收据链内序号（可信 sequence）；verified 事件必有 */
  seq?: number;
}

export type FoldDiagnosticCode =
  | 'duplicate-event-id'      // B-13：重复 event_id，幂等取首笔
  | 'promotion-rejected'      // 非法推进（from 不符 / 非法跳跃 / 序号重放），事件保留、推进不生效
  | 'correction-rejected'     // 非法补偿（目标不存在 / revert_to 与原 from 不符）
  | 'init-payload-invalid';   // project.initialized payload 缺 stage_order 或为空

export interface FoldDiagnostic {
  code: FoldDiagnosticCode;
  message: string;
  event_id: string;
  seq?: number;
}

export interface StageTransition {
  event_id: string;
  seq: number;
  kind: 'project.initialized' | 'promotion.completed' | 'correction';
  /** from=null 表示初始化（无前驱阶段） */
  from: string | null;
  to: string;
}

/** 「需处理」条目（B-11：投影进入需处理状态，不静默重算） */
export interface AttentionItem {
  source: 'chain' | 'fold';
  message: string;
  event_id?: string;
}

export interface StageProjection {
  /** 当前阶段；未初始化为 null */
  currentStage: string | null;
  /** gates.md 阶段序（来自 project.initialized payload.stage_order） */
  stageOrder: readonly string[] | null;
  transitions: StageTransition[];
  /** 最后参与推导事件的 recorded_at（ISO 8601；无参与事件为 null） */
  asOf: string | null;
  /** 参与推导的事件笔数（派生态版本，供 T-M0b-06 compare-and-set） */
  sourceVersion: number;
  attention: AttentionItem[];
  diagnostics: FoldDiagnostic[];
}

interface PromotionRecord {
  event_id: string;
  seq: number;
  from: string;
  to: string;
}

const payloadString = (payload: Record<string, unknown>, key: string): string | null => {
  const v = payload[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
};

/** 折叠事件流 → 当前阶段投影（D-24） */
export function foldStage(
  events: readonly FoldEvent[],
  options: { chainIssues?: readonly ChainIssue[] } = {},
): StageProjection {
  const diagnostics: FoldDiagnostic[] = [];
  const attention: AttentionItem[] = [];

  // 链级问题直接进入需处理（B-11），不因投影正常而吞掉
  for (const issue of options.chainIssues ?? []) {
    attention.push({ source: 'chain', message: `[${issue.code}] ${issue.message}`, ...(issue.event_id !== undefined ? { event_id: issue.event_id } : {}) });
  }

  // 参与推导：verified + core + 有链序（P-09：unknown/invalid 不参与；manual 永不驱动状态）
  const participating = events
    .filter((e) => e.effectiveIntegrity === 'verified' && e.envelope.origin === 'core' && e.seq !== undefined)
    .sort((a, b) => a.seq! - b.seq!); // B-16：只按链序，不按 occurred_at

  let currentStage: string | null = null;
  let stageOrder: readonly string[] | null = null;
  const transitions: StageTransition[] = [];
  const promotions = new Map<string, PromotionRecord>();
  const seenIds = new Set<string>();
  let lastRecordedAt: string | null = null;
  let version = 0;

  for (const ev of participating) {
    const { envelope, seq } = ev as FoldEvent & { seq: number };

    // B-13 幂等：重复 event_id 取首笔，后续不产生任何状态效果
    if (seenIds.has(envelope.event_id)) {
      diagnostics.push({
        code: 'duplicate-event-id',
        message: `重复 event_id（B-13 幂等）：取首笔参与折叠，本笔不产生状态效果`,
        event_id: envelope.event_id,
        seq,
      });
      continue;
    }
    seenIds.add(envelope.event_id);
    // as_of / sourceVersion：统计每笔被消费的参与事件（含拒绝/无状态效果的），
    // 回答「投影基于哪个时点的事件流」，供 T-M0b-06 compare-and-set 使用
    version++;
    lastRecordedAt = envelope.recorded_at;

    switch (envelope.kind) {
      case 'project.initialized': {
        const raw = envelope.payload['stage_order'];
        const order = Array.isArray(raw) && raw.every((s) => typeof s === 'string') && raw.length > 0
          ? (raw as string[])
          : null;
        if (order === null) {
          diagnostics.push({
            code: 'init-payload-invalid',
            message: 'project.initialized 的 payload.stage_order 缺失/为空/含非字符串，无法派生初始阶段（初始阶段=gates.md 首阶段）',
            event_id: envelope.event_id,
            seq,
          });
          attention.push({ source: 'fold', message: '初始化事件缺 stage_order，当前阶段派生不可信', event_id: envelope.event_id });
          break;
        }
        stageOrder = order;
        currentStage = order[0]!; // 初始阶段 = gates.md 首阶段
        transitions.push({ event_id: envelope.event_id, seq, kind: 'project.initialized', from: null, to: currentStage });
        break;
      }
      case 'promotion.completed': {
        const from = payloadString(envelope.payload, 'from');
        const to = payloadString(envelope.payload, 'to');
        const expectedRaw = envelope.payload['expected_sequence'];
        const expectedSequence = typeof expectedRaw === 'number' && Number.isInteger(expectedRaw) ? expectedRaw : null;
        if (from === null || to === null || expectedSequence === null) {
          diagnostics.push({
            code: 'promotion-rejected',
            message: `promotion.completed payload 缺 from/to/expected_sequence，推进无效（事件保留）`,
            event_id: envelope.event_id,
            seq,
          });
          break;
        }
        if (expectedSequence !== seq) {
          // 重放防护：事件被复制到其他链位置时 expected_sequence 对不上
          diagnostics.push({
            code: 'promotion-rejected',
            message: `promotion 序号重放拒绝：expected_sequence=${expectedSequence} ≠ 本事件链序 ${seq}（事件保留，推进不生效）`,
            event_id: envelope.event_id,
            seq,
          });
          break;
        }
        if (stageOrder === null || currentStage === null) {
          diagnostics.push({
            code: 'promotion-rejected',
            message: '未初始化即收到 promotion（无 stage_order 可校验），推进拒绝',
            event_id: envelope.event_id,
            seq,
          });
          break;
        }
        if (from !== currentStage) {
          diagnostics.push({
            code: 'promotion-rejected',
            message: `promotion from=${from} 与当前阶段 ${currentStage} 不符，推进拒绝（非法跳跃/过期申请）`,
            event_id: envelope.event_id,
            seq,
          });
          break;
        }
        const next: string | undefined = stageOrder[stageOrder.indexOf(currentStage) + 1];
        if (next === undefined || to !== next) {
          diagnostics.push({
            code: 'promotion-rejected',
            message: `promotion to=${to} 非当前阶段 ${currentStage} 的下一阶段${next !== undefined ? `（应为 ${next}）` : '（已到最后阶段）'}，非法跳跃拒绝`,
            event_id: envelope.event_id,
            seq,
          });
          break;
        }
        currentStage = to;
        promotions.set(envelope.event_id, { event_id: envelope.event_id, seq, from, to });
        transitions.push({ event_id: envelope.event_id, seq, kind: 'promotion.completed', from, to });
        break;
      }
      case 'correction': {
        const targetId = payloadString(envelope.payload, 'target_event_id');
        const revertTo = payloadString(envelope.payload, 'revert_to');
        const target = targetId !== null ? promotions.get(targetId) : undefined;
        if (target === undefined || revertTo === null) {
          diagnostics.push({
            code: 'correction-rejected',
            message: `correction 引用的 target_event_id 不存在或 revert_to 缺失，补偿拒绝（补偿只能引用已生效的 promotion）`,
            event_id: envelope.event_id,
            seq,
          });
          break;
        }
        if (revertTo !== target.from) {
          diagnostics.push({
            code: 'correction-rejected',
            message: `correction revert_to=${revertTo} 与原 promotion from=${target.from} 不符，补偿拒绝（只能退回推进前阶段）`,
            event_id: envelope.event_id,
            seq,
          });
          break;
        }
        currentStage = revertTo;
        transitions.push({ event_id: envelope.event_id, seq, kind: 'correction', from: target.to, to: revertTo });
        break;
      }
      default:
        // 其余 core kind（check.completed / authorization.* / operation.recovery 等）
        // 不影响阶段派生，属其他投影维度（检查事实/授权/恢复，M0b/M1 展开）
        break;
    }
  }

  return {
    currentStage,
    stageOrder,
    transitions,
    asOf: lastRecordedAt,
    sourceVersion: version,
    attention,
    diagnostics,
  };
}
