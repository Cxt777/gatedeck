import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * 架构守卫：core 层必须为纯 TS，无 IO 依赖（T-M0a-01 验收）。
 * 本文件位于 core 目录内但属测试，不参与自身扫描。
 */
const coreDir = path.dirname(fileURLToPath(import.meta.url));

const FORBIDDEN: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'node: 内置模块', pattern: /from\s+['"]node:/ },
  { label: 'node: 前缀 import()', pattern: /import\(\s*['"]node:/ },
  { label: 'fs/path/child_process 等裸模块', pattern: /from\s+['"](?:fs|path|os|net|http|https|child_process|process)['"]/ },
  { label: '向上越层依赖 cli', pattern: /from\s+['"][^'"]*\/cli\// },
];

describe('core 纯度约束（架构守卫）', () => {
  const sources = readdirSync(coreDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  it('core 目录下存在被检源文件', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  for (const file of sources) {
    it(`${file} 不含 IO 依赖`, () => {
      const content = readFileSync(path.join(coreDir, file), 'utf8');
      const hits = FORBIDDEN.filter((r) => r.pattern.test(content)).map((r) => r.label);
      expect(hits).toEqual([]);
    });
  }
});
