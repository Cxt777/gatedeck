/**
 * 派生状态版本：as_of + 源版本 compare-and-set（T-M0b-06；基准第八节 M0 表
 * 「派生状态版本」/ D-24 / P-06 / P-08）。
 *
 * 契约（基准 M0 表逐字对应）：
 *  - 决策台/风险分组/handoff 等派生投影**必须携带** as_of（最后参与推导事件的
 *    recorded_at）与源版本（参与推导的事件笔数）——stageFold 的 StageProjection
 *    已内建两字段（T-M0a-05），本模块把「携带」与「提交时校验」统一为同一契约；
 *  - **写动作基于同一版本 compare-and-set**：提交方回带其读取投影时的版本戳，
 *    与当前事件流重算出的版本逐字段比对，不一致即拒绝提交：
 *      · 源版本落后           → stale-projection（投影过期：重读事件流重算后再试）；
 *      · 源版本超前           → version-ahead（提交版本不来自当前事件流：跨流/伪造/
 *                                复制粘贴，宁可拒绝不可放行，P-08 未知不假设）；
 *      · 版本相同但 as_of 不同 → as-of-mismatch（同长度事件流被改写，同样拒绝）；
 *  - 内容字节级并发检测（同一文件被他人改写）仍是 optimisticWrite（T-M0b-03）的
 *    职责，两套 CAS 正交：本模块裁「投影代际」，字节 CAS 裁「文件内容」，壳层装配。
 *
 * 纯字符串计算，无 IO（core 纯度约束）。
 */

import { isIsoDateTimeWithTz } from './eventEnvelope.js';

/** 派生投影版本戳（as_of 展示口径 + 源版本代数） */
export interface DerivedVersion {
  /** 最后参与推导事件的 recorded_at（ISO 8601 带时区）；空事件流为 null */
  asOf: string | null;
  /** 参与推导的事件笔数（派生代数，随事件流单调递增） */
  sourceVersion: number;
}

/** 空事件流的版本戳 */
export const EMPTY_DERIVED_VERSION: DerivedVersion = { asOf: null, sourceVersion: 0 };

/** 从带版本字段的投影（StageProjection 形状）提取版本戳 */
export function versionOf(p: { asOf: string | null; sourceVersion: number }): DerivedVersion {
  return { asOf: p.asOf, sourceVersion: p.sourceVersion };
}

/** 面向决策台/handoff 的单行展示（携带口径统一，避免各端措辞漂移） */
export function formatVersion(v: DerivedVersion): string {
  return `as_of=${v.asOf ?? '（无参与事件）'} · 源版本=${v.sourceVersion}`;
}

function isValidVersionShape(v: DerivedVersion): boolean {
  if (!Number.isInteger(v.sourceVersion) || v.sourceVersion < 0) return false;
  if (v.sourceVersion === 0) return v.asOf === null; // 空流不得携带 as_of
  return v.asOf !== null && isIsoDateTimeWithTz(v.asOf); // 参与事件必有 recorded_at
}

export type FreshnessCode =
  | 'ok'
  | 'stale-projection'
  | 'version-ahead'
  | 'as-of-mismatch'
  | 'invalid-version';

export interface FreshnessResult {
  ok: boolean;
  code: FreshnessCode;
  /** 面向用户的拒绝/放行说明（含处置建议，不虚报） */
  message: string;
  /** 归一化后的提交版本戳；invalid-version 时为 null */
  submitted: DerivedVersion | null;
  /** 当前事件流重算出的版本戳（供重读比对） */
  current: DerivedVersion;
}

/**
 * 版本 compare-and-set：仅当提交版本与当前事件流版本完全一致时放行。
 * 过期投影提交被拒（基准 M0 表「写动作基于同一版本 compare-and-set，过期投影不能提交」）。
 * 提交方仅持有投影快照，不参与当前重算——两者由壳层分别取得后传入（core 无 IO）。
 */
export function checkFreshSubmission(
  current: DerivedVersion,
  submitted: DerivedVersion,
): FreshnessResult {
  if (!isValidVersionShape(submitted)) {
    return {
      ok: false,
      code: 'invalid-version',
      message:
        '提交拒绝（P-08）：版本戳形态非法——源版本须为非负整数，源版本 0 须配 as_of=null，' +
        '源版本 >0 须配带时区 ISO 8601 的 as_of。请基于当前投影重新生成提交，不猜测版本。',
      submitted: null,
      current,
    };
  }
  if (submitted.sourceVersion < current.sourceVersion) {
    return {
      ok: false,
      code: 'stale-projection',
      message:
        `提交拒绝：投影已过期（提交 ${formatVersion(submitted)}，当前 ${formatVersion(current)}）。` +
        '请重读事件流重算投影后再提交；本次不写入、不覆盖新投影。',
      submitted,
      current,
    };
  }
  if (submitted.sourceVersion > current.sourceVersion) {
    return {
      ok: false,
      code: 'version-ahead',
      message:
        `提交拒绝：提交版本超前于当前事件流（提交源版本 ${submitted.sourceVersion} > 当前 ${current.sourceVersion}），` +
        '该版本并非来自当前事件流（跨流/伪造/复制粘贴，P-08 不假设）。请基于当前投影重新生成。',
      submitted,
      current,
    };
  }
  if (submitted.asOf !== current.asOf) {
    return {
      ok: false,
      code: 'as-of-mismatch',
      message:
        `提交拒绝：源版本相同（${current.sourceVersion}）而 as_of 不一致` +
        `（提交 ${submitted.asOf} ≠ 当前 ${current.asOf}），事件流疑似被同长度改写。` +
        '请重读并经收据链重新验证事件来源后重试；本次不提交。',
      submitted,
      current,
    };
  }
  return {
    ok: true,
    code: 'ok',
    message: `版本一致（${formatVersion(current)}），允许提交。`,
    submitted,
    current,
  };
}
