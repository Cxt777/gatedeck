/**
 * 契约模板测试（T-M1-01）：五文件结构、语法可解析性、事件验真、D-24 断言、确定性、中文无损。
 * 全部为纯字符串断言，无 IO（core 测试不触碰文件系统）。
 */
import { describe, expect, it } from 'vitest';

import {
  buildContractBundle,
  buildInitEnvelope,
  TEMPLATE_VERSION,
  type ContractBundle,
  type ProjectSeed,
} from './contractTemplates.js';
import { isUlid, parseEventBlocks, reconstructEvents } from './eventEnvelope.js';
import { buildAnchor, buildReceiptChain } from './eventReceipt.js';
import { projectEventLog } from './eventLog.js';
import { auditProjectMarkdown } from './authorityRules.js';
import { foldStage } from './stageFold.js';
import { sha256Hex } from './hash.js';
import { parseFencedTaskBlocks } from './wbsSyntax.js';
import { getNodeField, updateTaskFieldById, validateWbsDocument } from './wbsKernel.js';

/** 基准种子：中文名/描述 + 固定时间与不透明身份（测试内固定字面值，非运行时生成） */
const BASE_SEED: ProjectSeed = {
  projectName: '门禁审核台',
  slug: 'gatedeck-demo',
  description: '决策台优先的项目管理工具：含全角冒号：、顿号与「引号」',
  initializedAt: '2026-10-24T08:30:00.000Z',
  initialStage: 'M0',
  actorId: '0123456789abcdef0123456789abcdef',
  sessionId: 'fedcba9876543210fedcba9876543210',
};

const cloneSeed = (patch: Partial<ProjectSeed>): ProjectSeed => ({ ...BASE_SEED, ...patch });

const bundleKeys = (bundle: ContractBundle): Array<keyof ContractBundle> =>
  Object.keys(bundle) as Array<keyof ContractBundle>;

describe('T-M1-01 · 五文件生成与关键结构', () => {
  it('五文件键齐全、非空且含各自关键结构；TEMPLATE_VERSION=1', () => {
    expect(TEMPLATE_VERSION).toBe(1);
    const bundle = buildContractBundle(BASE_SEED);
    expect(bundleKeys(bundle).sort()).toEqual(
      ['changelog.md', 'gates.md', 'insights.md', 'project.md', 'wbs.md'].sort(),
    );
    for (const k of bundleKeys(bundle)) {
      expect(bundle[k].length).toBeGreaterThan(0);
    }
    // project.md：项目名/slug/描述/初始化时间 + D-24 派生说明注释
    expect(bundle['project.md']).toContain('# 门禁审核台');
    expect(bundle['project.md']).toContain('- slug: gatedeck-demo');
    expect(bundle['project.md']).toContain('- 描述: 决策台优先的项目管理工具：含全角冒号：、顿号与「引号」');
    expect(bundle['project.md']).toContain('- 初始化时间: 2026-10-24T08:30:00.000Z');
    expect(bundle['project.md']).toContain('当前阶段：由事件折叠派生，不落本文件（D-24）');
    // gates.md：门禁表格（id/名称/条件/状态）+ 人工开启红线 + 初始阶段
    expect(bundle['gates.md']).toContain('| 门禁 id | 名称 | 条件清单 | 状态 |');
    expect(bundle['gates.md']).toContain('G-001');
    expect(bundle['gates.md']).toContain('🔒 未开启');
    expect(bundle['gates.md']).toContain('AI 不得代开');
    expect(bundle['gates.md']).toContain('## 阶段：M0');
    // changelog.md：人类说明示例注释 + gatedeck-event 事件块
    expect(bundle['changelog.md']).toContain('```gatedeck-event');
    expect(bundle['changelog.md']).toContain('人类说明示例');
    // insights.md：append-only 洞察/复盘区说明
    expect(bundle['insights.md']).toContain('append-only');
    expect(bundle['insights.md']).toContain('洞察');
  });

  it('wbs.md 示例节点被 parseFencedTaskBlocks 解析，且 wbsKernel 校验零诊断', () => {
    const wbs = buildContractBundle(BASE_SEED)['wbs.md'];
    const parsed = parseFencedTaskBlocks(wbs);
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.diagnostics).toEqual([]);
    const node = parsed.nodes[0]!;
    expect(getNodeField(node, 'id')).toBe('T-001');
    expect(getNodeField(node, 'title')).toBe('示例任务（模板占位，可编辑可删除）');
    expect(getNodeField(node, 'status')).toBe('todo');
    expect(node.fields.map((f) => f.key)).toEqual(['id', 'title', 'status', 'deps']);
    const validated = validateWbsDocument(wbs, parsed);
    expect(validated.diagnostics).toEqual([]);
    expect(validated.taskIds).toEqual(['T-001']);
  });

  it('wbs.md 示例节点支持内核局部修改且解析→重建一致（R-04 可编辑性）', () => {
    const wbs = buildContractBundle(BASE_SEED)['wbs.md'];
    const parsed = parseFencedTaskBlocks(wbs);
    const after = updateTaskFieldById(wbs, parsed, 'T-001', 'status', 'doing');
    expect(after).not.toBeNull();
    const reparsed = parseFencedTaskBlocks(after!);
    expect(reparsed.nodes).toHaveLength(1);
    expect(getNodeField(reparsed.nodes[0]!, 'status')).toBe('doing');
  });

  it('changelog.md 被 projectEventLog 解析出 1 笔 verified 事件（信封校验零诊断）', () => {
    const changelog = buildContractBundle(BASE_SEED)['changelog.md'];
    const parsed = parseEventBlocks(changelog);
    expect(parsed.envelopes).toHaveLength(1);
    expect(parsed.diagnostics).toEqual([]); // 无 missing-field/unknown-field，信封完整
    const env = parsed.envelopes[0]!;
    expect(env.kind).toBe('project.initialized');
    expect(env.origin).toBe('core');
    expect(env.integrity).toBe('verified');
    expect(env.payload['stage']).toBe('M0');
    expect(env.payload['template_version']).toBe(1);
    expect(env.actor.tool).toBe('gatedeck-cli');

    // 收据链与锚点从文档解析出的信封构建（与 T-M0a-04 加载路径同构），投影应判 verified
    const receipts = buildReceiptChain([env]);
    const anchor = buildAnchor(receipts, BASE_SEED.initializedAt);
    const projection = projectEventLog(changelog, receipts, anchor);
    expect(projection.entries).toHaveLength(1);
    const entry = projection.entries[0]!;
    expect(entry.status).toBe('verified');
    expect(entry.effectiveIntegrity).toBe('verified');
    expect(entry.eventId).toBe(env.event_id);
    expect(entry.seq).toBe(1);
    expect(entry.malformed).toBe(false);
    expect(projection.malformedCount).toBe(0);
    expect(projection.chainIssues).toEqual([]);
    expect(projection.needsAttention).toBe(false);
  });

  it('changelog.md 事件块解析→重建字节级一致（R-04 round-trip）', () => {
    const changelog = buildContractBundle(BASE_SEED)['changelog.md'];
    const parsed = parseEventBlocks(changelog);
    expect(reconstructEvents(changelog, parsed)).toBe(changelog);
  });

  it('foldStage 可从模板首笔事件派生初始阶段（payload.stage_order 契约，D-24）', () => {
    const env = buildInitEnvelope(BASE_SEED);
    const projection = foldStage([{ envelope: env, effectiveIntegrity: 'verified', seq: 1 }]);
    expect(projection.currentStage).toBe('M0'); // 初始阶段 = gates.md 首阶段
    expect(projection.stageOrder).toEqual(['M0']);
    expect(projection.diagnostics).toEqual([]);
    expect(projection.attention).toEqual([]);
  });
});

describe('T-M1-01 · D-24 断言与确定性', () => {
  it('project.md 不含「当前阶段: <具体值>」字段行——只有派生说明注释（D-24）', () => {
    const project = buildContractBundle(BASE_SEED)['project.md'];
    // 用既有 core 审计内核断言：无任何阶段类派生字段落盘
    expect(auditProjectMarkdown(project)).toEqual([]);
    // 行级断言：不存在以「当前阶段」为键的字段行（HTML 注释行以 <!-- 开头，不匹配）
    const fieldLineRe = /^[ \t]*(?:[-*][ \t]+)?当前阶段[ \t]*[:：]/;
    for (const line of project.split('\n')) {
      expect(line).not.toMatch(fieldLineRe);
    }
    // 且派生说明注释存在
    expect(project).toContain('当前阶段：由事件折叠派生，不落本文件（D-24）');
  });

  it('同 seed 确定性：两次生成五文件全等', () => {
    const a = buildContractBundle(BASE_SEED);
    const b = buildContractBundle(BASE_SEED);
    expect(a).toEqual(b);
    for (const k of bundleKeys(a)) {
      expect(a[k]).toBe(b[k]);
    }
  });

  it('不同 seed（slug 或 initializedAt 不同）产出不同 event_id', () => {
    const eventIdOf = (seed: ProjectSeed): string =>
      parseEventBlocks(buildContractBundle(seed)['changelog.md']).envelopes[0]!.event_id;
    const base = eventIdOf(BASE_SEED);
    expect(base).not.toBe('');
    expect(eventIdOf(cloneSeed({ slug: 'another-slug' }))).not.toBe(base);
    expect(eventIdOf(cloneSeed({ initializedAt: '2026-10-24T09:00:00.000Z' }))).not.toBe(base);
    expect(eventIdOf(BASE_SEED)).toBe(base); // 同 seed 复取一致
  });
});

describe('T-M1-01 · 信封契约细节与中文无损', () => {
  it('首笔事件信封满足 eventEnvelope schema：确定性 event_id/时间/actor/origin/integrity/subject/operation_id', () => {
    const env = buildInitEnvelope(BASE_SEED);
    // event_id：sha256(slug + initializedAt) 截断 26 位、ULID 形态；大写与解析规范化口径一致
    const expectedId = sha256Hex(BASE_SEED.slug + BASE_SEED.initializedAt).slice(0, 26).toUpperCase();
    expect(isUlid(env.event_id)).toBe(true);
    expect(env.event_id).toBe(expectedId);
    expect(env.schema_version).toBe('1');
    expect(env.occurred_at).toBe(BASE_SEED.initializedAt);
    expect(env.recorded_at).toBe(BASE_SEED.initializedAt);
    expect(env.actor.actor_id).toBe(BASE_SEED.actorId);
    expect(env.actor.session_id).toBe(BASE_SEED.sessionId);
    expect(env.actor.tool).toBe('gatedeck-cli');
    expect(env.actor.model).toBeUndefined(); // model=null 以缺省键表达（显式 null 会被解析层丢弃、破坏收据哈希复算）
    expect(env.origin).toBe('core');
    expect(env.integrity).toBe('verified');
    expect(env.subject.object_id).toBe(BASE_SEED.slug);
    expect(typeof env.operation_id).toBe('string'); // 由 event_id 派生、不与其相同
    expect(env.operation_id).not.toBe(env.event_id);
    expect(isUlid(env.operation_id ?? '')).toBe(true);
    expect(env.payload).toEqual({ stage: 'M0', stage_order: ['M0'], template_version: 1 });
  });

  it('中文项目名/描述/slug 往返无损：模板原文逐字保留，事件 subject 解析回读一致', () => {
    const seed = cloneSeed({
      projectName: '中文项目「名称」：含全角符号',
      slug: '门禁项目',
      description: '描述含中文、全角冒号：与（括号）、破折号——往返不得丢失',
    });
    const bundle = buildContractBundle(seed);
    expect(bundle['project.md']).toContain('# 中文项目「名称」：含全角符号');
    expect(bundle['project.md']).toContain('- 描述: 描述含中文、全角冒号：与（括号）、破折号——往返不得丢失');
    expect(bundle['gates.md']).toContain('## 阶段：M0');
    // wbs 中文标题 parse→回读无损
    const node = parseFencedTaskBlocks(bundle['wbs.md']).nodes[0]!;
    expect(getNodeField(node, 'title')).toBe('示例任务（模板占位，可编辑可删除）');
    // 事件 subject（slug）parse→回读无损
    const env = parseEventBlocks(bundle['changelog.md']).envelopes[0]!;
    expect(env.subject.object_id).toBe('门禁项目');
    // 事件块仍可验真（中文 slug 不影响收据链）
    const receipts = buildReceiptChain([env]);
    const projection = projectEventLog(
      bundle['changelog.md'],
      receipts,
      buildAnchor(receipts, seed.initializedAt),
    );
    expect(projection.entries[0]!.status).toBe('verified');
  });
});
