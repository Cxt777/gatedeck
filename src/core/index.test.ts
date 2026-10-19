import { describe, expect, it } from 'vitest';

import { CORE_VERSION, isStrictlyIncreasing } from './index.js';

describe('core 骨架冒烟测试', () => {
  it('导出内核版本', () => {
    expect(CORE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('isStrictlyIncreasing 判定严格递增序列', () => {
    expect(isStrictlyIncreasing([])).toBe(true);
    expect(isStrictlyIncreasing([1])).toBe(true);
    expect(isStrictlyIncreasing([1, 2, 3])).toBe(true);
    expect(isStrictlyIncreasing([1, 1])).toBe(false);
    expect(isStrictlyIncreasing([3, 1, 2])).toBe(false);
  });
});
