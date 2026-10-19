/**
 * wbs.md 节点语法三方案原型（T-M0a-02）。
 *
 * 三方案：
 *   A. fenced block   —— ```gatedeck-task ... ```（或波浪线 fence）
 *   B. HTML comment   —— <!-- gatedeck:task ... -->
 *   C. 独立任务文件   —— 每任务一个文件，YAML 风格 frontmatter
 *
 * 统一契约（R-04 round-trip 保真的可执行口径）：
 *   - 解析只「定位」节点区间（span），节点内部原文 raw 原样保留；
 *   - 未知字段、重复字段、未解析行一律保留并出诊断（F-06：手写未知内容保留并报错）；
 *   - reconstruct(parse(md)) 与原文字节级一致（含注释、空行、CRLF、EOL 风格）；
 *   - updateField 只改动目标字段的值文本，不动节点内其他字节（局部修改内核前置）。
 *
 * 纯字符串计算，无 IO（core 纯度约束）。
 */

export type WbsNodeScheme = 'fenced-block' | 'html-comment' | 'standalone-file';

export type WbsDiagnosticCode = 'unparsed-line' | 'unclosed-node' | 'duplicate-key';

export interface WbsDiagnostic {
  code: WbsDiagnosticCode;
  message: string;
  /** 1-based 行号（相对整个输入文本） */
  line: number;
}

export interface WbsField {
  key: string;
  value: string;
}

export interface WbsNode {
  scheme: WbsNodeScheme;
  /** 机器权威字段，按出现顺序；未知字段原样保留 */
  fields: WbsField[];
  /** 节点内部原文（不含包裹符） */
  raw: string;
  /** 节点内部原文在输入中的区间 [start, end) */
  rawSpan: { start: number; end: number };
  /** 节点整体区间 [start, end)（含包裹符），reconstruct 用 */
  span: { start: number; end: number };
  /** 包裹符原文切片：opener = md[span.start, rawSpan.start)，closer = md[rawSpan.end, span.end) */
  wrapper: { opener: string; closer: string };
}

export interface WbsParseResult {
  nodes: WbsNode[];
  diagnostics: WbsDiagnostic[];
}

/**
 * 字段行：`key: value`；key 以 Unicode 字母/下划线开头（允许中文未知字段，
 * F-06：手写未知内容保留并报错），后续为字母/数字/下划线/连字符。
 */
const FIELD_LINE = /^([\p{L}_][\p{L}\p{N}_-]*)[ \t]*:[ \t]?([^\r\n]*)$/u;

/** 逐行扫描原文（保留每行终止符），返回 [行文本(不含终止符), 行起始偏移, 终止符] */
function scanLines(text: string): Array<{ content: string; start: number; eol: string }> {
  const lines: Array<{ content: string; start: number; eol: string }> = [];
  let i = 0;
  while (i < text.length) {
    const nl = text.indexOf('\n', i);
    if (nl === -1) {
      lines.push({ content: text.slice(i), start: i, eol: '' });
      break;
    }
    const eol = text[nl - 1] === '\r' ? '\r\n' : '\n';
    const contentEnd = eol === '\r\n' ? nl - 1 : nl;
    lines.push({ content: text.slice(i, contentEnd), start: i, eol });
    i = nl + 1;
  }
  return lines;
}

/** 解析节点内部原文为字段行；无法识别的非空行保留原文并出诊断（F-06） */
function parseFieldLines(raw: string, lineOffset: number): { fields: WbsField[]; diagnostics: WbsDiagnostic[] } {
  const fields: WbsField[] = [];
  const diagnostics: WbsDiagnostic[] = [];
  for (const [idx, line] of scanLines(raw).entries()) {
    if (line.content.trim() === '') continue;
    const m = FIELD_LINE.exec(line.content);
    if (m === null) {
      diagnostics.push({
        code: 'unparsed-line',
        message: `无法识别为「key: value」的行已原样保留：${JSON.stringify(line.content)}`,
        line: lineOffset + idx + 1,
      });
      continue;
    }
    const key = m[1]!;
    if (fields.some((f) => f.key === key)) {
      diagnostics.push({
        code: 'duplicate-key',
        message: `字段 ${key} 在同一节点内重复出现，两处均保留，以权威位置规则后续裁决`,
        line: lineOffset + idx + 1,
      });
    }
    fields.push({ key, value: m[2] ?? '' });
  }
  return { fields, diagnostics };
}

function makeNode(
  scheme: WbsNodeScheme,
  md: string,
  span: { start: number; end: number },
  rawSpan: { start: number; end: number },
  lineOffset: number,
): { node: WbsNode; diagnostics: WbsDiagnostic[] } {
  const raw = md.slice(rawSpan.start, rawSpan.end);
  const { fields, diagnostics } = parseFieldLines(raw, lineOffset);
  const node: WbsNode = {
    scheme,
    fields,
    raw,
    rawSpan,
    span,
    wrapper: {
      opener: md.slice(span.start, rawSpan.start),
      closer: md.slice(rawSpan.end, span.end),
    },
  };
  return { node, diagnostics };
}

/* ---------------------------------------------------------------- *
 * 方案 A · fenced block
 * ---------------------------------------------------------------- */

/** 开 fence：`/^\s{0,3}(`{3,}|~{3,})[ \t]*gatedeck-task[ \t]*$/`（info string 固定） */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*gatedeck-task[ \t]*$/;

export function parseFencedTaskBlocks(md: string): WbsParseResult {
  const nodes: WbsNode[] = [];
  const diagnostics: WbsDiagnostic[] = [];
  const lines = scanLines(md);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const open = FENCE_OPEN.exec(line.content);
    if (open === null) {
      i++;
      continue;
    }
    const fenceChar = open[1]![0]!;
    const fenceLen = open[1]!.length;
    // CommonMark 闭合规则：同字符、长度不小于开 fence、不得携带 info string
    const closeRe = new RegExp(`^ {0,3}\\${fenceChar}{${fenceLen},}[ \\t]*$`);
    let closeIdx = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (closeRe.test(lines[j]!.content)) {
        closeIdx = j;
        break;
      }
    }
    if (closeIdx === -1) {
      diagnostics.push({
        code: 'unclosed-node',
        message: 'fenced block 未闭合，节点区间之后的内容无法归属（R-04：原文保留，不入节点）',
        line: i + 1,
      });
      break;
    }
    const rawStart = line.start + line.content.length + line.eol.length;
    const closeLine = lines[closeIdx]!;
    const rawEnd = closeLine.start;
    const spanEnd = closeLine.start + closeLine.content.length + closeLine.eol.length;
    const made = makeNode('fenced-block', md, { start: line.start, end: spanEnd }, { start: rawStart, end: rawEnd }, i + 1);
    nodes.push(made.node);
    diagnostics.push(...made.diagnostics);
    i = closeIdx + 1;
  }
  return { nodes, diagnostics };
}

/* ---------------------------------------------------------------- *
 * 方案 B · HTML comment
 * ---------------------------------------------------------------- */

const COMMENT_MARKER = 'gatedeck:task';

export function parseHtmlCommentTasks(md: string): WbsParseResult {
  const nodes: WbsNode[] = [];
  const diagnostics: WbsDiagnostic[] = [];
  let searchFrom = 0;
  while (searchFrom < md.length) {
    const open = md.indexOf('<!--', searchFrom);
    if (open === -1) break;
    const close = md.indexOf('-->', open + 4);
    const bodyStart = open + 4;
    if (close === -1) {
      // 未闭合注释：仅当带标记时才属于本语法关注范围
      if (md.slice(bodyStart).trimStart().startsWith(COMMENT_MARKER)) {
        diagnostics.push({
          code: 'unclosed-node',
          message: 'HTML 注释形式的任务节点未闭合（缺少 -->）',
          line: md.slice(0, open).split('\n').length,
        });
      }
      break;
    }
    const body = md.slice(bodyStart, close);
    const trimmed = body.trimStart();
    if (trimmed.startsWith(COMMENT_MARKER)) {
      // 去掉标记行（标记行后必须有换行，否则标记与首个字段同行——视为 unparsed）
      const rest = body.slice(body.length - trimmed.length);
      const nl = rest.indexOf('\n');
      if (nl === -1) {
        diagnostics.push({
          code: 'unparsed-line',
          message: 'gatedeck:task 标记后未换行，节点无字段可解析',
          line: md.slice(0, open).split('\n').length,
        });
      } else {
        const rawStart = bodyStart + (body.length - trimmed.length) + nl + 1;
        const rawEnd = close;
        const made = makeNode(
          'html-comment',
          md,
          { start: open, end: close + 3 },
          { start: rawStart, end: rawEnd },
          md.slice(0, rawStart).split('\n').length - 1,
        );
        nodes.push(made.node);
        diagnostics.push(...made.diagnostics);
      }
    }
    searchFrom = close + 3;
  }
  return { nodes, diagnostics };
}

/* ---------------------------------------------------------------- *
 * 方案 C · 独立任务文件（frontmatter）
 * ---------------------------------------------------------------- */

export function parseStandaloneTaskFile(text: string): WbsParseResult {
  const nodes: WbsNode[] = [];
  const diagnostics: WbsDiagnostic[] = [];
  const first = scanLines(text)[0];
  if (first === undefined || first.content.trim() !== '---') {
    return { nodes, diagnostics };
  }
  const rawStart = first.content.length + first.eol.length;
  const closeRe = /^---[ \t]*$/;
  for (const line of scanLines(text.slice(rawStart))) {
    if (!closeRe.test(line.content)) continue;
    const rawEnd = rawStart + line.start;
    const spanEnd = rawStart + line.start + line.content.length + line.eol.length;
    const made = makeNode('standalone-file', text, { start: 0, end: spanEnd }, { start: rawStart, end: rawEnd }, 1);
    nodes.push(made.node);
    diagnostics.push(...made.diagnostics);
    return { nodes, diagnostics };
  }
  diagnostics.push({
    code: 'unclosed-node',
    message: 'frontmatter 未闭合（缺少收尾 ---）',
    line: 1,
  });
  return { nodes, diagnostics };
}

/* ---------------------------------------------------------------- *
 * 重建与局部修改
 * ---------------------------------------------------------------- */

/**
 * 按解析结果重建整篇文档：节点区间以（包裹符 + 内部原文）原样回填，
 * 区间外文本一字节不动。raw 未被修改时结果与输入字节级一致。
 */
export function reconstruct(md: string, result: WbsParseResult): string {
  const sorted = [...result.nodes].sort((a, b) => b.span.start - a.span.start);
  let out = md;
  for (const node of sorted) {
    const rendered = node.wrapper.opener + node.raw + node.wrapper.closer;
    out = out.slice(0, node.span.start) + rendered + out.slice(node.span.end);
  }
  return out;
}

/**
 * 局部修改：将节点内第一个匹配 key 的字段值替换为 newValue。
 * 只改动该行的值文本，保留 key、冒号前空格、行终止符与缩进；key 不存在返回 null。
 */
export function updateField(node: WbsNode, key: string, newValue: string): WbsNode | null {
  const lines = scanLines(node.raw);
  let replaced = false;
  const parts: string[] = [];
  for (const line of lines) {
    if (!replaced) {
      const m = FIELD_LINE.exec(line.content);
      if (m !== null && m[1] === key) {
        const colon = line.content.indexOf(':');
        const head = line.content.slice(0, colon + 1);
        const tail = line.content.slice(colon + 1);
        const leading = tail.slice(0, tail.length - tail.trimStart().length);
        parts.push(head + leading + newValue);
        replaced = true;
        continue;
      }
    }
    parts.push(line.content);
  }
  if (!replaced) return null;
  // 重组：保留原有终止符风格
  let out = '';
  const srcLines = lines;
  for (let i = 0; i < parts.length; i++) {
    out += parts[i]! + (srcLines[i]!.eol);
  }
  return { ...node, raw: out };
}
