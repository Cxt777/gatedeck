/**
 * gatedeck promote —— 本地交互确认三步编排收口（T-M1-05 / W-S2-5 CLI 装配；D-22 / B-4 / B-12）。
 *
 * 通道分工（与 core promotionFlow 模块头一致）：
 *  - MCP/外部通道只能产生 authorization.requested（request 步，origin=managed-api，
 *    由 mcp/tools/gates.ts requestPromotion 落盘）；
 *  - 本命令在**真人 TTY**（B-12：stdin.isTTY 且非 CI 环境变量）下执行 confirm
 *    （authorization.locally_confirmed）与 apply（promotion.completed）两步，各追加
 *    一笔 core 事件；主体只存本地不透明随机 ID（D-22，node:crypto，无身份信息）；
 *  - **绝不产生 authorization.granted**（B-4：MCP 通道永不产生，本命令亦不产生）；
 *    非交互环境（非 TTY 或 CI）一律拒绝退出码 2，默认拒绝（非 'y' 一律不写）。
 *
 * apply 步 kind 裁定：**promotion.completed**（stageFold 的 FoldEvent 折叠契约，
 * src/core/stageFold.ts:12/158——payload { from, to, expected_sequence, manifest_hash? }，
 * 只有该 kind 驱动阶段派生 D-24）。core promotionFlow 状态机联合里的 'task.transitioned'
 * 是编排相位机内部命名，foldStage 不消费它，本命令不落盘该 kind；相位判定仍按规格
 * 调 nextPromotionPhase（只消费 phase==='requested' 判待审）。
 *
 * 写入纪律（P-06/B-1 + R-02）：
 *  - 读时记内容 hash 基线 → 两笔事件 appendEventBlock（前缀字节不动）→ 写前重读
 *    compareAndSet 比对基线（不一致拒绝提示重跑）→ 落盘；
 *  - 事件追加后经 managed 层 rebuildReceiptsForFile 同步重建收据链并写回
 *    （pm/receipts.jsonl + pm/receipts.anchor.json；仅 origin=core 事件入链）；
 *  - expected_sequence 取 promotion 事件在收据链中的**实际序位**（core 事件数 + 2，
 *    确认事件 +1、推进事件 +2）——复制申请声明值会与链序对不上而被折叠拒绝
 *    （stageFold 重放防护）；申请声明的 expected_sequence 仅展示。
 *
 * 合法性预演（写入前 foldStage 干跑）：把现有 core 信封按文档序视为 verified
 * （本次写入即建链登记，与收据链重建后的实际折叠一致）追加两笔新事件折叠——
 * 预演拒绝时在确认前明示原因（用户可拒绝），确认写入后如实报告投影结果，
 * 不虚报「阶段已迁移」（W-06）；折叠拒绝的事件保留在流中、投影记拒绝原因。
 *
 * 前置预检（B-10/B-11）：既有收据链存在链级问题（内容篡改/锚点不符/断链）或与
 * changelog 的 core 事件不一一对应时，拒绝推进与重建——不静默重算改写链语义。
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { generateUlid } from './adopt.js';
import {
  ENVELOPE_SCHEMA_VERSION,
  parseEventBlocks,
  type EventActor,
  type EventEnvelope,
  type EventSubject,
} from '../../core/eventEnvelope.js';
import { appendEventBlock } from '../../core/eventLog.js';
import { verifyEventChain, type EventReceipt, type ReceiptAnchor } from '../../core/eventReceipt.js';
import { compareAndSet, contentVersion } from '../../core/optimisticWrite.js';
import {
  isTtyInteractive,
  nextPromotionPhase,
  type PromotionFlowEvent,
} from '../../core/promotionFlow.js';
import { foldStage, type FoldEvent } from '../../core/stageFold.js';
import { formatVersion } from '../../core/derivedVersion.js';
import { rebuildReceiptsForFile } from '../../managed/receipts.js';
import type { CliIo } from '../index.js';

/** promote 用法（参数错误输出与 --help 同口径） */
export const PROMOTE_USAGE = 'gatedeck promote [--operation-id <id>]';

/* ---------------------------------------------------------------- *
 * 依赖注入（测试零侵入；core 纯度约束的壳层对应：时钟/随机/stdin 全注入）
 * ---------------------------------------------------------------- */

/** 运行依赖：TTY/CI 判定输入、时钟、ULID 与不透明 ID、确认行读取（同步） */
export interface PromoteDeps {
  /** B-12 判定输入：真实为 process.stdin.isTTY === true */
  stdinIsTty: boolean;
  /** B-12 判定输入：真实为 process.env.CI（非空即视为 CI） */
  envCi: string | undefined;
  /** ISO 8601 带时区时钟（事件 occurred_at/recorded_at、锚点 generated_at） */
  nowIso: () => string;
  /** 事件 event_id（26 位 Crockford ULID） */
  newEventUlid: () => string;
  /** 本地不透明 ID（D-22：principal/session，仅随机不透明，无身份信息） */
  newOpaqueId: () => string;
  /** 读一行确认输入（同步；EOF/异常按空串处理 → 默认拒绝） */
  readConfirmLine: () => string;
}

/** TTY 同步读一行（逐字节读到 \n；仅 B-12 判定为交互后才调用） */
function readLineSync(): string {
  const chunks: Buffer[] = [];
  const buf = Buffer.alloc(1);
  for (;;) {
    let n = 0;
    try {
      n = readSync(0, buf, 0, 1, null);
    } catch {
      break; // 读失败按空输入处理 → 默认拒绝（宁可拒绝不猜测，P-08）
    }
    if (n === 0) break;
    if (buf[0] === 13) continue; // \r：CRLF 行尾剔除
    if (buf[0] === 10) break; // \n：行结束
    chunks.push(Buffer.from(buf));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** 真实依赖（本文件是 promote 唯一取时钟/随机/stdin 的位置） */
function realPromoteDeps(): PromoteDeps {
  return {
    stdinIsTty: process.stdin.isTTY === true,
    envCi: process.env.CI,
    nowIso: () => new Date().toISOString(),
    newEventUlid: () => generateUlid(Date.now()),
    newOpaqueId: () => randomBytes(16).toString('hex'),
    readConfirmLine: readLineSync,
  };
}

/* ---------------------------------------------------------------- *
 * 可测纯逻辑：参数解析 / 申请挑选 / 确认判定 / 事件参数构造
 * ---------------------------------------------------------------- */

export type ParsePromoteArgsResult =
  | { ok: true; /** 指定的 operationId；缺省 null（取最新 pending） */ operationId: string | null }
  | { ok: false; message: string };

/** 极简参数解析：`--operation-id <id>` 与 `--operation-id=<id>`；未知开关/缺值/重复/空值报错 */
export function parsePromoteArgs(argv: readonly string[]): ParsePromoteArgsResult {
  let operationId: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    let flag = arg;
    let value: string | undefined;
    const eq = arg.indexOf('=');
    if (arg.startsWith('--') && eq > 2) {
      flag = arg.slice(0, eq);
      value = arg.slice(eq + 1);
    }
    if (flag !== '--operation-id') {
      return { ok: false, message: `未知参数：${arg}（仅支持 --operation-id；用法：${PROMOTE_USAGE}）` };
    }
    if (value === undefined) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        return { ok: false, message: `参数 ${flag} 缺少值（用法：${PROMOTE_USAGE}）` };
      }
      value = next;
      i++;
    }
    const v = value.trim();
    if (v === '') return { ok: false, message: `参数 ${flag} 不能为空（用法：${PROMOTE_USAGE}）` };
    if (operationId !== null) return { ok: false, message: `参数 ${flag} 重复给出（用法：${PROMOTE_USAGE}）` };
    operationId = v;
  }
  return { ok: true, operationId };
}

/** 待审推进申请的展示/装配视图（全部来自申请事件信封，不猜测缺失字段） */
export interface PromotionRequestView {
  operationId: string;
  /** payload.gate_id；申请未声明为 null（如实展示，不猜） */
  gateId: string | null;
  from: string;
  to: string;
  /** payload.expected_sequence（申请声明值；仅展示——落盘事件按实际链序重算） */
  expectedSequence: number | null;
  /** payload.manifest_hash（申请声明值，D-25 指纹引用） */
  manifestHash: string | null;
  /** 申请时刻 = 申请事件 recorded_at（展示口径，与 as_of 同源） */
  requestedAt: string;
  /** 申请事件 event_id（留痕定位） */
  requestEventId: string;
  /** 申请事件 subject.object_id（gate_id 缺失时的如实展示参照） */
  requestSubject: string;
  /** 申请事件在文档中的序（「最新」口径：按装配序，同 B-16 不按时间戳排序） */
  requestIndex: number;
}

export type SelectPendingResult =
  | { ok: true; request: PromotionRequestView }
  | {
      ok: false;
      reason: 'none' | 'not-found' | 'not-pending' | 'invalid-request';
      message: string;
    };

/** payload 非空字符串字段（缺失/空串 → null，P-08 不猜） */
function payloadString(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** 三步事件归属 id：信封 operation_id 优先，回退 payload.operationId（promotionFlow 同口径） */
function operationIdOf(env: EventEnvelope): string | null {
  if (typeof env.operation_id === 'string' && env.operation_id !== '') return env.operation_id;
  return payloadString(env.payload, 'operationId');
}

/**
 * 申请挑选（可测纯逻辑）：在 changelog 信封流中找 pending 的 authorization.requested。
 *
 * 口径：
 *  - 相位判定按规格调 core nextPromotionPhase，phase==='requested' 即待审（非法序列
 *    problem !== null 的相位为 'none'，同样不待审）；
 *  - 同一 operationId 多笔 requested（重复回放）取文档序最后一笔为代表（最新声明）；
 *  - 「最新 pending」按文档序取最后一笔（B-16 同精神：按装配序，不按时间戳排序）；
 *  - 无法归属（信封与 payload 均无 operationId）的 requested 事件不参与（P-08 不假设归属）；
 *  - payload 缺 from/to 的申请不可执行（无法构造推进事件，如实报 invalid-request）。
 */
export function selectPendingPromotion(
  envelopes: readonly EventEnvelope[],
  wantedOperationId: string | null,
): SelectPendingResult {
  const flowEvents: PromotionFlowEvent[] = envelopes.map((e) => {
    const opId = operationIdOf(e);
    return { kind: e.kind, payload: e.payload, ...(opId !== null ? { operationId: opId } : {}) };
  });

  // 候选代表：kind=authorization.requested 且可归属；同 operationId 后笔覆盖（最新）
  const representatives = new Map<string, { env: EventEnvelope; index: number }>();
  for (const [index, env] of envelopes.entries()) {
    if (env.kind !== 'authorization.requested') continue;
    const opId = operationIdOf(env);
    if (opId === null) continue; // 无法归属：不假设（P-08）
    representatives.set(opId, { env, index });
  }
  const ordered = [...representatives.entries()].sort((a, b) => a[1].index - b[1].index);

  const assess = (opId: string, env: EventEnvelope): { view: PromotionRequestView | null; problem: string | null } => {
    const from = payloadString(env.payload, 'from');
    const to = payloadString(env.payload, 'to');
    if (from === null || to === null) {
      return { view: null, problem: '申请 payload 缺 from/to，无法构造推进事件（P-08 不猜）' };
    }
    const gateId = payloadString(env.payload, 'gate_id');
    const expectedRaw = env.payload['expected_sequence'];
    const expectedSequence = typeof expectedRaw === 'number' && Number.isInteger(expectedRaw) ? expectedRaw : null;
    const phase = nextPromotionPhase(flowEvents, { gateId: gateId ?? '', operationId: opId });
    if (phase.problem !== null) return { view: null, problem: phase.problem };
    return {
      view: {
        operationId: opId,
        ...(gateId !== null ? { gateId } : { gateId: null }),
        from,
        to,
        expectedSequence,
        manifestHash: payloadString(env.payload, 'manifest_hash'),
        requestedAt: env.recorded_at,
        requestEventId: env.event_id,
        requestSubject: env.subject.object_id,
        requestIndex: representatives.get(opId)?.index ?? -1,
      },
      problem: null,
    };
  };

  if (wantedOperationId !== null) {
    const hit = representatives.get(wantedOperationId);
    if (hit === undefined) {
      return {
        ok: false,
        reason: 'not-found',
        message: `未找到 operationId=${wantedOperationId} 的推进申请（authorization.requested）——请核对 operation_id。`,
      };
    }
    const a = assess(wantedOperationId, hit.env);
    if (a.view === null) {
      return { ok: false, reason: 'invalid-request', message: `operationId=${wantedOperationId} 的申请不可执行：${a.problem}` };
    }
    if (phaseOf(flowEvents, a.view) !== 'requested') {
      return {
        ok: false,
        reason: 'not-pending',
        message:
          `operationId=${wantedOperationId} 不是待审状态（非 requested 相位：已确认/已执行，或存在非法序列）` +
          `${a.problem !== null ? `：${a.problem}` : '。'}请用 gatedeck deck 查看事件链现状。`,
      };
    }
    return { ok: true, request: a.view };
  }

  // 缺省：文档序最后一笔 pending（最新）
  let latest: PromotionRequestView | null = null;
  let firstProblem: string | null = null;
  for (const [opId, rep] of ordered) {
    const a = assess(opId, rep.env);
    if (a.view === null) {
      if (firstProblem === null) firstProblem = a.problem;
      continue;
    }
    if (phaseOf(flowEvents, a.view) === 'requested') latest = a.view; // 文档序最后胜出
  }
  if (latest !== null) return { ok: true, request: latest };
  return {
    ok: false,
    reason: 'none',
    message:
      '当前没有待审的推进申请（authorization.requested）——可经 gatedeck-mcp 的 request_promotion 发起。' +
      (firstProblem !== null ? `（另有申请因异常不可待审：${firstProblem}）` : ''),
  };
}

/** 相位判定便捷封装（assess 已保证 problem===null 时才调用） */
function phaseOf(flowEvents: readonly PromotionFlowEvent[], view: PromotionRequestView): string {
  return nextPromotionPhase(flowEvents, {
    gateId: view.gateId ?? '',
    operationId: view.operationId,
  }).phase;
}

/** 确认判定：仅「完整 y」（trim 后精确等于）接受；空/其他/大写 Y 一律默认拒绝 */
export function evaluateConfirmation(raw: string): boolean {
  return raw.trim() === 'y';
}

/** 构造 core 通道信封（confirm/apply 共用；origin=core、integrity=verified——收据链装配方标注） */
function buildCoreEnvelope(input: {
  kind: 'authorization.locally_confirmed' | 'promotion.completed';
  nowIso: string;
  eventId: string;
  operationId: string;
  actorId: string;
  sessionId: string;
  subject: EventSubject;
  payload: Record<string, unknown>;
}): EventEnvelope {
  const actor: EventActor = { actor_id: input.actorId, session_id: input.sessionId, tool: 'gatedeck-cli' };
  return {
    event_id: input.eventId,
    schema_version: ENVELOPE_SCHEMA_VERSION,
    kind: input.kind,
    occurred_at: input.nowIso,
    recorded_at: input.nowIso,
    actor,
    origin: 'core',
    integrity: 'verified',
    subject: input.subject,
    operation_id: input.operationId,
    payload: input.payload,
  };
}

/**
 * confirm 步事件（authorization.locally_confirmed）：payload 按规格只含
 * operationId + local_principal_id + terminal_session_id（均为本地不透明随机，D-22）；
 * 同一 principal/session 复用为 actor_id/session_id（同一真人同一终端会话）。
 */
export function buildLocallyConfirmedEnvelope(input: {
  nowIso: string;
  eventId: string;
  operationId: string;
  localPrincipalId: string;
  terminalSessionId: string;
}): EventEnvelope {
  return buildCoreEnvelope({
    kind: 'authorization.locally_confirmed',
    nowIso: input.nowIso,
    eventId: input.eventId,
    operationId: input.operationId,
    actorId: input.localPrincipalId,
    sessionId: input.terminalSessionId,
    subject: { object_id: `promotion:${input.operationId}` },
    payload: {
      operationId: input.operationId,
      local_principal_id: input.localPrincipalId,
      terminal_session_id: input.terminalSessionId,
    },
  });
}

/**
 * apply 步事件（promotion.completed，stageFold 折叠契约）：payload
 * { from, to, expected_sequence, manifest_hash? }；expected_sequence 必须等于本事件
 * 在收据链中的实际序位（由 planPromotionEvents 按 core 事件数 + 2 计算后传入）。
 */
export function buildPromotionEnvelope(input: {
  nowIso: string;
  eventId: string;
  operationId: string;
  from: string;
  to: string;
  expectedSequence: number;
  manifestHash: string | null;
  localPrincipalId: string;
  terminalSessionId: string;
}): EventEnvelope {
  return buildCoreEnvelope({
    kind: 'promotion.completed',
    nowIso: input.nowIso,
    eventId: input.eventId,
    operationId: input.operationId,
    actorId: input.localPrincipalId,
    sessionId: input.terminalSessionId,
    subject: {
      object_id: `stage:${input.to}`,
      ...(input.manifestHash !== null ? { manifest_hash: input.manifestHash } : {}),
    },
    payload: {
      from: input.from,
      to: input.to,
      expected_sequence: input.expectedSequence,
      ...(input.manifestHash !== null ? { manifest_hash: input.manifestHash } : {}),
    },
  });
}

/* ---------------------------------------------------------------- *
 * 事件参数构造 + 折叠预演（可测纯逻辑）
 * ---------------------------------------------------------------- */

export interface PromotionApplyPlan {
  /** 1/2：authorization.locally_confirmed */
  confirmedEnvelope: EventEnvelope;
  /** 2/2：promotion.completed（阶段迁移事件，D-24） */
  promotionEnvelope: EventEnvelope;
  /** promotion 事件在收据链中的实际序位 = 现有 core 事件数 + 2（重放防护锚点） */
  expectedSequence: number;
}

export interface PlanPromotionResult {
  plan: PromotionApplyPlan;
  /** 写入前 foldStage 干跑裁定：accepted=false 时确认前明示原因，写入后如实报告不虚报迁移 */
  fold: { accepted: boolean; message: string };
}

/**
 * 事件参数构造 + 折叠预演（可测纯逻辑，无 IO）：
 *  - expected_sequence = 现有 origin=core 信封数 + 2（确认事件占 +1、推进事件占 +2）；
 *  - 预演口径：core 信封按文档序视为 verified（seq=1..n，与本次收据链重建后的实际
 *    折叠输入一致——fresh 项目由此获得初始阶段派生），追加两笔新事件后 foldStage；
 *  - 预演接受 = 本推进事件无 promotion-rejected 诊断且迁移表末项即本事件（to 一致）。
 */
export function planPromotionEvents(input: {
  envelopes: readonly EventEnvelope[];
  request: PromotionRequestView;
  nowIso: string;
  confirmedEventId: string;
  promotionEventId: string;
  localPrincipalId: string;
  terminalSessionId: string;
}): PlanPromotionResult {
  const coreEnvelopes = input.envelopes.filter((e) => e.origin === 'core');
  const expectedSequence = coreEnvelopes.length + 2;
  const confirmedEnvelope = buildLocallyConfirmedEnvelope({
    nowIso: input.nowIso,
    eventId: input.confirmedEventId,
    operationId: input.request.operationId,
    localPrincipalId: input.localPrincipalId,
    terminalSessionId: input.terminalSessionId,
  });
  const promotionEnvelope = buildPromotionEnvelope({
    nowIso: input.nowIso,
    eventId: input.promotionEventId,
    operationId: input.request.operationId,
    from: input.request.from,
    to: input.request.to,
    expectedSequence,
    manifestHash: input.request.manifestHash,
    localPrincipalId: input.localPrincipalId,
    terminalSessionId: input.terminalSessionId,
  });

  const foldEvents: FoldEvent[] = [
    ...coreEnvelopes.map((envelope, i): FoldEvent => ({ envelope, effectiveIntegrity: 'verified', seq: i + 1 })),
    { envelope: confirmedEnvelope, effectiveIntegrity: 'verified', seq: coreEnvelopes.length + 1 },
    { envelope: promotionEnvelope, effectiveIntegrity: 'verified', seq: expectedSequence },
  ];
  const proj = foldStage(foldEvents);
  const myRejected = proj.diagnostics.find(
    (d) => d.code === 'promotion-rejected' && d.event_id === promotionEnvelope.event_id,
  );
  const lastTransition = proj.transitions[proj.transitions.length - 1];
  const accepted =
    myRejected === undefined &&
    lastTransition !== undefined &&
    lastTransition.event_id === promotionEnvelope.event_id &&
    lastTransition.to === input.request.to;
  const fold = accepted
    ? {
        accepted: true,
        message: `折叠预演通过：${input.request.from} → ${input.request.to}（expected_sequence=${expectedSequence}），当前阶段将派生为 ${input.request.to}。`,
      }
    : {
        accepted: false,
        message:
          myRejected !== undefined
            ? `折叠预演：本次推进将被投影拒绝——${myRejected.message}`
            : `折叠预演：推进未生效（${proj.diagnostics.map((d) => d.message).join('；') || '无迁移产生'}）`,
      };
  return { plan: { confirmedEnvelope, promotionEnvelope, expectedSequence }, fold };
}

/* ---------------------------------------------------------------- *
 * 壳层编排（IO 装配）
 * ---------------------------------------------------------------- */

/** 收据库 + 锚点读取（deck.ts 同一路径契约；坏行/坏锚点如实记错不静默） */
function readReceiptsState(pmDir: string): { receipts: EventReceipt[]; anchor: ReceiptAnchor | null; errors: string[] } {
  const receipts: EventReceipt[] = [];
  const errors: string[] = [];
  const receiptsPath = join(pmDir, 'receipts.jsonl');
  if (existsSync(receiptsPath)) {
    for (const [idx, line] of readFileSync(receiptsPath, 'utf8').split(/\r?\n/).entries()) {
      if (line.trim() === '') continue;
      try {
        receipts.push(JSON.parse(line) as EventReceipt);
      } catch {
        errors.push(`收据库第 ${idx + 1} 行不是合法 JSON，已跳过（pm/receipts.jsonl）`);
      }
    }
  }
  let anchor: ReceiptAnchor | null = null;
  const anchorPath = join(pmDir, 'receipts.anchor.json');
  if (existsSync(anchorPath)) {
    try {
      anchor = JSON.parse(readFileSync(anchorPath, 'utf8')) as ReceiptAnchor;
    } catch {
      errors.push('锚点文件解析失败（pm/receipts.anchor.json）：按无锚点处理（来源未知，不静默重算）');
      anchor = null;
    }
  }
  return { receipts, anchor, errors };
}

/** 两笔事件的人类说明（块外自由文本，不驱动状态——基准 3.5/R-09） */
function confirmNote(operationId: string): string {
  return `主理人于本机真人终端确认（B-12 TTY）：推进申请 operation_id=${operationId} 的 confirm 步（D-22：主体只记本地不透明 ID）。`;
}
function applyNote(operationId: string, from: string, to: string): string {
  return `主理人确认后执行推进 ${from} → ${to}（operation_id=${operationId}，apply 步）；阶段迁移由事件折叠派生（D-24）。`;
}

/**
 * promote 命令入口：参数 → 前置预检 → pending 挑选 → B-12 → 展示确认 →
 * 两笔事件追加（CAS）→ 收据链重建 → 新投影输出。
 * 返回进程退出码：0 成功 / 1 业务拒绝（无待审、用户拒绝、申请不可执行）/
 * 2 环境与状态错误（未初始化、参数错、链需处理、非交互、CAS 竞争）。
 */
export function runPromote(
  argv: readonly string[],
  io: CliIo,
  cwd: string = process.cwd(),
  deps: PromoteDeps = realPromoteDeps(),
): number {
  // ① 参数
  const parsedArgs = parsePromoteArgs(argv);
  if (!parsedArgs.ok) {
    io.err(parsedArgs.message);
    return 2;
  }

  // ② pm/ 存在（无 pm/ → 初始化引导，未初始化不是成功态，W-06）
  const pmDir = join(cwd, 'pm');
  if (!existsSync(pmDir) || !statSync(pmDir).isDirectory()) {
    io.out('尚未初始化：先运行 gatedeck init（在当前目录生成 pm/ 契约文件骨架）。');
    io.out('推进（promote）执行三步编排的 confirm/apply 两步：须先有 changelog 事件流与待审推进申请。');
    return 2;
  }
  const changelogPath = join(pmDir, 'changelog.md');
  if (!existsSync(changelogPath)) {
    io.err('pm/changelog.md 缺失：无事件流可读，无待审推进申请。');
    return 1;
  }

  // ③ 读事件流 + 记内容基线（写前比对，P-06/B-1）
  let current: string;
  try {
    current = readFileSync(changelogPath, 'utf8');
  } catch (e) {
    io.err(`读取 pm/changelog.md 失败：${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const baselineHash = contentVersion(current).contentHash;
  const parsedBlocks = parseEventBlocks(current);
  const envelopes = parsedBlocks.envelopes;
  if (parsedBlocks.diagnostics.length > 0) {
    const first = parsedBlocks.diagnostics[0]!;
    io.err(
      `注意：changelog 有 ${parsedBlocks.diagnostics.length} 条信封诊断（首条 [${first.code}] ${first.message}）——` +
        '致命缺陷块按 external-unverified 处理（不驱动状态），推进照常基于合法信封装配。',
    );
  }

  // ④ 收据链现状预检（B-10/B-11：链破/篡改/锚点不符 → 不推进不重建，不静默重算）
  const receiptsState = readReceiptsState(pmDir);
  for (const e of receiptsState.errors) io.err(`注意：${e}`);
  const verification = verifyEventChain(envelopes, receiptsState.receipts, receiptsState.anchor);
  if (verification.issues.length > 0) {
    const first = verification.issues[0]!;
    io.err(
      `事件链需处理（B-11）：${verification.issues.length} 条链级问题，拒绝推进与收据重建（不静默重算）。` +
        `首条：[${first.code}] ${first.message}`,
    );
    return 2;
  }
  const coreEnvelopes = envelopes.filter((e) => e.origin === 'core');
  if (receiptsState.receipts.length > 0) {
    const unverifiedCore = verification.perEvent.filter(
      (v, i) => envelopes[i]!.origin === 'core' && v.verdict !== 'verified',
    ).length;
    if (unverifiedCore > 0 || receiptsState.receipts.length !== coreEnvelopes.length) {
      io.err(
        `收据链与 changelog 的 core 事件不一一对应（收据 ${receiptsState.receipts.length} 条 vs 文档 core 事件 ${coreEnvelopes.length} 笔，其中 ${unverifiedCore} 笔未验真）——` +
          '此时重建将改写既有链语义（含把未登记的手工 core 事件转正，R-09），拒绝推进。请由主理人先理顺事件流与收据库。',
      );
      return 2;
    }
  }

  // ⑤ pending 挑选（--operation-id 指定 / 缺省最新；无 pending → exit 1）
  const selection = selectPendingPromotion(envelopes, parsedArgs.operationId);
  if (!selection.ok) {
    io.err(selection.message);
    return 1;
  }
  const request = selection.request;

  // ⑥ B-12 伪 TTY 防线（判定输入由 deps 注入；非交互一律拒绝 exit 2）
  const tty = isTtyInteractive(deps.stdinIsTty, deps.envCi);
  if (!tty.interactive) {
    io.err(tty.message);
    io.err('请在本机真人终端（stdin 为 TTY 且非 CI 环境）执行 gatedeck promote。');
    return 2;
  }

  // ⑦ 事件参数构造 + 折叠预演（时钟/随机由 deps 注入；一个真人一次会话共用一对不透明 ID）
  const nowIso = deps.nowIso();
  const localPrincipalId = deps.newOpaqueId();
  const terminalSessionId = deps.newOpaqueId();
  const { plan, fold } = planPromotionEvents({
    envelopes,
    request,
    nowIso,
    confirmedEventId: deps.newEventUlid(),
    promotionEventId: deps.newEventUlid(),
    localPrincipalId,
    terminalSessionId,
  });

  // ⑧ 申请内容逐行展示 + 确认（默认拒绝）
  io.out('待审推进申请（authorization.requested）——三步编排 confirm/apply（D-22）：');
  io.out(`  申请时间（recorded_at）：${request.requestedAt}`);
  io.out(`  门禁：${request.gateId ?? `（申请未声明 gate_id；申请 subject.object_id=${request.requestSubject}）`}`);
  io.out(`  阶段迁移：${request.from} → ${request.to}`);
  io.out(`  expected_sequence（申请声明）：${request.expectedSequence ?? '（未提供）'}`);
  io.out(`  manifest_hash（申请声明）：${request.manifestHash ?? '（未提供）'}`);
  io.out(`  来源 operationId：${request.operationId}`);
  io.out(`  申请事件 event_id：${request.requestEventId}`);
  io.out(
    `  本次将追加：authorization.locally_confirmed（event_id=${plan.confirmedEnvelope.event_id}）、` +
      `promotion.completed（event_id=${plan.promotionEnvelope.event_id}，expected_sequence=${plan.expectedSequence}）`,
  );
  if (!fold.accepted) {
    io.out(`  ⚠ ${fold.message}`);
    io.out('    （预演拒绝时写入后事件保留、阶段不迁移；如非预期请拒绝并先理顺 gates.md 阶段序/事件链。）');
  }
  io.out('');
  io.out('确认推进？输入完整 y 并回车（默认拒绝）：');
  let answer = '';
  try {
    answer = deps.readConfirmLine();
  } catch {
    answer = ''; // 读入异常按空输入 → 默认拒绝（P-08 宁拒不猜）
  }
  if (!evaluateConfirmation(answer)) {
    io.out(`已拒绝（不产生任何事件）——收到输入「${answer.trim()}」。`);
    return 1;
  }

  // ⑨ 两笔事件 appendEventBlock（前缀字节不动）→ 写前重读 CAS 比对基线 → 落盘
  let text = current;
  const appended: EventEnvelope[] = [plan.confirmedEnvelope, plan.promotionEnvelope];
  const notes: string[] = [confirmNote(request.operationId), applyNote(request.operationId, request.from, request.to)];
  for (const [i, env] of appended.entries()) {
    const result = appendEventBlock(text, env, notes[i]);
    if (!result.ok) {
      io.err(`事件追加被拒绝（${result.error}）：${result.message}——本次不写入任何内容。`);
      return 2;
    }
    text = result.text;
  }
  let beforeWrite: string;
  try {
    beforeWrite = readFileSync(changelogPath, 'utf8'); // 写前重读：缩短基线比对窗口
  } catch (e) {
    io.err(`写前重读 pm/changelog.md 失败（${e instanceof Error ? e.message : String(e)}）——本次不写入，请重跑。`);
    return 2;
  }
  const commit = compareAndSet(beforeWrite, { expectedHash: baselineHash, nextContent: text });
  if (!commit.ok) {
    io.err(`写入拒绝（${commit.code}）：${commit.message}——请重跑本命令。`);
    return 2;
  }
  try {
    writeFileSync(changelogPath, commit.nextContent, 'utf8');
  } catch (e) {
    io.err(`写盘失败（pm/changelog.md）：${e instanceof Error ? e.message : String(e)}——请检查文件权限后重跑。`);
    return 2;
  }

  // ⑩ 收据链同步重建写回（managed 层：core 过滤 + receipts.jsonl/anchor 落盘）
  const receipts = rebuildReceiptsForFile(pmDir, 'changelog.md', nowIso);
  if (receipts.ok) {
    io.out(`  收据链已重建：${receipts.count} 条（pm/receipts.jsonl + pm/receipts.anchor.json）`);
    for (const n of receipts.notes ?? []) io.out(`  · ${n}`);
  } else {
    io.err(
      `  收据链重建失败（${receipts.message}）——两笔事件已追加但未登记：按 unregistered 态处理` +
        '（有效 integrity=unknown，不驱动状态，P-09）；排除故障后可由受管写入路径重建，deck 将如实展示。',
    );
  }

  // ⑪ 新投影输出（as_of/源版本）+ 迁移终报（如实，不虚报）
  const finalParsed = parseEventBlocks(commit.nextContent);
  const finalState = readReceiptsState(pmDir); // 重建成功 = 新链；失败 = 旧链（事件 unverified）
  const finalVerification = verifyEventChain(finalParsed.envelopes, finalState.receipts, finalState.anchor);
  const finalFoldEvents: FoldEvent[] = finalParsed.envelopes.map((envelope, i) => {
    const verdict = finalVerification.perEvent[i]!;
    return {
      envelope,
      effectiveIntegrity: verdict.verdict,
      ...(verdict.seq !== undefined ? { seq: verdict.seq } : {}),
    };
  });
  const proj = foldStage(finalFoldEvents, { chainIssues: finalVerification.issues });
  io.out('推进完成：');
  io.out(`  authorization.locally_confirmed：${plan.confirmedEnvelope.event_id}`);
  io.out(`  promotion.completed：${plan.promotionEnvelope.event_id}`);
  io.out(`  ${formatVersion({ asOf: proj.asOf, sourceVersion: proj.sourceVersion })}`);
  if (!receipts.ok) {
    io.out('  事件暂未登记收据链（unregistered 态）：阶段投影暂不迁移（P-09）；收据链重建成功后 deck 将如实展示。');
  } else if (proj.currentStage === request.to && fold.accepted) {
    io.out('阶段迁移由事件折叠派生（D-24）——下次 gatedeck deck 生效。');
  } else {
    const rejected = proj.diagnostics
      .filter((d) => d.event_id === plan.promotionEnvelope.event_id)
      .map((d) => d.message);
    io.out(
      '  注意：按当前事件流折叠，本次推进未被投影接受' +
        `${rejected.length > 0 ? `——${rejected.join('；')}` : ''}（事件保留在流中，投影记拒绝原因；请核对 gates.md 阶段序后按流程处理）。`,
    );
  }
  return 0;
}
