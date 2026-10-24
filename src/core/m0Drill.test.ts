import { describe, expect, it } from 'vitest';

import {
  isUlid,
  parseEventBlocks,
  serializeEventBlock,
  type EventEnvelope,
} from './eventEnvelope.js';
import {
  GENESIS_PREV_HASH,
  buildAnchor,
  buildReceiptChain,
  verifyEventChain,
  type EventReceipt,
  type ReceiptAnchor,
} from './eventReceipt.js';
import { foldStage, type FoldEvent, type StageProjection } from './stageFold.js';
import { checkFreshSubmission, versionOf } from './derivedVersion.js';
import { parseFencedTaskBlocks, reconstruct } from './wbsSyntax.js';
import { getNodeField, updateTaskFieldById, validateWbsDocument } from './wbsKernel.js';
import { appendEventBlock, projectEventLog } from './eventLog.js';
import { compareAndSet, contentVersion } from './optimisticWrite.js';
import {
  assessRecovery,
  commitOperation,
  markApplied,
  markLogged,
  prepareOperation,
  type OperationJournal,
  type OperationTarget,
} from './operationRecovery.js';
import { nextBaseline, observeExternalEdit, summarizeExternalScan } from './externalEdit.js';

/**
 * W-S1-4（=T-M0b-09）· M0 门禁演练：保真 / 并发 / 中断三类合成样本回归。
 *
 * 一个虚构项目「demo-project」的数据端到端走三关：
 *   - 第一关 保真：wbs 局部修改字节级保真（P-04/R-04）、事件日志投影与 append-only（R-02）、
 *     收据链验证（B-10 内容篡改 / B-11 锚点与顺序 / S2.1-04 未登记）；
 *   - 第二关 并发：内容 hash compare-and-set（B-1）、派生版本戳 compare-and-set（T-M0b-06）、
 *     外部编辑指纹检测（B-2，P-08 结构性只记 observed_at）；
 *   - 第三关 中断：跨文件操作四相恢复（P-06/B-2），恢复完成态复跑保真断言。
 *
 * 本文件位于 src/core/，同守纯度约束：不 import node:*；时间戳一律固定字面量注入，
 * 不取系统时钟（W-06：全部断言可复核、可重放）。
 */

/* ---------------------------------------------------------------- *
 * 数据底座：demo-project 的 wbs.md 与 changelog.md 合成样本
 * ---------------------------------------------------------------- */

const ACTOR_ID = '01HXA8T0R00000000000000000';
const SESSION_ID = '01HXSESSN00000000000000000';
const ACTOR_LINE = `actor: {"actor_id":"${ACTOR_ID}","session_id":"${SESSION_ID}"}`;

/** ULID 风格字面量（26 位 Crockford Base32，逐笔递增尾号） */
const ID_INIT = '01JBM0DR000000000000000001';
const ID_TR1 = '01JBM0DR000000000000000002';
const ID_TR2 = '01JBM0DR000000000000000003';
const ID_DONE = '01JBM0DR000000000000000004';
const ID_5TH = '01JBM0DR000000000000000005';

/** wbs.md 富样本：CRLF 换行 + 中文注释行 + 未知字段 + 块外自由文本（R-04/F-06） */
const DEMO_WBS = [
  '# demo-project WBS',
  '',
  '<!-- 主理人手写注释：演示项目，机器不得吞掉本行（R-04） -->',
  '',
  '### T-001 初始化项目',
  '',
  '```gatedeck-task',
  'id: T-001',
  'title: 初始化 demo-project',
  'status: todo',
  'owner: 小王',
  'gate: G-M0',
  '备注: 手写未知字段（F-06 保留）',
  '```',
  '',
  '### T-002 演练任务',
  '',
  '```gatedeck-task',
  'id: T-002',
  'title: M0 门禁演练',
  'status: doing',
  'owner: 小张',
  'deps: T-001',
  'unknown_field_x: 保留我',
  '```',
  '',
  '### T-003 收尾任务',
  '',
  '```gatedeck-task',
  'id: T-003',
  'title: 收尾与归档',
  'status: done',
  'owner: 小李',
  '```',
  '',
  '块外自由文本：人类说明，不参与状态推导。',
].join('\r\n');

/** 事件块文本（不含块外说明；信封字段按基准 3.5 固定 schema 逐行手写） */
const demoEventBlock = (fields: readonly string[]): string =>
  ['```gatedeck-event', ...fields, '```'].join('\n');

/**
 * changelog.md 样本：3 笔规范事件块（project.initialized + task.transitioned×2，
 * occurred_at/recorded_at 为固定带时区字面量）+ 块外人类说明文字。
 */
const DEMO_CHANGELOG = [
  '# demo-project CHANGELOG',
  '',
  '<!-- 人类说明：块外自由文本不驱动状态（R-09） -->',
  '',
  '主理人批注（2026-10-24 上午）：demo-project 今日立项，并完成两笔任务迁移；以下 fenced 块为机器权威事件流。',
  '',
  demoEventBlock([
    `event_id: ${ID_INIT}`,
    'schema_version: 1',
    'kind: project.initialized',
    'occurred_at: 2026-10-24T09:30:00+08:00',
    'recorded_at: 2026-10-24T09:30:05+08:00',
    ACTOR_LINE,
    'origin: core',
    'integrity: verified',
    'subject: {"object_id":"proj:demo-project"}',
    'payload: {"project_id":"demo-project","stage_order":["M0","M1","M2"]}',
  ]),
  '',
  demoEventBlock([
    `event_id: ${ID_TR1}`,
    'schema_version: 1',
    'kind: task.transitioned',
    'occurred_at: 2026-10-24T09:40:00+08:00',
    'recorded_at: 2026-10-24T09:40:05+08:00',
    ACTOR_LINE,
    'origin: core',
    'integrity: verified',
    'subject: {"object_id":"task:T-001"}',
    'payload: {"task_id":"T-001","from":"todo","to":"doing"}',
  ]),
  '',
  demoEventBlock([
    `event_id: ${ID_TR2}`,
    'schema_version: 1',
    'kind: task.transitioned',
    'occurred_at: 2026-10-24T09:50:00+08:00',
    'recorded_at: 2026-10-24T09:50:05+08:00',
    ACTOR_LINE,
    'origin: core',
    'integrity: verified',
    'subject: {"object_id":"task:T-002"}',
    'payload: {"task_id":"T-002","from":"todo","to":"doing"}',
  ]),
  '',
].join('\n');

/** 第 4 笔事件：T-002 doing→done（与 wbs 局部修改同内容的跨文件配套事件） */
const EVT_DONE: EventEnvelope = {
  event_id: ID_DONE,
  schema_version: '1',
  kind: 'task.transitioned',
  occurred_at: '2026-10-24T10:00:00+08:00',
  recorded_at: '2026-10-24T10:00:05+08:00',
  actor: { actor_id: ACTOR_ID, session_id: SESSION_ID },
  origin: 'core',
  integrity: 'verified',
  subject: { object_id: 'task:T-002' },
  payload: { task_id: 'T-002', from: 'doing', to: 'done' },
};

/** 第 5 笔事件：仅存在于信封层、从未登记收据（S2.1-04 未登记口径用） */
const EVT_5TH: EventEnvelope = {
  event_id: ID_5TH,
  schema_version: '1',
  kind: 'task.transitioned',
  occurred_at: '2026-10-24T10:10:00+08:00',
  recorded_at: '2026-10-24T10:10:05+08:00',
  actor: { actor_id: ACTOR_ID, session_id: SESSION_ID },
  origin: 'core',
  integrity: 'verified',
  subject: { object_id: 'task:T-003' },
  payload: { task_id: 'T-003', from: 'done', to: 'blocked' },
};

/* —— 底座派生量（纯计算，无 IO） —— */

const PARSED_CHANGELOG = parseEventBlocks(DEMO_CHANGELOG);
const BASE_ENVELOPES = PARSED_CHANGELOG.envelopes; // 3 笔
const BASE_RECEIPTS: EventReceipt[] = buildReceiptChain(BASE_ENVELOPES);
const BASE_ANCHOR: ReceiptAnchor = buildAnchor(BASE_RECEIPTS, '2026-10-24T09:55:00+08:00');

const WBS_PATH = 'pm/demo-project/wbs.md';
const CHANGELOG_PATH = 'pm/demo-project/changelog.md';

/** 计划写入内容：wbs 的 T-002 status → done（仅目标行变化） */
const WBS_NEXT = updateTaskFieldById(DEMO_WBS, parseFencedTaskBlocks(DEMO_WBS), 'T-002', 'status', 'done');
if (WBS_NEXT === null) throw new Error('底座构造失败：wbs T-002 status 局部修改被拒');

/** 计划写入内容：changelog 追加第 4 笔事件块 */
const APPEND_DONE = appendEventBlock(DEMO_CHANGELOG, EVT_DONE);
if (!APPEND_DONE.ok) throw new Error(`底座构造失败：changelog 第 4 笔追加被拒（${APPEND_DONE.message}）`);
const CHANGELOG_NEXT = APPEND_DONE.text;

const ALL_ENVELOPES_4 = [...BASE_ENVELOPES, EVT_DONE];

/** 跨文件操作目标：baseHash/nextHash 均按 contentVersion（UTF-8 字节 SHA-256）计算 */
const TARGETS: OperationTarget[] = [
  {
    path: WBS_PATH,
    baseHash: contentVersion(DEMO_WBS).contentHash,
    nextHash: contentVersion(WBS_NEXT).contentHash,
  },
  {
    path: CHANGELOG_PATH,
    baseHash: contentVersion(DEMO_CHANGELOG).contentHash,
    nextHash: contentVersion(CHANGELOG_NEXT).contentHash,
  },
];

const OP_NOW = {
  prepare: '2026-10-24T10:20:00+08:00',
  applied: '2026-10-24T10:21:00+08:00',
  logged: '2026-10-24T10:22:00+08:00',
  committed: '2026-10-24T10:23:00+08:00',
} as const;

const OBSERVED_AT = '2026-10-24T11:00:00+08:00';

function preparedJournal(): OperationJournal {
  return prepareOperation({
    operationId: 'OP-DRILL-1',
    eventId: ID_DONE,
    targets: TARGETS,
    now: OP_NOW.prepare,
  });
}

function appliedJournal(): OperationJournal {
  const r = markApplied(preparedJournal(), OP_NOW.applied);
  if (!r.ok) throw new Error(r.message);
  return r.journal;
}

function loggedJournal(): OperationJournal {
  const r = markLogged(appliedJournal(), OP_NOW.logged);
  if (!r.ok) throw new Error(r.message);
  return r.journal;
}

const obs = (pairs: ReadonlyArray<readonly [string, string | null]>) =>
  pairs.map(([path, hash]) => ({ path, hash }));

/** 真实验证 → 折叠：信封 × 收据 × 锚点裁定后按裁定值构造 FoldEvent（不经手写捷径） */
function foldFromVerification(
  envelopes: readonly EventEnvelope[],
  receipts: readonly EventReceipt[],
  anchor: ReceiptAnchor | null,
): StageProjection {
  const verification = verifyEventChain(envelopes, receipts, anchor);
  const events: FoldEvent[] = envelopes.map((envelope, i) => {
    const verdict = verification.perEvent[i]!.verdict;
    const seq = verification.perEvent[i]!.seq;
    return { envelope, effectiveIntegrity: verdict, ...(seq !== undefined ? { seq } : {}) };
  });
  return foldStage(events);
}

/* ---------------------------------------------------------------- *
 * 数据底座自检
 * ---------------------------------------------------------------- */

describe('M0 门禁演练 · demo-project 数据底座', () => {
  it('底座：demoWbs 富样本——3 个 fenced 任务节点（todo/doing/done）+ CRLF + 中文注释 + 未知字段', () => {
    expect(DEMO_WBS).toContain('\r\n');
    expect(DEMO_WBS).not.toMatch(/[^\r]\n/); // 全文 CRLF，无裸 LF
    const parsed = parseFencedTaskBlocks(DEMO_WBS);
    expect(parsed.nodes).toHaveLength(3);
    expect(parsed.nodes.map((n) => getNodeField(n, 'id'))).toEqual(['T-001', 'T-002', 'T-003']);
    expect(parsed.nodes.map((n) => getNodeField(n, 'status'))).toEqual(['todo', 'doing', 'done']);
    expect(DEMO_WBS).toContain('<!-- 主理人手写注释：演示项目，机器不得吞掉本行（R-04） -->');
  });

  it('底座：demoChangelog 三笔信封逐字段合法（ULID/带时区/core 通道），人类说明不产信封', () => {
    for (const id of [ID_INIT, ID_TR1, ID_TR2, ID_DONE, ID_5TH]) {
      expect(isUlid(id)).toBe(true);
    }
    expect(PARSED_CHANGELOG.envelopes).toHaveLength(3);
    expect(PARSED_CHANGELOG.diagnostics).toEqual([]); // 手写块零信封诊断
    const [e1, e2, e3] = PARSED_CHANGELOG.envelopes;
    expect(e1).toMatchObject({
      event_id: ID_INIT,
      schema_version: '1',
      kind: 'project.initialized',
      origin: 'core',
      integrity: 'verified',
      occurred_at: '2026-10-24T09:30:00+08:00',
      recorded_at: '2026-10-24T09:30:05+08:00',
    });
    expect(e1!.actor).toEqual({ actor_id: ACTOR_ID, session_id: SESSION_ID });
    expect(e1!.subject).toEqual({ object_id: 'proj:demo-project' });
    expect(e1!.payload).toEqual({ project_id: 'demo-project', stage_order: ['M0', 'M1', 'M2'] });
    expect(e2!.kind).toBe('task.transitioned');
    expect(e2!.payload).toEqual({ task_id: 'T-001', from: 'todo', to: 'doing' });
    expect(e3!.payload).toEqual({ task_id: 'T-002', from: 'todo', to: 'doing' });
    // 块外人类说明与 HTML 注释不是事件块：不产信封（条目数只来自 3 个 fenced 块）
    expect(DEMO_CHANGELOG).toContain('主理人批注（2026-10-24 上午）');
  });
});

/* ---------------------------------------------------------------- *
 * 第一关 保真（round-trip / P-04 / B-10 / B-11）
 * ---------------------------------------------------------------- */

describe('第一关 保真：round-trip / P-04 / B-10 / B-11', () => {
  it('保真：解析→重建字节级一致（CRLF/注释/未知字段/块外文本全保留）', () => {
    const parsed = parseFencedTaskBlocks(DEMO_WBS);
    expect(reconstruct(DEMO_WBS, parsed)).toBe(DEMO_WBS);
    const v = validateWbsDocument(DEMO_WBS, parsed);
    // F-06：两个手写未知字段保留并诊断，且无任何致命诊断
    expect(v.diagnostics.map((d) => d.code)).toEqual(['unknown-field', 'unknown-field']);
    expect(v.taskIds).toEqual(['T-001', 'T-002', 'T-003']);
    expect(v.diagnostics.some((d) => d.code === 'missing-required-field')).toBe(false);
  });

  it('保真：T-002 status 改 done 后目标行外字节级一致（含注释/未知字段/CRLF）', () => {
    expect(DEMO_WBS.split('status: doing')).toHaveLength(2); // 目标行全文唯一
    const parsed = parseFencedTaskBlocks(DEMO_WBS);
    const after = updateTaskFieldById(DEMO_WBS, parsed, 'T-002', 'status', 'done');
    expect(after).not.toBeNull();
    // 全文比对：除目标行外一字节不动
    expect(after).toBe(DEMO_WBS.replace('status: doing', 'status: done'));
    const linesBefore = DEMO_WBS.split('\r\n');
    const linesAfter = after!.split('\r\n');
    expect(linesAfter).toHaveLength(linesBefore.length);
    const diffIdx = linesBefore.map((l, i) => (linesAfter[i] !== l ? i : -1)).filter((i) => i !== -1);
    expect(diffIdx).toEqual([20]); // 仅 T-002 的 status 行（0-based 第 20 行）
    expect(linesBefore[20]).toBe('status: doing');
    expect(linesAfter[20]).toBe('status: done');
    // 注释行、未知字段、块外文本、CRLF 风格全部保留
    expect(after).toContain('<!-- 主理人手写注释：演示项目，机器不得吞掉本行（R-04） -->');
    expect(after).toContain('备注: 手写未知字段（F-06 保留）');
    expect(after).toContain('unknown_field_x: 保留我');
    expect(after).toContain('块外自由文本：人类说明，不参与状态推导。');
    expect(after).not.toMatch(/[^\r]\n/);
  });

  it('保真：projectEventLog 三笔投影正确（verified+可信 seq），人类说明不产信封', () => {
    const p = projectEventLog(DEMO_CHANGELOG, BASE_RECEIPTS, BASE_ANCHOR);
    expect(p.entries).toHaveLength(3);
    expect(p.entries.map((e) => e.eventId)).toEqual([ID_INIT, ID_TR1, ID_TR2]);
    expect(p.entries.map((e) => e.status)).toEqual(['verified', 'verified', 'verified']);
    expect(p.entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(p.entries[0]).toMatchObject({ kind: 'project.initialized', origin: 'core', effectiveIntegrity: 'verified' });
    expect(p.needsAttention).toBe(false);
    expect(p.malformedCount).toBe(0);
    expect(p.chainIssues).toEqual([]);
  });

  it('保真：appendEventBlock 追加第 4 笔——前缀字节不动、追加段精确；重复 event_id 被拒', () => {
    expect(APPEND_DONE.ok).toBe(true);
    expect(CHANGELOG_NEXT.startsWith(DEMO_CHANGELOG)).toBe(true);
    expect(CHANGELOG_NEXT).toBe(DEMO_CHANGELOG + '\n' + serializeEventBlock(EVT_DONE));
    expect(parseEventBlocks(CHANGELOG_NEXT).envelopes.map((e) => e.event_id)).toEqual([
      ID_INIT,
      ID_TR1,
      ID_TR2,
      ID_DONE,
    ]);
    const dup = appendEventBlock(CHANGELOG_NEXT, EVT_DONE);
    expect(dup).toMatchObject({ ok: false, error: 'duplicate-event-id' });
    const dupInBase = appendEventBlock(DEMO_CHANGELOG, BASE_ENVELOPES[0]!);
    expect(dupInBase).toMatchObject({ ok: false, error: 'duplicate-event-id' });
  });

  it('保真：buildReceiptChain + buildAnchor 造收据链 → verifyEventChain 全 verified', () => {
    expect(BASE_RECEIPTS.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(BASE_RECEIPTS[0]!.prev_hash).toBe(GENESIS_PREV_HASH);
    expect(BASE_ANCHOR.chain_head).toBe(BASE_RECEIPTS[2]!.receipt_hash);
    expect(BASE_ANCHOR.length).toBe(3);
    expect(BASE_ANCHOR.algorithm).toBe('sha256');
    const v = verifyEventChain(BASE_ENVELOPES, BASE_RECEIPTS, BASE_ANCHOR);
    expect(v.perEvent.map((e) => e.verdict)).toEqual(['verified', 'verified', 'verified']);
    expect(v.perEvent.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(v.issues).toEqual([]);
    expect(v.needsAttention).toBe(false);
    expect(v.recomputedHead).toBe(BASE_ANCHOR.chain_head);
  });

  it('B-10：篡改第 2 笔事件 payload 一个字符 → 该笔 invalid，其余不受累', () => {
    expect(DEMO_CHANGELOG.split('"task_id":"T-001"')).toHaveLength(2); // 篡改点唯一
    const tamperedMd = DEMO_CHANGELOG.replace('"task_id":"T-001"', '"task_id":"T-009"');
    const tamperedEnvelopes = parseEventBlocks(tamperedMd).envelopes; // 格式仍合法，3 笔
    expect(tamperedEnvelopes).toHaveLength(3);
    const v = verifyEventChain(tamperedEnvelopes, BASE_RECEIPTS, BASE_ANCHOR);
    expect(v.perEvent.map((e) => e.verdict)).toEqual(['verified', 'invalid', 'verified']);
    expect(v.perEvent[1]!.event_id).toBe(ID_TR1);
    expect(v.issues.some((i) => i.code === 'content-hash-mismatch' && i.event_id === ID_TR1)).toBe(true);
    expect(v.needsAttention).toBe(true);
    // 投影口径一致：该笔 status=invalid、有效 integrity=invalid（不参与状态推导）
    const p = projectEventLog(tamperedMd, BASE_RECEIPTS, BASE_ANCHOR);
    expect(p.entries[1]).toMatchObject({
      eventId: ID_TR1,
      status: 'invalid',
      effectiveIntegrity: 'invalid',
      malformed: false,
    });
  });

  it('B-11：交换两笔收据顺序 → 复算断裂，全链 invalid（宁严勿漏）', () => {
    const swapped = [BASE_RECEIPTS[1]!, BASE_RECEIPTS[0]!, BASE_RECEIPTS[2]!];
    const v = verifyEventChain(BASE_ENVELOPES, swapped, BASE_ANCHOR);
    expect(v.perEvent.map((e) => e.verdict)).toEqual(['invalid', 'invalid', 'invalid']);
    expect(v.issues.some((i) => i.code === 'receipt-chain-broken')).toBe(true);
    expect(v.needsAttention).toBe(true);
  });

  it('B-11：删锚点（传 null）→ 口径为「来源未知」不静默重算', () => {
    const v = verifyEventChain(BASE_ENVELOPES, BASE_RECEIPTS, null);
    expect(v.perEvent.map((e) => e.verdict)).toEqual(['unregistered', 'unregistered', 'unregistered']);
    const missing = v.issues.find((i) => i.code === 'anchor-missing');
    expect(missing).toBeDefined();
    expect(missing!.message).toContain('来源未知');
    expect(missing!.message).toContain('不静默重算');
    expect(v.needsAttention).toBe(true);
    // 投影口径：链上事件全部降 external-unverified（有效 integrity=unknown），不参与推导
    const p = projectEventLog(DEMO_CHANGELOG, BASE_RECEIPTS, null);
    expect(p.entries.every((e) => e.status === 'external-unverified' && e.effectiveIntegrity === 'unknown')).toBe(true);
    expect(p.needsAttention).toBe(true);
  });

  it('B-11：未登记的第 5 笔事件 → unregistered（S2.1-04 external-unverified，不驱动状态）', () => {
    const v = verifyEventChain([...BASE_ENVELOPES, EVT_5TH], BASE_RECEIPTS, BASE_ANCHOR);
    expect(v.perEvent.map((e) => e.verdict)).toEqual(['verified', 'verified', 'verified', 'unregistered']);
    expect(v.issues).toEqual([]); // 未登记是正常态而非链问题（有锚点、已登记事件全验真）
    const p = projectEventLog(
      DEMO_CHANGELOG + '\n' + serializeEventBlock(EVT_5TH),
      BASE_RECEIPTS,
      BASE_ANCHOR,
    );
    expect(p.entries).toHaveLength(4);
    expect(p.entries[3]).toMatchObject({
      eventId: ID_5TH,
      status: 'external-unverified',
      effectiveIntegrity: 'unknown',
      malformed: false,
    });
    expect(p.entries[3]!.seq).toBeUndefined();
  });
});

/* ---------------------------------------------------------------- *
 * 第二关 并发（B-1 字节 CAS / 派生版本 / B-2 外部编辑检测）
 * ---------------------------------------------------------------- */

describe('第二关 并发：B-1 字节 CAS / 派生版本 compare-and-set / B-2 外部编辑检测', () => {
  it('并发：写者 B 抢先改文件后写者 A 提交被拒（content-hash-mismatch）且结果不携带新文本', () => {
    const baselineA = contentVersion(DEMO_WBS); // 写者 A 的读取基线
    const contentAfterB = updateTaskFieldById(
      DEMO_WBS,
      parseFencedTaskBlocks(DEMO_WBS),
      'T-003',
      'title',
      'B 抢先改过的收尾标题',
    )!; // 写者 B 先落盘
    expect(contentAfterB).not.toBe(DEMO_WBS);
    const aNext = updateTaskFieldById(DEMO_WBS, parseFencedTaskBlocks(DEMO_WBS), 'T-002', 'status', 'done')!;

    const rejected = compareAndSet(contentAfterB, { expectedHash: baselineA.contentHash, nextContent: aNext });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.code).toBe('content-hash-mismatch');
    // 结构上不携带新文本：调用方拿不到旧基线生成的内容去覆盖他人修改（B-1）
    expect('nextContent' in rejected).toBe(false);
    expect(rejected.actual.contentHash).toBe(contentVersion(contentAfterB).contentHash);
    expect(rejected.expectedHash).toBe(baselineA.contentHash);
  });

  it('并发：A 重读重算基线后提交成功（新内容同时保留 B 的修改）', () => {
    const contentAfterB = updateTaskFieldById(
      DEMO_WBS,
      parseFencedTaskBlocks(DEMO_WBS),
      'T-003',
      'title',
      'B 抢先改过的收尾标题',
    )!;
    const reread = contentVersion(contentAfterB); // A 重读磁盘最新字节
    const aNext2 = updateTaskFieldById(
      contentAfterB,
      parseFencedTaskBlocks(contentAfterB),
      'T-002',
      'status',
      'done',
    )!; // 基于最新内容重新生成
    expect(aNext2).toContain('title: B 抢先改过的收尾标题'); // 不覆盖 B 的修改
    expect(aNext2).toContain('status: done');

    const accepted = compareAndSet(contentAfterB, { expectedHash: reread.contentHash, nextContent: aNext2 });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.base.contentHash).toBe(reread.contentHash);
    expect(accepted.nextContent).toBe(aNext2);
    expect(accepted.next.contentHash).toBe(contentVersion(aNext2).contentHash);
  });

  it('并发：3 笔事件真实折叠出派生版本戳（versionOf 取自验证后折叠）', () => {
    const p3 = foldFromVerification(BASE_ENVELOPES, BASE_RECEIPTS, BASE_ANCHOR);
    // 3 笔 verified + core 事件全部参与计数（含不影响阶段的 task.transitioned）
    expect(versionOf(p3)).toEqual({ asOf: '2026-10-24T09:50:05+08:00', sourceVersion: 3 });
    expect(p3.currentStage).toBe('M0'); // stage_order 首阶段
    expect(p3.transitions).toHaveLength(1); // 仅 project.initialized 产生阶段迁移
    expect(p3.transitions[0]).toMatchObject({ kind: 'project.initialized', seq: 1, to: 'M0' });
    expect(p3.asOf).toBe('2026-10-24T09:50:05+08:00');
  });

  it('并发：追加第 4 笔后旧版本戳提交 stale-projection 拒绝，重读重算后放行', () => {
    const receipts4 = buildReceiptChain(ALL_ENVELOPES_4);
    const anchor4 = buildAnchor(receipts4, '2026-10-24T10:00:10+08:00');
    const stamp4 = versionOf(foldFromVerification(ALL_ENVELOPES_4, receipts4, anchor4));
    expect(stamp4).toEqual({ asOf: '2026-10-24T10:00:05+08:00', sourceVersion: 4 });

    const stamp3 = versionOf(foldFromVerification(BASE_ENVELOPES, BASE_RECEIPTS, BASE_ANCHOR));
    const stale = checkFreshSubmission(stamp4, stamp3);
    expect(stale.ok).toBe(false);
    expect(stale.code).toBe('stale-projection');
    expect(stale.message).toContain('重读');

    // 重读事件流重算投影后，同版本提交放行
    const fresh = checkFreshSubmission(
      stamp4,
      versionOf(foldFromVerification(ALL_ENVELOPES_4, receipts4, anchor4)),
    );
    expect(fresh.ok).toBe(true);
    expect(fresh.code).toBe('ok');
  });

  it('并发：基线 nextBaseline 登记 → 外部改一个字节 → external-change 且汇总需处理', () => {
    const baseline = nextBaseline(WBS_PATH, WBS_NEXT); // 受管写路径成功后登记指纹基线
    expect(baseline.fingerprint).toEqual(contentVersion(WBS_NEXT));
    const externallyEdited = WBS_NEXT.replace('deps: T-001', 'deps: T-009'); // 一个字节（'1'→'9'）
    expect(externallyEdited).not.toBe(WBS_NEXT);

    const observation = observeExternalEdit({
      path: WBS_PATH,
      baseline: baseline.fingerprint,
      currentContent: externallyEdited,
      observedAt: OBSERVED_AT,
    });
    expect(observation.status).toBe('external-change');
    expect(observation.baseline!.contentHash).toBe(contentVersion(WBS_NEXT).contentHash);
    expect(observation.current.contentHash).toBe(contentVersion(externallyEdited).contentHash);
    expect(observation.intermediateUnknown).toBe(true); // 中间过程不可观察，如实标注（P-08）

    const summary = summarizeExternalScan([observation]);
    expect(summary.needsAttention).toBe(true);
    expect(summary.changes).toHaveLength(1);
    expect(summary.changes[0]!.path).toBe(WBS_PATH);
    expect(summary.untracked).toHaveLength(0);
  });

  it('并发：外部编辑观察记录只有 observedAt，结构上无 occurredAt（P-08 不回填）', () => {
    const baseline = nextBaseline(WBS_PATH, WBS_NEXT).fingerprint;
    const observation = observeExternalEdit({
      path: WBS_PATH,
      baseline,
      currentContent: WBS_NEXT.replace('deps: T-001', 'deps: T-009'),
      observedAt: OBSERVED_AT,
    });
    expect('observedAt' in observation).toBe(true);
    expect('occurredAt' in observation).toBe(false);
    expect(Object.keys(observation).some((k) => k.toLowerCase().includes('occurred'))).toBe(false);
    expect(JSON.stringify(observation)).not.toContain('occurredAt');
    expect(observation.observedAt).toBe(OBSERVED_AT); // 观察时间逐字保留，不派生不改写
  });
});

/* ---------------------------------------------------------------- *
 * 第三关 中断（B-2 四相恢复）
 * ---------------------------------------------------------------- */

describe('第三关 中断：跨文件操作四相恢复（P-06/B-2）', () => {
  const bothNext = (): ReadonlyArray<readonly [string, string | null]> => [
    [WBS_PATH, TARGETS[0]!.nextHash],
    [CHANGELOG_PATH, TARGETS[1]!.nextHash],
  ];

  it('中断：prepared 相中断（两文件均未写）→ resume-apply，材料保留', () => {
    const r = assessRecovery(
      preparedJournal(),
      obs([
        [WBS_PATH, TARGETS[0]!.baseHash!],
        [CHANGELOG_PATH, TARGETS[1]!.baseHash!],
      ]),
      { eventLogged: false },
    );
    expect(r.action).toBe('resume-apply');
    expect(r.pendingPaths).toEqual([WBS_PATH, CHANGELOG_PATH]);
    expect(r.conflictPaths).toEqual([]);
    expect(r.needsAttention).toBe(false);
    expect(r.recordedPhase).toBe('prepared');
    expect(r.retainedMaterial.eventId).toBe(ID_DONE);
    expect(r.retainedMaterial.targets).toEqual(TARGETS);
    expect(r.retainedMaterial.observations).toHaveLength(2);
  });

  it('中断：applied 相中断且仅 wbs 落盘（changelog 未追加）→ 按模块语义 resume-apply 补写剩余目标', () => {
    const r = assessRecovery(
      appliedJournal(),
      obs([
        [WBS_PATH, TARGETS[0]!.nextHash],
        [CHANGELOG_PATH, TARGETS[1]!.baseHash!],
      ]),
      { eventLogged: false },
    );
    // 模块语义（operationRecovery.ts「相位 applied 但仍有文件停留在基线」）：
    // 继续写剩余目标，已写目标不重复覆盖——不是 resume-log（文件未齐备）也不是 mark-applied（有文件未写）
    expect(r.action).toBe('resume-apply');
    expect(r.pendingPaths).toEqual([CHANGELOG_PATH]);
    expect(r.targets[0]!.state).toBe('applied');
    expect(r.targets[1]!.state).toBe('base');
    expect(r.needsAttention).toBe(false);
  });

  it('中断：applied 相两文件均已落盘、日志未写 → resume-log（幂等补写）', () => {
    const r = assessRecovery(appliedJournal(), obs(bothNext()), { eventLogged: false });
    expect(r.action).toBe('resume-log');
    expect(r.pendingPaths).toEqual([]);
    expect(r.needsAttention).toBe(false);
    expect(r.messages.join()).toContain('补写');
  });

  it('中断：prepared 相但两文件均已落盘（中断于写完与相位推进之间）→ mark-applied，不重复写', () => {
    const r = assessRecovery(preparedJournal(), obs(bothNext()), { eventLogged: false });
    expect(r.action).toBe('mark-applied');
    expect(r.pendingPaths).toEqual([]);
    expect(r.needsAttention).toBe(false);
  });

  it('中断：logged 后文件不一致（wbs 被外部改回基线）→ 禁止 commit，manual-review', () => {
    const r = assessRecovery(
      loggedJournal(),
      obs([
        [WBS_PATH, TARGETS[0]!.baseHash!], // 文件被改回写入前内容
        [CHANGELOG_PATH, TARGETS[1]!.nextHash],
      ]),
      { eventLogged: true },
    );
    expect(r.action).toBe('manual-review');
    expect(r.needsAttention).toBe(true);
    expect(r.messages.join()).toContain('append-only'); // 日志不可撤回，不静默 commit
    // 被改回基线的文件 state='base'（conflict 仅指既非基线也非计划内容）；
    // 禁止 commit 的口径由「文件未齐备 + 日志已记」触发 manual-review
    expect(r.targets[0]!.state).toBe('base');
    expect(r.targets[0]!.observedHash).toBe(TARGETS[0]!.baseHash!);
    expect(r.targets[1]!.state).toBe('applied');
    expect(r.conflictPaths).toEqual([]);
  });

  it('中断：logged 相文件与日志齐备 → commit 放行，提交后复评 noop', () => {
    const journal = loggedJournal();
    const r = assessRecovery(journal, obs(bothNext()), { eventLogged: true });
    expect(r.action).toBe('commit');
    expect(r.needsAttention).toBe(false);
    const c = commitOperation(journal, OP_NOW.committed);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.journal.phase).toBe('committed');
    expect(c.journal.updated_at).toBe(OP_NOW.committed);
    const after = assessRecovery(c.journal, obs(bothNext()), { eventLogged: true });
    expect(after.action).toBe('noop');
    expect(after.needsAttention).toBe(false);
  });

  it('恢复完成态：wbs 恢复内容复跑保真断言全过（round-trip/局部修改幂等/校验干净）', () => {
    const parsed = parseFencedTaskBlocks(WBS_NEXT);
    expect(reconstruct(WBS_NEXT, parsed)).toBe(WBS_NEXT); // round-trip 字节级一致
    expect(parsed.nodes).toHaveLength(3);
    const t2 = parsed.nodes.find((n) => getNodeField(n, 'id') === 'T-002');
    expect(getNodeField(t2!, 'status')).toBe('done'); // 恢复后的目标状态
    expect(WBS_NEXT).toContain('<!-- 主理人手写注释：演示项目，机器不得吞掉本行（R-04） -->');
    expect(WBS_NEXT).toContain('备注: 手写未知字段（F-06 保留）');
    expect(WBS_NEXT).toContain('unknown_field_x: 保留我');
    const v = validateWbsDocument(WBS_NEXT, parsed);
    expect(v.diagnostics.map((d) => d.code)).toEqual(['unknown-field', 'unknown-field']);
    // 局部修改仍仅动目标行：对已恢复内容重写同值，字节级不变（幂等）
    expect(updateTaskFieldById(WBS_NEXT, parsed, 'T-002', 'status', 'done')).toBe(WBS_NEXT);
  });

  it('恢复完成态：changelog 恢复内容 4 笔投影全 verified，收据链复跑全过', () => {
    expect(CHANGELOG_NEXT.startsWith(DEMO_CHANGELOG)).toBe(true); // append-only 前缀字节不动
    const p = projectEventLog(CHANGELOG_NEXT, buildReceiptChain(ALL_ENVELOPES_4), buildAnchor(buildReceiptChain(ALL_ENVELOPES_4), '2026-10-24T10:00:10+08:00'));
    expect(p.entries).toHaveLength(4);
    expect(p.entries.map((e) => e.status)).toEqual(['verified', 'verified', 'verified', 'verified']);
    expect(p.entries[3]).toMatchObject({ eventId: ID_DONE, kind: 'task.transitioned', seq: 4 });
    expect(p.needsAttention).toBe(false);
    expect(p.malformedCount).toBe(0);
    // 复跑收据链验证（第 3 关断言形态，基于恢复后的 4 笔事件流）
    const receipts = buildReceiptChain(ALL_ENVELOPES_4);
    const anchor = buildAnchor(receipts, '2026-10-24T10:00:10+08:00');
    const v = verifyEventChain(ALL_ENVELOPES_4, receipts, anchor);
    expect(v.perEvent.every((e) => e.verdict === 'verified')).toBe(true);
    expect(v.issues).toEqual([]);
    expect(v.recomputedHead).toBe(anchor.chain_head);
  });
});
