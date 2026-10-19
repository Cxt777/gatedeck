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
