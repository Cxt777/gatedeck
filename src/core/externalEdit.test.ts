import { describe, expect, it } from 'vitest';

import {
  nextBaseline,
  observeExternalEdit,
  summarizeExternalScan,
  type ExternalObservation,
} from './externalEdit.js';
import { contentVersion } from './optimisticWrite.js';

const T0 = '2026-10-23T22:00:00+08:00';
const T1 = '2026-10-23T23:30:00+08:00';
const DOC_A = '# gatedeck\n\n状态：进行中\n';
const DOC_B = '# gatedeck\n\n状态：已推进\n';

describe('nextBaseline（受管写路径基线，T-M0b-07）', () => {
  it('基线指纹与 contentVersion 同源（杜绝双口径）', () => {
    const b = nextBaseline('pm/wbs.md', DOC_A);
    expect(b.path).toBe('pm/wbs.md');
    expect(b.fingerprint).toEqual(contentVersion(DOC_A));
  });

  it('path 为空抛出（调用方 bug，不静默）', () => {
    expect(() => nextBaseline('  ', DOC_A)).toThrow(/path 不能为空/);
  });
});

describe('observeExternalEdit（指纹比对 + observed_at）', () => {
  it('B-2 外部编辑器竞争：受管写入后外部改写 → external-change 可检测', () => {
    const baseline = nextBaseline('pm/wbs.md', DOC_A).fingerprint;
    const obs = observeExternalEdit({ path: 'pm/wbs.md', baseline, currentContent: DOC_B, observedAt: T1 });
    expect(obs.status).toBe('external-change');
    expect(obs.baseline).toEqual(contentVersion(DOC_A));
    expect(obs.current).toEqual(contentVersion(DOC_B));
    expect(obs.intermediateUnknown).toBe(true); // 中间过程不可观察，标未知
  });

  it('未变化：字节一致 → unchanged，指纹相同；中间过程仍不可观察（评审中·1 闭环）', () => {
    const baseline = nextBaseline('pm/changelog.md', DOC_A).fingerprint;
    const obs = observeExternalEdit({ path: 'pm/changelog.md', baseline, currentContent: DOC_A, observedAt: T1 });
    expect(obs.status).toBe('unchanged');
    expect(obs.current.contentHash).toBe(obs.baseline!.contentHash);
    // unchanged 只证明端点一致，不主张「期间未变」：intermediateUnknown 恒 true（P-08）
    expect(obs.intermediateUnknown).toBe(true);
  });

  it('仅换行差异（LF→CRLF）即判定变更（字节级指纹，不做归一化）', () => {
    const baseline = nextBaseline('pm/wbs.md', '# 标题\n正文\n').fingerprint;
    const obs = observeExternalEdit({ path: 'pm/wbs.md', baseline, currentContent: '# 标题\r\n正文\r\n', observedAt: T1 });
    expect(obs.status).toBe('external-change');
  });

  it('仅空白差异即判定变更', () => {
    const baseline = nextBaseline('pm/wbs.md', 'a: 1\nb: 2\n').fingerprint;
    const obs = observeExternalEdit({ path: 'pm/wbs.md', baseline, currentContent: 'a: 1\nb:  2\n', observedAt: T1 });
    expect(obs.status).toBe('external-change');
  });

  it('P-08 无基线不编造：untracked 如实标注，不声称 external；观察前历史不可观察', () => {
    const obs = observeExternalEdit({ path: 'pm/project.md', baseline: null, currentContent: DOC_B, observedAt: T1 });
    expect(obs.status).toBe('untracked');
    expect(obs.baseline).toBeNull();
    expect(obs.intermediateUnknown).toBe(true); // 无基线：观察之前的历史完全不可观察（评审中·1 闭环）
    expect(JSON.stringify(obs)).not.toContain('external');
  });

  it('评审中·1 语义锁：三种观察状态 intermediateUnknown 恒为 true，「有无差异」只由 status 区分', () => {
    const baseline = nextBaseline('pm/wbs.md', DOC_A).fingerprint;
    const unchanged = observeExternalEdit({ path: 'pm/wbs.md', baseline, currentContent: DOC_A, observedAt: T1 });
    const changed = observeExternalEdit({ path: 'pm/wbs.md', baseline, currentContent: DOC_B, observedAt: T1 });
    const untracked = observeExternalEdit({ path: 'pm/wbs.md', baseline: null, currentContent: DOC_B, observedAt: T1 });
    expect(unchanged.intermediateUnknown).toBe(true);
    expect(changed.intermediateUnknown).toBe(true);
    expect(untracked.intermediateUnknown).toBe(true);
    // 差异与否不由该字段承载
    expect(unchanged.status).toBe('unchanged');
    expect(changed.status).toBe('external-change');
    expect(untracked.status).toBe('untracked');
  });

  it('P-08 结构性保证：观察结果只有 observedAt，没有任何 occurredAt 字段（不回填发生时间）', () => {
    const baseline = nextBaseline('pm/wbs.md', DOC_A).fingerprint;
    const obs = observeExternalEdit({ path: 'pm/wbs.md', baseline, currentContent: DOC_B, observedAt: T1 });
    const keys = Object.keys(obs);
    expect(keys).toContain('observedAt');
    expect(keys.some((k) => k.toLowerCase().includes('occurred'))).toBe(false);
    // observedAt 逐字保留（不派生、不改写）
    expect(obs.observedAt).toBe(T1);
  });

  it('observedAt 非带时区 ISO 8601 抛出（时钟注入契约）', () => {
    const baseline = nextBaseline('pm/wbs.md', DOC_A).fingerprint;
    for (const bad of ['2026-10-23 22:00:00', '昨天', '2026-10-23T22:00:00']) {
      expect(() =>
        observeExternalEdit({ path: 'pm/wbs.md', baseline, currentContent: DOC_B, observedAt: bad }),
      ).toThrow(/ISO 8601/);
    }
  });

  it('path 为空抛出', () => {
    expect(() =>
      observeExternalEdit({ path: '', baseline: null, currentContent: DOC_A, observedAt: T0 }),
    ).toThrow(/path 不能为空/);
  });
});

describe('summarizeExternalScan（批量汇总，不静默）', () => {
  const mk = (partial: Partial<ExternalObservation>): ExternalObservation => ({
    path: 'pm/x.md',
    status: 'unchanged',
    observedAt: T1,
    baseline: contentVersion(DOC_A),
    current: contentVersion(DOC_A),
    intermediateUnknown: false,
    ...partial,
  });

  it('存在 external-change → needsAttention=true 且分拣正确（不静默重算）', () => {
    const s = summarizeExternalScan([
      mk({ path: 'pm/wbs.md', status: 'external-change', current: contentVersion(DOC_B), intermediateUnknown: true }),
      mk({ path: 'pm/project.md' }),
      mk({ path: 'pm/insights.md', status: 'untracked', baseline: null }),
    ]);
    expect(s.needsAttention).toBe(true);
    expect(s.changes.map((c) => c.path)).toEqual(['pm/wbs.md']);
    expect(s.untracked.map((c) => c.path)).toEqual(['pm/insights.md']);
    expect(s.observations).toHaveLength(3);
  });

  it('全部 unchanged → needsAttention=false', () => {
    const s = summarizeExternalScan([mk({ path: 'pm/a.md' }), mk({ path: 'pm/b.md' })]);
    expect(s.needsAttention).toBe(false);
    expect(s.changes).toHaveLength(0);
  });
});
