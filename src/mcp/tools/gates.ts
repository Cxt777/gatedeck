/**
 * gatedeck-mcp 门禁动作 handler（W-S3-2 门禁 2；T-M1-08 名单 check_gate / request_promotion）。
 *
 * 红线落点：
 *  - **check_gate 永不执行任何命令**（R-07/D-26）：语义=检查事实查询与失效判定——读
 *    changelog 既有检查事件投影事实（core checkFacts），重算 canonical manifest 指纹
 *    （core manifestFingerprint，T-M1-03）并与凭证锚比对改判「待复验」（B-3）。本文件
 *    无子进程、无 shell、无 eval；判定输入全部来自磁盘既有字节，缺什么说什么（W-06）。
 *  - **request_promotion 只产生待审申请事件**（authorization.requested，B-4/D-22）：
 *    批准（授权终态）与执行（状态迁移）仅限本机 CLI 真人 TTY 流程，本通道绝不代产
 *    任何授权终态/状态迁移 kind——写入前信封回验（events.ts verifyEnvelopeSerializes）
 *    对 kind×origin 矩阵违规做结构拦截，CI 源码文本守卫（allowlist.test.ts）另查本文件
 *    不含授权终态 kind 字面量。
 *  - M1 manifest 口径（如实注明）：T-M1-04 门禁解析器未接入，gates.md 明细暂不展开，
 *    manifest 采集 pm/ 四契约文件（project/wbs/gates/insights；changelog 属 append-only
 *    日志，core 默认排除，B-3 口径），role 按「检查对象/规则文件」归类。
 *
 * 时钟/随机：由 server.ts 顶层注入（McpToolDeps），本文件不取系统时间、不取随机。
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { parseEventBlocks } from '../../core/eventEnvelope.js';
import { projectEventLog, type EventLogEntry } from '../../core/eventLog.js';
import type { EventReceipt, ReceiptAnchor } from '../../core/eventReceipt.js';
import {
  CHECK_EVIDENCE_NOTICE,
  assessStaleness,
  projectLatestCheckFacts,
  type CheckEventInput,
  type CheckFact,
  type CheckStatus,
} from '../../core/checkFacts.js';
import { computeManifestFingerprint, type ManifestEntry } from '../../core/manifestFingerprint.js';
import { contentVersion } from '../../core/optimisticWrite.js';
import { resolveProjectContext } from '../context.js';
import {
  appendTypedEventViaCas,
  buildManagedEnvelope,
  rebuildChangelogReceiptsNote,
} from './events.js';
import { readTextIfExists, writeError, type McpToolDeps, type WriterHandler } from './writers.js';

/** 门禁 2 名单（与 tools/registry.ts 的 TOOL_ALLOWLIST 门禁区一致） */
export const GATE_TOOL_NAMES = ['check_gate', 'request_promotion'] as const;

export type GateToolName = (typeof GATE_TOOL_NAMES)[number];

/** 状态中文映射（公开状态词表：未检查/通过/失败/错误/待复验） */
const STATUS_ZH: Readonly<Record<CheckStatus, string>> = {
  'not-checked': '未检查',
  passed: '通过',
  failed: '失败',
  error: '错误',
  stale: '待复验',
};

/* ---------------------------------------------------------------- *
 * check_gate：检查事实投影 + manifest 失效判定（只读，永不执行命令）
 * ---------------------------------------------------------------- */

/** M1 manifest 采集口径：pm/ 契约文件（changelog 默认排除故不采集；缺失文件跳过并注明） */
const MANIFEST_FILES: ReadonlyArray<{ rel: string; role: ManifestEntry['role'] }> = [
  { rel: 'project.md', role: 'checked-file' },
  { rel: 'wbs.md', role: 'checked-file' },
  { rel: 'gates.md', role: 'rule-file' },
  { rel: 'insights.md', role: 'checked-file' },
];

/** check_gate 参数 */
export interface CheckGateParams {
  /** 只看指定门禁 id 的检查事实（缺省返回全部） */
  gate_id?: string;
}

/** 非空字符串提取（payload 宽接口映射用；空白按缺失，P-08 不猜） */
function asNonEmpty(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/**
 * 事件 → checkFacts 宽接口映射：gateId/ruleId 兼容驼峰与下划线两种 payload 键名
 * （core checkFacts.parsePair 读 payload['gateId']；本通道事件用下划线命名，装配层归一）。
 */
function toCheckEventInput(envelope: {
  kind: string;
  payload: Record<string, unknown>;
  recorded_at: string;
}): CheckEventInput {
  const p = envelope.payload;
  const gateId = asNonEmpty(p['gateId']) ?? asNonEmpty(p['gate_id']);
  const ruleId = asNonEmpty(p['ruleId']) ?? asNonEmpty(p['rule_id']);
  return {
    kind: envelope.kind,
    payload: envelope.payload,
    recordedAt: envelope.recorded_at,
    ...(gateId !== null ? { gateId } : {}),
    ...(ruleId !== null ? { ruleId } : {}),
  };
}

/**
 * changelog 事件装配（P-09 口径）：经收据链与锚点裁定后，只把 **verified** 事件喂给
 * 检查事实投影；未验真事件不驱动检查状态，数量如实返回（W-06 不静默）。
 * 收据库/锚点缺失时事件全部 unverified → 如实「未检查」。
 */
function assembleVerifiedCheckEvents(changelogText: string, rootDir: string): {
  events: CheckEventInput[];
  unverifiedCount: number;
  malformedCount: number;
} {
  const receipts: EventReceipt[] = [];
  let anchor: ReceiptAnchor | null = null;
  const receiptsPath = join(rootDir, 'pm', 'receipts.jsonl');
  const receiptsText = readTextIfExists(receiptsPath);
  if (receiptsText !== null) {
    for (const line of receiptsText.split(/\r?\n/)) {
      if (line.trim() === '') continue;
      try {
        receipts.push(JSON.parse(line) as EventReceipt);
      } catch {
        // 坏行跳过：与 context.ts 收据解析同口径；计数由 projectEventLog 的链级问题如实呈现
      }
    }
  }
  const anchorText = readTextIfExists(join(rootDir, 'pm', 'receipts.anchor.json'));
  if (anchorText !== null) {
    try {
      anchor = JSON.parse(anchorText) as ReceiptAnchor;
    } catch {
      anchor = null; // 锚点坏档：全部事件 unverified，如实「未验真」
    }
  }

  const log = projectEventLog(changelogText, receipts, anchor);
  const envelopes = parseEventBlocks(changelogText).envelopes;
  const events: CheckEventInput[] = [];
  let unverifiedCount = 0;
  let envIdx = 0;
  const pickEnvelope = (entry: EventLogEntry) => {
    if (entry.eventId === null) return undefined;
    const env = envelopes[envIdx];
    envIdx++;
    return env;
  };
  for (const entry of log.entries) {
    const env = pickEnvelope(entry);
    if (env === undefined) continue;
    if (entry.status === 'verified') events.push(toCheckEventInput(env));
    else unverifiedCount++;
  }
  return { events, unverifiedCount, malformedCount: log.malformedCount };
}

/** check_gate handler：检查事实查询与失效判定（只读；绝不执行任何命令，R-07/D-26） */
export const checkGate: WriterHandler<CheckGateParams> = (rootDir, args, _deps) => {
  const pmDir = join(rootDir, 'pm');
  if (!existsSync(pmDir)) {
    return writeError('not-initialized', '当前目录尚未初始化（无 pm/ 目录）：先运行 gatedeck init，再使用本工具。');
  }

  // ① manifest 重算（canonical 指纹，T-M1-03；缺失文件跳过并注明，不编造条目）
  const entries: ManifestEntry[] = [];
  const missingFiles: string[] = [];
  for (const f of MANIFEST_FILES) {
    const text = readTextIfExists(join(pmDir, f.rel));
    if (text === null) {
      missingFiles.push(`pm/${f.rel}`);
      continue;
    }
    entries.push({ path: `pm/${f.rel}`, role: f.role, contentHash: contentVersion(text).contentHash });
  }
  const fingerprint = computeManifestFingerprint({ entries });
  if (!fingerprint.ok) {
    return writeError(fingerprint.code, fingerprint.message);
  }

  // ② 检查事实投影（只喂 verified 事件，P-09）+ 失效判定（B-3：重算指纹 ≠ 凭证锚 → 待复验）
  const changelogText = readTextIfExists(join(pmDir, 'changelog.md'));
  let facts = new Map<string, CheckFact>();
  let unverifiedCount = 0;
  let malformedCount = 0;
  let noChangelog = false;
  if (changelogText === null) {
    noChangelog = true;
  } else {
    const assembled = assembleVerifiedCheckEvents(changelogText, rootDir);
    unverifiedCount = assembled.unverifiedCount;
    malformedCount = assembled.malformedCount;
    facts = projectLatestCheckFacts(assembled.events);
  }
  const judged = assessStaleness(facts, fingerprint.manifestHash);
  const gateFilter = args.gate_id?.trim();
  const allFacts = [...judged.facts.values()];
  const filtered = gateFilter !== undefined && gateFilter !== '' ? allFacts.filter((f) => f.gateId === gateFilter) : allFacts;

  const summary: Record<CheckStatus, number> = { 'not-checked': 0, passed: 0, failed: 0, error: 0, stale: 0 };
  for (const f of filtered) summary[f.status]++;

  const notes: string[] = [
    '本工具为检查事实查询与失效判定，永不执行任何门禁/shell 命令（R-07/D-26）；证据只存退出码/时长/摘要（D-26）。',
  ];
  if (missingFiles.length > 0) {
    notes.push(`manifest 采集跳过缺失文件：${missingFiles.join('、')}（不编造条目，W-06）。`);
  }
  if (noChangelog) {
    notes.push('pm/changelog.md 缺失：无检查记录，全部检查对象如实为「未检查」。');
  }
  if (unverifiedCount > 0) {
    notes.push(`changelog 中 ${unverifiedCount} 笔事件未通过收据链验真（含检查类事件）：不参与检查事实推导（P-09），验真由本机 CLI 建立收据链后重算。`);
  }
  if (malformedCount > 0) {
    notes.push(`changelog 中 ${malformedCount} 个事件块无法解析为合法信封（按 external-unverified 处理，需处理态）。`);
  }
  notes.push('gates.md 门禁定义解析器待 T-M1-04 接入：本工具暂不展开门禁条件明细（与 cli deck / list_gates 口径一致）。');
  notes.push('manifest 口径（M1）：仅 pm/ 四契约文件（changelog 属 append-only 日志按 core 默认排除，B-3）；gates.md 计为规则文件。');

  return {
    ok: true,
    tool: 'check_gate',
    manifest: {
      hash: fingerprint.manifestHash,
      entries: fingerprint.entries.map((e) => ({ path: e.path, role: e.role, contentHash: e.contentHash })),
      excluded: fingerprint.excluded,
    },
    checks: filtered.map((f) => ({
      gateId: f.gateId,
      ruleId: f.ruleId,
      status: f.status,
      statusZh: STATUS_ZH[f.status],
      checkedAt: f.checkedAt,
      exitCode: f.exitCode,
      durationMs: f.durationMs,
      summary: f.summary,
      subjectManifestHash: f.subjectManifestHash,
    })),
    staleKeys: judged.staleKeys.filter((k) => {
      if (gateFilter === undefined || gateFilter === '') return true;
      return (k.split(String.fromCharCode(0))[0] ?? '') === gateFilter; // 键由 core checkFactKey 以 NUL 分隔（gateId, ruleId），首段即 gateId
    }),
    summary,
    gate_id: gateFilter ?? null,
    evidenceNotice: CHECK_EVIDENCE_NOTICE,
    notes,
  };
};

/* ---------------------------------------------------------------- *
 * request_promotion：发起阶段推进申请（只产生待审申请事件）
 * ---------------------------------------------------------------- */

/** request_promotion 参数 */
export interface RequestPromotionParams {
  from: string;
  to: string;
  /** 期望事件链序（推进执行时与收据链序比对，重放防护；客户端从投影版本戳取得） */
  expected_sequence: number;
  /** 当前 canonical manifest 指纹（check_gate 产出） */
  manifest_hash: string;
  gate_id?: string;
  actor_id: string;
  session_id: string;
  /** changelog.md 内容基线 hash（CAS） */
  expected_hash: string;
  /** 人类说明：置于事件块之前的块外自由文本 */
  note?: string;
}

/**
 * request_promotion handler：构造 authorization.requested（origin=managed-api，
 * integrity=unknown）→ core appendEventBlock 追加 pm/changelog.md → 内容 hash CAS。
 * 绝不代产授权终态或状态迁移 kind（B-4/D-22，结构防线见 events.ts 回验）。
 * operation_id 由注入的 ULID 生成器产出并返回：CLI confirm/apply 步按其归属三步流程。
 */
export const requestPromotion: WriterHandler<RequestPromotionParams> = (rootDir, args, deps) => {
  const changelogPath = join(rootDir, 'pm', 'changelog.md');
  const current = readTextIfExists(changelogPath);
  if (current === null) {
    return writeError('not-initialized', 'pm/changelog.md 不存在：先运行 gatedeck init 生成契约文件骨架，再使用本工具。');
  }
  const from = args.from.trim();
  const to = args.to.trim();
  const manifestHash = args.manifest_hash.trim();
  if (from === '' || to === '' || manifestHash === '') {
    return writeError('invalid-input', 'from/to/manifest_hash 必填（trim 后非空）。');
  }
  if (!Number.isInteger(args.expected_sequence) || args.expected_sequence < 0) {
    return writeError('invalid-input', 'expected_sequence 须为非负整数（事件链序，重放防护锚点）。');
  }
  if (/[\r\n]/.test(from) || /[\r\n]/.test(to) || /[\r\n]/.test(args.gate_id ?? '')) {
    return writeError('invalid-input', 'from/to/gate_id 不得含换行符（信封字段为一行式）。');
  }

  const ctx = resolveProjectContext(rootDir, deps.nowIso());
  if (!ctx.ok) {
    return writeError('not-initialized', ctx.hint);
  }
  const warnings: string[] = [];
  if (ctx.stage.currentStage !== null && from !== ctx.stage.currentStage) {
    warnings.push(
      `from=${from} 与当前投影阶段 ${ctx.stage.currentStage} 不一致：申请仍会写入（requested 为待审事实，不驱动状态），` +
        '推进合法性由 CLI 确认/执行步按三步编排校验（P-08）。',
    );
  }

  const operationId = deps.newUlid();
  const gateId = args.gate_id?.trim();
  const envelope = buildManagedEnvelope({
    kind: 'authorization.requested',
    nowIso: deps.nowIso(),
    eventId: deps.newUlid(),
    operationId,
    actorId: args.actor_id.trim(),
    sessionId: args.session_id.trim(),
    subject: { object_id: gateId !== undefined && gateId !== '' ? `gate:${gateId}` : `stage:${to}`, manifest_hash: manifestHash },
    payload: {
      ...(gateId !== undefined && gateId !== '' ? { gate_id: gateId } : {}),
      from,
      to,
      expected_sequence: args.expected_sequence,
      manifest_hash: manifestHash,
    },
  });
  const result = appendTypedEventViaCas({
    targetPath: changelogPath,
    currentText: current,
    expectedHash: args.expected_hash,
    envelope,
    ...(args.note !== undefined ? { humanNote: args.note } : {}),
  });
  if (!result.ok) {
    return writeError(result.code, result.message, result.currentHash !== undefined ? { current_hash: result.currentHash } : {});
  }
  return {
    ok: true,
    tool: 'request_promotion',
    eventId: result.eventId,
    kind: envelope.kind,
    origin: envelope.origin,
    integrity: envelope.integrity,
    operationId,
    payload: envelope.payload,
    file: 'pm/changelog.md',
    nextHash: result.nextHash,
    currentStage: ctx.stage.currentStage,
    receiptChainNote: rebuildChangelogReceiptsNote(rootDir), // 落盘成功后全量重建 changelog 收据链（失败文案如实提示，不回滚）
    ...(warnings.length > 0 ? { warnings } : {}),
    nextStep:
      '批准与执行仅限本机 CLI 真人 TTY 流程（D-22/B-4/B-12）：请携带 operation_id 在 CLI 侧继续 confirm/apply；' +
      '本通道绝不代产授权终态或状态迁移 kind（kind×origin 矩阵 + 写入前信封回验结构拦截）。',
  };
};

/** 门禁 2 handler 注册表（键由 GATE_TOOL_NAMES 类型收窄，漏实现编译期报错） */
export const GATE_HANDLERS: Readonly<
  Record<GateToolName, (rootDir: string, args: never, deps: McpToolDeps) => unknown>
> = {
  check_gate: (rootDir, args, deps) => checkGate(rootDir, args as CheckGateParams, deps),
  request_promotion: (rootDir, args, deps) => requestPromotion(rootDir, args as RequestPromotionParams, deps),
};
