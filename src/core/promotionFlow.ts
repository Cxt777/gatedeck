/**
 * 本地交互确认三步编排状态机：request → confirm → apply（T-M1-05 / W-S2-5；
 * 基准 D-22 / B-4 / B-12 / P-08）。
 *
 * 契约要点：
 *  - **通道分工（D-22 / B-4）**：MCP/外部通道只能产生 authorization.requested
 *    （request 步）；confirm（authorization.locally_confirmed）与 apply
 *    （task.transitioned）仅限本机 CLI 在真人 TTY 交互下执行，主体只存本地不透明
 *    ID（localPrincipalId/terminalSessionId），不含身份信息；MCP 通道永不产生
 *    authorization.granted（B-4 的 schema 层编码见 eventEnvelope kind×origin 矩阵）；
 *  - **按 operationId 关联**：三步事件经装配方把信封 operation_id（或
 *    payload.operationId）映射进轻量事件的 operationId 字段后传入；core 对缺失
 *    operationId 字段的事件回退读 payload.operationId（容错），两者皆缺则视为
 *    无法归属——**不驱动本操作相位**（P-08：不假设归属，未知不假设）；
 *  - **非法序列拒绝（P-08）**：三步必须按出现序严格递进；跳步（confirmed 无
 *    requested / transitioned 未集齐前两步）与终态后追加（规格钉死
 *    「locally_confirmed 在 transitioned 后又出现」，本实现推广到终态后任何本操作
 *    事件——applied 是终态，追加即序列被污染，宁可拒绝不猜测放行）→ problem 中文
 *    说明、phase 退回 'none'；trace 仍按出现序返回，供上层如实展示；
 *  - **重复回放幂等（B-13 精神）**：流程未到终态时，重复出现「已满足步骤」的事件
 *    （含更早步骤的事件回放）不改相位、不报错——回放不授予任何新权限，只有
 *    「更高步骤未满足时的越步事件」才构成非法序列；
 *  - **B-12 伪 TTY 防线（isTtyInteractive）**：confirm/apply 前由 CLI 壳层以真实
 *    stdin.isTTY 与 CI 环境变量（GITHUB_ACTIONS/CI 等，非空即视为 CI）判定，
 *    非 TTY 或 CI 环境一律拒绝——AI 会话与流水线即使拿到 shell 也不是真人 TTY。
 *    判定所需输入全部参数注入（无 process.stdout/env 访问，core 纯度约束）。
 *
 * 纯函数，无 IO、无 Date.now/Math.random（时间戳由装配方注入）（core 纯度约束）。
 */

/** 三步编排相位：仅此三值 + 'none'（未开始/被拒绝），不存在其他中间态 */
export type PromotionPhase = 'requested' | 'locally-confirmed' | 'applied';

/**
 * 一次推进请求的完整记录（request 步的领域形态，由装配方在发起 request 时构建）。
 * 本模块的状态机推导只消费 { gateId, operationId } 子集；其余字段供事件 payload
 * 序列化与审计展示使用。
 */
export interface PromotionRequest {
  gateId: string;
  from: string;
  to: string;
  expectedSequence: number;
  manifestHash: string;
  /** ISO 8601（带时区），由装配方注入，core 不取系统时间 */
  requestedAt: string;
  /** 只存不透明 id（D-22）：本地 principal/终端会话，不含身份信息 */
  localPrincipalId: string | null;
  /** 只存不透明 id（D-22）：本地 principal/终端会话，不含身份信息 */
  terminalSessionId: string | null;
}

/** 三步编排事件 kind（authorization.requested 为 managed-api 专属，后两类为 core 专属） */
export type PromotionEventKind =
  | 'authorization.requested'
  | 'authorization.locally_confirmed'
  | 'task.transitioned';

/** 全部三步编排 kind（运行时白名单，TS 类型无法拦截来自外部流的垃圾 kind） */
export const PROMOTION_EVENT_KINDS: readonly PromotionEventKind[] = [
  'authorization.requested',
  'authorization.locally_confirmed',
  'task.transitioned',
] as const;

const FLOW_KIND_SET: ReadonlySet<string> = new Set(PROMOTION_EVENT_KINDS);

/**
 * 装配方投影后的轻量事件形状：信封 kind → kind、信封 payload → payload、
 * 信封 operation_id（或 payload.operationId）→ operationId（映射由装配方完成）。
 */
export interface PromotionFlowEvent {
  kind: string;
  payload: Record<string, unknown>;
  /** 操作关联 id；缺失时 core 回退读 payload.operationId，两者皆缺视为无法归属 */
  operationId?: string;
}

/** 三步编排相位判定结果 */
export interface PromotionPhaseResult {
  /** 当前相位；'none' = 无事件或非法序列被拒绝 */
  phase: PromotionPhase | 'none';
  /** 本操作全部可归属三步事件的 kind，按出现序（含幂等重复，如实呈现不裁剪） */
  trace: PromotionEventKind[];
  /** 非法序列的中文拒绝说明；正常序列为 null */
  problem: string | null;
}

/** B-12 拒绝消息（固定文案，各端不漂移） */
export const B12_REJECT_MESSAGE =
  '非交互环境拒绝 confirm/apply：本地确认必须真人 TTY（B-12）';

/**
 * 通道分工告示（D-22 / B-4）：MCP 只能 request，confirm/apply 仅 CLI TTY 真人执行；
 * MCP 不产生 authorization.granted。供 CLI/MCP 装配方在帮助文本与工具描述中展示。
 */
export const PROMOTION_NOTICE =
  'MCP/外部通道只能发起推进请求（authorization.requested）；confirm 与 apply 仅限' +
  '本机 CLI 在真人 TTY 交互下执行，主体只记本地不透明 ID（D-22）；MCP 通道不产生' +
  ' authorization.granted（B-4）。三步必须按 requested → locally_confirmed → ' +
  'task.transitioned 顺序完成，乱序/跳步一律拒绝（P-08）。';

/** 归属判定：优先装配方映射的 operationId 字段，缺失回退 payload.operationId */
function resolveOperationId(ev: PromotionFlowEvent): string | null {
  if (typeof ev.operationId === 'string' && ev.operationId !== '') return ev.operationId;
  const fromPayload = ev.payload['operationId'];
  if (typeof fromPayload === 'string' && fromPayload !== '') return fromPayload;
  return null;
}

/** 非法序列拒绝结果：phase 退回 none，trace 原样保留供上层如实展示 */
function rejectSequence(
  operationId: string,
  trace: PromotionEventKind[],
  reason: string,
): PromotionPhaseResult {
  return {
    phase: 'none',
    trace,
    problem:
      `非法序列拒绝（P-08）：操作 ${operationId} ${reason}` +
      `（已观测序列：${trace.length > 0 ? trace.join(' → ') : '（空）'}）。` +
      '三步必须按 authorization.requested → authorization.locally_confirmed → ' +
      'task.transitioned 顺序完成；请核对事件流后从正确步骤重新发起，不猜测放行。',
  };
}

/**
 * 按出现序折叠某操作的推进事件 → 当前相位。
 *
 * 过滤口径：kind 须属三步编排白名单；operationId 可归属 request.operationId
 * （字段缺失回退 payload.operationId，皆缺则不归属、不驱动本操作）；payload 若
 * 声明非空 gate_id，须与 request.gateId 一致（声明了别的 gate 的事件不属本 gate 流）。
 * 未命中过滤的事件不进 trace、不参与相位推导。
 */
export function nextPromotionPhase(
  events: readonly PromotionFlowEvent[],
  request: { gateId: string; operationId: string },
): PromotionPhaseResult {
  const matched: PromotionEventKind[] = [];
  for (const ev of events) {
    if (!FLOW_KIND_SET.has(ev.kind)) continue; // 非三步编排事件不属本投影
    const opId = resolveOperationId(ev);
    if (opId === null || opId !== request.operationId) continue; // 无法归属/他操作：不假设归属（P-08）
    const gate = ev.payload['gate_id'];
    if (typeof gate === 'string' && gate !== '' && gate !== request.gateId) continue; // 声明了他 gate
    matched.push(ev.kind as PromotionEventKind);
  }

  // 步数状态机：0=未开始 → 1=requested → 2=locally-confirmed → 3=applied（终态）
  let step = 0;
  for (const kind of matched) {
    if (step === 0) {
      if (kind === 'authorization.requested') {
        step = 1;
        continue;
      }
      // confirmed 无 requested / transitioned 无前两步
      const reason =
        kind === 'authorization.locally_confirmed'
          ? '出现 authorization.locally_confirmed 但此前无 authorization.requested（confirmed 无 requested）'
          : '出现 task.transitioned 但此前未集齐 requested + locally_confirmed（transitioned 无前两步）';
      return rejectSequence(request.operationId, matched, reason);
    }
    if (step === 1) {
      if (kind === 'authorization.locally_confirmed') {
        step = 2;
        continue;
      }
      if (kind === 'authorization.requested') continue; // 重复回放：幂等（B-13 精神）
      return rejectSequence(
        request.operationId,
        matched,
        '出现 task.transitioned 但此前未集齐 requested + locally_confirmed（transitioned 无前两步）',
      );
    }
    if (step === 2) {
      if (kind === 'task.transitioned') {
        step = 3;
        continue;
      }
      continue; // requested / locally_confirmed 回放：幂等（回放不授予新权限）
    }
    // step === 3：applied 终态后任何本操作事件均非法
    //（覆盖规格钉死的「locally_confirmed 在 transitioned 后又出现」）
    return rejectSequence(
      request.operationId,
      matched,
      `已于三步完成后（applied 终态）又出现 ${kind}（终态不可追加本操作事件）`,
    );
  }

  const phase: PromotionPhase | 'none' =
    step === 3 ? 'applied' : step === 2 ? 'locally-confirmed' : step === 1 ? 'requested' : 'none';
  return { phase, trace: matched, problem: null };
}

/**
 * B-12 伪 TTY 防线：confirm/apply 前的交互环境判定。
 * stdin 非 TTY，或处于 CI 环境（envCi 非空即视为 CI，如 GITHUB_ACTIONS/CI=true；
 * 空串与 undefined 均视为非 CI）→ 拒绝，message 为固定文案 B12_REJECT_MESSAGE。
 * 输入全部参数注入，由 CLI 壳层以真实 process.stdin.isTTY 与环境变量装配。
 */
export function isTtyInteractive(
  stdinIsTty: boolean,
  envCi: string | undefined,
): { interactive: boolean; message: string } {
  const inCi = envCi !== undefined && envCi !== '';
  if (!stdinIsTty || inCi) {
    return { interactive: false, message: B12_REJECT_MESSAGE };
  }
  return {
    interactive: true,
    message: '本地交互环境成立（stdin 为 TTY 且非 CI），允许真人执行 confirm/apply（D-22/B-12）。',
  };
}
