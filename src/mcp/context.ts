/**
 * gatedeck-mcp 项目上下文装配（W-S3-1）。
 *
 * 分层：
 *  - resolveProjectContext(rootDir, nowIso)：IO 薄壳——只做 pm/ 文件读取与存在性判断，
 *    读到的文本原样交给纯函数装配（本工作区为 projects-index provider，不产生 .gatedeck/）；
 *  - assembleProjectContext(texts, nowIso)：**可测纯函数**——从已读文本到 ProjectContext，
 *    装配口径与 cli deck（W-S2-6）逐项对齐，业务判定一律调 core 既有导出：
 *      任务：parseFencedTaskBlocks + wbsKernel.validateWbsDocument（缺必需字段/status 非法
 *            的节点不入任务列表，诊断如实附列）；
 *      阶段：eventLog.projectEventLog（事件状态裁定：verified/external-unverified/invalid）
 *            → stageFold.foldStage（只按可信 sequence 折叠，P-09/B-16）；
 *      决策台：decisionBoard.decideBoard（四条规则归区，门禁以空装配——T-M1-04 未接入）；
 *      用量：insights.md 的 usage.reported 事件聚合（无数据如实为空，W-06）。
 *  - 数据不全（如 changelog 缺失）不阻塞只读投影：按空装配 + notes 注明，未知与缺失
 *    如实展示、不编造（W-06）。
 *
 * 时钟：nowIso 由调用方注入（server.ts 顶层注入），本文件不取系统时间。
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { parseEventBlocks } from '../core/eventEnvelope.js';
import { projectEventLog } from '../core/eventLog.js';
import type { EventReceipt, ReceiptAnchor } from '../core/eventReceipt.js';
import {
  decideBoard,
  type BoardProjection,
  type BoardTask,
  type BoardTaskStatus,
} from '../core/decisionBoard.js';
import { parseNativeRegistry, type NativeRegistryEntry } from '../core/registry.js';
import { foldStage, type FoldEvent, type StageProjection } from '../core/stageFold.js';
import {
  getNodeField,
  validateWbsDocument,
  WBS_STATUS_VALUES,
  type WbsStatus,
} from '../core/wbsKernel.js';
import { parseFencedTaskBlocks, type WbsNode } from '../core/wbsSyntax.js';

/* ---------------------------------------------------------------- *
 * 上下文形状
 * ---------------------------------------------------------------- */

/** wbs.md 任务的上下文投影（get_wbs/get_task/query 的数据面） */
export interface TaskRecord {
  id: string;
  title: string;
  status: WbsStatus;
  /** 前置任务 id（逗号分隔字段的拆分结果；空为 []） */
  deps: string[];
  /** 任务所属阶段（节点 gate 字段；未标为 undefined，与 foldStage.currentStage 同命名空间） */
  stage?: string;
  owner?: string;
  acceptance?: string;
  scope?: string;
  /** 节点在 wbs.md 中的 1-based 起始行（供 AI 引用原文位置） */
  line: number;
}

/** 解析诊断（来源 + 代码 + 消息 + 可选行号），如实附列不静默（W-06） */
export interface DiagnosticLine {
  source: string;
  code: string;
  message: string;
  line?: number;
}

/** 「需处理」明细行（foldStage.attention + 收据解析异常 + 无法解析块，B-11 口径） */
export interface AttentionLine {
  source: string;
  message: string;
}

/** changelog 事件计数（unverified 对应 eventLog 的 external-unverified 三态口径） */
export interface EventCounters {
  verified: number;
  unverified: number;
  invalid: number;
  /** 信封存在致命缺陷的块数（对外状态仍为 external-unverified） */
  malformed: number;
}

/** insights 用量汇总（usage.reported 事件聚合；无数据如实为零值） */
export interface UsageSummary {
  /** usage.reported 事件笔数 */
  events: number;
  /** 按模型计数（payload.model 为非空字符串时计入） */
  byModel: Record<string, number>;
  /** 输入 token 累计（payload.input_tokens 为数值时计入，P-08 不猜其他字段名） */
  inputTokens: number;
  /** 输出 token 累计（payload.output_tokens 为数值时计入） */
  outputTokens: number;
  /** 聚合口径说明（T-M2a-05 用量契约定稿前为最小实现） */
  note: string;
}

/** 注册表摘要（list_projects 数据面；M1 最小实现） */
export interface RegistrySummary {
  source: 'registry.md' | 'self';
  projects: Array<
    Pick<NativeRegistryEntry, 'project_id' | 'workspace_id' | 'slug' | 'display_name' | 'managed' | 'registered_at'>
  >;
  note: string;
}

/** 已装配上下文（ok=true 分支的载荷） */
export interface AssembledProjectContext {
  /** 投影观察时间（调用方注入时钟，只记不回填——T-M0b-07 observed_at 口径） */
  observedAt: string;
  project: { name: string | null; slug: string | null; description: string | null };
  tasks: TaskRecord[];
  diagnostics: DiagnosticLine[];
  /** 数据说明（缺失文件等，W-06 如实展示） */
  notes: string[];
  /** 阶段折叠投影（as_of/sourceVersion/attention/diagnostics 内建） */
  stage: StageProjection;
  /** 需处理明细（链级 + 折叠 + 收据异常 + 无法解析块），非空即投影进入需处理状态 */
  needsAttention: AttentionLine[];
  /** 决策台投影（四区条目 + 计数 + as_of + 源版本戳） */
  board: BoardProjection;
  /** 门禁面（T-M1-04 前：仅阶段投影 + 提示，与 cli deck 口径一致） */
  gates: { currentStage: string | null; stageOrder: readonly string[] | null; note: string };
  /** changelog 事件计数与需处理标记 */
  events: EventCounters & { needsAttention: boolean };
  usage: UsageSummary;
  registry: RegistrySummary;
}

/** 上下文总形态：pm/ 缺失 → not-initialized（不是成功态，W-06） */
export type ProjectContext =
  | ({ ok: true; rootDir: string } & AssembledProjectContext)
  | { ok: false; error: 'not-initialized'; hint: string };

/** resolveProjectContext 读入的文本包（键名即 pm/ 文件名语义；IO 层产出，纯函数消费） */
export interface PmTexts {
  wbs?: string;
  changelog?: string;
  insights?: string;
  project?: string;
  gates?: string;
  /** 收据库（pm/receipts.jsonl，每行一个 EventReceipt） */
  receipts?: string;
  /** 本地锚点（pm/receipts.anchor.json） */
  anchor?: string;
  /** 项目注册表（.gatedeck/registry.md，可选——跨项目 M2 再扩） */
  registry?: string;
  /** IO 层读文件失败记录（键同上；按缺失处理并如实注明，W-06） */
  readErrors?: Partial<Record<'wbs' | 'changelog' | 'insights' | 'project' | 'gates' | 'receipts' | 'anchor' | 'registry', string>>;
}

/* ---------------------------------------------------------------- *
 * 纯函数装配
 * ---------------------------------------------------------------- */

const STATUS_SET: ReadonlySet<string> = new Set<string>(WBS_STATUS_VALUES);

/** 项目元信息解析结果 */
interface ProjectMeta {
  name: string | null;
  slug: string | null;
  description: string | null;
}

/** 解析 project.md 元信息（契约模板口径：`# 名称` + `- slug: x` + `- 描述: y`） */
function parseProjectMeta(md: string): ProjectMeta {
  const meta: ProjectMeta = { name: null, slug: null, description: null };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (meta.name === null && line.startsWith('# ')) {
      meta.name = line.slice(2).trim() || null;
      continue;
    }
    const slug = /^-\s*slug:\s*(.+)$/.exec(line);
    if (slug !== null && meta.slug === null) {
      meta.slug = slug[1]!.trim() || null;
      continue;
    }
    const desc = /^-\s*描述:\s*(.+)$/.exec(line);
    if (desc !== null && meta.description === null) {
      meta.description = desc[1]!.trim() || null;
    }
  }
  return meta;
}

/** 收据库 JSONL 解析（与 cli deck 同口径）：坏行跳过并记错误，不静默吞掉（W-06） */
function parseReceiptsJsonl(text: string): { receipts: EventReceipt[]; errors: string[] } {
  const receipts: EventReceipt[] = [];
  const errors: string[] = [];
  for (const [idx, line] of text.split(/\r?\n/).entries()) {
    if (line.trim() === '') continue;
    try {
      receipts.push(JSON.parse(line) as EventReceipt);
    } catch {
      errors.push(`收据库第 ${idx + 1} 行不是合法 JSON，已跳过（pm/receipts.jsonl）`);
    }
  }
  return { receipts, errors };
}

/** 单节点在文档中的 1-based 起始行 */
function nodeStartLine(md: string, rawSpan: { start: number }): number {
  return md.slice(0, rawSpan.start).split('\n').length;
}

/** 字段值 trim；空串归 undefined（exactOptionalPropertyTypes 下按条件展开） */
function optionalField(node: WbsNode, key: string): string | undefined {
  const v = getNodeField(node, key)?.trim();
  return v !== undefined && v !== '' ? v : undefined;
}

/**
 * 从已读文本装配 ProjectContext（**纯函数**，无 IO、无时钟——nowIso 由参数注入）。
 * 装配口径与 cli deck 逐项对齐；core 判定一律调既有导出，本函数只做粘合与如实标注。
 */
export function assembleProjectContext(texts: PmTexts, nowIso: string): AssembledProjectContext {
  const notes: string[] = [];
  const diagnostics: DiagnosticLine[] = [];
  const needsAttention: AttentionLine[] = [];

  // IO 层读文件失败的如实转记（W-06：读取失败 ≠ 文件缺失，都要说清）
  for (const [key, message] of Object.entries(texts.readErrors ?? {})) {
    if (message !== undefined) notes.push(`pm 层文件读取失败（${key}）：${message}（按缺失处理）`);
  }

  // —— 任务：pm/wbs.md ——
  const tasks: TaskRecord[] = [];
  const boardTasks: BoardTask[] = [];
  if (texts.wbs === undefined) {
    notes.push('pm/wbs.md 缺失：任务数据为空。');
  } else {
    const parsed = parseFencedTaskBlocks(texts.wbs, 'gatedeck-task');
    const validation = validateWbsDocument(texts.wbs, parsed);
    for (const node of parsed.nodes) {
      const id = getNodeField(node, 'id')?.trim();
      const title = getNodeField(node, 'title')?.trim();
      const status = getNodeField(node, 'status')?.trim();
      // 缺必需字段 / status 非法的节点不入任务列表（诊断如实展示，不编造状态）
      if (id === undefined || id === '' || title === undefined || title === '' || status === undefined || !STATUS_SET.has(status)) {
        continue;
      }
      const deps = (getNodeField(node, 'deps') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '');
      const stage = optionalField(node, 'gate');
      const owner = optionalField(node, 'owner');
      const acceptance = optionalField(node, 'acceptance');
      const scope = optionalField(node, 'scope');
      tasks.push({
        id,
        title,
        status: status as WbsStatus,
        deps,
        line: nodeStartLine(texts.wbs, node.rawSpan),
        ...(stage !== undefined ? { stage } : {}),
        ...(owner !== undefined ? { owner } : {}),
        ...(acceptance !== undefined ? { acceptance } : {}),
        ...(scope !== undefined ? { scope } : {}),
      });
      const boardTask: BoardTask = { id, title, status: status as BoardTaskStatus, deps };
      if (stage !== undefined) boardTask.stage = stage;
      boardTasks.push(boardTask);
    }
    for (const d of [...parsed.diagnostics, ...validation.diagnostics]) {
      diagnostics.push({
        source: 'wbs',
        code: d.code,
        message: d.message,
        ...(typeof d.line === 'number' ? { line: d.line } : {}),
      });
    }
  }

  // —— 阶段与事件：pm/changelog.md + 收据库 + 锚点 ——
  let stage: StageProjection;
  const counters: EventCounters = { verified: 0, unverified: 0, invalid: 0, malformed: 0 };
  let eventsNeedsAttention = false;
  if (texts.changelog === undefined) {
    notes.push('pm/changelog.md 缺失：事件流为空，阶段无法派生。');
    stage = foldStage([], {});
  } else {
    const parsedEvents = parseEventBlocks(texts.changelog);
    const envelopes = parsedEvents.envelopes;
    for (const d of parsedEvents.diagnostics) {
      diagnostics.push({ source: 'changelog', code: d.code, message: d.message, line: d.line });
    }
    let receipts: EventReceipt[] = [];
    let anchor: ReceiptAnchor | null = null;
    if (texts.receipts === undefined) {
      notes.push('收据库未找到（pm/receipts.jsonl）：changelog 事件暂无来源验证，均不参与状态推导。');
    } else {
      const read = parseReceiptsJsonl(texts.receipts);
      receipts = read.receipts;
      for (const e of read.errors) needsAttention.push({ source: 'receipts', message: e });
    }
    if (texts.anchor !== undefined) {
      try {
        anchor = JSON.parse(texts.anchor) as ReceiptAnchor;
      } catch (e) {
        needsAttention.push({
          source: 'receipts',
          message: `锚点文件解析失败（pm/receipts.anchor.json）：${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }

    // 事件状态裁定（core：信封 schema + 收据链 + 锚点，一步完成）
    const log = projectEventLog(texts.changelog, receipts, anchor);
    for (const entry of log.entries) {
      if (entry.status === 'verified') counters.verified++;
      else if (entry.status === 'invalid') counters.invalid++;
      else counters.unverified++;
    }
    counters.malformed = log.malformedCount;
    eventsNeedsAttention = log.needsAttention;

    // 折叠输入：entries（eventId 非空）与 envelopes 同文档序一一对应；
    // effectiveIntegrity 三态映射：unknown（未登记/无法验证）→ unregistered（不参与推导，P-09）
    const foldEvents: FoldEvent[] = [];
    let envIdx = 0;
    for (const entry of log.entries) {
      if (entry.eventId === null) continue; // 无法解析块无信封，不参与折叠
      const envelope = envelopes[envIdx];
      envIdx++;
      if (envelope === undefined) break; // 理论不可达（同一文本同一解析）；防御性截断
      foldEvents.push({
        envelope,
        effectiveIntegrity:
          entry.effectiveIntegrity === 'verified'
            ? 'verified'
            : entry.effectiveIntegrity === 'invalid'
              ? 'invalid'
              : 'unregistered',
        ...(entry.seq !== undefined ? { seq: entry.seq } : {}),
      });
    }
    stage = foldStage(foldEvents, { chainIssues: log.chainIssues });

    // 需处理明细：折叠投影 attention（链级 + 折叠诊断）+ 无法解析块计数（deck 同口径）
    for (const a of stage.attention) {
      needsAttention.push({
        source: a.source,
        message: a.event_id !== undefined ? `${a.message}（event_id=${a.event_id}）` : a.message,
      });
    }
    if (log.malformedCount > 0) {
      needsAttention.push({
        source: 'changelog',
        message: `changelog 中有 ${log.malformedCount} 个无法解析为合法信封的事件块（按 external-unverified 处理，不参与状态推导）`,
      });
    }
  }

  // —— 决策台归区（core 纯函数；门禁以空装配——解析器待 T-M1-04，deck 同口径） ——
  const board = decideBoard({
    tasks: boardTasks,
    gates: [],
    stage: {
      current: stage.currentStage,
      asOf: stage.asOf,
      sourceVersion: stage.sourceVersion,
      needsAttention,
    },
    currentStageName: stage.currentStage,
  });

  // —— 用量：pm/insights.md（usage.reported 聚合；无数据如实为空） ——
  const usage: UsageSummary = {
    events: 0,
    byModel: {},
    inputTokens: 0,
    outputTokens: 0,
    note: '用量聚合为最小实现：仅累计 insights.md 中 usage.reported 事件的 payload.input_tokens / payload.output_tokens 数值字段（T-M2a-05 用量契约定稿前不猜其他字段名）。',
  };
  if (texts.insights === undefined) {
    notes.push('pm/insights.md 缺失：用量数据为空（如实展示）。');
  } else {
    const parsedInsights = parseEventBlocks(texts.insights);
    for (const d of parsedInsights.diagnostics) {
      diagnostics.push({ source: 'insights', code: d.code, message: d.message, line: d.line });
    }
    for (const env of parsedInsights.envelopes) {
      if (env.kind !== 'usage.reported') continue;
      usage.events++;
      const model = env.payload['model'];
      if (typeof model === 'string' && model !== '') {
        usage.byModel[model] = (usage.byModel[model] ?? 0) + 1;
      }
      const input = env.payload['input_tokens'];
      if (typeof input === 'number') usage.inputTokens += input;
      const output = env.payload['output_tokens'];
      if (typeof output === 'number') usage.outputTokens += output;
    }
  }

  // —— 门禁面（T-M1-04 前：阶段投影 + 提示） ——
  if (texts.gates === undefined) {
    notes.push('pm/gates.md 缺失：门禁定义视为空。');
  } else {
    notes.push('门禁明细待 T-M1-04 解析器接入：本投影暂不展示门禁条件明细（与 cli deck 口径一致）。');
  }
  const gates = {
    currentStage: stage.currentStage,
    stageOrder: stage.stageOrder,
    note: '门禁数据待 T-M1-04 接入：本投影暂以空门禁装配，「等您决定」区暂不含门禁卡。',
  };

  // —— 项目元信息：pm/project.md ——
  let project: ProjectMeta = { name: null, slug: null, description: null };
  if (texts.project === undefined) {
    notes.push('pm/project.md 缺失：项目元信息为空。');
  } else {
    project = parseProjectMeta(texts.project);
    if (project.name === null) {
      notes.push('pm/project.md 未按契约模板解析出项目名（首行 `# 名称`），如实返回空值。');
    }
  }

  // —— 注册表（M1 最小实现：registry.md 有则列，无则单项目自述；跨项目 M2 再扩） ——
  let registry: RegistrySummary;
  if (texts.registry === undefined) {
    registry = {
      source: 'self',
      projects: [{ project_id: '(当前项目)', workspace_id: '(未登记)', slug: project.slug ?? project.name ?? '(未命名)', display_name: project.name ?? '(未命名)', managed: true, registered_at: '(未登记)' }],
      note: '未找到 .gatedeck/registry.md：以当前上下文项目自述（单项目最小实现，跨项目枚举待 M2 扩展；可运行 gatedeck adopt 收编登记）。',
    };
  } else {
    const parsed = parseNativeRegistry(texts.registry);
    for (const d of parsed.diagnostics) {
      diagnostics.push({ source: 'registry', code: d.code, message: d.message, ...(typeof d.line === 'number' ? { line: d.line } : {}) });
    }
    registry = {
      source: 'registry.md',
      projects: parsed.entries.map((e) => ({ ...e })),
      note:
        parsed.entries.length > 0
          ? `来自 .gatedeck/registry.md（native provider，append-only 登记 ${parsed.entries.length} 条）。`
          : '.gatedeck/registry.md 存在但无登记行（native provider）；跨项目枚举待 M2 扩展。',
    };
  }

  return {
    observedAt: nowIso,
    project: { name: project.name, slug: project.slug, description: project.description },
    tasks,
    diagnostics,
    notes,
    stage,
    needsAttention,
    board,
    gates,
    events: { ...counters, needsAttention: eventsNeedsAttention },
    usage,
    registry,
  };
}

/* ---------------------------------------------------------------- *
 * IO 薄壳（仅此一层做文件读取；业务判定全部在上方纯函数与 core）
 * ---------------------------------------------------------------- */

/** 可选读取：不存在返回 undefined；读取异常返回错误信息（按缺失处理并如实注明，W-06） */
function readOptionalFile(path: string): { text?: string; error?: string } {
  if (!existsSync(path)) return {};
  try {
    return { text: readFileSync(path, 'utf8') };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 解析项目上下文：读 rootDir/pm/ 事实源（+ 可选 .gatedeck/registry.md）→ 纯函数装配。
 * pm/ 目录缺失 → { ok: false, error: 'not-initialized' }（未初始化不是成功态，W-06）。
 * nowIso 由调用方注入（server.ts 顶层时钟），本函数不取系统时间。
 */
export function resolveProjectContext(rootDir: string, nowIso: string): ProjectContext {
  const pmDir = join(rootDir, 'pm');
  if (!existsSync(pmDir) || !statSync(pmDir).isDirectory()) {
    return {
      ok: false,
      error: 'not-initialized',
      hint: '当前目录尚未初始化（无 pm/ 目录）：先运行 gatedeck init 生成 pm/ 契约文件骨架，再使用本工具。',
    };
  }

  const sources = {
    wbs: 'wbs.md',
    changelog: 'changelog.md',
    insights: 'insights.md',
    project: 'project.md',
    gates: 'gates.md',
    receipts: 'receipts.jsonl',
    anchor: 'receipts.anchor.json',
  } as const;

  const texts: PmTexts = { readErrors: {} };
  for (const [key, file] of Object.entries(sources) as Array<[keyof typeof sources, string]>) {
    const read = readOptionalFile(join(pmDir, file));
    if (read.text !== undefined) (texts as Record<string, string | undefined>)[key] = read.text;
    if (read.error !== undefined) texts.readErrors![key] = read.error;
  }
  const registryRead = readOptionalFile(join(rootDir, '.gatedeck', 'registry.md'));
  if (registryRead.text !== undefined) texts.registry = registryRead.text;
  if (registryRead.error !== undefined) texts.readErrors!['registry'] = registryRead.error;
  if (Object.keys(texts.readErrors!).length === 0) delete texts.readErrors;

  return { ok: true, rootDir, ...assembleProjectContext(texts, nowIso) };
}
