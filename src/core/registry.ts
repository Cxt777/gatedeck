/**
 * 注册表 provider（T-M0a-06；基准 MOD-01 / D-27 分层 / D-30 provider / B-14 / B-15）。
 *
 * 两个 provider 投影到统一的 RegistryProjection，供 discover/总览消费：
 *
 *  - **native**（通用工作区默认）：
 *      `.gatedeck/registry.md`（git 管理）——登记行 append-only（R-02），存
 *      project_id / workspace_id（ULID，不随目录移动改变，B-14）/ slug / 显示名 / 受管状态；
 *      `registry.local.md`（默认 git 忽略）——binding_key 与本地 locator 属机器本地状态，
 *      locator 随目录移动就地震荡更新，workspace_id/binding_key 不变（B-14）；
 *  - **projects-index**（本 AI 工作区采用，D-30）：只读解析工作区根 PROJECTS-INDEX.md
 *      投影为本产品所需数据——**不创建第二注册表、不修改根治理文件、不向工作区根写
 *      `.gatedeck/`**（B-15）。只读由 API 形状保证：本模块不存在任何以 PROJECTS-INDEX
 *      为写入目标的序列化/追加/更新函数（`registry.test.ts` 有结构性断言）。
 *
 * ULID 与带时区 ISO 8601 校验复用 eventEnvelope 的同源实现，避免双口径。
 * 表格解析为行级保真：单元格文本原样保留、未知列保留并出诊断（F-06 口径）。
 * 纯字符串计算，无 IO（core 纯度约束）；ULID/binding_key 的随机生成由调用方注入。
 */

import { isIsoDateTimeWithTz, isUlid } from './eventEnvelope.js';

/* ---------------------------------------------------------------- *
 * 通用：Markdown 表格行级解析（单元格原样保留，未知列不丢）
 * ---------------------------------------------------------------- */

export interface RegistryDiagnostic {
  code: 'bad-value' | 'missing-column' | 'column-count-mismatch';
  message: string;
  line?: number;
}

interface RawTable {
  headerCells: string[];
  /** 数据行：单元格文本（已去两端空格）+ 原始行文本 + 1-based 行号 */
  rows: Array<{ cells: string[]; rawLine: string; line: number }>;
  headerLine: number;
}

const TABLE_ROW = /^\s*\|(.*)\|\s*$/;
const SEPARATOR_ROW = /^\s*\|[\s:|-]+\|\s*$/;

function splitCells(content: string): string[] {
  return content.split('|').map((c) => c.trim());
}

/** 解析文档中第一个「表头 + 分隔行 + 数据行」结构的表格；找不到返回 null */
function parseFirstTable(md: string): RawTable | null {
  const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    if (!TABLE_ROW.test(lines[i]!) || !SEPARATOR_ROW.test(lines[i + 1]!)) continue;
    const headerCells = splitCells(lines[i]!.replace(TABLE_ROW, '$1'));
    const rows: RawTable['rows'] = [];
    for (let j = i + 2; j < lines.length; j++) {
      const line = lines[j]!;
      if (!TABLE_ROW.test(line)) break;
      rows.push({ cells: splitCells(line.replace(TABLE_ROW, '$1')), rawLine: line, line: j + 1 });
    }
    return { headerCells, rows, headerLine: i + 1 };
  }
  return null;
}

/* ---------------------------------------------------------------- *
 * provider 一：native —— .gatedeck/registry.md（git 管理，登记行 append-only）
 * ---------------------------------------------------------------- */

export const NATIVE_REGISTRY_HEADER = ['project_id', 'workspace_id', 'slug', 'display_name', 'managed', 'registered_at'] as const;

export interface NativeRegistryEntry {
  project_id: string;
  /** ULID；不随目录移动改变（B-14），根路径只是 locator */
  workspace_id: string;
  slug: string;
  display_name: string;
  managed: boolean;
  /** ISO 8601 带时区 */
  registered_at: string;
}

function serializeNativeRow(e: NativeRegistryEntry): string {
  return `| ${e.project_id} | ${e.workspace_id} | ${e.slug} | ${e.display_name} | ${e.managed ? 'true' : 'false'} | ${e.registered_at} |`;
}

/** 生成 registry.md 全文（首次创建/重建用；后续登记一律走 appendNativeRegistryEntry） */
export function serializeNativeRegistry(entries: readonly NativeRegistryEntry[]): string {
  const lines = [
    '# 一休PM · 注册表（native provider）',
    '',
    '> 本文件由 gatedeck 受管写入；登记行 append-only（R-02），不删改既有行。',
    '> workspace_id 为 ULID，不随目录移动改变（B-14）；binding_key 与本地 locator 在 registry.local.md（默认 git 忽略）。',
    '',
    `| ${NATIVE_REGISTRY_HEADER.join(' | ')} |`,
    '|---|---|---|---|---|---|',
    ...entries.map(serializeNativeRow),
    '',
  ];
  return lines.join('\n');
}

/** 校验单条登记值；返回诊断（不抛出，由调用方决定严格性） */
function validateNativeEntry(e: NativeRegistryEntry, line: number, diagnostics: RegistryDiagnostic[]): void {
  if (!isUlid(e.workspace_id)) {
    diagnostics.push({ code: 'bad-value', message: `workspace_id 不是合法 ULID：${e.workspace_id}（B-14：workspace_id 稳定不变）`, line });
  }
  if (e.project_id.trim() === '' || e.slug.trim() === '' || e.display_name.trim() === '') {
    diagnostics.push({ code: 'bad-value', message: `project_id/slug/display_name 均须非空`, line });
  }
  if (e.managed !== true && e.managed !== false) {
    diagnostics.push({ code: 'bad-value', message: `managed 须为 true/false`, line });
  }
  if (!isIsoDateTimeWithTz(e.registered_at)) {
    diagnostics.push({ code: 'bad-value', message: `registered_at 须为带时区 ISO 8601：${e.registered_at}`, line });
  }
}

export interface NativeRegistryParseResult {
  entries: NativeRegistryEntry[];
  diagnostics: RegistryDiagnostic[];
}

/** 解析 registry.md：未知列保留在诊断中提示但不丢弃（F-06） */
export function parseNativeRegistry(md: string): NativeRegistryParseResult {
  const entries: NativeRegistryEntry[] = [];
  const diagnostics: RegistryDiagnostic[] = [];
  const table = parseFirstTable(md);
  if (table === null) return { entries, diagnostics };
  const missing = NATIVE_REGISTRY_HEADER.filter((h) => !table.headerCells.includes(h));
  if (missing.length > 0) {
    diagnostics.push({ code: 'missing-column', message: `registry.md 缺少必需列：${missing.join(', ')}`, line: table.headerLine });
    return { entries, diagnostics };
  }
  const unknownCols = table.headerCells.filter((c) => !(NATIVE_REGISTRY_HEADER as readonly string[]).includes(c));
  if (unknownCols.length > 0) {
    diagnostics.push({ code: 'column-count-mismatch', message: `registry.md 存在未知列（已忽略值、原表保留）：${unknownCols.join(', ')}` });
  }
  const idx = (name: string) => table.headerCells.indexOf(name);
  for (const row of table.rows) {
    if (row.cells.every((c) => c === '')) continue;
    if (row.cells.length !== table.headerCells.length) {
      diagnostics.push({ code: 'column-count-mismatch', message: `行单元格数（${row.cells.length}）与表头（${table.headerCells.length}）不一致；若单元格含「|」请改写内容`, line: row.line });
      continue;
    }
    const managedRaw = row.cells[idx('managed')]!.toLowerCase();
    const entry: NativeRegistryEntry = {
      project_id: row.cells[idx('project_id')]!,
      workspace_id: row.cells[idx('workspace_id')]!,
      slug: row.cells[idx('slug')]!,
      display_name: row.cells[idx('display_name')]!,
      managed: managedRaw === 'true' ? true : managedRaw === 'false' ? false : (managedRaw as unknown as boolean),
      registered_at: row.cells[idx('registered_at')]!,
    };
    validateNativeEntry(entry, row.line, diagnostics);
    entries.push(entry);
  }
  return { entries, diagnostics };
}

/**
 * 追加一条登记（append-only：只允许表尾追加行，既有字节不动）。
 * project_id 或 workspace_id 重复 → 抛出（登记幂等由 core 守住，不静默去重）。
 */
export function appendNativeRegistryEntry(md: string, entry: NativeRegistryEntry): string {
  const { entries, diagnostics } = parseNativeRegistry(md);
  if (diagnostics.some((d) => d.code === 'missing-column' || d.code === 'bad-value')) {
    throw new Error(`registry.md 现有内容存在结构性缺陷，拒绝在缺陷上追加：${diagnostics.map((d) => d.message).join('；')}`);
  }
  if (entries.some((e) => e.project_id === entry.project_id || e.workspace_id === entry.workspace_id)) {
    throw new Error(`重复登记：project_id=${entry.project_id} 或 workspace_id=${entry.workspace_id} 已存在（append-only 登记，不覆盖）`);
  }
  const selfCheck: RegistryDiagnostic[] = [];
  validateNativeEntry(entry, 0, selfCheck);
  if (selfCheck.length > 0) {
    throw new Error(`追加的登记条目非法：${selfCheck.map((d) => d.message).join('；')}`);
  }
  const table = parseFirstTable(md);
  if (table === null || table.rows.length === 0) {
    throw new Error('registry.md 中未找到登记表，无法追加（请先用 serializeNativeRegistry 生成）');
  }
  const lines = md.split(/(\r?\n)/); // 捕获组保留 EOL 风格（R-04 round-trip 保真）
  const lastRowRaw = table.rows[table.rows.length - 1]!.rawLine;
  const lastIdx = lines.indexOf(lastRowRaw);
  const eol = md.includes('\r\n') ? '\r\n' : '\n';
  lines.splice(lastIdx + 1, 0, eol + serializeNativeRow(entry));
  return lines.join('');
}

/* ---------------------------------------------------------------- *
 * provider 一（续）：registry.local.md（默认 git 忽略；locator 可就地更新）
 * ---------------------------------------------------------------- */

export const NATIVE_LOCAL_HEADER = ['workspace_id', 'binding_key', 'locator', 'observed_at'] as const;

export interface NativeLocalEntry {
  workspace_id: string;
  /** 机器本地不透明绑定键（随机生成由调用方注入；core 只校验非空） */
  binding_key: string;
  /** 本地路径 locator（可随目录移动更新，B-14） */
  locator: string;
  /** locator 最近观测时间（ISO 8601 带时区） */
  observed_at: string;
}

function serializeNativeLocalRow(e: NativeLocalEntry): string {
  return `| ${e.workspace_id} | ${e.binding_key} | ${e.locator} | ${e.observed_at} |`;
}

export function serializeNativeRegistryLocal(entries: readonly NativeLocalEntry[]): string {
  return [
    '# 一休PM · 本地绑定（native provider · 默认 git 忽略）',
    '',
    '> binding_key 与 locator 属机器本地状态：locator 随目录移动就地更新（B-14），',
    '> workspace_id/binding_key 不变；本文件不入 git（W-01 同源的本地边界）。',
    '',
    `| ${NATIVE_LOCAL_HEADER.join(' | ')} |`,
    '|---|---|---|---|',
    ...entries.map(serializeNativeLocalRow),
    '',
  ].join('\n');
}

export interface NativeLocalParseResult {
  entries: NativeLocalEntry[];
  diagnostics: RegistryDiagnostic[];
}

export function parseNativeRegistryLocal(md: string): NativeLocalParseResult {
  const entries: NativeLocalEntry[] = [];
  const diagnostics: RegistryDiagnostic[] = [];
  const table = parseFirstTable(md);
  if (table === null) return { entries, diagnostics };
  const missing = NATIVE_LOCAL_HEADER.filter((h) => !table.headerCells.includes(h));
  if (missing.length > 0) {
    diagnostics.push({ code: 'missing-column', message: `registry.local.md 缺少必需列：${missing.join(', ')}`, line: table.headerLine });
    return { entries, diagnostics };
  }
  const idx = (name: string) => table.headerCells.indexOf(name);
  for (const row of table.rows) {
    if (row.cells.every((c) => c === '')) continue;
    if (row.cells.length !== table.headerCells.length) {
      diagnostics.push({ code: 'column-count-mismatch', message: `行单元格数与表头不一致`, line: row.line });
      continue;
    }
    const entry: NativeLocalEntry = {
      workspace_id: row.cells[idx('workspace_id')]!,
      binding_key: row.cells[idx('binding_key')]!,
      locator: row.cells[idx('locator')]!,
      observed_at: row.cells[idx('observed_at')]!,
    };
    if (!isUlid(entry.workspace_id)) {
      diagnostics.push({ code: 'bad-value', message: `workspace_id 不是合法 ULID：${entry.workspace_id}`, line: row.line });
    }
    if (entry.binding_key.trim() === '') {
      diagnostics.push({ code: 'bad-value', message: 'binding_key 须为非空不透明字符串', line: row.line });
    }
    if (!isIsoDateTimeWithTz(entry.observed_at)) {
      diagnostics.push({ code: 'bad-value', message: `observed_at 须为带时区 ISO 8601：${entry.observed_at}`, line: row.line });
    }
    entries.push(entry);
  }
  return { entries, diagnostics };
}

/**
 * 目录移动后更新 locator（B-14）：仅改目标行 locator/observed_at 两个单元格，
 * workspace_id 与 binding_key 不变，其余字节不动；未找到对应 workspace_id → 抛出。
 */
export function updateLocalLocator(md: string, workspaceId: string, newLocator: string, observedAt: string): string {
  const table = parseFirstTable(md);
  if (table === null) throw new Error('registry.local.md 中未找到绑定表');
  const idx = (name: string) => table.headerCells.indexOf(name);
  const wsCol = idx('workspace_id');
  const locCol = idx('locator');
  const obsCol = idx('observed_at');
  if (!isIsoDateTimeWithTz(observedAt)) throw new Error(`observedAt 须为带时区 ISO 8601：${observedAt}`);
  const lines = md.split(/(\r?\n)/); // 捕获组保留 EOL 风格（R-04 round-trip 保真）
  let found = false;
  for (const row of table.rows) {
    if (row.cells[wsCol] !== workspaceId) continue;
    found = true;
    const lineNo = lines.indexOf(row.rawLine);
    const original = lines[lineNo]!;
    // 逐单元格替换：定位该行第 locCol / obsCol 个单元格文本（保守整格替换，key 列不动）
    const cells = original.split('|');
    // cells 布局：[前缀, cell0, cell1, ..., cellN, 后缀]
    const mapToCells = (col: number) => col + 1;
    if (mapToCells(locCol) >= cells.length - 1 || mapToCells(obsCol) >= cells.length - 1) {
      throw new Error(`第 ${row.line} 行单元格数不足，拒绝更新`);
    }
    cells[mapToCells(locCol)] = ` ${newLocator} `;
    cells[mapToCells(obsCol)] = ` ${observedAt} `;
    lines[lineNo] = cells.join('|');
  }
  if (!found) throw new Error(`registry.local.md 中不存在 workspace_id=${workspaceId} 的绑定行`);
  return lines.join('');
}

/* ---------------------------------------------------------------- *
 * provider 二：projects-index —— 只读解析工作区根 PROJECTS-INDEX.md（D-30 / B-15）
 * ---------------------------------------------------------------- */

/** PROJECTS-INDEX.md 登记表列（工作区治理文件格式，只读消费） */
export const PROJECTS_INDEX_HEADER = ['slug', '中文名', '目录', '状态', '端口段', '技术栈', '项目级入口'] as const;

export interface ProjectsIndexEntry {
  slug: string;
  display_name: string;
  /** 目录 locator（相对工作区根） */
  dir: string;
  status: string;
  port_range: string;
  stack: string;
  /** 项目级入口文件 */
  entry: string;
}

export interface ProjectsIndexParseResult {
  entries: ProjectsIndexEntry[];
  diagnostics: RegistryDiagnostic[];
}

/**
 * 只读解析 PROJECTS-INDEX.md 为 provider 投影。
 * 刻意不提供任何写/序列化函数（B-15：不修改根治理文件）——见模块头注释与结构性测试。
 */
export function parseProjectsIndex(md: string): ProjectsIndexParseResult {
  const entries: ProjectsIndexEntry[] = [];
  const diagnostics: RegistryDiagnostic[] = [];
  const table = parseFirstTable(md);
  if (table === null) return { entries, diagnostics };
  const missing = PROJECTS_INDEX_HEADER.filter((h) => !table.headerCells.includes(h));
  if (missing.length > 0) {
    diagnostics.push({ code: 'missing-column', message: `PROJECTS-INDEX.md 登记表缺少预期列：${missing.join(', ')}`, line: table.headerLine });
    return { entries, diagnostics };
  }
  const idx = (name: string) => table.headerCells.indexOf(name);
  for (const row of table.rows) {
    if (row.cells.every((c) => c === '')) continue;
    if (row.cells.length !== table.headerCells.length) {
      diagnostics.push({ code: 'column-count-mismatch', message: `登记行单元格数与表头不一致，已跳过该行（原行保留）`, line: row.line });
      continue;
    }
    entries.push({
      slug: row.cells[idx('slug')]!,
      display_name: row.cells[idx('中文名')]!,
      dir: row.cells[idx('目录')]!,
      status: row.cells[idx('状态')]!,
      port_range: row.cells[idx('端口段')]!,
      stack: row.cells[idx('技术栈')]!,
      entry: row.cells[idx('项目级入口')]!,
    });
  }
  return { entries, diagnostics };
}

/* ---------------------------------------------------------------- *
 * 统一投影（discover/总览消费）
 * ---------------------------------------------------------------- */

export type RegistrySource = 'native' | 'projects-index';

export interface RegistryProjection {
  source: RegistrySource;
  project_id: string;
  display_name: string;
  /** 本地 locator：native = registry.local.md 的 locator；projects-index = 登记目录 */
  locator: string;
  /** projects-index 投影的受管状态恒为 false：是否收编由本地绑定决定（M1-02 adopt） */
  managed: boolean;
}

export function nativeToProjection(e: NativeRegistryEntry, local?: NativeLocalEntry): RegistryProjection {
  if (local !== undefined && local.workspace_id !== e.workspace_id) {
    throw new Error(`本地绑定 workspace_id 不匹配：${local.workspace_id} ≠ ${e.workspace_id}`);
  }
  return { source: 'native', project_id: e.project_id, display_name: e.display_name, locator: local?.locator ?? '', managed: e.managed };
}

export function projectsIndexToProjection(e: ProjectsIndexEntry): RegistryProjection {
  return { source: 'projects-index', project_id: e.slug, display_name: e.display_name, locator: e.dir, managed: false };
}
