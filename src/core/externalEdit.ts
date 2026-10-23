/**
 * 外部编辑检测：指纹比对 + observed_at（T-M0b-07；基准 F-05 / P-08 / 3.3 / 附 B-2）。
 *
 * 契约：
 *  - 受管写路径之外的文件内容变更**可检测**：受管写入成功后记录内容指纹基线
 *    （与 optimisticWrite 同源的 UTF-8 字节 SHA-256——杜绝双口径），后续任一次
 *    观察按指纹比对；任何一字节差异（含 CRLF、尾换行、中文）都判定为变更；
 *  - **外部修改只记 observed_at，不回填 occurred_at**（P-08/基准 3.3）：外部改动
 *    何时发生不可观测——ExternalObservation 结构上只有 observedAt 字段、没有
 *    occurredAt，调用方想伪造发生时间也无字段可填（结构性保证，非口头约定）；
 *  - **观察不到的中间过程标未知**（P-08/基准 3.3）：基线到本次观察之间发生了
 *    几次编辑、经过哪些中间状态不可知——external-change 观察一律
 *    intermediateUnknown=true，绝不补插中间历史；
 *  - 无基线（首次观察/未纳管）→ untracked：如实标注无从判定，不声称 external；
 *  - unchanged 只证明当前字节与基线一致，不证明期间未被改过又改回——该残余
 *    未知不升级为告警，由本口径承载，不伪造「期间未变」的断言；
 *  - 汇总遵循「不静默」：存在 external-change 即 needsAttention=true，调用方必须
 *    展示指纹差异并进入「需处理」，不得静默重算基线（对齐 B-11 精神）。
 *
 * 纯字符串计算，无 IO（core 纯度约束）；文件扫描/基线持久化由壳层（M1 接入）承接。
 */

import { isIsoDateTimeWithTz } from './eventEnvelope.js';
import { contentVersion, type ContentVersion } from './optimisticWrite.js';

/** 受管写路径的基线条目（写入成功后由壳层持久化，core 无 IO） */
export interface ExternalBaselineEntry {
  path: string;
  fingerprint: ContentVersion;
}

/** 受管写路径成功写入后计算下一条基线（持久化时机与位置由存储层承接） */
export function nextBaseline(path: string, writtenContent: string): ExternalBaselineEntry {
  if (path.trim().length === 0) throw new Error('nextBaseline：path 不能为空');
  return { path, fingerprint: contentVersion(writtenContent) };
}

export type ExternalEditStatus =
  | 'unchanged'        // 当前字节与基线一致
  | 'external-change'  // 与基线不一致：受管写路径外的内容变更（B-2 检测命中）
  | 'untracked';       // 无基线：无从判定是否外部改动，如实标注

export interface ExternalObservation {
  path: string;
  status: ExternalEditStatus;
  /**
   * 观察时间（壳层注入时钟，ISO 8601 带时区）。
   * 本结构**没有 occurredAt 字段**：外部修改的发生时间不可观测，只记 observed_at，
   * 不回填 occurred_at（P-08，结构性保证）。
   */
  observedAt: string;
  /** 基线指纹；无基线（untracked）为 null */
  baseline: ContentVersion | null;
  /** 本次观察到的当前指纹 */
  current: ContentVersion;
  /** true = 基线与本观察之间的中间过程不可观察（P-08：中间历史标未知，不补插） */
  intermediateUnknown: boolean;
}

export function observeExternalEdit(input: {
  path: string;
  /** 受管写路径最近一次已知状态；null = 无基线 */
  baseline: ContentVersion | null;
  currentContent: string;
  /** 观察时间（ISO 8601 带时区，由壳层注入；core 不取系统时钟） */
  observedAt: string;
}): ExternalObservation {
  if (input.path.trim().length === 0) throw new Error('observeExternalEdit：path 不能为空');
  if (!isIsoDateTimeWithTz(input.observedAt)) {
    throw new Error(
      `observeExternalEdit：observedAt 须为带时区 ISO 8601（如 2026-10-23T23:00:00+08:00），收到「${input.observedAt}」`,
    );
  }
  const current = contentVersion(input.currentContent);
  if (input.baseline === null) {
    return {
      path: input.path,
      status: 'untracked',
      observedAt: input.observedAt,
      baseline: null,
      current,
      intermediateUnknown: false,
    };
  }
  if (input.baseline.contentHash === current.contentHash) {
    return {
      path: input.path,
      status: 'unchanged',
      observedAt: input.observedAt,
      baseline: input.baseline,
      current,
      // 端点一致不主张「期间未变」（改过又改回不可观察）；该残余未知由模块头注释
      // 与展示层文案承载，不置 intermediateUnknown 以免与 external-change 语义混同。
      intermediateUnknown: false,
    };
  }
  return {
    path: input.path,
    status: 'external-change',
    observedAt: input.observedAt,
    baseline: input.baseline,
    current,
    intermediateUnknown: true,
  };
}

export interface ExternalScanSummary {
  /** 全部观察（与输入同序） */
  observations: ExternalObservation[];
  /** external-change 子集：必须进入「需处理」展示，不静默重算基线 */
  changes: ExternalObservation[];
  /** untracked 子集：提示纳管，不视为异常 */
  untracked: ExternalObservation[];
  /** true = 存在外部改动（基准 F-05 承诺的「外部修改可检测」命中） */
  needsAttention: boolean;
}

/** 批量汇总：分拣 changed/untracked 并给出 needsAttention（不静默，B-2 检测出口） */
export function summarizeExternalScan(
  observations: readonly ExternalObservation[],
): ExternalScanSummary {
  const changes = observations.filter((o) => o.status === 'external-change');
  const untracked = observations.filter((o) => o.status === 'untracked');
  return {
    observations: [...observations],
    changes,
    untracked,
    needsAttention: changes.length > 0,
  };
}
