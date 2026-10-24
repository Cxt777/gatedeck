/**
 * canonical manifest 指纹（T-M1-03 / W-S2-3；基准 D-25 / P-08 / B-3）。
 *
 * 设计要点：
 *  - **manifest 是「门禁检查对象的快照清单」**：被检文件、规则文件、引用脚本、runner
 *    配置各占一条，逐条携带工作区当前内容的 sha256，整体折叠为单一 manifestHash。
 *    T-M1-04 将其写入凭证 subject_manifest_hash，并以「重算 hash ≠ 凭证 hash」判定
 *    「待复验」（B-3 对象或规则变化）；
 *  - **canonical 化四步**：条目校验（含同 path 冲突检测）→ 排除过滤（默认 + 额外，
 *    被排除项记入 excluded 如实返回，不静默丢弃）→ 按 path 字典序排序 → 稳定序列化
 *    后取 SHA-256。乱序输入必得同一 hash，杜绝「文件系统枚举顺序」进入指纹；
 *  - **contentHash 口径由壳层负责**：core 只接收条目，不做 IO、不重算内容 hash。
 *    「含未提交 diff」的语义由口径保证——壳层必须用 optimisticWrite.contentVersion
 *    基于磁盘当前字节计算，而非 git blob hash，未提交修改同样计入指纹；
 *  - **宁可拒绝（P-08）**：同 path 出现两次（无论 hash 是否一致）即 duplicate-path-conflict；
 *    校验（含冲突检测）作用于全部输入条目、先于排除过滤——将被排除的重复/非法条目
 *    同样拒绝，不因「反正要被排除」而放行畸形输入；
 *  - **诚实边界**：canonical 行以 \u0000 分隔字段、\n 连接记录（见 canonicalJson JSDoc）；
 *    path 若含这两个字符会引入行歧义，本任务规格的 invalid-entry 条件未包含此形态，
 *    壳层采集仓库相对路径不应产生此类 path（如实披露局限，不虚报无此问题）。
 *
 * 纯字符串/数组计算，无 IO（core 纯度约束）。
 */

import { sha256Hex } from './hash.js';

/** manifest 条目角色：门禁检查对象清单中的四类成员（D-25） */
export type ManifestRole = 'checked-file' | 'rule-file' | 'script' | 'runner-config';

/** 全部合法角色（运行时校验用；TS 静态类型无法拦截来自 JSON/外部的垃圾值） */
const ROLES: readonly string[] = ['checked-file', 'rule-file', 'script', 'runner-config'];

export interface ManifestEntry {
  /** 仓库相对路径，'/' 分隔（壳层采集口径；'\' 不做分隔符归一，按字面字符参与匹配） */
  path: string;
  role: ManifestRole;
  /**
   * 工作区当前内容的 sha256（64 位小写 hex）。
   *
   * 口径：**基于磁盘当前内容**计算——含未提交 diff 的语义即由此而来（hash 反映
   * 工作区此刻的真实字节，而非 git 提交历史的 blob）。壳层用
   * `optimisticWrite.contentVersion` 计算（同源 SHA-256，杜绝双口径）；
   * core 只接收条目，不读文件、不重算、不归一化大小写。
   */
  contentHash: string;
}

/**
 * 默认排除模式（字面量 glob 风格字符串，匹配语义见 isExcluded）：
 *  - changelog 自身（pm/changelog.md）：追加式日志逐次任务膨胀，纳入指纹只会迫使
 *    无意义的「待复验」；**pm/insights.md 不在排除之列**（洞察文档属检查对象口径，
 *    非 changelog）；
 *  - 缓存与派生产物（.gatedeck/cache/**、dist/**、coverage/**、node_modules/**）：
 *    可再生内容不参与「对象或规则变化」判定（B-3），否则每次构建都会误报待复验。
 */
export const MANIFEST_EXCLUDE_DEFAULTS: readonly string[] = [
  'pm/changelog.md',
  '.gatedeck/cache/**',
  'dist/**',
  'coverage/**',
  'node_modules/**',
];

/**
 * 最小 glob 匹配（纯字符串/数组回溯实现，不含正则递归引擎）：
 *  - 模式与 path 都按 '/' 分段，逐段比对；
 *  - '**' 段匹配任意多段（**含 0 段**，即目录整体排除语义）：'a/**' 命中 'a/b'、
 *    'a/b/c'，也命中 'a' 本身；
 *  - '*' 在单段内匹配任意字符（含空），不跨段：'a/*' 命中 'a/b'，不命中 'a/b/c'；
 *  - 其余段/字符精确匹配。
 *
 * path 为空时仅空模式（''）可命中——computeManifestFingerprint 的条目校验先于
 * 排除过滤，空 path 不会走到这里（调用方直接使用时按上述语义理解）。
 */
export function isExcluded(path: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => matchGlob(path, p));
}

/** 单模式匹配：按 '/' 分段后逐段比对 */
function matchGlob(path: string, pattern: string): boolean {
  return matchSegments(path.split('/'), pattern.split('/'));
}

/** 段序列回溯匹配：patSegs 消耗完时 pathSegs 必须同时耗尽 */
function matchSegments(pathSegs: string[], patSegs: string[]): boolean {
  const pat = patSegs[0];
  if (pat === undefined) return pathSegs.length === 0; // 模式耗尽：路径也须耗尽
  if (pat === '**') {
    // '**' 匹配 0..n 段，逐个切分位置回溯
    for (let i = 0; i <= pathSegs.length; i++) {
      if (matchSegments(pathSegs.slice(i), patSegs.slice(1))) return true;
    }
    return false;
  }
  const seg = pathSegs[0];
  if (seg === undefined) return false; // 模式还有段而路径已耗尽
  if (!matchSegment(seg, pat)) return false;
  return matchSegments(pathSegs.slice(1), patSegs.slice(1));
}

/** 单段匹配：段内 '*'+字面字符混合（'*' 匹配段内任意子串，含空） */
function matchSegment(seg: string, pat: string): boolean {
  return matchChars(seg, 0, pat, 0);
}

function matchChars(seg: string, si: number, pat: string, pi: number): boolean {
  if (pi >= pat.length) return si >= seg.length; // 模式耗尽：段也须耗尽
  if (pat[pi] === '*') {
    for (let k = si; k <= seg.length; k++) {
      if (matchChars(seg, k, pat, pi + 1)) return true; // '*' 吞 0..n 字符
    }
    return false;
  }
  if (si >= seg.length || seg[si] !== pat[pi]) return false; // 字面字符必须逐位一致
  return matchChars(seg, si + 1, pat, pi + 1);
}

/**
 * canonical 稳定序列化（名为 JSON，实为**行式序列化**，刻意避开 JSON 的键序歧义）：
 *  - 每条目序列化为一行 `path + '\u0000' + role + '\u0000' + contentHash`；
 *  - 行间以 '\n' 连接，**不含尾随 '\n'**；空条目集序列化为空字符串 ''。
 *
 * \u0000 与 \n 为字段/记录分隔符：role 与 contentHash 取值受限（见校验），path 理论上
 * 可含这两字符造成行歧义——局限与不拒绝的理由见模块头「诚实边界」。
 *
 * 须传入**已按 path 排序**的条目（computeManifestFingerprint 内部保证）；单独调用时
 * 排序责任在调用方——同一集合不同顺序会得到不同字符串（本函数不做排序，职责单一）。
 */
export function canonicalJson(entries: readonly ManifestEntry[]): string {
  return entries.map((e) => `${e.path}\u0000${e.role}\u0000${e.contentHash}`).join('\n');
}

export type ManifestResult =
  | {
      ok: true;
      /** manifest 指纹 = sha256Hex(canonicalJson(排序后条目))，64 位小写 hex */
      manifestHash: string;
      /** canonical（path 字典序，按 UTF-16 码元）排序后的纳入条目，与指纹输入一致 */
      entries: ManifestEntry[];
      /** 被排除条目的 path（同样字典序），如实返回不静默 */
      excluded: string[];
    }
  | {
      ok: false;
      code: 'duplicate-path-conflict' | 'invalid-entry';
      /** 面向用户的拒绝说明（含处置建议，不虚报） */
      message: string;
      /** 原始输入条目（保持输入顺序，供壳层展示定位问题） */
      entries?: ManifestEntry[];
    };

/** 字典序比较（UTF-16 码元，JS 原生 `<`/`>` 语义；确定且与排序无关环境） */
function byPath(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const HASH_RE = /^[0-9a-f]{64}$/;

/**
 * 计算 canonical manifest 指纹（D-25）。
 *
 * 流程（失败即短路拒绝，宁可拒绝不猜测放行，P-08）：
 *  1. **条目校验**（作用于全部输入条目，先于排除过滤）：
 *     - path 为空（'' 或纯空白）→ invalid-entry；
 *     - contentHash 非 64 位小写 hex（**不归一化**大写/空白——凭证口径宁严勿宽）
 *       → invalid-entry；
 *     - role 不在四类合法值内 → invalid-entry；
 *     - 同 path 出现两次（无论 hash 是否一致）→ duplicate-path-conflict；
 *  2. **排除过滤**：MANIFEST_EXCLUDE_DEFAULTS + extraExcludes 逐条匹配，命中者记入
 *     excluded 返回（不静默丢弃），其余纳入；
 *  3. **canonical 排序**：按 path 字典序排序（乱序输入同 hash）；
 *  4. **取指纹**：manifestHash = sha256Hex(canonicalJson(排序后条目))。
 *
 * manifestHash 语义：**纳入条目集合（增/删/换 path）、任一 contentHash 或 role 变化
 * （一字节差异即变）、或排除规则变化导致纳入集合变化 → hash 必变**。T-M1-04 将其写入
 * 凭证 subject_manifest_hash，并以「重算 hash ≠ 凭证 hash」判定「待复验」（B-3 对象或
 * 规则变化）；changelog 自身与缓存/构建产物被默认排除，其日常追加/再生不触发待复验。
 */
export function computeManifestFingerprint(input: {
  entries: ManifestEntry[];
  extraExcludes?: string[];
}): ManifestResult {
  const entries = input.entries;

  // ① 条目校验：逐条「先字段、后重复」，首见即拒，回带原始条目供定位
  const seen = new Set<string>();
  for (const e of entries) {
    if (e.path === '' || e.path.trim() === '') {
      return {
        ok: false,
        code: 'invalid-entry',
        message:
          `指纹计算拒绝（P-08）：存在 path 为空的条目（role=${e.role}）。` +
          '空路径无法定位检查对象，请修正条目后重算，不猜测其归属。',
        entries,
      };
    }
    if (!HASH_RE.test(e.contentHash)) {
      return {
        ok: false,
        code: 'invalid-entry',
        message:
          `指纹计算拒绝（P-08）：条目 ${e.path} 的 contentHash 不是 64 位小写十六进制 SHA-256` +
          `（收到 ${e.contentHash === '' ? '空串' : `"${e.contentHash}"`}）。` +
          '请用 optimisticWrite.contentVersion 基于磁盘当前字节重新计算（不归一化大写）。',
        entries,
      };
    }
    if (!ROLES.includes(e.role)) {
      return {
        ok: false,
        code: 'invalid-entry',
        message:
          `指纹计算拒绝（P-08）：条目 ${e.path} 的 role "${String(e.role)}" 不在合法值内` +
          `（${ROLES.join(' / ')}）。请修正角色后重算。`,
        entries,
      };
    }
    if (seen.has(e.path)) {
      return {
        ok: false,
        code: 'duplicate-path-conflict',
        message:
          `指纹计算拒绝（P-08）：path "${e.path}" 出现两次（无论内容 hash 是否一致）。` +
          '同一检查对象必须唯一，宁可拒绝不猜测以哪条为准；请去重后重算。',
        entries,
      };
    }
    seen.add(e.path);
  }

  // ② 排除过滤（默认 + 额外）：命中记入 excluded，不静默丢弃
  const patterns = [...MANIFEST_EXCLUDE_DEFAULTS, ...(input.extraExcludes ?? [])];
  const kept: ManifestEntry[] = [];
  const excluded: string[] = [];
  for (const e of entries) {
    if (isExcluded(e.path, patterns)) excluded.push(e.path);
    else kept.push(e);
  }

  // ③ canonical 排序：纳入条目与 excluded 均按 path 字典序，结果确定
  const sorted = [...kept].sort((a, b) => byPath(a.path, b.path));
  excluded.sort(byPath);

  // ④ 稳定序列化取指纹
  return {
    ok: true,
    manifestHash: sha256Hex(canonicalJson(sorted)),
    entries: sorted,
    excluded,
  };
}
