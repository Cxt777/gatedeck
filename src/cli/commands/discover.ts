/**
 * gatedeck discover —— 工作区候选项目只读预览（T-M1-02 / W-S2-2）。
 *
 * **B-7 红线：本命令零写动作**——永不执行任何命令、永不入册、永不写任何文件；
 * 只做 readdir / stat / readFile 三类只读 IO，扫描结果仅打印。
 *
 * 流程（与 core 判定内核同源）：
 *  1. 从 cwd 向下扫描 1~3 层目录（跳过 `.` 开头隐藏目录与 node_modules；
 *     单目录条目上限 500，超出截断并如实提示——防误扫巨型目录）；
 *  2. 读取扫描根 .gatedeckignore（`#` 注释与空行忽略）→ applyIgnore 过滤
 *     （被忽略路径如实展示，不静默丢弃）；
 *  3. classifyCandidates 判定候选（三信号：pm/、PROJECTS-INDEX.md、pm/wbs.md）；
 *  4. 只读解析 .gatedeck/registry.md + registry.local.md，已登记项目按
 *     markOffline 标注「在线/离线」——路径失效显示「离线」，不静默移除（R-08）。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  applyIgnore,
  classifyCandidates,
  markOffline,
  type DiscoverSignal,
  type ScannedPath,
} from '../../core/discoverRules.js';
import {
  parseNativeRegistry,
  parseNativeRegistryLocal,
  type NativeLocalEntry,
  type NativeRegistryEntry,
  type RegistryDiagnostic,
} from '../../core/registry.js';
import type { CliIo } from '../index.js';

/** 扫描深度限制：向下 1~3 层 */
export const SCAN_DEPTH = 3;
/** 单目录条目上限：超出截断并如实提示（防误扫巨型目录） */
export const DIR_LISTING_CAP = 500;

/** 下降时跳过的固定目录名（配合 `.` 开头隐藏目录；排除靠 .gatedeckignore 在候选层做） */
const SKIP_DIR_NAMES: ReadonlySet<string> = new Set(['node_modules']);

export interface DiscoverDeps {
  /** 扫描根（= 工作区根），默认 process.cwd() */
  cwd: string;
}

const DEFAULT_DEPS: DiscoverDeps = { cwd: process.cwd() };

/** 信号 → 中文说明（预览展示用） */
const SIGNAL_LABELS: Record<DiscoverSignal, string> = {
  'has-pm-dir': 'pm/ 目录',
  'has-project-index': 'PROJECTS-INDEX.md',
  'has-wbs-md': 'pm/wbs.md',
};

/** Windows 反斜杠归一为「/」（core 侧路径一律 posix 形态） */
export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** 壳层存在性探测：三信号逐一 stat（判定逻辑在 core classifyCandidates） */
export function probeSignals(abs: string): ScannedPath['exists'] {
  return {
    pmDir: isDirectory(path.join(abs, 'pm')),
    projectIndex: statIsFile(path.join(abs, 'PROJECTS-INDEX.md')),
    wbsMd: statIsFile(path.join(abs, 'pm', 'wbs.md')),
  };
}

function statIsFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

interface DirObservation {
  /** 相对扫描根的 posix 路径（至少一层，不含根本身） */
  rel: string;
  abs: string;
  exists: ScannedPath['exists'];
}

interface ScanReport {
  dirs: DirObservation[];
  /** 条目超上限被截断的目录（rel；根记作「.」） */
  truncatedDirs: string[];
  /** 读取失败（权限等）被跳过的目录（rel） */
  unreadableDirs: string[];
}

/** 逐层 BFS 扫描：只列目录、只 stat，不写任何东西 */
function scanWorkspace(rootAbs: string): ScanReport {
  const dirs: DirObservation[] = [];
  const truncatedDirs: string[] = [];
  const unreadableDirs: string[] = [];
  let frontier: Array<{ rel: string; abs: string }> = [{ rel: '', abs: rootAbs }];
  for (let depth = 1; depth <= SCAN_DEPTH; depth++) {
    const next: Array<{ rel: string; abs: string }> = [];
    for (const parent of frontier) {
      const relLabel = parent.rel === '' ? '.' : parent.rel;
      let names: string[];
      try {
        names = readdirSync(parent.abs).sort();
      } catch {
        unreadableDirs.push(relLabel);
        continue;
      }
      if (names.length > DIR_LISTING_CAP) {
        truncatedDirs.push(relLabel);
        names = names.slice(0, DIR_LISTING_CAP);
      }
      for (const name of names) {
        if (name.startsWith('.') || SKIP_DIR_NAMES.has(name)) continue;
        const abs = path.join(parent.abs, name);
        try {
          if (!statSync(abs).isDirectory()) continue;
        } catch {
          continue; // 列目录与 stat 之间竞态消失的条目：跳过，不猜测
        }
        next.push({ rel: parent.rel === '' ? name : `${parent.rel}/${name}`, abs });
      }
    }
    for (const d of next) dirs.push({ ...d, exists: probeSignals(d.abs) });
    frontier = next;
  }
  return { dirs, truncatedDirs, unreadableDirs };
}

/** 读取 .gatedeckignore：`#` 注释与空行忽略；返回 null 表示文件不存在 */
function readIgnorePatterns(rootAbs: string): { patterns: string[]; fileExists: boolean; readError?: string } {
  const p = path.join(rootAbs, '.gatedeckignore');
  if (!existsSync(p)) return { patterns: [], fileExists: false };
  let raw: string;
  try {
    raw = readFileSync(p, 'utf8');
  } catch (e) {
    return { patterns: [], fileExists: true, readError: e instanceof Error ? e.message : String(e) };
  }
  const patterns = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
  return { patterns, fileExists: true };
}

interface RegistryView {
  registryExists: boolean;
  entries: NativeRegistryEntry[];
  /** workspace_id → 本地绑定（locator 所在） */
  localByWs: Map<string, NativeLocalEntry>;
  /** 解析诊断（registry.md / registry.local.md），预览时如实展示 */
  diagnostics: string[];
}

/** 只读解析 native 注册表两件套（缺失按空处理，缺陷按诊断展示，不写不改） */
function readRegistry(rootAbs: string): RegistryView {
  const view: RegistryView = { registryExists: false, entries: [], localByWs: new Map(), diagnostics: [] };
  const fmtDiag = (d: RegistryDiagnostic): string => `${d.message}${d.line === undefined ? '' : `（第 ${d.line} 行）`}`;
  const registryPath = path.join(rootAbs, '.gatedeck', 'registry.md');
  if (existsSync(registryPath)) {
    view.registryExists = true;
    try {
      const parsed = parseNativeRegistry(readFileSync(registryPath, 'utf8'));
      view.entries = parsed.entries;
      for (const d of parsed.diagnostics) view.diagnostics.push(`registry.md：${fmtDiag(d)}`);
    } catch (e) {
      view.diagnostics.push(`registry.md 读取失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const localPath = path.join(rootAbs, '.gatedeck', 'registry.local.md');
  if (existsSync(localPath)) {
    try {
      const parsedLocal = parseNativeRegistryLocal(readFileSync(localPath, 'utf8'));
      view.localByWs = new Map(parsedLocal.entries.map((e) => [e.workspace_id, e]));
      for (const d of parsedLocal.diagnostics) view.diagnostics.push(`registry.local.md：${fmtDiag(d)}`);
    } catch (e) {
      view.diagnostics.push(`registry.local.md 读取失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return view;
}

/** locator 归一：去首尾空白、反斜杠转 posix（与 adopt 写入口径一致） */
function normLocator(s: string): string {
  return s.trim().replace(/\\/g, '/');
}

/**
 * discover 命令入口。返回进程退出码：恒 0（零候选/零登记也是成功——如实预览即职责完成）。
 * 零写动作：本函数体不存在任何 write/mkdir/append 调用。
 */
export function runDiscover(argv: readonly string[], io: CliIo, deps: DiscoverDeps = DEFAULT_DEPS): number {
  if (argv.length > 0) {
    io.err('gatedeck discover 不接受参数（扫描根固定为当前工作目录）。');
    io.err('用法：gatedeck discover');
    return 2;
  }

  const rootAbs = deps.cwd;
  const scan = scanWorkspace(rootAbs);
  const ignore = readIgnorePatterns(rootAbs);
  const registry = readRegistry(rootAbs);

  /* core 判定：ignore 过滤（先）→ 候选分类（后），与任务规格顺序一致 */
  const scannedRels = scan.dirs.map((d) => d.rel);
  const { kept, ignored } = applyIgnore(scannedRels, ignore.patterns);
  const keptSet = new Set(kept);
  const candidates = classifyCandidates(
    scan.dirs.filter((d) => keptSet.has(d.rel)).map((d) => ({ path: d.rel, exists: d.exists })),
  );

  /* 已登记项目的在线/离线标注（R-08：失效显示「离线」，不剔除） */
  const existingPaths = new Set<string>(['.', toPosix(rootAbs)]);
  for (const d of scan.dirs) {
    existingPaths.add(d.rel);
    existingPaths.add(toPosix(d.abs));
  }
  const byLocator = new Map<string, string[]>();
  const unboundProjects: string[] = [];
  for (const entry of registry.entries) {
    const loc = normLocator(registry.localByWs.get(entry.workspace_id)?.locator ?? '');
    if (loc === '') {
      unboundProjects.push(entry.project_id);
      continue;
    }
    const absLoc = path.isAbsolute(loc) ? loc : path.resolve(rootAbs, loc);
    if (existsSync(absLoc)) existingPaths.add(loc);
    const list = byLocator.get(loc) ?? [];
    list.push(entry.project_id);
    byLocator.set(loc, list);
  }
  const statusRows = markOffline(
    [...byLocator.keys()].map((path) => ({ path })),
    [...existingPaths],
  );

  /* ---- 预览输出 ---- */
  io.out('gatedeck discover —— 工作区候选项目只读预览（T-M1-02）');
  io.out('承诺（B-7）：本命令零写动作——不执行任何命令、不入册、不写任何文件。');
  io.out('');
  io.out(`扫描根：${toPosix(rootAbs)}`);
  io.out(
    `扫描范围：向下 ${SCAN_DEPTH} 层（跳过「.」开头隐藏目录与 node_modules）；单目录条目上限 ${DIR_LISTING_CAP}`,
  );
  io.out(`扫描目录：${scan.dirs.length} 个`);
  for (const d of scan.truncatedDirs) io.out(`  ⚠ 目录条目超过 ${DIR_LISTING_CAP} 上限，已截断（如实提示）：./${d}`);
  for (const d of scan.unreadableDirs) io.out(`  ⚠ 目录不可读，已跳过（如实提示）：./${d}`);
  if (ignore.readError !== undefined) io.out(`  ⚠ .gatedeckignore 读取失败，本次按无忽略模式处理：${ignore.readError}`);
  io.out('');

  io.out(`—— 候选项目（${candidates.length} 个）——`);
  if (candidates.length === 0) {
    io.out('（未发现候选项目。候选信号：pm/ 目录、PROJECTS-INDEX.md、pm/wbs.md 至少命中其一。）');
  }
  for (const [i, c] of candidates.entries()) {
    io.out(`  [${i + 1}] ./${c.path}`);
    io.out(`      信号：${c.signals.map((s) => `${s}（${SIGNAL_LABELS[s]}）`).join('、')}`);
    const registeredPid = (byLocator.get(c.path) ?? [])[0];
    io.out(
      `      状态：${
        registeredPid !== undefined
          ? `已入册（project_id=${registeredPid}），无需重复收编`
          : '未入册，adopt 显式收编（gatedeck adopt <path>）'
      }`,
    );
  }
  io.out('');

  io.out(`—— 已登记项目（${registry.entries.length} 个 · 来源 .gatedeck/registry.md）——`);
  if (!registry.registryExists) {
    io.out('（.gatedeck/registry.md 不存在：当前无 native 注册表登记。）');
  } else if (registry.entries.length === 0) {
    io.out('（registry.md 存在但无登记行。）');
  }
  for (const row of statusRows) {
    const tag = row.status === 'online' ? '在线' : '离线';
    const note =
      row.status === 'online'
        ? ''
        : '（路径已失效：显示「离线」，不静默移除，R-08）';
    io.out(`  [${tag}] ${row.path} —— project_id=${(byLocator.get(row.path) ?? []).join('、')}${note}`);
  }
  for (const pid of unboundProjects) {
    io.out(`  [未知] project_id=${pid} —— registry.local.md 无本地绑定（locator 未登记），无法判定在线/离线`);
  }
  for (const d of registry.diagnostics) io.out(`  ⚠ 解析诊断：${d}`);
  io.out('');

  io.out(`—— 被 .gatedeckignore 忽略的路径（${ignored.length} 个，如实展示不丢弃）——`);
  if (!ignore.fileExists) {
    io.out('（扫描根无 .gatedeckignore，无忽略记录。）');
  } else if (ignored.length === 0) {
    io.out('（.gatedeckignore 存在，无命中路径。）');
  }
  for (const p of ignored) io.out(`  ./${p}`);
  return 0;
}
