/**
 * wbs.md 解析/校验/局部修改内核（T-M0b-01；基准 3.1 / MOD-02 / P-04 / R-04）。
 *
 * 在 T-M0a-02 定稿语法（wbsSyntax.ts 的 span/raw/wrapper 契约）之上补齐两件事：
 *  1. 校验：节点级（必需字段、status 枚举、deps 格式、未知字段 F-06 保留并报错）
 *     + 文档级（任务 id 重复、deps 悬空引用）；
 *  2. 局部修改：按任务 id 定位节点 → 仅重写目标字段行的值文本 → reconstruct，
 *     区间外与节点内其他字节一律不动（R-04 round-trip 保真的可执行面）。
 *
 * 口径说明：
 *  - 重复 id：读取幂等取首笔（B-13 精神），同时出诊断交由权威位置规则（T-M0b-05）裁决；
 *  - deps 悬空：本文件内无法解析到的任务 id 出 dangling-dep 诊断——允许跨文件引用的
 *    场景由调用方在文档级自行合并后再校验（M0 不引入跨文件语义）；
 *  - 标题行 vs 块内 title 冲突、时间语义字段（updated_at 等）拒绝：归 T-M0b-05 校验内核。
 *
 * 纯字符串计算，无 IO（core 纯度约束）。
 */

import {
  reconstruct,
  updateField,
  type WbsDiagnostic,
  type WbsNode,
  type WbsParseResult,
} from './wbsSyntax.js';

/** 任务状态枚举（项目负责人 2026-10-19 确认：双语并列，机器权威层以英文为准） */
export const WBS_STATUS_VALUES = ['todo', 'doing', 'done', 'blocked', 'dropped'] as const;
export type WbsStatus = (typeof WBS_STATUS_VALUES)[number];

/** 必需字段（MOD-02 / wbs节点语法定稿 2.2） */
export const WBS_REQUIRED_FIELDS = ['id', 'title', 'status'] as const;

/** 已知字段全集（定稿 2.2；estimate 不入字段） */
export const WBS_KNOWN_FIELDS = ['id', 'title', 'status', 'owner', 'deps', 'gate', 'acceptance', 'scope'] as const;

const STATUS_SET: ReadonlySet<string> = new Set(WBS_STATUS_VALUES);
const KNOWN_SET: ReadonlySet<string> = new Set(WBS_KNOWN_FIELDS);

/** 单个任务 id 的形态（T-M0b-01 基线：字母/数字/点/下划线/连字符组成） */
const TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type WbsKernelDiagnosticCode =
  | 'missing-required-field'
  | 'bad-status'
  | 'bad-deps-format'
  | 'unknown-field'
  | 'duplicate-task-id'
  | 'dangling-dep';

export interface WbsKernelDiagnostic {
  code: WbsKernelDiagnosticCode;
  message: string;
  /** 关联任务 id（文档级诊断如 dangling-dep 为引用方 id） */
  taskId?: string;
  /** 1-based 行号（相对整个文档；文档级诊断可能缺省） */
  line?: number;
}

export interface WbsDocumentValidation {
  /** 全部内核诊断（节点级 + 文档级），节点级按节点顺序 */
  diagnostics: WbsKernelDiagnostic[];
  /** id → 首个节点（重复 id 取首笔，B-13 精神） */
  byId: Map<string, WbsNode>;
  /** 文档内全部任务 id（含重复者，按出现顺序） */
  taskIds: string[];
}

/** 取节点内第一个匹配 key 的字段值 */
export function getNodeField(node: WbsNode, key: string): string | undefined {
  return node.fields.find((f) => f.key === key)?.value;
}

/** 字段在文档中的 1-based 行号（找不到返回节点 raw 起始行，供诊断兜底） */
function fieldLine(md: string, node: WbsNode, key: string): number {
  const rawStartLine = md.slice(0, node.rawSpan.start).split('\n').length;
  const idx = node.raw.split('\n').findIndex((l) => l.trimStart().startsWith(key));
  return idx === -1 ? rawStartLine : rawStartLine + idx;
}

/**
 * 解析后的任务节点校验 + 文档级一致性检查。
 * 解析层诊断（unparsed-line/unclosed-node/duplicate-key）由 wbsSyntax 产出，
 * 本函数只做语义层：字段缺失/取值非法/未知字段（F-06）/重复 id/悬空 deps。
 */
export function validateWbsDocument(md: string, result: WbsParseResult): WbsDocumentValidation {
  const diagnostics: WbsKernelDiagnostic[] = [];
  const byId = new Map<string, WbsNode>();
  const taskIds: string[] = [];

  // —— 节点级校验 ——
  for (const node of result.nodes) {
    const id = getNodeField(node, 'id');
    for (const key of WBS_REQUIRED_FIELDS) {
      const v = getNodeField(node, key);
      if (v === undefined || v.trim() === '') {
        diagnostics.push({
          code: 'missing-required-field',
          message: `任务节点缺少必需字段：${key}（定稿 2.2；id/title/status 必需）`,
          ...(id !== undefined ? { taskId: id } : {}),
          line: fieldLine(md, node, key),
        });
      }
    }
    const status = getNodeField(node, 'status');
    if (status !== undefined && status.trim() !== '' && !STATUS_SET.has(status.trim())) {
      diagnostics.push({
        code: 'bad-status',
        message: `status 取值非法：${JSON.stringify(status)}（允许 ${WBS_STATUS_VALUES.join('/')}，双语并列以英文为准）`,
        ...(id !== undefined ? { taskId: id } : {}),
        line: fieldLine(md, node, 'status'),
      });
    }
    const deps = getNodeField(node, 'deps');
    if (deps !== undefined && deps.trim() !== '') {
      for (const raw of deps.split(',')) {
        const dep = raw.trim();
        if (dep === '' || !TASK_ID_RE.test(dep)) {
          diagnostics.push({
            code: 'bad-deps-format',
            message: `deps 含非法任务 id：${JSON.stringify(raw)}（逗号分隔，成员须形如 T-M0b-01）`,
            ...(id !== undefined ? { taskId: id } : {}),
            line: fieldLine(md, node, 'deps'),
          });
        }
      }
    }
    // 未知字段：保留 + 诊断（F-06；不驱动受管状态）
    for (const f of node.fields) {
      if (!KNOWN_SET.has(f.key)) {
        diagnostics.push({
          code: 'unknown-field',
          message: `未知字段「${f.key}」已原样保留、不参与受管状态（F-06）`,
          ...(id !== undefined ? { taskId: id } : {}),
          line: fieldLine(md, node, f.key),
        });
      }
    }
    if (id !== undefined && id.trim() !== '') {
      if (!byId.has(id)) byId.set(id, node); // 重复 id 读取取首笔
      taskIds.push(id);
    }
  }

  // —— 文档级：重复 id ——
  const seen = new Set<string>();
  for (const id of taskIds) {
    if (seen.has(id)) {
      const node = result.nodes.find((n) => getNodeField(n, 'id') === id);
      diagnostics.push({
        code: 'duplicate-task-id',
        message: `任务 id 在文档中重复：${id}（读取取首笔，冲突交由权威位置规则 T-M0b-05 裁决）`,
        taskId: id,
        ...(node !== undefined ? { line: fieldLine(md, node, 'id') } : {}),
      });
    }
    seen.add(id);
  }

  // —— 文档级：悬空 deps ——
  const declared = new Set(taskIds);
  for (const node of result.nodes) {
    const id = getNodeField(node, 'id');
    const deps = getNodeField(node, 'deps');
    if (deps === undefined || deps.trim() === '') continue;
    for (const raw of deps.split(',')) {
      const dep = raw.trim();
      if (dep === '' || !TASK_ID_RE.test(dep)) continue; // 格式问题已由 bad-deps-format 覆盖
      if (!declared.has(dep)) {
        diagnostics.push({
          code: 'dangling-dep',
          message: `deps 引用的任务 id 在本文件中不存在：${dep}${id !== undefined ? `（引用方 ${id}）` : ''}（若为跨文件引用，请在调用方合并文档后再校验）`,
          ...(id !== undefined ? { taskId: id } : {}),
          line: fieldLine(md, node, 'deps'),
        });
      }
    }
  }

  return { diagnostics, byId, taskIds };
}

/**
 * 局部修改：按任务 id 定位节点，重写其第一个匹配 key 的字段值。
 * 只改动目标行的值文本（key/冒号/冒号后空白/行终止符/其余字节全部保留）。
 * 节点或字段不存在返回 null（不静默产生新字段；新增字段属模板演进，非局部修改）。
 */
export function updateTaskFieldById(
  md: string,
  result: WbsParseResult,
  taskId: string,
  key: string,
  value: string,
): string | null {
  const node = result.nodes.find((n) => getNodeField(n, 'id') === taskId);
  if (node === undefined) return null;
  const updated = updateField(node, key, value);
  if (updated === null) return null;
  const merged: WbsParseResult = {
    nodes: result.nodes.map((n) => (n === node ? updated : n)),
    diagnostics: [] as WbsDiagnostic[],
  };
  return reconstruct(md, merged);
}
