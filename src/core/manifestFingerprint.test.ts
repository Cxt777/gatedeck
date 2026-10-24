import { describe, expect, it } from 'vitest';

import {
  MANIFEST_EXCLUDE_DEFAULTS,
  canonicalJson,
  computeManifestFingerprint,
  isExcluded,
  type ManifestEntry,
} from './manifestFingerprint.js';
import { sha256Hex } from './hash.js';

const H_A = '7b16679becd3fb8efca6bc4a5e1ade884d91a342bbbce61dd415b5de999d5af8'; // sha256('内容甲')，外部 node:crypto 预计算
const H_B = 'c52c973a9f46fd8f267582fc48344923fc3c448dcff0794aab2b47b6434aab02'; // sha256('规则乙')，外部 node:crypto 预计算
const H_C = '1111111111111111111111111111111111111111111111111111111111111111';

const entry = (path: string, role: ManifestEntry['role'] = 'checked-file', contentHash = H_A): ManifestEntry => ({
  path,
  role,
  contentHash,
});

describe('isExcluded（最小 glob：精确 / "*" / "**"）', () => {
  it('精确匹配：命中自身，不放行前缀相似路径', () => {
    expect(isExcluded('pm/changelog.md', MANIFEST_EXCLUDE_DEFAULTS)).toBe(true);
    expect(isExcluded('pm/changelog2.md', MANIFEST_EXCLUDE_DEFAULTS)).toBe(false);
    expect(isExcluded('docs/pm/changelog.md', MANIFEST_EXCLUDE_DEFAULTS)).toBe(false);
  });

  it('"**" 任意多段命中，"*" 只匹配单段（a/b/c 对 a/** 命中、对 a/* 不命中）', () => {
    expect(isExcluded('a/b/c', ['a/**'])).toBe(true);
    expect(isExcluded('a/b', ['a/**'])).toBe(true);
    expect(isExcluded('a/b/c', ['a/*'])).toBe(false); // '*' 不跨段
    expect(isExcluded('a/b', ['a/*'])).toBe(true);
    expect(isExcluded('dist/app.js', ['dist/**'])).toBe(true);
    expect(isExcluded('node_modules/vitest/dist/index.js', ['node_modules/**'])).toBe(true);
    expect(isExcluded('.gatedeck/cache/proj/v1.json', ['.gatedeck/cache/**'])).toBe(true);
  });

  it('段内 "*" 匹配任意字符（含空），不跨段', () => {
    expect(isExcluded('src/a.ts', ['src/*.ts'])).toBe(true);
    expect(isExcluded('src/core/a.ts', ['src/*.ts'])).toBe(false); // 跨段不放行
    expect(isExcluded('src/ab.ts', ['src/a*b.ts'])).toBe(true); // '*' 取空串也命中
    expect(isExcluded('src/ab.tsx', ['src/a*b.ts'])).toBe(false); // 结尾不符 → 不命中
    expect(isExcluded('src/aXXb.ts', ['src/a*b.ts'])).toBe(true);
  });

  it('多模式任一命中即排除；全不命中放行', () => {
    expect(isExcluded('pm/changelog.md', ['nope/**', 'pm/changelog.md'])).toBe(true);
    expect(isExcluded('pm/wbs.md', MANIFEST_EXCLUDE_DEFAULTS)).toBe(false);
    expect(isExcluded('pm/insights.md', MANIFEST_EXCLUDE_DEFAULTS)).toBe(false); // insights 非排除对象
  });
});

describe('computeManifestFingerprint · canonical 与排除', () => {
  it('canonical 排序稳定性：乱序输入与有序输入得到同一 manifestHash 与同一顺序', () => {
    const ordered = [entry('pm/a.md'), entry('pm/b.md', 'rule-file', H_B), entry('src/core/x.ts', 'script', H_C)];
    const shuffled = [ordered[2]!, ordered[0]!, ordered[1]!];
    const r1 = computeManifestFingerprint({ entries: ordered });
    const r2 = computeManifestFingerprint({ entries: shuffled });
    if (!r1.ok || !r2.ok) throw new Error('用例前置失败：输入本应合法');
    expect(r2.manifestHash).toBe(r1.manifestHash);
    expect(r2.entries.map((e) => e.path)).toEqual(['pm/a.md', 'pm/b.md', 'src/core/x.ts']); // 已 canonical 排序
    expect(r1.entries.map((e) => e.path)).toEqual(r2.entries.map((e) => e.path));
  });

  it('默认排除：changelog 自身排除，insights 保留（放行口径）', () => {
    const r = computeManifestFingerprint({
      entries: [entry('pm/changelog.md'), entry('pm/insights.md'), entry('pm/wbs.md')],
    });
    if (!r.ok) throw new Error('用例前置失败：输入本应合法');
    expect(r.entries.map((e) => e.path)).toEqual(['pm/insights.md', 'pm/wbs.md']);
    expect(r.excluded).toEqual(['pm/changelog.md']);
  });

  it('excluded 如实返回不静默：缓存与构建产物进 excluded，不出现在 entries', () => {
    const r = computeManifestFingerprint({
      entries: [
        entry('.gatedeck/cache/x.json'),
        entry('dist/bundle.js'),
        entry('coverage/lcov.info'),
        entry('node_modules/vitest/index.js'),
        entry('src/core/y.ts'),
      ],
    });
    if (!r.ok) throw new Error('用例前置失败：输入本应合法');
    expect(r.excluded).toEqual(['.gatedeck/cache/x.json', 'coverage/lcov.info', 'dist/bundle.js', 'node_modules/vitest/index.js']);
    expect(r.entries.map((e) => e.path)).toEqual(['src/core/y.ts']);
    const keptPaths = r.entries.map((e) => e.path);
    for (const p of r.excluded) expect(keptPaths).not.toContain(p);
  });

  it('extraExcludes 追加排除，默认模式仍然生效', () => {
    const r = computeManifestFingerprint({
      entries: [entry('pm/notes/draft.md'), entry('dist/x.js')],
      extraExcludes: ['pm/notes/**'],
    });
    if (!r.ok) throw new Error('用例前置失败：输入本应合法');
    expect(r.excluded).toEqual(['dist/x.js', 'pm/notes/draft.md']); // excluded 亦按字典序
    expect(r.entries).toHaveLength(0);
  });

  it('manifestHash 与 canonicalJson(排序后条目) 的 sha256Hex 一致（内部对拍）', () => {
    const entries = [entry('pm/a.md'), entry('pm/规则/决策.md', 'rule-file', H_B)];
    const r = computeManifestFingerprint({ entries });
    if (!r.ok) throw new Error('用例前置失败：输入本应合法');
    expect(r.manifestHash).toBe(sha256Hex(canonicalJson(r.entries)));
  });
});

describe('computeManifestFingerprint · 拒绝（P-08 宁可拒绝）', () => {
  it('同 path 重复（hash 一致）→ duplicate-path-conflict', () => {
    const r = computeManifestFingerprint({ entries: [entry('pm/a.md'), entry('pm/b.md'), entry('pm/a.md')] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('duplicate-path-conflict');
    expect(r.message).toContain('pm/a.md');
    expect(r.entries).toHaveLength(3); // 回带原始条目供定位
  });

  it('同 path 重复（hash 不一致）同样拒绝，不以内容为转移', () => {
    const r = computeManifestFingerprint({ entries: [entry('pm/a.md', 'checked-file', H_A), entry('pm/a.md', 'checked-file', H_B)] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('duplicate-path-conflict');
  });

  it('contentHash 非法（大写 / 位数不足 / 非 hex）→ invalid-entry', () => {
    for (const bad of [H_A.toUpperCase(), H_A.slice(0, 63), 'z' + H_A.slice(1), '']) {
      const r = computeManifestFingerprint({ entries: [entry('pm/a.md', 'checked-file', bad)] });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('invalid-entry');
    }
  });

  it('path 为空（含纯空白）→ invalid-entry', () => {
    for (const p of ['', '   ']) {
      const r = computeManifestFingerprint({ entries: [entry(p)] });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('invalid-entry');
    }
  });

  it('role 非法 → invalid-entry（运行时拦截 JSON/外部垃圾值）', () => {
    const r = computeManifestFingerprint({
      entries: [entry('pm/a.md', 'not-a-role' as ManifestEntry['role'])],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('invalid-entry');
    expect(r.message).toContain('not-a-role');
  });

  it('校验先于排除：重复条目即使将被排除也拒绝（宁可拒绝，不因兜底放行畸形）', () => {
    const r = computeManifestFingerprint({ entries: [entry('dist/x.js'), entry('dist/x.js', 'script', H_B)] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('duplicate-path-conflict');
  });
});

describe('manifestHash 敏感性与外部对拍', () => {
  const base = [entry('pm/a.md'), entry('pm/规则/决策.md', 'rule-file', H_B)];
  const baseHash = computeManifestFingerprint({ entries: base });
  if (!baseHash.ok) throw new Error('用例前置失败：base 输入本应合法');

  it('hash 变化敏感性：任一 contentHash 改一字节 / role 变化 / 新增条目 → manifestHash 必变', () => {
    const hashOf = (entries: ManifestEntry[]): string | null => {
      const r = computeManifestFingerprint({ entries });
      return r.ok ? r.manifestHash : null;
    };
    const flipped = H_A.slice(0, 10) + (H_A[10] === 'a' ? 'b' : 'a') + H_A.slice(11); // 第 11 位 hex 改一字节
    expect(hashOf([entry('pm/a.md', 'checked-file', flipped), base[1]!])).not.toBe(baseHash.manifestHash);
    expect(hashOf([entry('pm/a.md', 'script'), base[1]!])).not.toBe(baseHash.manifestHash); // role 属于对象口径
    expect(hashOf([...base, entry('pm/extra.md', 'checked-file', H_C)])).not.toBe(baseHash.manifestHash);
  });

  it('含中文路径：保留并参与指纹，与等价 ASCII 路径得到不同 hash', () => {
    const r = computeManifestFingerprint({ entries: [entry('pm/规则/决策.md', 'rule-file', H_B)] });
    const ascii = computeManifestFingerprint({ entries: [entry('pm/rules/decision.md', 'rule-file', H_B)] });
    expect(r.ok && ascii.ok).toBe(true);
    if (r.ok && ascii.ok) {
      expect(r.entries[0]!.path).toBe('pm/规则/决策.md'); // 不改写、不转写
      expect(r.manifestHash).not.toBe(ascii.manifestHash);
    }
  });

  it('手算向量：与外部 node:crypto 独立预计算值对拍', () => {
    // 向量外部计算（node:crypto，与本模块纯实现互验）：
    //   contentHash1 = sha256('内容甲') = H_A；contentHash2 = sha256('规则乙') = H_B
    //   canonical = 'pm/a.md\0checked-file\0<H_A>\npm/规则.md\0rule-file\0<H_B>'（无尾随 \n）
    //   manifestHash = sha256(canonical) = 907bf53351c3b1f021d79371c3b407dfe292f05d33faec7281121bfbed8bbf27
    const r = computeManifestFingerprint({ entries: [entry('pm/规则.md', 'rule-file', H_B), entry('pm/a.md')] });
    expect(r).toMatchObject({
      ok: true,
      manifestHash: '907bf53351c3b1f021d79371c3b407dfe292f05d33faec7281121bfbed8bbf27',
    });
    // 手算 canonical 行逐字节可复算（\u0000 分隔、\n 连接、无尾随 \n）
    expect(canonicalJson([entry('pm/a.md'), entry('pm/规则.md', 'rule-file', H_B)])).toBe(
      'pm/a.md\u0000checked-file\u0000' + H_A + '\npm/规则.md\u0000rule-file\u0000' + H_B,
    );
  });
});
