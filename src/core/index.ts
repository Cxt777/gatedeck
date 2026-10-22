/**
 * gatedeck core —— 纯计算内核（不变量：本目录不得依赖任何 IO）。
 *
 * 约束（基准 P-01 / D-24 / T-M0a-01 验收）：
 *   - 只允许纯函数与纯数据结构，禁止 import `node:*`、文件系统、网络、进程、时钟等副作用来源；
 *   - 时钟、随机数等一律由调用方注入，core 内不做隐式取值；
 *   - 该约束由 `src/core/purity.test.ts` 在 CI 中机器校验。
 */

/** 内核版本（与 package.json version 同步演进；当前为骨架占位）。 */
export const CORE_VERSION = '0.0.0';

/**
 * 判定一组事件序列号是否严格递增。
 * 事件折叠以 sequence 为准（而非 occurred_at，基准 B-16），此为其前置校验。
 */
export function isStrictlyIncreasing(sequence: readonly number[]): boolean {
  for (let i = 1; i < sequence.length; i++) {
    if (sequence[i]! <= sequence[i - 1]!) return false;
  }
  return true;
}

/** 覆盖基准 3.5 的哈希函数 */
export { sha256Hex, sha256HexBytes } from './hash.js';

/** T-M0a-03：规范事件块语法 + 事件信封 schema（kind×origin 矩阵编码 B-4/B-17） */
export * from './eventEnvelope.js';

/** T-M0a-04：事件来源收据（hash chain + 本地锚点，B-10/B-11） */
export * from './eventReceipt.js';

/** T-M0a-05：状态折叠规则（当前阶段派生，D-24/B-13/B-16） */
export * from './stageFold.js';

/** T-M0a-06：注册表 provider（native + projects-index，D-30/B-14/B-15） */
export * from './registry.js';

/** T-M0b-01：wbs.md 解析/校验/局部修改内核（P-04/R-04） */
export * from './wbsKernel.js';

/** T-M0b-02：changelog/insights 事件日志投影 + append-only 追加（S2.1-04/R-02） */
export * from './eventLog.js';

/** T-M0b-03：乐观并发写入——内容 hash compare-and-set（P-06/B-1） */
export * from './optimisticWrite.js';
