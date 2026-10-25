/**
 * gatedeck promote 可测纯逻辑与编排路径测试（W-S2-5 CLI 装配；不做真 TTY 测试——
 * B-12 的 isTtyInteractive 判定本身已有 core promotionFlow.test.ts 单测，此处只测
 * 编排层对判定结果的消费：deps.stdinIsTty/envCi 注入 → 拒绝路径）。
 *
 * 覆盖（对应任务规格 ≥8 条）：
 *  - pending 挑选：缺省取最新（文档序）/ --operation-id 指定 / 无 pending；
 *  - operationId 关联：已确认不待审、无法归属不参与、payload.operationId 回退归属；
 *  - 确认判定：y / 其他 / 空（默认拒绝）；
 *  - 事件参数构造：locally_confirmed 与 promotion.completed payload 字段齐、
 *    expected_sequence 取实际链序（core 事件数 + 2）；
 *  - 折叠预演：接受（stage_order 含目标阶段）与拒绝（越级/过期申请）；
 *  - 编排路径：无 pm/ 引导 exit 2、非交互（非 TTY / CI）拒绝 exit 2 且零写入、
 *    确认拒绝 exit 1 零写入、无 pending exit 1、happy path（事件追加 + 收据链
 *    重建 + 折叠派生新阶段）与 --operation-id 指定执行。
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  isUlid,
  parseEventBlocks,
  serializeEventBlock,
  type EventEnvelope,
} from '../../core/eventEnvelope.js';
import { verifyEventChain, type EventReceipt, type ReceiptAnchor } from '../../core/eventReceipt.js';
import { foldStage, type FoldEvent } from '../../core/stageFold.js';
import { B12_REJECT_MESSAGE } from '../../core/promotionFlow.js';
import {
  buildLocallyConfirmedEnvelope,
  buildPromotionEnvelope,
  evaluateConfirmation,
  parsePromoteArgs,
  planPromotionEvents,
  runPromote,
  selectPendingPromotion,
  type PromoteDeps,
} from './promote.js';

/* ---------------------------------------------------------------- *
 * 夹具：确定性 ULID / 信封构造 / 临时项目 / 注入依赖
 * ---------------------------------------------------------------- */

const T = '2026-10-25T09:00:00+08:00';
const MANIFEST = 'a'.repeat(64);

/** 确定性 ULID 形态 id（26 位，hex 后缀均在 Crockford 字母表内） */
function ulidOf(n: number): string {
  return `01H800000000000000000000${n.toString(16).toUpperCase().padStart(2, '0')}`;
}

/** 由文本确定性派生夹具 event_id（不同 operationId 不碰撞——重复 event_id 块会被 B-11 预检拒绝） */
function idFromText(text: string, base: number): string {
  const sum = [...text].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return ulidOf(base + (sum % 64));
}

/** project.initialized（origin=core；payload.stage_order 为折叠的阶段序） */
function initEnvelope(stageOrder: readonly string[]): EventEnvelope {
  return {
    event_id: ulidOf(1),
    schema_version: '1',
    kind: 'project.initialized',
    occurred_at: T,
    recorded_at: T,
    actor: { actor_id: 'init-actor', session_id: 'init-session' },
    origin: 'core',
    integrity: 'verified',
    subject: { object_id: 'demo' },
    operation_id: ulidOf(2),
    payload: { stage: stageOrder[0]!, stage_order: [...stageOrder], template_version: 1 },
  };
}

/** authorization.requested（origin=managed-api，与 mcp/tools/gates.ts requestPromotion 同 payload 形状） */
function requestEnvelope(
  operationId: string,
  from: string,
  to: string,
  overrides: { operation_id?: string | undefined; payload?: Record<string, unknown> } = {},
): EventEnvelope {
  const { operation_id: overrideOpId, payload: overridePayload } = overrides;
  return {
    event_id: idFromText(operationId, 10),
    schema_version: '1',
    kind: 'authorization.requested',
    occurred_at: T,
    recorded_at: T,
    actor: { actor_id: 'mcp-actor', session_id: 'mcp-session' },
    origin: 'managed-api',
    integrity: 'unknown',
    subject: { object_id: `gate:G-001`, manifest_hash: MANIFEST },
    ...(overrideOpId !== undefined ? { operation_id: overrideOpId } : { operation_id: operationId }),
    payload: overridePayload ?? { gate_id: 'G-001', from, to, expected_sequence: 9, manifest_hash: MANIFEST },
  };
}

/** authorization.locally_confirmed 夹具（operationId 关联测试用） */
function confirmedEnvelope(operationId: string): EventEnvelope {
  return {
    event_id: idFromText(operationId, 40),
    schema_version: '1',
    kind: 'authorization.locally_confirmed',
    occurred_at: T,
    recorded_at: T,
    actor: { actor_id: 'p', session_id: 't' },
    origin: 'core',
    integrity: 'verified',
    subject: { object_id: `promotion:${operationId}` },
    operation_id: operationId,
    payload: { operationId, local_principal_id: 'p', terminal_session_id: 't' },
  };
}

function changelogOf(...envelopes: readonly EventEnvelope[]): string {
  return '# 变更日志\n\n' + envelopes.map((e) => serializeEventBlock(e)).join('');
}

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

/** 临时项目：pm/changelog.md 落盘；返回项目根目录 */
function tmpProject(changelogText: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'gd-promote-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'pm'), { recursive: true });
  writeFileSync(join(dir, 'pm', 'changelog.md'), changelogText, 'utf8');
  return dir;
}

function readChangelog(dir: string): string {
  return readFileSync(join(dir, 'pm', 'changelog.md'), 'utf8');
}

/** 可断言的内存终端（与 cli/index.test.ts 同约定） */
function captureIo(): { io: { out: (l: string) => void; err: (l: string) => void }; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

/** 注入依赖：交互 TTY、固定时钟、确定性 ULID/不透明 ID、固定确认行 */
function fixedDeps(line: string, overrides: Partial<PromoteDeps> = {}): PromoteDeps {
  let ulidCounter = 100;
  let opaqueCounter = 0;
  return {
    stdinIsTty: true,
    envCi: undefined,
    nowIso: () => T,
    newEventUlid: () => ulidOf(ulidCounter++),
    newOpaqueId: () => `opaque-${++opaqueCounter}`,
    readConfirmLine: () => line,
    ...overrides,
  };
}

/* ---------------------------------------------------------------- *
 * 纯逻辑测试
 * ---------------------------------------------------------------- */

describe('parsePromoteArgs（参数解析）', () => {
  it('无参数 → operationId=null；空格与 = 两种传值形态均可；未知/缺值/重复/空值报错', () => {
    expect(parsePromoteArgs([])).toEqual({ ok: true, operationId: null });
    expect(parsePromoteArgs(['--operation-id', 'OP-1'])).toEqual({ ok: true, operationId: 'OP-1' });
    expect(parsePromoteArgs(['--operation-id=OP-1'])).toEqual({ ok: true, operationId: 'OP-1' });
    expect(parsePromoteArgs(['--gate', 'x']).ok).toBe(false);
    expect(parsePromoteArgs(['--operation-id']).ok).toBe(false);
    expect(parsePromoteArgs(['--operation-id', 'A', '--operation-id', 'B']).ok).toBe(false);
    expect(parsePromoteArgs(['--operation-id', '   ']).ok).toBe(false);
  });
});

describe('selectPendingPromotion（pending 挑选）', () => {
  it('缺省取文档序最新一笔 pending（B-16 同精神按装配序，不按时间戳）', () => {
    const envelopes = [
      initEnvelope(['A', 'B']),
      requestEnvelope('OP-A', 'A', 'B'),
      requestEnvelope('OP-B', 'A', 'B'),
    ];
    const result = selectPendingPromotion(envelopes, null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.operationId).toBe('OP-B');
      expect(result.request.from).toBe('A');
      expect(result.request.to).toBe('B');
      expect(result.request.manifestHash).toBe(MANIFEST);
      expect(result.request.requestedAt).toBe(T);
    }
  });

  it('--operation-id 指定：非最新的 pending 也可精确选中', () => {
    const envelopes = [
      initEnvelope(['A', 'B']),
      requestEnvelope('OP-A', 'A', 'B'),
      requestEnvelope('OP-B', 'A', 'B'),
    ];
    const result = selectPendingPromotion(envelopes, 'OP-A');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request.operationId).toBe('OP-A');
  });

  it('无 pending → reason=none，提示「没有待审的推进申请」；未指定的 operationId → not-found', () => {
    const none = selectPendingPromotion([initEnvelope(['A'])], null);
    expect(none.ok).toBe(false);
    if (!none.ok) {
      expect(none.reason).toBe('none');
      expect(none.message).toContain('没有待审的推进申请');
    }
    const notFound = selectPendingPromotion([initEnvelope(['A'])], 'OP-X');
    expect(notFound.ok).toBe(false);
    if (!notFound.ok) expect(notFound.reason).toBe('not-found');
  });

  it('operationId 关联：已确认的申请不待审；无法归属的 requested 不参与；payload.operationId 可回退归属', () => {
    const payloadOnlyRequest = requestEnvelope('', 'A', 'B', {
      operation_id: undefined,
      payload: { from: 'A', to: 'B', expected_sequence: 9, manifest_hash: MANIFEST, operationId: 'OP-P' },
    });
    const envelopes = [
      initEnvelope(['A', 'B']),
      requestEnvelope('OP-A', 'A', 'B'),
      confirmedEnvelope('OP-A'),
      requestEnvelope('OP-B', 'A', 'B'),
      requestEnvelope('', 'A', 'B', { operation_id: undefined }), // 信封与 payload 均无 operationId
      payloadOnlyRequest,
    ];
    const wantedDone = selectPendingPromotion(envelopes, 'OP-A');
    expect(wantedDone.ok).toBe(false);
    if (!wantedDone.ok) expect(wantedDone.reason).toBe('not-pending');

    const latest = selectPendingPromotion(envelopes, null);
    expect(latest.ok).toBe(true);
    if (latest.ok) expect(latest.request.operationId).toBe('OP-P'); // 文档序最后的 pending（payload 回退归属）
  });
});

describe('evaluateConfirmation（确认判定：默认拒绝）', () => {
  it('仅完整 y（trim 后）接受；空/大写 Y/其他输入一律拒绝', () => {
    expect(evaluateConfirmation('y')).toBe(true);
    expect(evaluateConfirmation('  y  ')).toBe(true);
    expect(evaluateConfirmation('y\r')).toBe(true);
    expect(evaluateConfirmation('')).toBe(false);
    expect(evaluateConfirmation('n')).toBe(false);
    expect(evaluateConfirmation('Y')).toBe(false);
    expect(evaluateConfirmation('yes')).toBe(false);
  });
});

describe('事件参数构造（payload 字段齐）', () => {
  it('locally_confirmed：origin=core、integrity=verified、payload 三字段齐、actor 复用不透明 ID', () => {
    const env = buildLocallyConfirmedEnvelope({
      nowIso: T,
      eventId: ulidOf(99),
      operationId: 'OP-R',
      localPrincipalId: 'principal-hex',
      terminalSessionId: 'term-hex',
    });
    expect(isUlid(env.event_id)).toBe(true);
    expect(env.kind).toBe('authorization.locally_confirmed');
    expect(env.origin).toBe('core');
    expect(env.integrity).toBe('verified');
    expect(env.operation_id).toBe('OP-R');
    expect(env.occurred_at).toBe(T);
    expect(env.recorded_at).toBe(T);
    expect(env.subject).toEqual({ object_id: 'promotion:OP-R' });
    expect(env.payload).toEqual({
      operationId: 'OP-R',
      local_principal_id: 'principal-hex',
      terminal_session_id: 'term-hex',
    });
    expect(env.actor).toEqual({ actor_id: 'principal-hex', session_id: 'term-hex', tool: 'gatedeck-cli' });
  });

  it('promotion.completed：payload from/to/expected_sequence/manifest_hash 齐；manifest_hash=null 时缺省该键', () => {
    const env = buildPromotionEnvelope({
      nowIso: T,
      eventId: ulidOf(98),
      operationId: 'OP-R',
      from: 'A',
      to: 'B',
      expectedSequence: 3,
      manifestHash: MANIFEST,
      localPrincipalId: 'p',
      terminalSessionId: 't',
    });
    expect(env.kind).toBe('promotion.completed');
    expect(env.origin).toBe('core');
    expect(env.integrity).toBe('verified');
    expect(env.operation_id).toBe('OP-R');
    expect(env.subject).toEqual({ object_id: 'stage:B', manifest_hash: MANIFEST });
    expect(env.payload).toEqual({ from: 'A', to: 'B', expected_sequence: 3, manifest_hash: MANIFEST });

    const noManifest = buildPromotionEnvelope({
      nowIso: T,
      eventId: ulidOf(97),
      operationId: 'OP-R',
      from: 'A',
      to: 'B',
      expectedSequence: 3,
      manifestHash: null,
      localPrincipalId: 'p',
      terminalSessionId: 't',
    });
    expect('manifest_hash' in noManifest.payload).toBe(false);
    expect('manifest_hash' in noManifest.subject).toBe(false);
  });
});

describe('planPromotionEvents（事件参数构造 + 折叠预演）', () => {
  it('接受：expected_sequence 取实际链序（core 事件数 + 2）；折叠预演通过且阶段派生为目标阶段', () => {
    const envelopes = [initEnvelope(['A', 'B']), requestEnvelope('OP-R', 'A', 'B')];
    const result = planPromotionEvents({
      envelopes,
      request: {
        operationId: 'OP-R',
        gateId: 'G-001',
        from: 'A',
        to: 'B',
        expectedSequence: 9,
        manifestHash: MANIFEST,
        requestedAt: T,
        requestEventId: ulidOf(11),
        requestSubject: 'gate:G-001',
        requestIndex: 1,
      },
      nowIso: T,
      confirmedEventId: ulidOf(100),
      promotionEventId: ulidOf(101),
      localPrincipalId: 'p',
      terminalSessionId: 't',
    });
    expect(result.plan.expectedSequence).toBe(3); // 1 笔 core 事件 + 确认 +1 + 推进 +2
    expect(result.plan.promotionEnvelope.payload['expected_sequence']).toBe(3); // 不复制申请声明的 9
    expect(result.plan.promotionEnvelope.operation_id).toBe('OP-R');
    expect(result.fold.accepted).toBe(true);
    expect(result.fold.message).toContain('折叠预演通过');
  });

  it('拒绝预演：目标非下一阶段（stage_order 不含）与 from 与当前阶段不符，均如实给出拒绝原因', () => {
    const build = (from: string, to: string, stageOrder: readonly string[]) =>
      planPromotionEvents({
        envelopes: [initEnvelope(stageOrder), requestEnvelope('OP-R', from, to)],
        request: {
          operationId: 'OP-R',
          gateId: 'G-001',
          from,
          to,
          expectedSequence: 9,
          manifestHash: MANIFEST,
          requestedAt: T,
          requestEventId: ulidOf(11),
          requestSubject: 'gate:G-001',
          requestIndex: 1,
        },
        nowIso: T,
        confirmedEventId: ulidOf(100),
        promotionEventId: ulidOf(101),
        localPrincipalId: 'p',
        terminalSessionId: 't',
      });
    const jump = build('A', 'B', ['A']); // stage_order 只有 A：to=B 非下一阶段
    expect(jump.fold.accepted).toBe(false);
    expect(jump.fold.message).toContain('拒绝');
    const stale = build('X', 'B', ['A', 'B']); // from=X 与当前阶段 A 不符
    expect(stale.fold.accepted).toBe(false);
    expect(stale.fold.message).toContain('拒绝');
  });
});

/* ---------------------------------------------------------------- *
 * 编排路径测试（临时项目 + 注入依赖；不做真 TTY）
 * ---------------------------------------------------------------- */

describe('runPromote（编排路径）', () => {
  it('无 pm/ → 初始化引导 exit 2（未初始化不是成功态，W-06）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gd-promote-empty-'));
    dirs.push(dir);
    const { io, out } = captureIo();
    const rc = runPromote([], io, dir, fixedDeps('y'));
    expect(rc).toBe(2);
    expect(out.join('\n')).toContain('gatedeck init');
  });

  it('非交互（stdin 非 TTY）拒绝 exit 2：B-12 文案 + 零写入（changelog 字节不变）', () => {
    const dir = tmpProject(changelogOf(initEnvelope(['A', 'B']), requestEnvelope('OP-R', 'A', 'B')));
    const before = readChangelog(dir);
    const { io, err } = captureIo();
    const rc = runPromote([], io, dir, fixedDeps('y', { stdinIsTty: false }));
    expect(rc).toBe(2);
    expect(err.join('\n')).toContain(B12_REJECT_MESSAGE);
    expect(err.join('\n')).toContain('真人终端');
    expect(readChangelog(dir)).toBe(before); // 拒绝路径零写入
    expect(existsNoReceipts(dir)).toBe(true); // 收据文件也不产生
  });

  it('CI 环境变量非空即拒绝（B-12 编排层消费 envCi），即使 stdin.isTTY 为真', () => {
    const dir = tmpProject(changelogOf(initEnvelope(['A', 'B']), requestEnvelope('OP-R', 'A', 'B')));
    const { io, err } = captureIo();
    const rc = runPromote([], io, dir, fixedDeps('y', { envCi: 'true' }));
    expect(rc).toBe(2);
    expect(err.join('\n')).toContain(B12_REJECT_MESSAGE);
  });

  it('确认拒绝（非 y）exit 1：不产生任何事件、不写任何文件', () => {
    const dir = tmpProject(changelogOf(initEnvelope(['A', 'B']), requestEnvelope('OP-R', 'A', 'B')));
    const before = readChangelog(dir);
    const { io, out } = captureIo();
    const rc = runPromote([], io, dir, fixedDeps('n'));
    expect(rc).toBe(1);
    expect(out.join('\n')).toContain('已拒绝（不产生任何事件）');
    expect(readChangelog(dir)).toBe(before);
  });

  it('无 pending → 「没有待审的推进申请」exit 1', () => {
    const dir = tmpProject(changelogOf(initEnvelope(['A', 'B'])));
    const { io, err } = captureIo();
    const rc = runPromote([], io, dir, fixedDeps('y'));
    expect(rc).toBe(1);
    expect(err.join('\n')).toContain('没有待审的推进申请');
  });

  it('happy path：两笔事件追加 + 收据链重建 + 折叠派生新阶段，expected_sequence 为实际链序', () => {
    const dir = tmpProject(changelogOf(initEnvelope(['A', 'B']), requestEnvelope('OP-R', 'A', 'B')));
    const { io, out } = captureIo();
    const rc = runPromote([], io, dir, fixedDeps('y'));
    expect(rc).toBe(0);

    // 落盘内容：两笔新事件 + payload 契约
    const finalEnvelopes = parseEventBlocks(readChangelog(dir)).envelopes;
    const confirmed = finalEnvelopes.find((e) => e.kind === 'authorization.locally_confirmed');
    const promotion = finalEnvelopes.find((e) => e.kind === 'promotion.completed');
    expect(confirmed).toBeDefined();
    expect(promotion).toBeDefined();
    expect(promotion!.operation_id).toBe('OP-R'); // operationId 关联贯穿三步
    expect(promotion!.payload).toMatchObject({ from: 'A', to: 'B', expected_sequence: 3, manifest_hash: MANIFEST });
    expect(typeof confirmed!.payload['local_principal_id']).toBe('string');
    expect(typeof confirmed!.payload['terminal_session_id']).toBe('string');
    expect(confirmed!.payload['local_principal_id']).not.toBe(confirmed!.payload['terminal_session_id']);

    // 收据链：3 条 core 收据 + 锚点；全链验真；推进事件 seq=3
    const receipts = readFileSync(join(dir, 'pm', 'receipts.jsonl'), 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as EventReceipt);
    expect(receipts).toHaveLength(3);
    const anchor = JSON.parse(readFileSync(join(dir, 'pm', 'receipts.anchor.json'), 'utf8')) as ReceiptAnchor;
    const verification = verifyEventChain(finalEnvelopes, receipts, anchor);
    expect(verification.issues).toHaveLength(0);
    expect(verification.perEvent.filter((p) => p.verdict === 'verified')).toHaveLength(3); // managed-api 申请不入链
    expect(verification.perEvent.find((p) => p.event_id === promotion!.event_id)?.seq).toBe(3);

    // 折叠派生：当前阶段 = B（D-24）
    const foldEvents: FoldEvent[] = finalEnvelopes.map((envelope, i) => {
      const verdict = verification.perEvent[i]!;
      return { envelope, effectiveIntegrity: verdict.verdict, ...(verdict.seq !== undefined ? { seq: verdict.seq } : {}) };
    });
    expect(foldStage(foldEvents).currentStage).toBe('B');

    // 输出：两笔 event_id + 新投影版本 + D-24 生效提示
    const text = out.join('\n');
    expect(text).toContain(`authorization.locally_confirmed：${confirmed!.event_id}`);
    expect(text).toContain(`promotion.completed：${promotion!.event_id}`);
    expect(text).toContain('as_of=');
    expect(text).toContain('阶段迁移由事件折叠派生（D-24）');
  });

  it('--operation-id 指定执行非最新申请：仅目标 operation 产生推进事件', () => {
    const dir = tmpProject(
      changelogOf(
        initEnvelope(['A', 'B']),
        requestEnvelope('OP-A', 'A', 'B'),
        requestEnvelope('OP-B', 'A', 'B'),
      ),
    );
    const { io, out } = captureIo();
    const rc = runPromote(['--operation-id', 'OP-A'], io, dir, fixedDeps('y'));
    expect(rc).toBe(0);
    const finalEnvelopes = parseEventBlocks(readChangelog(dir)).envelopes;
    const promotions = finalEnvelopes.filter((e) => e.kind === 'promotion.completed');
    expect(promotions).toHaveLength(1);
    expect(promotions[0]!.operation_id).toBe('OP-A');
    expect(out.join('\n')).toContain('OP-A');
  });
});

/** 收据文件不应存在的断言辅助（拒绝路径零副作用） */
function existsNoReceipts(dir: string): boolean {
  return !readHasFile(join(dir, 'pm', 'receipts.jsonl')) && !readHasFile(join(dir, 'pm', 'receipts.anchor.json'));
}
function readHasFile(path: string): boolean {
  try {
    readFileSync(path, 'utf8');
    return true;
  } catch {
    return false;
  }
}
