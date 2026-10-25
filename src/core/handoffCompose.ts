/**
 * handoff 交接包组装（T-M1-07 / W-S2-7）。
 *
 * 交接包是「AI 会话之间的接力棒」：把一次会话结束时项目负责人需要的上下文——
 * 目标范围、适用规则、依赖决定、有效失效证据、已试败路径、下一步验收——
 * 以固定六段结构渲染为一段 Markdown 文本，交给下一个会话（`pm handoff` / 别名 `revive`）。
 *
 * 契约：
 *  - 六段固定顺序与固定段键（缺段拒绝、未知段拒绝——不静默补段，R-08 不猜语义）；
 *  - 携带派生源版本（DerivedVersion：as_of + 源版本，与决策台同一携带口径，见
 *    derivedVersion.formatVersion，避免各端措辞漂移）与生成时间（壳层注入 ISO 8601 带时区，
 *    core 不取系统时间——纯度约束）；
 *  - 软预算（B-8）：超限**明示估算值与预算值并拒绝输出，不静默裁剪正文**——
 *    裁剪后的交接包会丢失上下文却看似完整，宁可让调用方显式决策；
 *  - token 数为粗估（中日等宽字符 ×1 + ASCII ×0.25 向上取整），仅用于预算提示，
 *    非精确计量——口径在 HandoffEstimate 注释中固定，供 brief 等复用。
 *
 * 纯字符串计算，无 IO、无时钟、无随机（core 纯度约束）。
 */

import { isIsoDateTimeWithTz } from './eventEnvelope.js';
import { formatVersion, type DerivedVersion } from './derivedVersion.js';

/** 交接包段键（固定六值；键即契约，增删走 schema 迁移而非静默扩展） */
export type HandoffSectionKey =
  | 'scope' // 目标范围
  | 'rules' // 适用规则
  | 'decisions' // 依赖决定
  | 'evidence' // 有效失效证据
  | 'failed-paths' // 已试败路径
  | 'acceptance'; // 下一步验收

/** 交接包单段：段键 + 段标题 + 正文（markdown 片段，可为空串——空正文仍渲染段标题） */
export interface HandoffSection {
  /** 段键（固定六值） */
  key: HandoffSectionKey;
  /** 段标题（渲染用；壳层装配时取 HANDOFF_SECTION_TITLES 标准标题保证全库统一） */
  title: string;
  /** 该段正文（markdown 片段，可为空串） */
  body: string;
}

/** 六段固定渲染顺序（与输入顺序无关，composeHandoff 按此重排） */
export const HANDOFF_SECTION_ORDER: readonly HandoffSection['key'][] = [
  'scope',
  'rules',
  'decisions',
  'evidence',
  'failed-paths',
  'acceptance',
];

/** 六段中文标题常量表（壳层装配的标准标题来源；显示层措辞统一，不各端自造） */
export const HANDOFF_SECTION_TITLES: Readonly<Record<HandoffSection['key'], string>> = {
  scope: '目标范围',
  rules: '适用规则',
  decisions: '依赖决定',
  evidence: '有效失效证据',
  'failed-paths': '已试败路径',
  acceptance: '下一步验收',
};

/** 组装输入：壳层负责装配段内容、注入时钟与预算 */
export interface HandoffInput {
  /** 项目名（渲染进标题行；由壳层取自目录名或注册表） */
  project: string;
  /** 六段（顺序不限，按 HANDOFF_SECTION_ORDER 重排；缺段/未知段拒绝） */
  sections: HandoffSection[];
  /** 派生源版本（as_of + 源版本；空事件流 asOf=null、sourceVersion=0） */
  version: DerivedVersion;
  /** 生成时间（壳层注入，ISO 8601 带时区；无时区拒绝——R-08 不猜语义） */
  generatedAt: string;
  /** 软预算（token 粗估上限；估算值 > 预算 → budget-exceeded，不裁剪正文） */
  softBudgetTokens: number;
}

/** token/字符粗估（B-8 口径：估算并标注，非精确计量） */
export interface HandoffEstimate {
  /** 字符数（JS 字符串 UTF-16 码元数，即 markdown.length） */
  chars: number;
  /**
   * token 粗估：中日等宽字符（非 ASCII）×1 + ASCII ×0.25，向上取整。
   * 仅用于软预算提示，非精确计量；emoji 等多码元字符按「1 个宽字符」计。
   */
  estTokens: number;
}

/** 组装结果：ok 时给出全文与估算；拒绝时给中文原因（missing 仅 missing-section 携带） */
export type HandoffResult =
  | { ok: true; markdown: string; estimate: HandoffEstimate }
  | {
      ok: false;
      code: 'missing-section' | 'unknown-section' | 'invalid-generated-at' | 'budget-exceeded';
      message: string;
      missing?: string[];
    };

/**
 * token 粗估（独立导出，供 brief 等其他派生输出复用同一口径）。
 * 非 ASCII（含中日、全角标点）×1，ASCII ×0.25，向上取整。
 */
export function estimateHandoffTokens(markdown: string): HandoffEstimate {
  let ascii = 0;
  let wide = 0;
  for (const ch of markdown) {
    // for...of 按码位迭代：emoji 等代理对按 1 个宽字符计
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 0x7f) ascii++;
    else wide++;
  }
  // Math.ceil 向上取整：估算宁可偏高（预算提示早触发），不低估
  const estTokens = Math.ceil(ascii * 0.25 + wide * 1);
  return { chars: markdown.length, estTokens };
}

/**
 * 组装交接包 Markdown：
 *   # handoff · <project>
 *   生成时间：<generatedAt>
 *   as_of=… · 源版本=N        （formatVersion，与决策台同一携带口径）
 *   ## <中文标题> ×6（固定顺序）
 *   ——本包由 gatedeck 生成；源版本以上述为准，过期投影请重取
 *
 * 校验顺序：未知段 → 缺段 → 非法生成时间 → 渲染 → 软预算。
 */
export function composeHandoff(input: HandoffInput): HandoffResult {
  // ① 未知段键：接口误用，先于缺段拒绝（宁可拒绝不可放行，P-08）
  const unknownKeys = input.sections
    .map((s) => s.key)
    .filter((k) => !HANDOFF_SECTION_ORDER.includes(k));
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      code: 'unknown-section',
      message:
        `交接包含未知段键：${unknownKeys.join('、')}（段键固定六值，` +
        `合法值：${HANDOFF_SECTION_ORDER.join(' / ')}）。请修正段键后重试；不静默丢弃未知段。`,
    };
  }

  // ② 缺段：带缺失键列表，不静默补空段（交接包结构即契约）
  const known = new Map(input.sections.map((s) => [s.key, s]));
  const missingKeys = HANDOFF_SECTION_ORDER.filter((k) => !known.has(k));
  if (missingKeys.length > 0) {
    return {
      ok: false,
      code: 'missing-section',
      message:
        `交接包缺少必需段：${missingKeys.join('、')}（六段必须齐全：` +
        `${HANDOFF_SECTION_ORDER.join(' / ')}）。请补齐后重试；不静默补段。`,
      missing: [...missingKeys],
    };
  }

  // ③ 生成时间必须显式带时区（R-08：无时区不猜语义，拒绝而非按 UTC 兜底）
  if (!isIsoDateTimeWithTz(input.generatedAt)) {
    return {
      ok: false,
      code: 'invalid-generated-at',
      message:
        `生成时间非法：「${input.generatedAt}」不是带时区的 ISO 8601 日期时间` +
        `（须形如 2026-10-24T12:00:00.000Z 或 2026-10-24T20:00:00+08:00）。`,
    };
  }

  // ④ 按固定顺序渲染（输入顺序不影响输出顺序）
  const ordered = HANDOFF_SECTION_ORDER.map((k) => known.get(k)).filter(
    (s): s is HandoffSection => s !== undefined,
  );
  const parts: string[] = [
    `# handoff · ${input.project}`,
    `生成时间：${input.generatedAt}`,
    formatVersion(input.version),
    ...ordered.map((s) => `## ${s.title}${s.body ? `\n\n${s.body}` : ''}`),
    '——本包由 gatedeck 生成；源版本以上述为准，过期投影请重取',
  ];
  const markdown = parts.join('\n\n');

  // ⑤ 软预算（B-8）：超限明示估算值与预算值并拒绝，不静默裁剪正文
  const estimate = estimateHandoffTokens(markdown);
  if (estimate.estTokens > input.softBudgetTokens) {
    return {
      ok: false,
      code: 'budget-exceeded',
      message:
        `交接包超过软预算（B-8）：估算 ${estimate.estTokens} token > 预算 ${input.softBudgetTokens} token。` +
        '本次不输出交接包，也不裁剪正文（裁剪会丢失上下文却看似完整）；请精简内容或调高软预算后重试。',
    };
  }

  return { ok: true, markdown, estimate };
}
