import { describe, expect, it } from 'vitest';

import {
  auditProjectMarkdown,
  auditWbsTimeFields,
  classifyClaim,
  compareDerivedValue,
  detectDuplicateStorage,
  FACT_AUTHORITY,
  normalizeLocation,
} from './authorityRules.js';
import { parseFencedTaskBlocks } from './wbsSyntax.js';

describe('T-M0b-05 · 事实权威表（基准 3.1）', () => {
  it('当前阶段为派生态且明确不落 project.md（D-24）', () => {
    const a = FACT_AUTHORITY['current-stage'];
    expect(a.kind).toBe('derived');
    expect(a.note).toContain('不落 project.md');
  });

  it('文件类事实各自指向唯一权威路径', () => {
    expect(FACT_AUTHORITY['project-meta'].location).toBe('pm/project.md');
    expect(FACT_AUTHORITY['task-content'].location).toBe('pm/wbs.md');
    expect(FACT_AUTHORITY['gate-definition'].location).toBe('pm/gates.md');
    expect(FACT_AUTHORITY['check-records'].location).toBe('pm/changelog.md');
    expect(FACT_AUTHORITY['usage-records'].location).toBe('pm/insights.md');
  });

  it('路径归一化：分隔符/大小写/前导 ./ 不影响权威判定', () => {
    expect(normalizeLocation('.\\PM\\WBS.md')).toBe('pm/wbs.md');
    const c = classifyClaim({ fact: 'task-content', location: 'PM\\WBS.md', value: 'done' });
    expect(c.verdict).toBe('authoritative');
  });

  it('非权威位置 → non-authoritative；派生态任何落盘 → derived-field-forbidden', () => {
    const wrong = classifyClaim({ fact: 'gate-definition', location: 'pm/project.md', value: 'G-M1' });
    expect(wrong.verdict).toBe('non-authoritative');
    expect(wrong.message).toContain('pm/gates.md');

    const derived = classifyClaim({ fact: 'current-stage', location: 'pm/project.md', value: 'M1' });
    expect(derived.verdict).toBe('derived-field-forbidden');
  });
});

describe('T-M0b-05 · project.md 派生态字段审计（D-24）', () => {
  it('stage / current_stage / currentPhase / 当前阶段 均报冲突，未知字段不误报', () => {
    const md = [
      '# 示例项目',
      '',
      'name: demo',
      'stage: M1',
      'current_stage: M1',
      'currentPhase: M2',
      '当前阶段: M2',
      'tags: [a, b]',
      '说明: 本行冒号：不误判',
    ].join('\n');
    const conflicts = auditProjectMarkdown(md);
    expect(conflicts).toHaveLength(4);
    expect(conflicts.every((c) => c.code === 'derived-fact-stored')).toBe(true);
    expect(conflicts.every((c) => c.fact === 'current-stage')).toBe(true);
    expect(conflicts.map((c) => c.line)).toEqual([4, 5, 6, 7]);
    expect(conflicts[0]!.message).toContain('不静默合并');
    expect(conflicts[0]!.display).toContain('派生：promotion 事件折叠（D-24）');
    expect(conflicts[0]!.display).toContain('pm/project.md = M1');
  });

  it('不含阶段字段的 project.md 无冲突（只读诊断）', () => {
    expect(auditProjectMarkdown('name: demo\nrepo: local\nowner: 项目负责人\n')).toHaveLength(0);
  });
});

describe('T-M0b-05 · wbs.md 时间语义字段审计（基准 3.3）', () => {
  const md = [
    '### T-A 任务',
    '',
    '```gatedeck-task',
    'id: T-A',
    'title: 任务 A',
    'status: todo',
    'updated_at: 2026-10-22T23:00:00+08:00',
    'last_progress_at: 2026-10-22T23:00:00+08:00',
    'gate: G-M0b',
    '```',
  ].join('\n');

  it('updated_at / last_progress_at 落任务块 → 逐字段冲突并带行号', () => {
    const parsed = parseFencedTaskBlocks(md);
    const conflicts = auditWbsTimeFields(md, parsed);
    expect(conflicts).toHaveLength(2);
    expect(conflicts.every((c) => c.fact === 'task-time')).toBe(true);
    expect(conflicts.map((c) => c.line)).toEqual([7, 8]);
    expect(conflicts[0]!.message).toContain('T-A');
    expect(conflicts[0]!.message).toContain('事件派生');
  });

  it('合法字段（gate/acceptance/status）不误报', () => {
    const clean = ['```gatedeck-task', 'id: T-B', 'title: B', 'status: done', 'gate: G-M1', '```'].join('\n');
    expect(auditWbsTimeFields(clean, parseFencedTaskBlocks(clean))).toHaveLength(0);
  });
});

describe('T-M0b-05 · 重复存储与取值冲突', () => {
  it('同一任务状态在 project.md 重复存储 → duplicate-storage，展示权威值与重复值', () => {
    const conflicts = detectDuplicateStorage([
      { fact: 'task-content', location: 'pm/wbs.md', value: 'done', line: 12 },
      { fact: 'task-content', location: 'pm/project.md', value: 'todo', line: 3 },
    ]);
    expect(conflicts).toHaveLength(1);
    const c = conflicts[0]!;
    expect(c.code).toBe('duplicate-storage');
    expect(c.authoritativeLocation).toBe('pm/wbs.md');
    expect(c.authoritativeValue).toBe('done');
    expect(c.conflictingLocation).toBe('pm/project.md');
    expect(c.conflictingValue).toBe('todo');
    expect(c.display).toContain('done');
    expect(c.display).toContain('todo');
    expect(c.message).toContain('以权威位置为准');
  });

  it('派生态事实被落盘 → derived-fact-stored（即使位置看似合理）', () => {
    const conflicts = detectDuplicateStorage([
      { fact: 'current-stage', location: 'pm/project.md', value: 'M1' },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.code).toBe('derived-fact-stored');
    expect(conflicts[0]!.authoritativeValue).toBeNull();
  });

  it('权威位置内出现不同取值 → conflicting-values（以首笔为准告警，不合并）', () => {
    const conflicts = detectDuplicateStorage([
      { fact: 'gate-definition', location: 'pm/gates.md', value: 'G-M1: 全自动', line: 5 },
      { fact: 'gate-definition', location: 'pm/gates.md', value: 'G-M1: 含人工验收', line: 9 },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.code).toBe('conflicting-values');
    expect(conflicts[0]!.authoritativeValue).toBe('G-M1: 全自动');
    expect(conflicts[0]!.conflictingValue).toBe('G-M1: 含人工验收');
  });

  it('单处权威声明 + 相同重复值不告警（幂等读取）', () => {
    expect(
      detectDuplicateStorage([
        { fact: 'project-meta', location: 'pm/project.md', value: 'demo' },
        { fact: 'project-meta', location: 'pm/project.md', value: 'demo' },
      ]),
    ).toHaveLength(0);
  });

  it('registry 为配置类事实，位置不符即重复存储（native provider）', () => {
    const conflicts = detectDuplicateStorage([
      { fact: 'registry', location: 'pm/registry.md', value: 'workspace_id: X' },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.authoritativeLocation).toContain('.gatedeck/registry.md');
  });
});

describe('T-M0b-05 · 派生值与落盘值差异显示', () => {
  it('与权威派生值一致 → 无冲突', () => {
    expect(
      compareDerivedValue('current-stage', 'M1', { fact: 'current-stage', location: 'pm/project.md', value: ' M1 ' }),
    ).toBeNull();
  });

  it('不一致 → conflicting-values，以派生值为准展示差异并告警', () => {
    const c = compareDerivedValue('current-stage', 'M1', {
      fact: 'current-stage',
      location: 'pm/project.md',
      value: 'M2',
      line: 4,
    });
    expect(c).not.toBeNull();
    if (c === null) return;
    expect(c.code).toBe('conflicting-values');
    expect(c.authoritativeValue).toBe('M1');
    expect(c.conflictingValue).toBe('M2');
    expect(c.display).toContain('M1');
    expect(c.display).toContain('M2');
    expect(c.message).toContain('不静默合并');
  });
});
