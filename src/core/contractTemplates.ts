/**
 * 契约模板 v1 + pm init 骨架生成（T-M1-01；基准 3.1/3.5/D-24/R-02/R-03/R-04）。
 *
 * 五文件（pm/ 目录，键名即落盘文件名）：
 *  - project.md  ：项目元信息唯一权威位置（基准 3.1 project-meta）；
 *                  当前阶段不落本文件，仅保留「由事件折叠派生」显式说明注释（D-24，
 *                  与 authorityRules.auditProjectMarkdown 的禁写名单对齐，模板产出零冲突）；
 *  - wbs.md      ：任务内容与状态唯一权威位置；示例节点用 T-M0a-02 定稿 fenced block 语法，
 *                  必须能被 parseFencedTaskBlocks 解析、被 wbsKernel 零诊断校验；
 *  - gates.md    ：门禁定义唯一权威位置；门禁人工开启，AI 不得代开（R-03），状态 🔒 未开启；
 *  - changelog.md：检查/授权/推进记录唯一权威位置（append-only，R-02）；首笔规范事件
 *                  project.initialized 按完整信封构造，块文本由 serializeEventBlock 生成——
 *                  与收据 content_hash（= sha256(规范序列化文本)，T-M0a-04）同源，
 *                  保证后续建收据链后 projectEventLog 可验真为 verified；
 *  - insights.md ：用量与活动原始记录唯一权威位置（append-only 洞察/复盘区）。
 *
 * event_id/operation_id 确定性派生：sha256 截断 26 位大写 hex（ULID 形态，isUlid 可过；
 * 同 seed 重跑生成同 id，重复写入由读取侧 B-13 幂等兜底；大写与 buildEnvelope 的
 * 规范化口径一致，保证收据按 event_id 可对上）。
 *
 * payload 契约说明：任务规格要求 { stage, template_version }；本实现额外携带
 * stage_order=[initialStage]——stageFold.ts:9-10 明确「payload.stage_order = gates.md 阶段序
 * （初始化时由 core 写入，fold 只消费）」，缺 stage_order 的初始化事件折叠将永久出
 * init-payload-invalid 且 append-only 不允许回填，故在模板期即按折叠契约写入。
 *
 * 纯字符串计算，无 IO、无时钟/随机（日期与身份由壳层注入 ProjectSeed，core 纯度约束）。
 */

import { sha256Hex } from './hash.js';
import {
  ENVELOPE_SCHEMA_VERSION,
  serializeEventBlock,
  type EventEnvelope,
} from './eventEnvelope.js';

/** 契约模板版本（结构演进时递增；随首笔事件 payload.template_version 落盘） */
export const TEMPLATE_VERSION = 1;

/** 初始化种子：时间与时钟无关字段全部由壳层注入（core 不取系统时间/随机数） */
export interface ProjectSeed {
  projectName: string;
  slug: string;
  description: string;
  /** ISO8601 带时区，壳层注入 */
  initializedAt: string;
  /** 初始阶段名（= gates.md 首阶段，D-24） */
  initialStage: string;
  actorId: string;
  sessionId: string;
}

/** pm/ 五文件契约包（键名即落盘文件名） */
export interface ContractBundle {
  'project.md': string;
  'wbs.md': string;
  'gates.md': string;
  'changelog.md': string;
  'insights.md': string;
}

/** 落盘写入顺序（init 逐文件写、写前逐文件存在性检查，R-06） */
export const BUNDLE_FILE_ORDER = [
  'project.md',
  'wbs.md',
  'gates.md',
  'changelog.md',
  'insights.md',
] as const;

/**
 * 确定性 event_id：sha256(slug + initializedAt) 前 26 位大写 hex。
 * 26 位 0-9A-F 满足 isUlid 的 Crockford Base32 判定（ULID 形态）；
 * 大写与 buildEnvelope 解析规范化（toUpperCase）一致，收据与文档两侧 event_id 必然相等。
 */
function deriveEventId(seed: ProjectSeed): string {
  return sha256Hex(seed.slug + seed.initializedAt).slice(0, 26).toUpperCase();
}

/**
 * 构造首笔规范事件信封（kind=project.initialized，origin=core，integrity=verified）。
 *
 * actor.model 按 EventActor 可选语义缺省（= null 的表达）：显式写入 model:null 会被
 * buildEnvelope 的 asOptionalString 丢弃，导致收据 content_hash 复算不一致，故以缺省表达。
 */
export function buildInitEnvelope(seed: ProjectSeed): EventEnvelope {
  const eventId = deriveEventId(seed);
  return {
    event_id: eventId,
    schema_version: ENVELOPE_SCHEMA_VERSION,
    kind: 'project.initialized',
    occurred_at: seed.initializedAt,
    recorded_at: seed.initializedAt,
    actor: { actor_id: seed.actorId, session_id: seed.sessionId, tool: 'gatedeck-cli' },
    origin: 'core',
    integrity: 'verified',
    subject: { object_id: seed.slug },
    operation_id: sha256Hex(`operation|${eventId}`).slice(0, 26).toUpperCase(),
    payload: {
      stage: seed.initialStage,
      stage_order: [seed.initialStage],
      template_version: TEMPLATE_VERSION,
    },
  };
}

/** project.md：元信息唯一权威 + D-24 派生说明注释（不落阶段字段行） */
function buildProjectMd(seed: ProjectSeed): string {
  return [
    `# ${seed.projectName}`,
    '',
    '<!-- 本文件是项目元信息（project-meta）的唯一权威位置（基准 3.1）；由 gatedeck init 生成（契约模板 v1）。 -->',
    '',
    `- slug: ${seed.slug}`,
    `- 描述: ${seed.description}`,
    `- 初始化时间: ${seed.initializedAt}`,
    '',
    '<!-- 当前阶段：由事件折叠派生，不落本文件（D-24）。 -->',
    '',
    '<!-- 提示：当前阶段/任务时间语义等可推导事实请勿写入本文件，落盘即重复存储并告警（基准 3.1/3.3）。 -->',
    '',
  ].join('\n');
}

/** wbs.md：语法说明注释 + 1 个示例任务节点（parseFencedTaskBlocks 可解析、wbsKernel 零诊断） */
function buildWbsMd(): string {
  return [
    '# 工作分解（wbs.md）',
    '',
    '<!-- 任务节点语法（T-M0a-02 定稿）：gatedeck-task 围栏块，字段一行式「key: value」；',
    '     必需字段 id/title/status，status 取值 todo/doing/done/blocked/dropped（双语并列以英文为准）；',
    '     deps 逗号分隔引用其他任务 id；未知字段原样保留并出诊断（F-06），不驱动受管状态。 -->',
    '',
    '## 任务列表',
    '',
    '### T-001 示例任务',
    '',
    '```gatedeck-task',
    'id: T-001',
    'title: 示例任务（模板占位，可编辑可删除）',
    'status: todo',
    'deps:',
    '```',
    '',
    '<!-- 提示：新增任务复制上述围栏块并替换字段；块外为人类说明自由文本，机器不解析。 -->',
    '',
  ].join('\n');
}

/** gates.md：初始阶段门禁一个（id/名称/条件清单/状态表格）+ 人工开启说明注释 */
function buildGatesMd(seed: ProjectSeed): string {
  return [
    '# 门禁（gates.md）',
    '',
    '<!-- 门禁定义唯一权威位置（基准 3.1 gate-definition）；由 gatedeck init 生成（契约模板 v1）。',
    '     门禁由主理人人工开启（授权有痕，R-03）：AI 不得代开、不得自动推进阶段；开启须在 changelog 留 authorization.* 事件。',
    '     状态取值：🔒 未开启 ／ ✅ 已开启。 -->',
    '',
    `## 阶段：${seed.initialStage}`,
    '',
    '| 门禁 id | 名称 | 条件清单 | 状态 |',
    '| --- | --- | --- | --- |',
    `| G-001 | ${seed.initialStage} 出口门禁 | 条件一：（由主理人填写）；条件二：（由主理人填写） | 🔒 未开启 |`,
    '',
    '<!-- 说明：上表为初始阶段门禁骨架；后续阶段门禁由主理人按同一表结构追加，阶段序即推进顺序（stage_order）。 -->',
    '',
  ].join('\n');
}

/** changelog.md：人类说明区示例注释 + 首笔规范事件块（serializeEventBlock 生成，收据同源） */
function buildChangelogMd(eventBlock: string): string {
  return [
    '# 变更日志（changelog.md）',
    '',
    '<!-- 本文件是检查/授权/破例/阶段推进记录的唯一权威位置（基准 3.1 check-records），append-only（R-02）：只追加、不改写历史。 -->',
    '',
    '<!-- 人类说明示例：在事件块外写自由文本（如「主理人人工开启 G-001」），不驱动状态（基准 3.5/R-09）。 -->',
    '',
    '<!-- 以下为首笔规范事件：项目初始化（project.initialized）；块文本由 serializeEventBlock 生成，收据链建立后即可验真。 -->',
    '',
    eventBlock,
  ].join('\n');
}

/** insights.md：append-only 洞察/复盘区说明注释 */
function buildInsightsMd(): string {
  return [
    '# 洞察与复盘（insights.md）',
    '',
    '<!-- append-only 洞察/复盘区（R-02）：只追加、不改写历史；本文件同时是用量与活动原始记录的唯一权威位置（基准 3.1 usage-records）。 -->',
    '',
    '<!-- 用法：洞察/复盘的人类说明写在事件块外自由文本；机器事件用 gatedeck-event 围栏块（与 changelog.md 同语法）。 -->',
    '',
  ].join('\n');
}

/** 生成 pm/ 五文件契约包（确定性：同 seed 两次调用产出字节全等） */
export function buildContractBundle(seed: ProjectSeed): ContractBundle {
  const eventBlock = serializeEventBlock(buildInitEnvelope(seed));
  return {
    'project.md': buildProjectMd(seed),
    'wbs.md': buildWbsMd(),
    'gates.md': buildGatesMd(seed),
    'changelog.md': buildChangelogMd(eventBlock),
    'insights.md': buildInsightsMd(),
  };
}
