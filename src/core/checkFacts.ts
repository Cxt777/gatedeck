/**
 * 检查事实 + 凭证 + 失效判定（T-M1-04 / W-S2-4；基准 3.4 / D-26 / B-3 / P-08）。
 *
 * 定稿要点：
 *  - **检查事实由 check.completed 事件投影派生**（与 stageFold 的 D-24 同一精神）：
 *    每 (gateId, ruleId) 取事件流中**最近一笔** check.completed；「最近」＝事件流装配
 *    顺序中的最后一笔——与 stageFold B-16 口径一致，**不按 occurred_at 排序**（时间戳
 *    仅展示；装配方负责按收据链序喂入，本投影按输入顺序折叠）；
 *  - **无记录 → not-checked**：事件流中被引用过（任意 kind 携带该 gateId/ruleId）但从未
 *    有 check.completed 的组合，投影为 not-checked（如实展示「没查过」，绝不与「通过」
 *    混同）；完全未被任何事件引用的组合不凭空出现在 Map 中（P-08 不编造检查对象）；
 *  - **凭证（凭证字段即 D-26 证据契约）**：只存退出码/时长/摘要，不存原始输出；凭证
 *    锚定检查执行时的 canonical manifest 指纹（subjectManifestHash，来自 T-M1-03）；
 *  - **失效判定（B-3）**：对象或规则变化（重算 manifestHash ≠ 凭证 hash）→ passed/failed
 *    改判 stale「待复验」，其余字段原样保留（凭证仍在，只是不再适用）；凭证缺锚
 *    （subjectManifestHash=null）的 passed/failed 同样改判 stale——无法证明仍适用的
 *    凭证不假设一致（P-08）；not-checked/error 不参与比对（error 本身就需复验，
 *    not-checked 本身就「没查过」，改判 stale 是同义反复）；
 *  - **不回填**：输入已为 stale 的条目原样保留、不因 hash 恢复一致而翻案回 passed/
 *    failed——复验必须产生新的 check.completed 事件（append-only），投影层不自行改写
 *    检查历史（T-M0b-07「只记不回填」同一精神）；staleKeys 只列本次改判者，需要
 *    「当前全部 stale」的调用方对返回 facts 过滤即可；
 *  - **宽接口事件**（不 import 具体信封类型）：装配方把 EventEnvelope 映射为
 *    CheckEventInput（kind/payload/recorded_at → recordedAt；gateId/ruleId 可选放顶层，
 *    payload 内的 gateId/ruleId 优先）。payload 缺字段容错：不可解读的 outcome 如实按
 *    error「需复验」呈现，不猜为通过也不吞事件（P-08 / 不吞异常精神）；
 *    payload 与顶层均无 gateId/ruleId 的事件无法定位检查对象，不进入投影（不猜键）。
 *
 * Map 键为 checkFactKey(gateId, ruleId)（'\u0000' 分隔，杜绝 id 含分隔符时的键歧义，
 * 与 manifestFingerprint.canonicalJson 同一口径）；调用方一律经 checkFactKey 构造/拆分，
 * 不自行拼字符串。纯字符串计算，无 IO、无时钟、无随机数（core 纯度约束）。
 */

/** check.completed 的 kind 约定（与 eventEnvelope.CORE_KINDS 中的条目一致；本模块
 *  刻意不 import 信封类型/常量，装配方负责把信封 kind 映射到本约定） */
export const CHECK_COMPLETED_KIND = 'check.completed';

/**
 * 宽接口事件输入（装配方映射：EventEnvelope → 本形状）。
 * gateId/ruleId 顶层为可选便捷字段（payload 缺失时的回退位；非 check 事件也可携带，
 * 用于让「被引用但从未检查」的组合进投影为 not-checked）。
 */
export interface CheckEventInput {
  kind: string;
  payload: Record<string, unknown>;
  /** 事件 recorded_at（ISO 8601；空串按无时刻处理 → checkedAt=null，不猜语义 R-08） */
  recordedAt: string;
  gateId?: string;
  ruleId?: string;
}

/** 检查状态：not-checked（无记录）/ passed / failed / error（执行异常或结果不可解读）/ stale（凭证过期待复验） */
export type CheckStatus = 'not-checked' | 'passed' | 'failed' | 'error' | 'stale';

/** 单条检查事实：状态 + 凭证（D-26 证据契约字段 + manifest 指纹锚） */
export interface CheckFact {
  gateId: string;
  ruleId: string;
  status: CheckStatus;
  /** 检查执行时刻（事件 recorded_at，注入/取自事件）；无记录或事件无有效时刻为 null */
  checkedAt: string | null;
  /** 证据契约字段：只存退出码/时长/摘要（D-26），不存原始输出 */
  exitCode?: number;
  durationMs?: number;
  summary?: string;
  /** 检查时锚定的 canonical manifest 指纹（凭证）；事件未携带为 null */
  subjectManifestHash: string | null;
}

/** (gateId, ruleId) → Map 键：'\u0000' 分隔（id 理论上不含空字符，见模块头说明） */
export function checkFactKey(gateId: string, ruleId: string): string {
  return `${gateId}\u0000${ruleId}`;
}

/** 非空字符串（空白串按缺失处理——口径与 eventEnvelope.asNonEmptyString 一致） */
function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}

const OUTCOMES: readonly string[] = ['passed', 'failed', 'error'];

/** 从 payload（优先）与顶层字段（回退）解析 (gateId, ruleId)；两者齐备才成对，缺一不猜 */
function parsePair(ev: CheckEventInput): { gateId: string; ruleId: string } | null {
  const gateId = asNonEmptyString(ev.payload['gateId']) ?? asNonEmptyString(ev.gateId);
  const ruleId = asNonEmptyString(ev.payload['ruleId']) ?? asNonEmptyString(ev.ruleId);
  if (gateId === null || ruleId === null) return null;
  return { gateId, ruleId };
}

/** 由 check.completed 的 payload 构建凭证事实；outcome 缺失/非法 → error（P-08 不猜通过） */
function factFromPayload(pair: { gateId: string; ruleId: string }, ev: CheckEventInput): CheckFact {
  const outcome = asNonEmptyString(ev.payload['outcome']);
  const status: CheckStatus = outcome !== null && OUTCOMES.includes(outcome) ? (outcome as CheckStatus) : 'error';
  const exitCodeRaw = ev.payload['exitCode'];
  const durationRaw = ev.payload['durationMs'];
  return {
    gateId: pair.gateId,
    ruleId: pair.ruleId,
    status,
    checkedAt: asNonEmptyString(ev.recordedAt),
    ...(typeof exitCodeRaw === 'number' && Number.isFinite(exitCodeRaw) ? { exitCode: exitCodeRaw } : {}),
    ...(typeof durationRaw === 'number' && Number.isFinite(durationRaw) && durationRaw >= 0
      ? { durationMs: durationRaw }
      : {}),
    ...(asNonEmptyString(ev.payload['summary']) !== null ? { summary: asNonEmptyString(ev.payload['summary'])! } : {}),
    subjectManifestHash: asNonEmptyString(ev.payload['subjectManifestHash']),
  };
}

/**
 * 事件流 → 每 (gateId, ruleId) 最近一笔 check.completed 的检查事实投影。
 *
 * 口径：
 *  - 按**输入顺序**折叠，「最近」＝该组合最后一笔 check.completed（B-16：不按
 *    occurred_at 排序；装配方按收据链序喂入）；
 *  - 任意 kind 的事件携带某 (gateId, ruleId)（payload 优先、顶层回退）→ 该组合进入
 *    投影；若从无 check.completed → not-checked（checkedAt=null、subjectManifestHash=null）；
 *  - check.completed 的 outcome 缺失/非法 → status='error'（结果不可解读，如实按需
 *    复验呈现）；exitCode/durationMs/summary 非法形态静默略去该字段（不虚构数值），
 *    其余字段照常投影；
 *  - gateId/ruleId 缺一的事件不进入投影（无法定位检查对象，不猜键）。
 */
export function projectLatestCheckFacts(events: readonly CheckEventInput[]): Map<string, CheckFact> {
  const facts = new Map<string, CheckFact>();
  for (const ev of events) {
    const pair = parsePair(ev);
    if (pair === null) continue; // 缺 gateId/ruleId：无法定位检查对象，不猜键（P-08）
    const key = checkFactKey(pair.gateId, pair.ruleId);
    if (ev.kind === CHECK_COMPLETED_KIND) {
      facts.set(key, factFromPayload(pair, ev)); // 最近一笔胜出（覆盖即折叠）
    } else if (!facts.has(key)) {
      // 非 check 事件仅登记「该组合存在于事件流」；已有事实不覆盖。
      // summary 是 D-26 证据字段（来自检查本身），not-checked 无证据，故不填。
      facts.set(key, {
        gateId: pair.gateId,
        ruleId: pair.ruleId,
        status: 'not-checked',
        checkedAt: null,
        subjectManifestHash: null,
      });
    }
  }
  return facts;
}

export interface StalenessResult {
  /** 改判后的新 Map（输入不被改写，R-04 精神：同输入同输出、可重算） */
  facts: Map<string, CheckFact>;
  /** 本次被改判 stale 的键（按 Map 迭代序＝插入序，确定）；已 stale 输入不重复列入 */
  staleKeys: string[];
}

/**
 * 失效判定（B-3）：对象或规则变化 → 待复验。
 *
 * 对 status ∈ {passed, failed} 且 subjectManifestHash ≠ currentManifestHash（含凭证
 * 缺锚 null）的条目改判 stale，其余字段（checkedAt/凭证/摘要）原样保留；not-checked/
 * error 不参与比对；输入已为 stale 的条目原样保留（不回填、不翻案，复验走新事件），
 * 且不计入 staleKeys。输入 Map 不被改写。
 */
export function assessStaleness(
  facts: ReadonlyMap<string, CheckFact>,
  currentManifestHash: string,
): StalenessResult {
  const out = new Map<string, CheckFact>();
  const staleKeys: string[] = [];
  for (const [key, fact] of facts) {
    const shouldStale =
      (fact.status === 'passed' || fact.status === 'failed') && fact.subjectManifestHash !== currentManifestHash;
    if (shouldStale) {
      out.set(key, { ...fact, status: 'stale' }); // 仅改判状态，凭证与证据字段原样保留
      staleKeys.push(key);
    } else {
      out.set(key, fact);
    }
  }
  return { facts: out, staleKeys };
}

/** 证据契约与信任边界提示（决策台/handoff 等各端复用同一措辞，勿各端自定） */
export const CHECK_EVIDENCE_NOTICE =
  '检查证据只存退出码/时长/摘要（D-26），不存原始输出；门禁命令执行须显式信任授权；' +
  'MCP/discover/doctor 永不执行门禁命令。';
