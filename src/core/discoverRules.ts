/**
 * discover / adopt 判定内核（T-M1-02 / W-S2-2）。
 *
 * 职责三分（路径列表一律由壳层扫描后传入，本模块只做纯判定，core 纯度约束）：
 *  - classifyCandidates：候选项目三信号判定——pm/ 目录、PROJECTS-INDEX.md、pm/wbs.md；
 *    三信号全无的路径不是候选，不返回（宁缺勿滥：非候选不得被 adopt 收编）；
 *  - applyIgnore：.gatedeckignore 最小 glob 过滤——`**` 跨多段任意、`*` 单段内任意、
 *    其余逐字精确；被忽略的路径记入 ignored 如实展示，绝不静默丢弃（R-08 精神）；
 *  - markOffline：注册表条目的路径在现有路径集合中找不到 → offline（显示「离线」，
 *    不剔除条目——注册表 append-only，路径失效不静默移除，R-08）。
 *
 * 约定：本模块内的 path 一律是「/」分隔的规范化字符串（Windows 反斜杠由壳层归一），
 * core 不做路径系统调用、不区分大小写语义（比较按字符串原样）。
 */

/** 候选信号：pm/ 目录存在 */
export type DiscoverSignal = 'has-pm-dir' | 'has-project-index' | 'has-wbs-md';

/** 壳层扫描后的单条路径观测（存在性由壳层用文件系统判定后传入） */
export interface ScannedPath {
  path: string;
  exists: {
    /** pm/ 目录存在 */
    pmDir: boolean;
    /** PROJECTS-INDEX.md 存在 */
    projectIndex: boolean;
    /** pm/wbs.md 存在 */
    wbsMd: boolean;
  };
}

/** 候选项目：至少命中一个信号；signals 按固定顺序（pm 目录 → 项目索引 → wbs） */
export interface DiscoverCandidate {
  path: string;
  signals: DiscoverSignal[];
}

/** 候选判定：按布尔观测映射为信号序列；三信号全无的路径不返回（非候选） */
export function classifyCandidates(scanned: readonly ScannedPath[]): DiscoverCandidate[] {
  const candidates: DiscoverCandidate[] = [];
  for (const s of scanned) {
    const signals: DiscoverSignal[] = [];
    if (s.exists.pmDir) signals.push('has-pm-dir');
    if (s.exists.projectIndex) signals.push('has-project-index');
    if (s.exists.wbsMd) signals.push('has-wbs-md');
    if (signals.length === 0) continue; // 三信号全无 → 非候选，不进预览
    candidates.push({ path: s.path, signals });
  }
  return candidates;
}

/* ---------------------------------------------------------------- *
 * .gatedeckignore 最小 glob
 * ---------------------------------------------------------------- */

/** 把路径/模式按「/」切段，滤掉空段（兼容开头「./」、重复分隔符） */
function splitSegments(s: string): string[] {
  return s.split('/').filter((seg) => seg !== '' && seg !== '.');
}

/** 单段内匹配：段内 `*` 通配任意字符序列（不跨「/」），其余逐字精确 */
function matchSegment(pattern: string, segment: string): boolean {
  if (!pattern.includes('*')) return pattern === segment;
  const parts = pattern.split('*');
  let pos = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part === '') continue; // 连续或首尾的 `*`：空片段，吞任意
    if (i === 0) {
      if (!segment.startsWith(part)) return false;
      pos = part.length;
    } else if (i === parts.length - 1) {
      if (!segment.endsWith(part) || segment.length - part.length < pos) return false;
      pos = segment.length;
    } else {
      const idx = segment.indexOf(part, pos);
      if (idx === -1) return false;
      pos = idx + part.length;
    }
  }
  return true;
}

/** 段序列匹配：`**` 段匹配零或多段；其余段逐段 matchSegment */
function matchSegments(pattern: readonly string[], segments: readonly string[]): boolean {
  const head = pattern[0];
  if (head === undefined) return segments.length === 0;
  const rest = pattern.slice(1);
  if (head === '**') {
    for (let i = 0; i <= segments.length; i++) {
      if (matchSegments(rest, segments.slice(i))) return true;
    }
    return false;
  }
  if (segments.length === 0) return false;
  return matchSegment(head, segments[0]!) && matchSegments(rest, segments.slice(1));
}

/** 单条路径是否命中任一忽略模式 */
function isIgnored(path: string, patterns: readonly string[]): boolean {
  const segments = splitSegments(path);
  return patterns.some((p) => matchSegments(splitSegments(p), segments));
}

export interface IgnoreFilterResult {
  /** 未被任何模式命中的路径（保持输入顺序） */
  kept: string[];
  /** 被忽略的路径（保持输入顺序；如实记录，不静默丢弃） */
  ignored: string[];
}

/**
 * .gatedeckignore 过滤（最小 glob）：
 *  - `**`：跨多段任意（含零段）——`a/**` 命中 `a/b`、`a/b/c`（也命中 `a` 本身）；
 *  - `*`：单段内任意——`a/*` 命中 `a/b`，不命中 `a/b/c`；
 *  - 其余字符逐字精确。
 * 被忽略的路径记入 ignored（R-08 精神：不静默丢弃，预览时如实展示）。
 */
export function applyIgnore(paths: readonly string[], ignorePatterns: readonly string[]): IgnoreFilterResult {
  const kept: string[] = [];
  const ignored: string[] = [];
  for (const p of paths) {
    if (isIgnored(p, ignorePatterns)) ignored.push(p);
    else kept.push(p);
  }
  return { kept, ignored };
}

/* ---------------------------------------------------------------- *
 * 注册表条目在线/离线标记（路径失效 → 显示「离线」，不静默移除）
 * ---------------------------------------------------------------- */

export type RegistryEntryStatus = 'online' | 'offline';

/** 注册表条目的路径有效性标记行（与输入同序同量：条目永不被剔除） */
export interface RegistryEntryStatusRow {
  path: string;
  status: RegistryEntryStatus;
}

/**
 * 标记注册表条目路径有效性：existingPaths 不含该路径 → offline。
 * 逐条输出（与输入同序同量）——路径失效显示「离线」，绝不从列表中移除（R-08 精神）。
 * 路径比较为规范化字符串全等（壳层负责两侧归一为「/」分隔形式）。
 */
export function markOffline(
  entries: readonly { path: string }[],
  existingPaths: readonly string[],
): RegistryEntryStatusRow[] {
  const existing = new Set(existingPaths);
  return entries.map((e) => ({ path: e.path, status: existing.has(e.path) ? 'online' : 'offline' }));
}
