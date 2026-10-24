import { describe, expect, it } from 'vitest';

import {
  applyIgnore,
  classifyCandidates,
  markOffline,
  type ScannedPath,
} from './discoverRules.js';

/** 便捷构造：按存在性布尔生成扫描观测 */
function scanned(path: string, pmDir: boolean, projectIndex: boolean, wbsMd: boolean): ScannedPath {
  return { path, exists: { pmDir, projectIndex, wbsMd } };
}

describe('候选判定 classifyCandidates（T-M1-02）', () => {
  it('三信号全有 → 三信号按固定顺序全部保留', () => {
    const out = classifyCandidates([scanned('proj', true, true, true)]);
    expect(out).toEqual([
      { path: 'proj', signals: ['has-pm-dir', 'has-project-index', 'has-wbs-md'] },
    ]);
  });

  it('部分信号组合逐布尔映射（只 pm/；只 PROJECTS-INDEX.md；pm/wbs.md 组合）', () => {
    const out = classifyCandidates([
      scanned('a', true, false, false),
      scanned('b', false, true, false),
      scanned('c', false, false, true),
      scanned('d', true, false, true),
    ]);
    expect(out).toEqual([
      { path: 'a', signals: ['has-pm-dir'] },
      { path: 'b', signals: ['has-project-index'] },
      { path: 'c', signals: ['has-wbs-md'] },
      { path: 'd', signals: ['has-pm-dir', 'has-wbs-md'] },
    ]);
  });

  it('三信号全无的路径不返回（非候选），其余候选不受影响', () => {
    const out = classifyCandidates([
      scanned('empty-dir', false, false, false),
      scanned('real-proj', true, false, false),
      scanned('another-empty', false, false, false),
    ]);
    expect(out).toEqual([{ path: 'real-proj', signals: ['has-pm-dir'] }]);
  });

  it('空输入 → 空数组', () => {
    expect(classifyCandidates([])).toEqual([]);
  });

  it('中文路径作为候选原样保留', () => {
    const out = classifyCandidates([scanned('项目甲/子工程', true, true, false)]);
    expect(out).toEqual([
      { path: '项目甲/子工程', signals: ['has-pm-dir', 'has-project-index'] },
    ]);
  });
});

describe('.gatedeckignore 最小 glob applyIgnore', () => {
  it('glob 边界：a/b/c 命中 a/**（** 跨多段），不命中 a/*（* 仅单段）', () => {
    const { kept, ignored } = applyIgnore(['a/b/c', 'a/b', 'a'], ['a/**']);
    expect(ignored).toEqual(['a/b/c', 'a/b', 'a']); // ** 含零段：a 本身也命中
    expect(kept).toEqual([]);

    const single = applyIgnore(['a/b/c', 'a/b', 'a/x', 'a'], ['a/*']);
    expect(single.kept).toEqual(['a/b/c', 'a']);
    expect(single.ignored).toEqual(['a/b', 'a/x']);
  });

  it('精确匹配与单段内 * 通配：node_* 命中 node_modules，不命中 a/node_modules', () => {
    const { kept, ignored } = applyIgnore(
      ['node_modules', 'node_cache', 'libs/node_modules', 'src'],
      ['node_*'],
    );
    expect(ignored).toEqual(['node_modules', 'node_cache']);
    expect(kept).toEqual(['libs/node_modules', 'src']);
  });

  it('被忽略项记入 ignored 不静默丢弃，kept 保持输入顺序', () => {
    const { kept, ignored } = applyIgnore(
      ['p3', 'skip-me', 'p1', 'also-skip', 'p2'],
      ['skip-me', 'also-skip'],
    );
    expect(kept).toEqual(['p3', 'p1', 'p2']);
    expect(ignored).toEqual(['skip-me', 'also-skip']);
  });

  it('中文路径与中文模式可匹配；空模式列表 → 全部 kept', () => {
    const cn = applyIgnore(['沙盒/临时项目', '正式项目'], ['沙盒/**']);
    expect(cn.ignored).toEqual(['沙盒/临时项目']);
    expect(cn.kept).toEqual(['正式项目']);

    const none = applyIgnore(['a/b', 'c'], []);
    expect(none).toEqual({ kept: ['a/b', 'c'], ignored: [] });
  });

  it('空输入 → kept/ignored 均为空', () => {
    expect(applyIgnore([], ['a/**'])).toEqual({ kept: [], ignored: [] });
  });
});

describe('注册表条目离线标记 markOffline（R-08：不静默移除）', () => {
  it('existingPaths 缺席的条目 → offline，在场的 → online；输出与输入同序同量', () => {
    const rows = markOffline(
      [{ path: 'alive' }, { path: 'gone' }, { path: 'alive-too' }],
      ['alive', 'alive-too', 'other'],
    );
    expect(rows).toEqual([
      { path: 'alive', status: 'online' },
      { path: 'gone', status: 'offline' },
      { path: 'alive-too', status: 'online' },
    ]);
  });

  it('空 entries / 空 existingPaths 边界', () => {
    expect(markOffline([], ['a'])).toEqual([]);
    expect(markOffline([{ path: 'a' }], [])).toEqual([{ path: 'a', status: 'offline' }]);
    expect(markOffline([], [])).toEqual([]);
  });

  it('路径比较为规范化字符串全等：大小写与分隔符差异视为不同路径', () => {
    const rows = markOffline([{ path: 'Proj/A' }], ['proj/a', 'Proj/A/']);
    expect(rows).toEqual([{ path: 'Proj/A', status: 'offline' }]);
  });
});
