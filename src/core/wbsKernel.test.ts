import { describe, expect, it } from 'vitest';

import {
  parseFencedTaskBlocks,
  reconstruct,
} from './wbsSyntax.js';
import {
  getNodeField,
  updateTaskFieldById,
  validateWbsDocument,
} from './wbsKernel.js';

/** 富样本：手写注释 / 未知字段 / 中文键值 / 嵌套代码块（异字符 fence）/ 全角符号 */
const RICH_LF = [
  '# 项目 WBS（测试样例）',
  '',
  '<!-- 主理人手写注释：机器不得吞掉（R-04） -->',
  '',
  '### T-A 第一个任务',
  '',
  '```gatedeck-task',
  'id: T-A',
  'title: 第一个任务（中文标题）',
  'status: todo',
  'deps: T-B, T-C',
  'owner: 主理人',
  'note_x: 手写未知字段保留',
  '```',
  '人类说明自由文本，不参与状态推导。',
  '',
  '### T-B 第二个任务',
  '',
  '```gatedeck-task',
  'id: T-B',
  'title: 第二个任务',
  'status: doing',
  '```',
  '',
  '### T-C 中文键与全角',
  '',
  '```gatedeck-task',
  'id: T-C',
  '标题: 中文未知键',
  'title: C 任务',
  'status: done',
  '备注: 值含全角符号：；、',
  '```',
  '',
  '### T-D 嵌套代码块',
  '',
  '```gatedeck-task',
  'id: T-D',
  'title: D 任务',
  'status: todo',
  '示例:',
  '~~~',
  'text with : colon line',
  '~~~',
  '```',
  '',
].join('\n');

const RICH_CRLF = RICH_LF.replace(/\n/g, '\r\n');

/** 逐行对比，返回差异行下标数组 */
function diffLineIndexes(a: string, b: string): number[] {
  const la = a.split('\n');
  const lb = b.split('\n');
  const diffs: number[] = [];
  for (const [i, line] of la.entries()) {
    if (lb[i] !== line) diffs.push(i);
  }
  expect(lb.length).toBe(la.length);
  return diffs;
}

describe('T-M0b-01 · round-trip 保真（R-04/P-04）', () => {
  it('富样本 LF：解析→重建 字节级一致（注释/未知字段/中文键/嵌套代码块全保留）', () => {
    const parsed = parseFencedTaskBlocks(RICH_LF);
    expect(parsed.nodes).toHaveLength(4);
    expect(reconstruct(RICH_LF, parsed)).toBe(RICH_LF);
  });

  it('富样本 CRLF：解析→重建 字节级一致', () => {
    const parsed = parseFencedTaskBlocks(RICH_CRLF);
    expect(parsed.nodes).toHaveLength(4);
    expect(reconstruct(RICH_CRLF, parsed)).toBe(RICH_CRLF);
  });

  it('未知字段与中文键保留在 fields 中（F-06），全角符号值不丢', () => {
    const parsed = parseFencedTaskBlocks(RICH_LF);
    const c = parsed.nodes.find((n) => getNodeField(n, 'id') === 'T-C');
    expect(c).toBeDefined();
    expect(getNodeField(c!, '标题')).toBe('中文未知键');
    expect(getNodeField(c!, '备注')).toBe('值含全角符号：；、');
    const a = parsed.nodes.find((n) => getNodeField(n, 'id') === 'T-A');
    expect(getNodeField(a!, 'note_x')).toBe('手写未知字段保留');
  });

  it('局部修改后未触及字节一律不动（含注释、未知字段、人类说明、其他节点）', () => {
    const parsed = parseFencedTaskBlocks(RICH_LF);
    const after = updateTaskFieldById(RICH_LF, parsed, 'T-B', 'status', 'done');
    expect(after).not.toBeNull();
    const diffs = diffLineIndexes(RICH_LF, after!);
    expect(diffs).toEqual([21]); // 仅 T-B 的 status 行（0-based 第 21 行）
    expect(after!.split('\n')[21]).toBe('status: done');
    // 注释行与人类说明原样
    expect(after).toContain('<!-- 主理人手写注释：机器不得吞掉（R-04） -->');
    expect(after).toContain('人类说明自由文本，不参与状态推导。');
  });

  it('局部修改后再次解析→重建仍字节级一致（可重复编辑）', () => {
    const parsed1 = parseFencedTaskBlocks(RICH_LF);
    const step1 = updateTaskFieldById(RICH_LF, parsed1, 'T-A', 'status', 'blocked')!;
    const parsed2 = parseFencedTaskBlocks(step1);
    const step2 = updateTaskFieldById(step1, parsed2, 'T-C', 'title', '改后的中文标题')!;
    const parsed3 = parseFencedTaskBlocks(step2);
    expect(reconstruct(step2, parsed3)).toBe(step2);
    expect(getNodeField(parsed3.nodes[0]!, 'status')).toBe('blocked');
  });

  it('CRLF 样本局部修改：仅目标行变化且行终止符保持 CRLF', () => {
    const parsed = parseFencedTaskBlocks(RICH_CRLF);
    const after = updateTaskFieldById(RICH_CRLF, parsed, 'T-A', 'status', 'done')!;
    const diffs = diffLineIndexes(RICH_CRLF, after);
    expect(diffs).toHaveLength(1);
    expect(after.split('\r\n')[9]).toBe('status: done');
    expect(after).toBe(RICH_CRLF.replace('status: todo', 'status: done'));
  });
});

describe('T-M0b-01 · 校验（节点级 + 文档级）', () => {
  it('合法文档：无内核诊断，byId/taskIds 齐备', () => {
    const parsed = parseFencedTaskBlocks(RICH_LF);
    const v = validateWbsDocument(RICH_LF, parsed);
    const codes = v.diagnostics.map((d) => d.code);
    expect(codes).not.toContain('missing-required-field');
    expect(codes).not.toContain('bad-status');
    expect(codes).not.toContain('bad-deps-format');
    expect(codes).not.toContain('duplicate-task-id');
    expect(codes).not.toContain('dangling-dep');
    expect([...v.byId.keys()]).toEqual(['T-A', 'T-B', 'T-C', 'T-D']);
    expect(v.taskIds).toEqual(['T-A', 'T-B', 'T-C', 'T-D']);
    // 未知字段仍出 unknown-field（F-06）
    expect(codes).toContain('unknown-field');
  });

  it('缺必需字段：status 缺失 → missing-required-field（行号定位到节点内）', () => {
    const md = ['```gatedeck-task', 'id: T-X', 'title: 无状态任务', '```'].join('\n');
    const parsed = parseFencedTaskBlocks(md);
    const v = validateWbsDocument(md, parsed);
    const d = v.diagnostics.find((x) => x.code === 'missing-required-field' && x.taskId === 'T-X');
    expect(d).toBeDefined();
    expect(d!.line).toBe(2); // status 行缺失时兜底定位到节点 raw 起始行（1-based，文档约定）
  });

  it('status 空值同样报 missing-required-field；非法取值 → bad-status', () => {
    const md = ['```gatedeck-task', 'id: T-X', 'title: t', 'status: finished', '```'].join('\n');
    const parsed = parseFencedTaskBlocks(md);
    const v = validateWbsDocument(md, parsed);
    const codes = v.diagnostics.map((d) => d.code);
    expect(codes).toContain('bad-status');
    const bad = v.diagnostics.find((d) => d.code === 'bad-status');
    expect(bad!.message).toContain('finished');
  });

  it('deps 格式非法 → bad-deps-format；空 deps 不报错', () => {
    const md = [
      '```gatedeck-task',
      'id: T-X',
      'title: t',
      'status: todo',
      'deps: T-Y, , bad id!, T-Z',
      '```',
    ].join('\n');
    const parsed = parseFencedTaskBlocks(md);
    const v = validateWbsDocument(md, parsed);
    const bad = v.diagnostics.filter((d) => d.code === 'bad-deps-format');
    expect(bad).toHaveLength(2); // 「」(空段) 与 「bad id!」
    expect(bad.some((d) => d.message.includes('bad id!'))).toBe(true);

    const ok = ['```gatedeck-task', 'id: T-X', 'title: t', 'status: todo', 'deps:', '```'].join('\n');
    const v2 = validateWbsDocument(ok, parseFencedTaskBlocks(ok));
    expect(v2.diagnostics.filter((d) => d.code === 'bad-deps-format')).toHaveLength(0);
  });

  it('重复任务 id：duplicate-task-id 诊断，byId 取首笔（B-13 精神）', () => {
    const md = [
      '```gatedeck-task',
      'id: T-X',
      'title: 第一处',
      'status: todo',
      '```',
      '```gatedeck-task',
      'id: T-X',
      'title: 第二处',
      'status: done',
      '```',
    ].join('\n');
    const parsed = parseFencedTaskBlocks(md);
    const v = validateWbsDocument(md, parsed);
    expect(v.diagnostics.filter((d) => d.code === 'duplicate-task-id')).toHaveLength(1);
    expect(getNodeField(v.byId.get('T-X')!, 'title')).toBe('第一处');
  });

  it('悬空 deps：引用本文件不存在的任务 id → dangling-dep', () => {
    const md = ['```gatedeck-task', 'id: T-X', 'title: t', 'status: todo', 'deps: T-NOPE', '```'].join('\n');
    const parsed = parseFencedTaskBlocks(md);
    const v = validateWbsDocument(md, parsed);
    const d = v.diagnostics.find((x) => x.code === 'dangling-dep');
    expect(d).toBeDefined();
    expect(d!.taskId).toBe('T-X');
    expect(d!.message).toContain('T-NOPE');
  });

  it('诊断行号落在文档中正确位置（未知字段行）', () => {
    const parsed = parseFencedTaskBlocks(RICH_LF);
    const v = validateWbsDocument(RICH_LF, parsed);
    const unknown = v.diagnostics.filter((d) => d.code === 'unknown-field');
    // T-A.note_x（第 13 行）、T-C.标题（第 29 行）、T-C.备注（第 32 行）、T-D.示例（第 41 行）
    expect(unknown.map((d) => d.line)).toEqual(expect.arrayContaining([13, 29, 32]));
  });
});

describe('T-M0b-01 · 局部修改边界', () => {
  it('不存在的任务 id → null（不静默新建节点）', () => {
    const parsed = parseFencedTaskBlocks(RICH_LF);
    expect(updateTaskFieldById(RICH_LF, parsed, 'T-NOPE', 'status', 'done')).toBeNull();
  });

  it('不存在的字段 key → null（不静默新增字段；新增字段属模板演进）', () => {
    const parsed = parseFencedTaskBlocks(RICH_LF);
    expect(updateTaskFieldById(RICH_LF, parsed, 'T-B', 'owner', '某人')).toBeNull();
  });

  it('保留 key、冒号与冒号后空白的原样式', () => {
    const md = ['```gatedeck-task', 'id: T-S', 'title:  带多余空格', 'status :  todo', '```'].join('\n');
    const parsed = parseFencedTaskBlocks(md);
    const after = updateTaskFieldById(md, parsed, 'T-S', 'status', 'done')!;
    expect(after).toContain('status :  done');
    expect(after).toContain('title:  带多余空格');
  });

  it('中文值与含冒号值均可安全写入', () => {
    const parsed = parseFencedTaskBlocks(RICH_LF);
    const after = updateTaskFieldById(RICH_LF, parsed, 'T-B', 'title', '验收：含中文冒号：与半角:冒号')!;
    const reparsed = parseFencedTaskBlocks(after);
    expect(getNodeField(reparsed.nodes[1]!, 'title')).toBe('验收：含中文冒号：与半角:冒号');
  });
});
