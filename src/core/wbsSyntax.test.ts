import { describe, expect, it } from 'vitest';

import {
  parseFencedTaskBlocks,
  parseHtmlCommentTasks,
  parseStandaloneTaskFile,
  reconstruct,
  updateField,
  type WbsParseResult,
} from './wbsSyntax.js';

const F3 = '`'.repeat(3);
const T3 = '~'.repeat(3);

/** 真实含注释样本：中文、用户注释、未知字段、节点内嵌不同字符的内层 fence */
const FENCED_SAMPLE = [
  '# 示例 WBS（真实含注释样本）',
  '',
  '<!-- 用户手写注释：机器不得吞掉这一行（R-04） -->',
  '',
  `${T3}gatedeck-task`,
  'id: T-M0a-02',
  'title: 节点语法三方案对比原型',
  'status: doing',
  'owner: 张三',
  'deps: T-M0a-01',
  '自定义字段-示例: 未知的字段值也要保留',
  'note: 值里允许中文与符号：冒号、波浪线与更短的内层 fence（见下）',
  F3,
  'const x = 1; // 内层三反引号围栏在波浪线节点内是普通内容',
  F3,
  T3,
  '',
  '节点之间的自由文本是人类说明，不参与状态推导。',
  '',
  `${F3}gatedeck-task`,
  'id: T-M0a-03',
  'title: 事件信封 schema 定稿',
  'status: todo',
  F3,
  '',
].join('\n');

/** 结构歧义样本：内层与外层同字符 fence 被当作闭合（方案 A 的已知风险） */
const FENCED_CONFLICT_SAMPLE = [
  `${F3}gatedeck-task`,
  'id: X-1',
  F3,
  '这一行本应是节点内容，但被闭合规则截断',
  `${F3}gatedeck-task`,
  'id: X-2',
  F3,
].join('\n');

const FENCED_UNCLOSED_SAMPLE = [`${F3}gatedeck-task`, 'id: X-1', 'status: todo'].join('\n');

const HTML_SAMPLE = [
  '前文人类说明。',
  '',
  '<!-- gatedeck:task',
  'id: T-1',
  'title: 注释方案节点',
  'status: todo',
  '-->',
  '',
  '<!-- 普通用户注释，不是任务节点，必须原样保留 -->',
  '',
].join('\n');

/** 方案 B 结构缺陷样本：值中出现 --> 会提前终止注释 */
const HTML_DEADLOCK_SAMPLE = [
  '<!-- gatedeck:task',
  'id: T-2',
  'note: 值里写 --> 会提前终止',
  'status: todo',
  '-->',
].join('\n');

const HTML_UNCLOSED_SAMPLE = ['<!-- gatedeck:task', 'id: T-3', 'status: todo'].join('\n');

const STANDALONE_SAMPLE = [
  '---',
  'id: T-1',
  'title: 独立任务文件方案',
  'status: doing',
  'deps: T-0',
  '---',
  '',
  '# 正文：人类说明（不参与推导）',
  '',
  '正文里的代码块与注释随意，均不属于机器字段。',
  '',
].join('\n');

function ids(result: WbsParseResult): string[] {
  return result.nodes.map((n) => n.fields.find((f) => f.key === 'id')?.value ?? '(缺 id)');
}

describe('方案 A · fenced block（T-M0a-02 原型）', () => {
  it('解析出两个节点，字段按出现顺序，未知字段原样保留', () => {
    const r = parseFencedTaskBlocks(FENCED_SAMPLE);
    expect(ids(r)).toEqual(['T-M0a-02', 'T-M0a-03']);
    const unknown = r.nodes[0]!.fields.find((f) => f.key === '自定义字段-示例');
    expect(unknown?.value).toBe('未知的字段值也要保留');
    expect(r.nodes[0]!.fields.map((f) => f.key)).toEqual([
      'id',
      'title',
      'status',
      'owner',
      'deps',
      '自定义字段-示例',
      'note',
    ]);
  });

  it('round-trip：reconstruct 与原文字节级一致（注释/空行/自由文本全保留）', () => {
    const r = parseFencedTaskBlocks(FENCED_SAMPLE);
    expect(reconstruct(FENCED_SAMPLE, r)).toBe(FENCED_SAMPLE);
  });

  it('节点内不同字符的内层 fence 是普通内容，不终止节点', () => {
    const r = parseFencedTaskBlocks(FENCED_SAMPLE);
    expect(r.nodes[0]!.raw).toContain('const x = 1;');
  });

  it('CRLF 样本 round-trip 字节级一致', () => {
    const crlf = FENCED_SAMPLE.replace(/\n/g, '\r\n');
    const r = parseFencedTaskBlocks(crlf);
    expect(reconstruct(crlf, r)).toBe(crlf);
  });

  it('updateField 只改动目标行，其余字节不变', () => {
    const r = parseFencedTaskBlocks(FENCED_SAMPLE);
    const node = r.nodes[0]!;
    const updated = updateField(node, 'status', 'done');
    expect(updated).not.toBeNull();
    const doc =
      FENCED_SAMPLE.slice(0, node.span.start) +
      updated!.wrapper.opener +
      updated!.raw +
      updated!.wrapper.closer +
      FENCED_SAMPLE.slice(node.span.end);
    expect(doc).toBe(FENCED_SAMPLE.replace('status: doing', 'status: done'));
  });

  it('已知风险：内层同字符 fence 被当作闭合，后续内容落在节点外（原文仍不丢失）', () => {
    const r = parseFencedTaskBlocks(FENCED_CONFLICT_SAMPLE);
    expect(ids(r)).toEqual(['X-1', 'X-2']);
    expect(r.nodes[0]!.raw).not.toContain('这一行本应是节点内容');
    expect(reconstruct(FENCED_CONFLICT_SAMPLE, r)).toBe(FENCED_CONFLICT_SAMPLE);
  });

  it('未闭合 fence 出诊断，原文保留', () => {
    const r = parseFencedTaskBlocks(FENCED_UNCLOSED_SAMPLE);
    expect(r.nodes).toHaveLength(0);
    expect(r.diagnostics.some((d) => d.code === 'unclosed-node')).toBe(true);
  });
});

describe('方案 B · HTML comment（T-M0a-02 原型）', () => {
  it('解析节点字段；非节点的用户注释不属于节点', () => {
    const r = parseHtmlCommentTasks(HTML_SAMPLE);
    expect(ids(r)).toEqual(['T-1']);
    expect(r.diagnostics).toEqual([]);
  });

  it('round-trip 字节级一致（用户注释原样保留）', () => {
    const r = parseHtmlCommentTasks(HTML_SAMPLE);
    expect(reconstruct(HTML_SAMPLE, r)).toBe(HTML_SAMPLE);
  });

  it('已知缺陷：值中出现 --> 提前终止注释，后续字段静默丢失在节点外', () => {
    const r = parseHtmlCommentTasks(HTML_DEADLOCK_SAMPLE);
    const node = r.nodes[0]!;
    expect(node.fields.map((f) => f.key)).toEqual(['id', 'note']);
    expect(node.fields.find((f) => f.key === 'note')?.value).toBe('值里写 ');
    expect(node.raw).not.toContain('status: todo');
  });

  it('带标记但未闭合的注释出诊断', () => {
    const r = parseHtmlCommentTasks(HTML_UNCLOSED_SAMPLE);
    expect(r.nodes).toHaveLength(0);
    expect(r.diagnostics.some((d) => d.code === 'unclosed-node')).toBe(true);
  });

  it('updateField 可局部修改注释节点', () => {
    const r = parseHtmlCommentTasks(HTML_SAMPLE);
    const node = r.nodes[0]!;
    const updated = updateField(node, 'status', 'done');
    expect(updated?.raw).toContain('status: done');
    expect(updated?.raw).toContain('title: 注释方案节点');
  });
});

describe('方案 C · 独立任务文件（T-M0a-02 原型）', () => {
  it('解析 frontmatter 字段；正文不属于节点', () => {
    const r = parseStandaloneTaskFile(STANDALONE_SAMPLE);
    expect(ids(r)).toEqual(['T-1']);
    expect(r.nodes[0]!.raw).not.toContain('正文');
    expect(r.diagnostics).toEqual([]);
  });

  it('round-trip 字节级一致', () => {
    const r = parseStandaloneTaskFile(STANDALONE_SAMPLE);
    expect(reconstruct(STANDALONE_SAMPLE, r)).toBe(STANDALONE_SAMPLE);
  });

  it('CRLF 样本 round-trip 字节级一致', () => {
    const crlf = STANDALONE_SAMPLE.replace(/\n/g, '\r\n');
    const r = parseStandaloneTaskFile(crlf);
    expect(reconstruct(crlf, r)).toBe(crlf);
  });

  it('无 frontmatter 返回空；未闭合出诊断', () => {
    expect(parseStandaloneTaskFile('普通文档没有 frontmatter').nodes).toHaveLength(0);
    const unclosed = parseStandaloneTaskFile('---\nid: T-9\nstatus: todo\n');
    expect(unclosed.nodes).toHaveLength(0);
    expect(unclosed.diagnostics.some((d) => d.code === 'unclosed-node')).toBe(true);
  });

  it('updateField 不触碰正文（正文在 span 之外）', () => {
    const r = parseStandaloneTaskFile(STANDALONE_SAMPLE);
    const node = r.nodes[0]!;
    const updated = updateField(node, 'status', 'done');
    const doc =
      STANDALONE_SAMPLE.slice(0, node.span.start) +
      updated!.wrapper.opener +
      updated!.raw +
      updated!.wrapper.closer +
      STANDALONE_SAMPLE.slice(node.span.end);
    expect(doc).toBe(STANDALONE_SAMPLE.replace('status: doing', 'status: done'));
  });
});
