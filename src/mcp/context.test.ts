/**
 * gatedeck-mcp 上下文装配测试（W-S3-1）。
 *
 * 只测可测纯函数 assembleProjectContext（从已读文本到 ProjectContext）与
 * resolveProjectContext 的存在性分支（IO 最小化验证）：
 *  - 完整数据（任务/事件/收据/用量/元信息/注册表全链路，含 verified 收据验真）；
 *  - 缺文件降级（不阻塞只读投影，notes 如实注明，W-06）；
 *  - 空事件流（计数为零、阶段未派生）；
 *  - decisionBoard 集成（归区与计数；unverified 事件不驱动状态，P-09）；
 *  - 版本戳透传（as_of=末笔参与事件 recorded_at；sourceVersion=参与笔数，T-M0b-06）；
 *  - not-initialized（pm/ 缺失）与 IO 薄壳 happy path；
 *  - 无法解析块（malformed → external-unverified + 需处理，S2.1-04）。
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { buildAnchor, buildReceiptChain, type EventReceipt, type ReceiptAnchor } from '../core/eventReceipt.js';
import { parseEventBlocks } from '../core/eventEnvelope.js';
import {
  assembleProjectContext,
  resolveProjectContext,
  type PmTexts,
} from './context.js';

/* ---------------------------------------------------------------- *
 * 夹具构造
 * ---------------------------------------------------------------- */

/** 规范事件块（字段一行式）；kind/origin/payload 由参数注入 */
function eventBlock(fields: Record<string, string>): string {
  return ['```gatedeck-event', ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), '```', ''].join('\n');
}

const ACTOR = '{"actor_id":"actor-1","session_id":"session-1"}';
const SUBJECT_PROJECT = '{"object_id":"project:demo"}';
const NOW = '2026-10-24T08:00:00Z';

/** project.initialized 事件（stage_order 供折叠派生初始阶段） */
function initEvent(recordedAt: string): string {
  return eventBlock({
    event_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    schema_version: '1',
    kind: 'project.initialized',
    occurred_at: recordedAt,
    recorded_at: recordedAt,
    actor: ACTOR,
    origin: 'core',
    integrity: 'verified',
    subject: SUBJECT_PROJECT,
    payload: '{"stage":"阶段一","stage_order":["阶段一","阶段二"],"template_version":1}',
  });
}

/** 用量上报事件（managed-api；不入收据链，读取侧如实为 external-unverified） */
const USAGE_EVENT = eventBlock({
  event_id: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
  schema_version: '1',
  kind: 'usage.reported',
  occurred_at: '2026-10-24T09:00:00Z',
  recorded_at: '2026-10-24T09:00:00Z',
  actor: ACTOR,
  origin: 'managed-api',
  integrity: 'unknown',
  subject: '{"object_id":"session:session-1"}',
  payload: '{"model":"glm-5.3-flash","input_tokens":120,"output_tokens":45}',
});

function taskBlock(fields: Record<string, string>): string {
  return ['```gatedeck-task', ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), '```', ''].join('\n');
}

/** 三任务 wbs：done / doing（带 gate 与 owner）/ todo（deps 指向已完成任务） */
const WBS_FULL = [
  '# 工作分解',
  '',
  taskBlock({ id: 'T-X-01', title: '任务一（已完成）', status: 'done' }),
  taskBlock({ id: 'T-X-02', title: '任务二（进行中）', status: 'doing', owner: 'alice', gate: '阶段一' }),
  taskBlock({ id: 'T-X-03', title: '任务三（可领取）', status: 'todo', deps: 'T-X-01', acceptance: '验收说明', scope: '范围说明' }),
].join('\n');

const PROJECT_MD = ['# 示例项目', '', '- slug: demo', '- 描述: 决策台式 PM 演示项目', ''].join('\n');

const GATES_MD = '# 门禁定义\n\n<!-- 状态 🔒 未开启 -->\n';

/** 注册表（native provider 表格，workspace_id 为合法 ULID） */
const REGISTRY_MD = [
  '# 一休PM · 注册表（native provider）',
  '',
  '| project_id | workspace_id | slug | display_name | managed | registered_at |',
  '|---|---|---|---|---|---|',
  '| p1 | 01ARZ3NDEKTSV4RRFFQ69G5FAW | demo | 示例项目 | true | 2026-10-24T08:00:00Z |',
  '',
].join('\n');

/** 给定 changelog 文本，构造可验真的收据库 JSONL 与锚点（core 既有导出，同源口径） */
function buildReceiptFixtures(changelogMd: string): { receiptsJsonl: string; anchorJson: string } {
  const envelopes = parseEventBlocks(changelogMd).envelopes;
  const receipts: EventReceipt[] = buildReceiptChain(envelopes);
  const anchor: ReceiptAnchor = buildAnchor(receipts, NOW);
  return {
    receiptsJsonl: receipts.map((r) => JSON.stringify(r)).join('\n') + '\n',
    anchorJson: JSON.stringify(anchor),
  };
}

/* ---------------------------------------------------------------- *
 * 用例
 * ---------------------------------------------------------------- */

describe('assembleProjectContext（上下文纯函数装配）', () => {
  it('完整数据：任务/事件验真/阶段派生/决策台归区/用量/元信息/注册表全链路', () => {
    const changelog = initEvent('2026-10-24T07:00:00Z');
    const { receiptsJsonl, anchorJson } = buildReceiptFixtures(changelog);
    const texts: PmTexts = {
      wbs: WBS_FULL,
      changelog,
      insights: USAGE_EVENT,
      project: PROJECT_MD,
      gates: GATES_MD,
      receipts: receiptsJsonl,
      anchor: anchorJson,
      registry: REGISTRY_MD,
    };
    const ctx = assembleProjectContext(texts, NOW);

    // 任务投影：字段与行号
    expect(ctx.tasks.map((t) => t.id)).toEqual(['T-X-01', 'T-X-02', 'T-X-03']);
    expect(ctx.tasks[1]).toMatchObject({ status: 'doing', stage: '阶段一', owner: 'alice' });
    expect(ctx.tasks[2]).toMatchObject({ deps: ['T-X-01'], acceptance: '验收说明', scope: '范围说明' });
    expect(ctx.tasks[0]!.line).toBeGreaterThan(0);

    // 事件验真：init 事件经收据链 + 锚点 → verified
    expect(ctx.events).toMatchObject({ verified: 1, unverified: 0, invalid: 0, malformed: 0, needsAttention: false });
    expect(ctx.needsAttention).toEqual([]);
    expect(ctx.diagnostics).toEqual([]);

    // 阶段派生与版本戳透传（T-M0b-06：as_of=末笔参与事件 recorded_at，源版本=参与笔数）
    expect(ctx.stage.currentStage).toBe('阶段一');
    expect(ctx.stage.stageOrder).toEqual(['阶段一', '阶段二']);
    expect(ctx.stage.asOf).toBe('2026-10-24T07:00:00Z');
    expect(ctx.stage.sourceVersion).toBe(1);

    // 决策台归区（core decideBoard）：doing→进行中，todo+前置满足→可以推进，done 不入墙
    expect(ctx.board.counts).toEqual({ 'awaiting-decision': 0, 'needs-attention': 0, 'can-proceed': 1, 'in-progress': 1 });
    expect(ctx.board.asOf).toBe('2026-10-24T07:00:00Z');
    expect(ctx.board.sourceVersion).toBe(1);

    // 用量聚合（usage.reported 最小口径）
    expect(ctx.usage.events).toBe(1);
    expect(ctx.usage.byModel).toEqual({ 'glm-5.3-flash': 1 });
    expect(ctx.usage.inputTokens).toBe(120);
    expect(ctx.usage.outputTokens).toBe(45);

    // 元信息与注册表
    expect(ctx.project).toEqual({ name: '示例项目', slug: 'demo', description: '决策台式 PM 演示项目' });
    expect(ctx.registry.source).toBe('registry.md');
    expect(ctx.registry.projects).toHaveLength(1);
    expect(ctx.registry.projects[0]).toMatchObject({ slug: 'demo', managed: true });

    // 观察时间透传（时钟只由调用方注入）
    expect(ctx.observedAt).toBe(NOW);
    // 门禁面：T-M1-04 前如实提示
    expect(ctx.gates.note).toContain('T-M1-04');
    expect(ctx.gates.currentStage).toBe('阶段一');
  });

  it('缺文件降级：仅 wbs 时按空装配 + notes 如实注明，不阻塞不抛错（W-06）', () => {
    const ctx = assembleProjectContext({ wbs: WBS_FULL }, NOW);
    expect(ctx.tasks).toHaveLength(3);
    expect(ctx.stage.currentStage).toBeNull();
    // 归区不依赖阶段派生：doing→进行中；todo 未标阶段→前置满足即可推进（decisionBoard 规则④）
    expect(ctx.board.counts).toEqual({ 'awaiting-decision': 0, 'needs-attention': 0, 'can-proceed': 1, 'in-progress': 1 });
    expect(ctx.events).toMatchObject({ verified: 0, unverified: 0, invalid: 0 });
    expect(ctx.notes.some((n) => n.includes('changelog.md 缺失'))).toBe(true);
    expect(ctx.notes.some((n) => n.includes('insights.md 缺失'))).toBe(true);
    expect(ctx.notes.some((n) => n.includes('project.md 缺失'))).toBe(true);
    expect(ctx.registry.source).toBe('self');
  });

  it('空事件流：changelog 存在但无事件块 → 计数为零、收据缺失注明、阶段未派生', () => {
    const ctx = assembleProjectContext({ changelog: '# 变更记录\n\n（暂无事件）\n' }, NOW);
    expect(ctx.events).toMatchObject({ verified: 0, unverified: 0, invalid: 0, malformed: 0, needsAttention: false });
    expect(ctx.stage.currentStage).toBeNull();
    expect(ctx.stage.sourceVersion).toBe(0);
    expect(ctx.stage.asOf).toBeNull();
    expect(ctx.needsAttention).toEqual([]);
    expect(ctx.notes.some((n) => n.includes('receipts.jsonl'))).toBe(true);
  });

  it('decisionBoard 集成：blocked 入需关注；unverified 事件不驱动状态（P-09）且不算链级异常', () => {
    const wbs = [
      taskBlock({ id: 'T-Y-01', title: '阻塞任务', status: 'blocked' }),
      taskBlock({ id: 'T-Y-02', title: '前置未完成任务', status: 'todo', deps: 'T-Y-01' }),
    ].join('\n');
    // 事件未入收据库 → external-unverified（不参与推导，也不是链级问题）
    const changelog = [
      eventBlock({
        event_id: '01ARZ3NDEKTSV4RRFFQ69G5FC1',
        schema_version: '1',
        kind: 'task.transitioned',
        occurred_at: '2026-10-24T07:00:00Z',
        recorded_at: '2026-10-24T07:00:00Z',
        actor: ACTOR,
        origin: 'core',
        integrity: 'verified',
        subject: '{"object_id":"task:T-Y-01"}',
        payload: '{"to":"doing"}',
      }),
    ].join('\n');
    const ctx = assembleProjectContext({ wbs, changelog }, NOW);

    expect(ctx.events).toMatchObject({ verified: 0, unverified: 1, invalid: 0 });
    expect(ctx.stage.currentStage).toBeNull(); // unverified 不驱动状态
    expect(ctx.stage.sourceVersion).toBe(0); // 不计入参与推导笔数
    expect(ctx.needsAttention).toEqual([]); // 未登记≠链级问题，不算需处理

    const zones = new Map(ctx.board.items.map((i) => [i.zone, i]));
    expect(zones.get('needs-attention')?.task?.id).toBe('T-Y-01');
    expect(zones.has('can-proceed')).toBe(false); // 前置 blocked 未满足
    expect(ctx.board.counts['needs-attention']).toBe(1);
  });

  it('版本戳透传：两笔 verified 参与事件 → sourceVersion=2、as_of=末笔 recorded_at', () => {
    const changelog = [
      initEvent('2026-10-24T07:00:00Z'),
      eventBlock({
        event_id: '01ARZ3NDEKTSV4RRFFQ69G5FD2',
        schema_version: '1',
        kind: 'check.completed',
        occurred_at: '2026-10-24T07:30:00Z',
        recorded_at: '2026-10-24T07:31:00Z',
        actor: ACTOR,
        origin: 'core',
        integrity: 'verified',
        subject: '{"object_id":"gate:阶段一"}',
        payload: '{"validation_status":"passed"}',
      }),
    ].join('\n');
    const { receiptsJsonl, anchorJson } = buildReceiptFixtures(changelog);
    const ctx = assembleProjectContext({ changelog, receipts: receiptsJsonl, anchor: anchorJson }, NOW);
    expect(ctx.events.verified).toBe(2);
    expect(ctx.stage.sourceVersion).toBe(2);
    expect(ctx.stage.asOf).toBe('2026-10-24T07:31:00Z'); // B-16：as_of 取参与事件 recorded_at
    expect(ctx.board.sourceVersion).toBe(2);
  });

  it('malformed 块：无法解析事件按 external-unverified 处理并进入需处理（S2.1-04）', () => {
    // 缺 event_id → 信封不成立 → external-unverified + malformed
    const changelog = eventBlock({
      schema_version: '1',
      kind: 'note',
      occurred_at: '2026-10-24T07:00:00Z',
      recorded_at: '2026-10-24T07:00:00Z',
      actor: ACTOR,
      origin: 'managed-api',
      integrity: 'unknown',
      subject: SUBJECT_PROJECT,
      payload: '{}',
    });
    const ctx = assembleProjectContext({ changelog }, NOW);
    expect(ctx.events.unverified).toBe(1);
    expect(ctx.events.malformed).toBe(1);
    expect(ctx.events.needsAttention).toBe(true);
    expect(ctx.needsAttention.some((a) => a.source === 'changelog' && a.message.includes('无法解析'))).toBe(true);
  });

  it('收据库坏行：跳过并进入需处理明细，不静默吞掉（W-06）', () => {
    const changelog = initEvent('2026-10-24T07:00:00Z');
    const { receiptsJsonl, anchorJson } = buildReceiptFixtures(changelog);
    const ctx = assembleProjectContext(
      { changelog, receipts: `${receiptsJsonl}这不是JSON\n`, anchor: anchorJson },
      NOW,
    );
    expect(ctx.needsAttention.some((a) => a.source === 'receipts' && a.message.includes('不是合法 JSON'))).toBe(true);
  });
});

describe('resolveProjectContext（IO 薄壳：存在性分支最小验证）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gatedeck-mcp-ctx-'));

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('pm/ 缺失 → not-initialized（未初始化不是成功态，W-06）', () => {
    const ctx = resolveProjectContext(dir, NOW);
    expect(ctx).toMatchObject({ ok: false, error: 'not-initialized' });
    if (!ctx.ok) expect(ctx.hint).toContain('gatedeck init');
  });

  it('pm/ 存在 → ok=true 且读到 wbs 任务（IO 薄壳 happy path）', () => {
    const pmDir = join(dir, 'pm-proj', 'pm');
    mkdirSync(pmDir, { recursive: true });
    writeFileSync(join(pmDir, 'wbs.md'), WBS_FULL, 'utf8');
    const ctx = resolveProjectContext(join(dir, 'pm-proj'), NOW);
    expect(ctx.ok).toBe(true);
    if (ctx.ok) {
      expect(ctx.rootDir).toBe(join(dir, 'pm-proj'));
      expect(ctx.tasks.map((t) => t.id)).toEqual(['T-X-01', 'T-X-02', 'T-X-03']);
      expect(ctx.observedAt).toBe(NOW);
    }
  });
});
