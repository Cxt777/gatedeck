/**
 * 决策台查询规则层（T-M1-09；承载 T-M1-06 总览墙数据面。基准 D-24「决策台式 PM」/ P-08 / W-06）。
 *
 * M1 四条规则（W-S2-6 定稿口径；brief 与 T-M1-10 一页 Web 复用本层，CLI 只渲染不判定）：
 *   ① 门禁 readyForReview（条件全满足、待人工验收）或 hasPendingRequest（待审推进申请）
 *      → awaiting-decision「等您决定」；
 *   ② 任务 status=blocked → needs-attention「需要关注」；
 *   ③ 门禁 hasStaleEvidence（关联检查存在过期/待复验凭证）→ needs-attention「需要关注」；
 *   ④ 任务 status=todo 且 deps 全部 done/dropped 且（未标阶段或 == currentStageName）
 *      → can-proceed「可以推进」。
 *   其余 doing → in-progress「进行中」；done/dropped 不入墙（counts 不计）。
 *   stage.needsAttention 非空 → 追加一条 needs-attention 区合成项（reason=「事件链需处理」，
 *   task/gate 均空，id 固定 'stage-attention'，以 BoardItem.stageIssue 承载）。
 *
 * 口径说明（供各端复用一致，勿在各端自定）：
 *   - 规则逐条独立判定：同一门禁可同时命中 ① 与 ③，两区各出一条卡（每卡对应一个行动项）；
 *   - deps 引用不存在的任务 id 视为未满足（P-08 不假设），该任务不进 can-proceed；
 *   - 任务标注了阶段而 currentStageName 为 null（阶段未派生）→ 阶段无法确认，不进 can-proceed；
 *   - 本层只做归区与计数，不做任何 IO；无时钟、无随机数（core 纯度约束）；
 *   - as_of 与源版本自 BoardInput.stage 原样透传（T-M1-06：总览墙必须携带派生版本戳，
 *     见 derivedVersion.ts 契约），本层不做新旧判定——CAS 归 derivedVersion.checkFreshSubmission。
 *
 * 纯 TS 计算，无 IO（core 纯度约束）。
 */

/** 决策台任务状态（与 wbsKernel.WBS_STATUS_VALUES 同枚举；机器权威层以英文为准） */
export type BoardTaskStatus = 'todo' | 'doing' | 'done' | 'blocked' | 'dropped';

/** 决策台任务输入（wbs.md 节点投影；字段自定但供 M1 后续 brief/wall 复用） */
export interface BoardTask {
  id: string;
  title: string;
  status: BoardTaskStatus;
  /** 前置任务 id 列表；全部 done/dropped 才满足规则④ */
  deps: string[];
  /**
   * 任务所属阶段（门禁 id 命名空间，与 foldStage 的 currentStage 同一命名空间）。
   * M1 装配口径：wbs.md 节点的 gate 字段即任务所属阶段门禁 id；未标 = 不限阶段。
   */
  stage?: string;
}

/** 决策台门禁输入（gates.md 节点投影；gates.md 解析器落地前的装配见 cli/commands/deck.ts） */
export interface BoardGate {
  id: string;
  title: string;
  /** 门禁条件全部满足、待人工验收（规则①） */
  readyForReview: boolean;
  /** 存在待审推进申请（规则①） */
  hasPendingRequest: boolean;
  /** 关联检查存在过期/待复验凭证（规则③） */
  hasStaleEvidence: boolean;
}

/** 阶段快照（StageProjection 的决策台侧切片：current/asOf/sourceVersion/needsAttention） */
export interface BoardStageSnapshot {
  /** 当前阶段；未初始化或无参与事件为 null */
  current: string | null;
  /** 最后参与推导事件的 recorded_at（T-M1-06 携带口径）；无参与事件为 null */
  asOf: string | null;
  /** 参与推导的事件笔数（派生代数，T-M0b-06） */
  sourceVersion: number;
  /** 事件链需处理条目（B-11：链级问题/折叠诊断/不可解析块等，形状由装配方决定） */
  needsAttention: unknown[];
}

/** 决策台输入（装配方拼装；core 只消费，不做文件/时钟访问） */
export interface BoardInput {
  tasks: BoardTask[];
  gates: BoardGate[];
  stage: BoardStageSnapshot;
  /** 当前阶段名（规则④的阶段过滤基准）；与 stage.current 通常同源，由装配方传入 */
  currentStageName: string | null;
}

/** 决策区（三区 + 进行中；中文区名统一由渲染层映射：等您决定/可以推进/需要关注/进行中） */
export type DecisionZone = 'awaiting-decision' | 'needs-attention' | 'can-proceed' | 'in-progress';

/** 决策台条目（一张卡）；task/gate 至多其一（stage-attention 合成项两者皆空） */
export interface BoardItem {
  zone: DecisionZone;
  /** 归区原因（中文，展示用） */
  reason: string;
  task?: BoardTask;
  gate?: BoardGate;
  /** 事件链合成项的固定契约 id（值恒为 'stage-attention'）；其余条目无此字段 */
  stageIssue?: string;
}

/** 决策台投影：条目全集 + 分区计数 + 派生版本戳（T-M1-06 携带） */
export interface BoardProjection {
  items: BoardItem[];
  counts: Record<DecisionZone, number>;
  /** as_of（透传自 stage.asOf）；无参与事件为 null */
  asOf: string | null;
  /** 源版本（透传自 stage.sourceVersion） */
  sourceVersion: number;
}

/** 事件链需处理合成项的固定契约 id（BoardItem.stageIssue 承载） */
export const STAGE_ATTENTION_ID = 'stage-attention';

/** 四区初始计数（全零） */
function emptyCounts(): Record<DecisionZone, number> {
  return { 'awaiting-decision': 0, 'needs-attention': 0, 'can-proceed': 0, 'in-progress': 0 };
}

/**
 * 决策台归区：按四条规则逐条判定输入任务与门禁，产出墙条目与分区计数。
 * 条目顺序＝规则顺序（①门禁 → ②blocked → ③证据过期 → ④可领取 → 进行中 → 事件链合成项），
 * 渲染层按 zone 分区展示时顺序天然稳定（R-04 精神：同输入同输出，可重算）。
 */
export function decideBoard(input: BoardInput): BoardProjection {
  const items: BoardItem[] = [];
  const taskById = new Map(input.tasks.map((t) => [t.id, t]));

  // 规则①：待验收门禁 / 待审推进申请 → 等您决定
  for (const gate of input.gates) {
    if (gate.readyForReview) {
      items.push({ zone: 'awaiting-decision', reason: '门禁待验收', gate });
    } else if (gate.hasPendingRequest) {
      items.push({ zone: 'awaiting-decision', reason: '存在待审推进申请', gate });
    }
  }

  // 规则②：blocked → 需要关注
  for (const task of input.tasks) {
    if (task.status === 'blocked') {
      items.push({ zone: 'needs-attention', reason: '任务阻塞', task });
    }
  }

  // 规则③：证据过期/待复验 → 需要关注（与规则①独立判定，同一门禁两区各一条）
  for (const gate of input.gates) {
    if (gate.hasStaleEvidence) {
      items.push({ zone: 'needs-attention', reason: '证据过期/待复验', gate });
    }
  }

  // 规则④：todo 且前置满足且阶段匹配 → 可以推进
  for (const task of input.tasks) {
    if (task.status !== 'todo') continue;
    // deps 全部 done/dropped；引用不存在的任务视为未满足（P-08 不假设）
    const depsSatisfied = task.deps.every((depId) => {
      const dep = taskById.get(depId);
      return dep !== undefined && (dep.status === 'done' || dep.status === 'dropped');
    });
    if (!depsSatisfied) continue;
    // 阶段过滤：未标阶段不限；标了阶段必须与当前阶段一致（当前阶段未派生时不猜）
    const stageMatches = task.stage === undefined || task.stage === input.currentStageName;
    if (!stageMatches) continue;
    items.push({ zone: 'can-proceed', reason: '前置满足，可领取', task });
  }

  // 其余 doing → 进行中；done/dropped 不入墙
  for (const task of input.tasks) {
    if (task.status === 'doing') {
      items.push({ zone: 'in-progress', reason: '进行中', task });
    }
  }

  // 事件链需处理：needsAttention 非空 → 追加一条合成项（id 固定，task/gate 均空）
  if (input.stage.needsAttention.length > 0) {
    items.push({ zone: 'needs-attention', reason: '事件链需处理', stageIssue: STAGE_ATTENTION_ID });
  }

  const counts = emptyCounts();
  for (const item of items) counts[item.zone]++;

  return {
    items,
    counts,
    asOf: input.stage.asOf,
    sourceVersion: input.stage.sourceVersion,
  };
}
