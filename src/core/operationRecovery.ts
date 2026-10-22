/**
 * 跨文件操作恢复状态机（T-M0b-04；基准 P-06 / B-2）。
 *
 * 四相（不可跳相）：
 *   prepared —— journal 已登记目标文件、基线 hash 与计划 hash；尚未（全部）写入
 *   applied  —— 全部目标文件已落盘为计划内容；事件尚未写入 changelog
 *   logged   —— 事件已追加到 changelog；尚未标记提交
 *   committed —— 操作终结：文件与日志一致
 *   另有 aborted —— 在写入日志前显式放弃；已写文件不做自动回滚（前向修正，避免二次破坏）
 *
 * 恢复原则（`assessRecovery`，纯判定、不执行 IO）：
 *  1. **只依据可观察事实**：盘上每个目标当前 hash + 「日志是否存在」三值（true/false/null）。
 *     无法观察 → `unknown`，不假设为未写/已写（P-08 未知如实展示）；
 *  2. **绝不覆盖外部修改**：目标既不是基线也不是计划内容 → `conflict`；
 *     prepared/applied 阶段有冲突即中止并保留材料；logged 阶段因日志不可撤回 → 人工复核；
 *  3. **中断提交保留可恢复材料**：journal 原样保留（目标、基线/计划 hash、event_id），
 *     评估结果回带 `retainedMaterial`，调用方不得丢弃；
 *  4. **不留状态与日志不一致**：`logged` 相只有在文件全部为计划内容 + 日志存在时才允许 commit；
 *     文件缺失/被改回 → 人工复核，不静默 commit。
 *
 * 时间戳由调用方注入；core 无 IO、无时钟（纯度约束）。
 */

export type OperationPhase = 'prepared' | 'applied' | 'logged' | 'committed' | 'aborted';

export const OPERATION_PHASES: readonly OperationPhase[] = [
  'prepared',
  'applied',
  'logged',
  'committed',
  'aborted',
];

/** 操作目标文件：写入前基线（新建文件为 null）与计划写入后 hash */
export interface OperationTarget {
  path: string;
  baseHash: string | null;
  nextHash: string;
}

/** 跨文件操作日志（调用方负责持久化；本模块只做不可变判定） */
export interface OperationJournal {
  operation_id: string;
  /** 待写入 changelog 的事件 id（logged 相完成后存在） */
  event_id: string;
  phase: OperationPhase;
  targets: readonly OperationTarget[];
  created_at: string;
  updated_at: string;
  /** aborted 时必填；其余相位为 null */
  abort_reason: string | null;
}

export interface PrepareOperationInput {
  operationId: string;
  eventId: string;
  targets: readonly OperationTarget[];
  /** 由调用方注入的时间戳（ISO 8601） */
  now: string;
}

/** 创建 prepared 相 journal（不执行任何写入） */
export function prepareOperation(input: PrepareOperationInput): OperationJournal {
  return {
    operation_id: input.operationId,
    event_id: input.eventId,
    phase: 'prepared',
    targets: input.targets.map((t) => ({ path: t.path, baseHash: t.baseHash, nextHash: t.nextHash })),
    created_at: input.now,
    updated_at: input.now,
    abort_reason: null,
  };
}

export type TransitionErrorCode = 'invalid-phase' | 'missing-abort-reason';

export type TransitionResult =
  | { ok: true; journal: OperationJournal }
  | { ok: false; code: TransitionErrorCode; message: string };

const PHASE_LABEL: Readonly<Record<OperationPhase, string>> = {
  prepared: 'prepared（已登记，未写完）',
  applied: 'applied（文件已写，日志未记）',
  logged: 'logged（日志已记，未提交）',
  committed: 'committed（已提交）',
  aborted: 'aborted（已中止）',
};

function replacePhase(
  journal: OperationJournal,
  phase: OperationPhase,
  now: string,
  abortReason: string | null,
): OperationJournal {
  return { ...journal, phase, updated_at: now, abort_reason: abortReason };
}

function requirePhase(
  journal: OperationJournal,
  allowed: readonly OperationPhase[],
  action: string,
): TransitionResult | null {
  if (!allowed.includes(journal.phase)) {
    return {
      ok: false,
      code: 'invalid-phase',
      message:
        `${action} 只允许从 ${allowed.map((p) => PHASE_LABEL[p]).join(' / ')} 发起；` +
        `当前为 ${PHASE_LABEL[journal.phase]}。四相不得跳相（P-06）。`,
    };
  }
  return null;
}

/** prepared → applied：全部目标文件已按计划落盘 */
export function markApplied(journal: OperationJournal, now: string): TransitionResult {
  const rejected = requirePhase(journal, ['prepared'], 'markApplied');
  if (rejected !== null) return rejected;
  return { ok: true, journal: replacePhase(journal, 'applied', now, null) };
}

/** applied → logged：事件已追加进 changelog（append-only） */
export function markLogged(journal: OperationJournal, now: string): TransitionResult {
  const rejected = requirePhase(journal, ['applied'], 'markLogged');
  if (rejected !== null) return rejected;
  return { ok: true, journal: replacePhase(journal, 'logged', now, null) };
}

/** logged → committed：文件与日志一致，操作终结 */
export function commitOperation(journal: OperationJournal, now: string): TransitionResult {
  const rejected = requirePhase(journal, ['logged'], 'commitOperation');
  if (rejected !== null) return rejected;
  return { ok: true, journal: replacePhase(journal, 'committed', now, null) };
}

/**
 * prepared/applied → aborted。
 * 日志一旦追加不可撤回，故 logged 之后不允许 abort（只能 commit 或人工复核）。
 */
export function abortOperation(
  journal: OperationJournal,
  now: string,
  reason: string,
): TransitionResult {
  if (journal.phase === 'logged') {
    return {
      ok: false,
      code: 'invalid-phase',
      message:
        '日志已追加（append-only 不可撤回），logged 相不允许中止；请核实文件与日志一致性后 commit，或走人工复核（P-06/B-2）。',
    };
  }
  const rejected = requirePhase(journal, ['prepared', 'applied'], 'abortOperation');
  if (rejected !== null) return rejected;
  if (reason.trim() === '') {
    return { ok: false, code: 'missing-abort-reason', message: '中止必须写明原因（留痕，不得静默放弃）' };
  }
  return { ok: true, journal: replacePhase(journal, 'aborted', now, reason.trim()) };
}

/* ---------------------------------------------------------------- *
 * 恢复判定
 * ---------------------------------------------------------------- */

export interface TargetObservation {
  path: string;
  /** 盘上当前内容 hash；文件不存在为 null */
  hash: string | null;
}

export type TargetState =
  | 'base'      // 仍是写入前内容（新建文件则仍未创建）
  | 'applied'   // 已是计划内容
  | 'conflict'  // 既非基线也非计划内容（外部修改/删除）
  | 'unknown';  // 调用方未提供观察

export interface TargetRecoveryState extends OperationTarget {
  observedHash: string | null;
  state: TargetState;
  message: string;
}

export type RecoveryAction =
  | 'noop'          // 已终结，无动作
  | 'resume-apply'  // 继续写入 pending 目标
  | 'mark-applied'  // 文件已全部落盘，仅需把相位推进到 applied
  | 'resume-log'    // 补写日志（event_id 幂等，重复追加由 appendEventBlock 拒绝）
  | 'commit'        // 文件与日志齐备，可提交
  | 'abort'         // 写日志前中止（保留材料，不自动回滚）
  | 'manual-review'; // 无法自动收敛，人工处理（不静默继续）

/** 中断提交保留的可恢复材料（调用方不得丢弃） */
export interface RetainedMaterial {
  operationId: string;
  eventId: string;
  phase: OperationPhase;
  targets: readonly OperationTarget[];
  observations: readonly TargetObservation[];
}

export interface RecoveryAssessment {
  operationId: string;
  recordedPhase: OperationPhase;
  action: RecoveryAction;
  targets: TargetRecoveryState[];
  /** resume-apply 需继续写入的文件 */
  pendingPaths: string[];
  /** 外部修改/删除的文件 */
  conflictPaths: string[];
  /** 日志是否存在的三值原样回显（null = 无法核实/未知） */
  eventLogged: boolean | null;
  needsAttention: boolean;
  retainedMaterial: RetainedMaterial;
  messages: string[];
}

function observeTarget(target: OperationTarget, observation: TargetObservation | undefined): TargetRecoveryState {
  if (observation === undefined) {
    return {
      ...target,
      observedHash: null,
      state: 'unknown',
      message: '未提供盘上观察：恢复决定不得假设文件状态（P-08）',
    };
  }
  const observedHash = observation.hash;
  if (observedHash === target.nextHash) {
    return { ...target, observedHash, state: 'applied', message: '已是计划写入内容' };
  }
  if (target.baseHash === null ? observedHash === null : observedHash === target.baseHash) {
    return { ...target, observedHash, state: 'base', message: '仍是写入前内容（新建文件则尚未创建）' };
  }
  const detail = observedHash === null ? '文件已不存在' : `当前 hash ${observedHash.slice(0, 12)}… 与基线和计划均不符`;
  return {
    ...target,
    observedHash,
    state: 'conflict',
    message: `外部修改冲突：${detail}；不得覆盖（B-2）`,
  };
}

/**
 * 恢复评估（纯判定）：根据 journal 相位 + 盘上观察 + 日志存在性，给出唯一的下一步动作。
 * 不修改 journal、不执行写入；调用方按动作执行后仍需走正常相位迁移并持久化 journal。
 */
export function assessRecovery(
  journal: OperationJournal,
  observations: readonly TargetObservation[],
  context: { eventLogged: boolean | null },
): RecoveryAssessment {
  const observationByPath = new Map(observations.map((o) => [o.path, o]));
  const targets = journal.targets.map((t) => observeTarget(t, observationByPath.get(t.path)));
  const pendingPaths = targets.filter((t) => t.state === 'base').map((t) => t.path);
  const conflictPaths = targets.filter((t) => t.state === 'conflict').map((t) => t.path);
  const hasUnknown = targets.some((t) => t.state === 'unknown');
  const allApplied = targets.length > 0 && targets.every((t) => t.state === 'applied');
  const { eventLogged } = context;

  const base = {
    operationId: journal.operation_id,
    recordedPhase: journal.phase,
    targets,
    pendingPaths,
    conflictPaths,
    eventLogged,
    retainedMaterial: {
      operationId: journal.operation_id,
      eventId: journal.event_id,
      phase: journal.phase,
      targets: journal.targets,
      observations,
    },
  };

  if (targets.length === 0) {
    return {
      ...base,
      action: 'manual-review',
      needsAttention: true,
      messages: ['操作未登记任何目标文件，无法判定恢复范围；保留 journal，人工核对'],
    };
  }

  switch (journal.phase) {
    case 'committed': {
      if (allApplied) {
        return { ...base, action: 'noop', needsAttention: false, messages: ['操作已提交，文件均为计划内容，无恢复动作'] };
      }
      return {
        ...base,
        action: 'manual-review',
        needsAttention: true,
        messages: [
          'journal 记为已提交，但文件已不是计划内容（提交后又被外部修改）：本状态机不自动覆盖，交由外部编辑检测（T-M0b-07）与人工核对',
        ],
      };
    }
    case 'aborted':
      return {
        ...base,
        action: 'noop',
        needsAttention: false,
        messages: [`操作已中止（原因：${journal.abort_reason ?? '未记录'}）；已写文件不做自动回滚，保留材料备查`],
      };
    case 'prepared': {
      if (conflictPaths.length > 0) {
        return {
          ...base,
          action: 'abort',
          needsAttention: true,
          messages: [
            `写入尚未记日志即发现外部修改：${conflictPaths.join(', ')}；中止操作、不覆盖外部内容（B-2），journal 与观察材料保留`,
          ],
        };
      }
      if (hasUnknown) {
        return {
          ...base,
          action: 'manual-review',
          needsAttention: true,
          messages: ['存在无法观察的目标文件，无法判断是否已部分写入；请补齐观察后重试，材料已保留'],
        };
      }
      if (allApplied) {
        return {
          ...base,
          action: 'mark-applied',
          needsAttention: false,
          messages: ['全部目标已是计划内容（中断于写完成与相位推进之间）：确认后落 applied 再补日志'],
        };
      }
      return {
        ...base,
        action: 'resume-apply',
        needsAttention: false,
        messages:
          pendingPaths.length === targets.length
            ? ['尚未写入：按 journal 的计划内容从头执行写入']
            : [`已部分写入，继续写剩余目标：${pendingPaths.join(', ')}（已写目标不重复覆盖）`],
      };
    }
    case 'applied': {
      if (conflictPaths.length > 0 || hasUnknown) {
        return {
          ...base,
          action: 'manual-review',
          needsAttention: true,
          messages: [
            '相位 applied 但目标文件存在冲突/不可观察：日志尚未写入，不自动回滚也不覆盖外部修改，材料保留待人工裁定',
          ],
        };
      }
      if (!allApplied) {
        return {
          ...base,
          action: 'resume-apply',
          needsAttention: false,
          messages: [`相位 applied 但仍有文件停留在基线（中断于写入与相位推进之间）：继续写 ${pendingPaths.join(', ')}`],
        };
      }
      if (eventLogged === null) {
        return {
          ...base,
          action: 'resume-log',
          needsAttention: true,
          messages: [
            '文件均已写入；日志是否存在无法核实（未知，不按存在处理）：按 event_id 幂等补写，随后推进 logged',
          ],
        };
      }
      return {
        ...base,
        action: 'resume-log',
        needsAttention: false,
        messages: [
          eventLogged
            ? '文件均已写入且日志已存在（中断于日志写入与相位推进之间）：按 event_id 幂等跳过重复追加，推进 logged'
            : '文件均已写入、日志未写：补写事件后推进 logged',
        ],
      };
    }
    case 'logged': {
      if (!allApplied) {
        return {
          ...base,
          action: 'manual-review',
          needsAttention: true,
          messages: [
            '日志已追加（append-only 不可撤回）但文件未全部为计划内容：不得静默 commit，需人工前向修正（补写文件或追加 correction 事件），材料保留',
          ],
        };
      }
      if (eventLogged === true) {
        return { ...base, action: 'commit', needsAttention: false, messages: ['文件与日志一致，可提交（committed）'] };
      }
      if (eventLogged === false) {
        return {
          ...base,
          action: 'resume-log',
          needsAttention: true,
          messages: ['相位记为 logged 但日志未找到：按同一 event_id 补写（幂等），恢复后才允许 commit'],
        };
      }
      return {
        ...base,
        action: 'manual-review',
        needsAttention: true,
        messages: ['相位 logged 但日志存在性未知：提交前必须核实，避免状态与日志不一致'],
      };
    }
  }
}
