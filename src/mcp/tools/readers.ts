/**
 * gatedeck-mcp 读工具 handler（W-S3-2 读 7 部分）。
 *
 * 七个 handler 均为**纯函数**：输入 ProjectContext（context.ts 装配产物）+ 工具参数，
 * 输出可 JSON 序列化的结构化投影；不做任何 IO、不取时钟、不执行任何命令（R-07：
 * MCP 永不执行门禁/shell 命令）。业务判定一律复用 context.ts 装配时调用的 core 结果
 * （decisionBoard / stageFold / eventLog / wbsKernel），本文件只做筛选与形状映射。
 *
 * 诚实边界（W-06）：not-initialized / not-found / 空数据均如实返回，不编造占位内容。
 */

import type { BoardItem } from '../../core/decisionBoard.js';
import { WBS_STATUS_VALUES } from '../../core/wbsKernel.js';
import type { ProjectContext, TaskRecord } from '../context.js';

/** 读工具统一参数形状（server.ts 按 zod schema 校验后传入；多余键被忽略） */
export interface ReaderParams {
  /** get_task / query 可用：任务 id */
  id?: string;
  /** query 可用：任务状态过滤（todo/doing/done/blocked/dropped） */
  status?: string;
  /** query 可用：阶段过滤（任务 gate 字段 = 阶段门禁 id） */
  stage?: string;
}

/** 读工具 handler 统一签名（返回值须可 JSON 序列化） */
export type ReaderHandler = (ctx: ProjectContext, args: ReaderParams) => unknown;

/** 读 7 名单（与 tools/registry.ts 的 TOOL_ALLOWLIST 读区一致；Record 类型强制全实现） */
export const READER_TOOL_NAMES = [
  'list_projects',
  'get_overview',
  'get_wbs',
  'get_task',
  'list_gates',
  'query',
  'get_report',
] as const;

export type ReaderToolName = (typeof READER_TOOL_NAMES)[number];

/** not-initialized 分支的统一返回（未初始化不是成功态，W-06） */
function notInitialized(ctx: Extract<ProjectContext, { ok: false }>): unknown {
  return { error: ctx.error, hint: ctx.hint };
}

/** 任务列表条目（get_wbs 口径：id/title/status/deps/stage） */
function toTaskSummary(t: TaskRecord): Record<string, unknown> {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    deps: t.deps,
    ...(t.stage !== undefined ? { stage: t.stage } : {}),
  };
}

/* ---------------------------------------------------------------- *
 * 读 7 handler
 * ---------------------------------------------------------------- */

/** list_projects：列注册表（registry.md 有则列，无则单项目自述）；跨项目 M2 再扩 */
function listProjects(ctx: ProjectContext): unknown {
  if (!ctx.ok) return notInitialized(ctx);
  return {
    source: ctx.registry.source,
    projects: ctx.registry.projects,
    currentProject: {
      name: ctx.project.name,
      slug: ctx.project.slug,
      description: ctx.project.description,
      rootDir: ctx.rootDir,
    },
    note: ctx.registry.note,
  };
}

/** get_overview：决策台投影 → 结构化 JSON（四区条目 + 计数 + as_of/源版本戳） */
function getOverview(ctx: ProjectContext): unknown {
  if (!ctx.ok) return notInitialized(ctx);
  const zones: Record<string, BoardItem[]> = {};
  for (const item of ctx.board.items) {
    (zones[item.zone] ??= []).push(item);
  }
  return {
    currentStage: ctx.stage.currentStage,
    asOf: ctx.board.asOf,
    sourceVersion: ctx.board.sourceVersion,
    counts: ctx.board.counts,
    zones,
    needsAttention: ctx.needsAttention,
    diagnostics: ctx.diagnostics,
    notes: ctx.notes,
    observedAt: ctx.observedAt,
  };
}

/** get_wbs：任务列表（id/title/status/deps/stage）+ 诊断如实附列 */
function getWbs(ctx: ProjectContext): unknown {
  if (!ctx.ok) return notInitialized(ctx);
  return {
    count: ctx.tasks.length,
    tasks: ctx.tasks.map(toTaskSummary),
    diagnostics: ctx.diagnostics,
    notes: ctx.notes,
  };
}

/** get_task：按 id 单任务详情（受管字段全集）；不存在如实 not-found */
function getTask(ctx: ProjectContext, args: ReaderParams): unknown {
  if (!ctx.ok) return notInitialized(ctx);
  const id = args.id?.trim() ?? '';
  if (id === '') {
    return { error: 'bad-request', hint: '参数 id 必填（任务 id，如 T-M0b-01）。' };
  }
  const task = ctx.tasks.find((t) => t.id === id);
  if (task === undefined) {
    return {
      error: 'not-found',
      id,
      hint: '未找到该任务：get_wbs 可列出全部可解析任务；无法解析的节点只出现在诊断中，不编造任务内容（W-06）。',
      diagnostics: ctx.diagnostics,
    };
  }
  return { task };
}

/** list_gates：门禁与阶段投影（T-M1-04 前与 cli deck 口径一致） */
function listGates(ctx: ProjectContext): unknown {
  if (!ctx.ok) return notInitialized(ctx);
  return {
    gates: [],
    currentStage: ctx.gates.currentStage,
    stageOrder: ctx.gates.stageOrder,
    asOf: ctx.stage.asOf,
    sourceVersion: ctx.stage.sourceVersion,
    note: ctx.gates.note,
    notes: ctx.notes,
  };
}

/** query：M1 简化——按 status/stage 过滤任务（两条件可并用；未提供条件返回全部） */
function query(ctx: ProjectContext, args: ReaderParams): unknown {
  if (!ctx.ok) return notInitialized(ctx);
  const status = args.status?.trim();
  const statusSet: ReadonlySet<string> = new Set<string>(WBS_STATUS_VALUES);
  if (status !== undefined && status !== '' && !statusSet.has(status)) {
    return {
      error: 'bad-filter',
      hint: `status 取值须为 ${WBS_STATUS_VALUES.join('/')}（双语并列以英文为准）。`,
      received: status,
    };
  }
  const stage = args.stage?.trim();
  const matches = ctx.tasks.filter((t) => {
    if (status !== undefined && status !== '' && t.status !== status) return false;
    if (stage !== undefined && stage !== '' && t.stage !== stage) return false;
    return true;
  });
  return {
    count: matches.length,
    filter: {
      ...(status !== undefined && status !== '' ? { status } : {}),
      ...(stage !== undefined && stage !== '' ? { stage } : {}),
    },
    tasks: matches.map(toTaskSummary),
  };
}

/** get_report：事件计数（verified/unverified/invalid）+ 需处理明细 + 用量汇总 */
function getReport(ctx: ProjectContext): unknown {
  if (!ctx.ok) return notInitialized(ctx);
  return {
    events: ctx.events,
    needsAttention: ctx.needsAttention,
    usage: ctx.usage,
    stage: {
      currentStage: ctx.stage.currentStage,
      asOf: ctx.stage.asOf,
      sourceVersion: ctx.stage.sourceVersion,
    },
    observedAt: ctx.observedAt,
    notes: ctx.notes,
  };
}

/** 读 7 handler 注册表（键由 READER_TOOL_NAMES 类型收窄，漏实现编译期报错） */
export const READER_HANDLERS: Readonly<Record<ReaderToolName, ReaderHandler>> = {
  list_projects: listProjects,
  get_overview: getOverview,
  get_wbs: getWbs,
  get_task: getTask,
  list_gates: listGates,
  query,
  get_report: getReport,
};
