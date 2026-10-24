import { describe, expect, it } from 'vitest';

import {
  composeHandoff,
  estimateHandoffTokens,
  HANDOFF_SECTION_ORDER,
  HANDOFF_SECTION_TITLES,
  type HandoffInput,
  type HandoffResult,
  type HandoffSection,
} from './handoffCompose.js';

/** 断言成功并收窄类型（失败即测试失败，不虚报） */
function expectOk(r: HandoffResult): Extract<HandoffResult, { ok: true }> {
  if (!r.ok) throw new Error(`应成功，实际拒绝：${r.code} ${r.message}`);
  return r;
}

/** 断言拒绝并收窄类型 */
function expectFail(r: HandoffResult): Extract<HandoffResult, { ok: false }> {
  if (r.ok) throw new Error(`应拒绝，实际成功：${r.markdown}`);
  return r;
}

/** 标准六段输入（顺序故意乱序，验证按 HANDOFF_SECTION_ORDER 重排） */
function fullSections(): HandoffSection[] {
  return [
    { key: 'acceptance', title: HANDOFF_SECTION_TITLES.acceptance, body: '验收：交接包可被 revive 读取' },
    { key: 'scope', title: HANDOFF_SECTION_TITLES.scope, body: '目标：完成 handoff 交接包' },
    { key: 'failed-paths', title: HANDOFF_SECTION_TITLES['failed-paths'], body: '曾试过直接截断正文——被 B-8 拒绝' },
    { key: 'rules', title: HANDOFF_SECTION_TITLES.rules, body: 'gates.md 全文为适用规则' },
    { key: 'evidence', title: HANDOFF_SECTION_TITLES.evidence, body: '提交过 3 份证据，均已核验' },
    { key: 'decisions', title: HANDOFF_SECTION_TITLES.decisions, body: '依赖 D-24：阶段由事件折叠派生' },
  ];
}

const BASE_INPUT: HandoffInput = {
  project: 'gatedeck',
  sections: fullSections(),
  version: { asOf: '2026-10-24T08:00:00.000Z', sourceVersion: 7 },
  generatedAt: '2026-10-24T12:00:00.000Z',
  softBudgetTokens: 8000,
};

describe('composeHandoff（T-M1-07 交接包组装）', () => {
  it('六段全量渲染：标题行/元信息行/六段标题按固定顺序/尾部签名，estimate 随附', () => {
    const r = expectOk(composeHandoff(BASE_INPUT));
    const orderOf = (needle: string): number => {
      const i = r.markdown.indexOf(needle);
      expect(i, `缺少片段：${needle}`).toBeGreaterThan(-1);
      return i;
    };
    // 结构断言：各段标题与顺序（代替快照文件，避免测试产物落盘）
    expect(orderOf('# handoff · gatedeck') < orderOf('生成时间：2026-10-24T12:00:00.000Z')).toBe(true);
    expect(orderOf('as_of=2026-10-24T08:00:00.000Z · 源版本=7')).toBeLessThan(
      orderOf('## 目标范围'),
    );
    const sectionIdx = HANDOFF_SECTION_ORDER.map((k) => orderOf(`## ${HANDOFF_SECTION_TITLES[k]}`));
    for (let i = 0; i + 1 < sectionIdx.length; i++) {
      expect(sectionIdx[i] ?? -1).toBeLessThan(sectionIdx[i + 1] ?? -1);
    }
    expect(orderOf('——本包由 gatedeck 生成；源版本以上述为准，过期投影请重取')).toBeGreaterThan(
      sectionIdx[sectionIdx.length - 1] ?? -1,
    );
    // estimate 随附且与全文一致
    expect(r.estimate.chars).toBe(r.markdown.length);
    expect(r.estimate.estTokens).toBeGreaterThan(0);
  });

  it('输入乱序不改变渲染顺序：仍按 HANDOFF_SECTION_ORDER 输出（上文用例即乱序输入，此处逐段复核）', () => {
    const r = expectOk(composeHandoff(BASE_INPUT));
    const order = HANDOFF_SECTION_ORDER.map(
      (k) => r.markdown.indexOf(`## ${HANDOFF_SECTION_TITLES[k]}`),
    );
    expect(order.every((i) => i > -1)).toBe(true);
    const sorted = [...order].sort((a, b) => a - b);
    expect(order).toEqual(sorted);
  });

  it('空正文段仍保留段标题（## 已试败路径 后直接接下一段标题）', () => {
    const r = expectOk(
      composeHandoff({
        ...BASE_INPUT,
        sections: fullSections().map((s) =>
          s.key === 'failed-paths' ? { ...s, body: '' } : s,
        ),
      }),
    );
    expect(r.markdown).toContain('## 已试败路径\n\n## 下一步验收');
  });

  it('缺段拒绝：missing-section 携带缺失键列表', () => {
    const r = expectFail(
      composeHandoff({
        ...BASE_INPUT,
        sections: fullSections().filter((s) => s.key !== 'rules' && s.key !== 'acceptance'),
      }),
    );
    expect(r.code).toBe('missing-section');
    expect(r.missing).toEqual(['rules', 'acceptance']);
    expect(r.message).toContain('rules'); // message 以段键列出缺失
    expect(r.message).toContain('acceptance');
  });

  it('未知段拒绝：unknown-section；未知段与缺段并存时未知段优先', () => {
    const unknown = [...fullSections(), { key: 'extra' as never, title: '多余段', body: 'x' }];
    const r1 = expectFail(composeHandoff({ ...BASE_INPUT, sections: unknown }));
    expect(r1.code).toBe('unknown-section');
    expect(r1.message).toContain('extra');

    const both = unknown.filter((s) => s.key !== 'rules'); // 同时缺段
    const r2 = expectFail(composeHandoff({ ...BASE_INPUT, sections: both }));
    expect(r2.code).toBe('unknown-section'); // 校验顺序：未知段先于缺段
  });

  it('非法生成时间拒绝：无时区与乱串均 invalid-generated-at', () => {
    for (const generatedAt of ['2026-10-24T12:00:00', 'not-a-date', '2026-10-24']) {
      const r = expectFail(composeHandoff({ ...BASE_INPUT, generatedAt }));
      expect(r.code).toBe('invalid-generated-at');
      expect(r.message).toContain(generatedAt);
    }
  });

  it('源版本携带：formatVersion 单行进入元信息；空流版本如实显示无参与事件', () => {
    const r = expectOk(composeHandoff(BASE_INPUT));
    expect(r.markdown).toContain('as_of=2026-10-24T08:00:00.000Z · 源版本=7');

    const empty = expectOk(
      composeHandoff({ ...BASE_INPUT, version: { asOf: null, sourceVersion: 0 } }),
    );
    expect(empty.markdown).toContain('as_of=（无参与事件） · 源版本=0');
  });

  it('软预算超限拒绝：message 同时含估算值与预算值两个数值，且不产出 markdown（不静默裁剪）', () => {
    const baseline = expectOk(composeHandoff(BASE_INPUT));
    const budget = baseline.estimate.estTokens - 1; // 人为低于估算 1 token
    const r = expectFail(composeHandoff({ ...BASE_INPUT, softBudgetTokens: budget }));
    expect(r.code).toBe('budget-exceeded');
    expect(r.message).toContain(String(baseline.estimate.estTokens)); // 估算值
    expect(r.message).toContain(String(budget)); // 预算值
    expect('markdown' in r).toBe(false); // 拒绝路径不携带被裁剪的正文
  });

  it('软预算恰好等于估算值时放行（仅 > 预算才拒绝）', () => {
    const baseline = expectOk(composeHandoff(BASE_INPUT));
    const r = composeHandoff({ ...BASE_INPUT, softBudgetTokens: baseline.estimate.estTokens });
    expectOk(r);
    expect(r).toMatchObject({ ok: true });
  });
});

describe('estimateHandoffTokens（B-8 粗估口径手算对拍）', () => {
  it('纯 ASCII：每字符 ×0.25，向上取整', () => {
    expect(estimateHandoffTokens('hello')).toEqual({ chars: 5, estTokens: 2 }); // 5×0.25=1.25→2
    expect(estimateHandoffTokens('abcd')).toEqual({ chars: 4, estTokens: 1 }); // 4×0.25=1→1
  });

  it('纯中文：每字符 ×1', () => {
    expect(estimateHandoffTokens('你好世界')).toEqual({ chars: 4, estTokens: 4 });
    expect(estimateHandoffTokens('一')).toEqual({ chars: 1, estTokens: 1 });
  });

  it('混合（含换行/空白）：宽字符 ×1 + ASCII ×0.25，向上取整', () => {
    expect(estimateHandoffTokens('你好ab!')).toEqual({ chars: 5, estTokens: 3 }); // 2+0.75=2.75→3
    expect(estimateHandoffTokens('你好\nworld')).toEqual({ chars: 8, estTokens: 4 }); // 2+1.5=3.5→4（\n 计 ASCII）
  });
});
