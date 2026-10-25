import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseEventBlocks } from '../core/eventEnvelope.js';
import { verifyEventChain, type EventReceipt, type ReceiptAnchor } from '../core/eventReceipt.js';
import { projectEventLog } from '../core/eventLog.js';
import { rebuildReceiptsForFile, rebuildChangelogReceipts, writeReceipts } from './receipts.js';

const T = '2026-10-25T09:00:00+08:00';

/** 构造一笔合法 core 事件块（project.initialized，字段格式与 contractTemplates 首笔事件对齐） */
function coreEventBlock(id: string, occurredAt: string): string {
  return [
    '```gatedeck-event',
    `event_id: ${id}`,
    'schema_version: 1',
    'kind: project.initialized',
    `occurred_at: ${occurredAt}`,
    `recorded_at: ${occurredAt}`,
    'actor: {"actor_id":"866c0d0cb4e81894e5dfefce0525ce84","session_id":"c495175b7a65cdfae09ca75f1c65ebb9","tool":"test"}',
    'origin: core',
    'integrity: verified',
    'subject: {"object_id":"gatedeck"}',
    `operation_id: ${id}`,
    'payload: {"stage":"M1"}',
    '```',
    '',
  ].join('\n');
}

/** 构造一笔合法 managed-api 事件块（evidence.submitted——MCP submit_evidence 的落盘形态） */
function managedEventBlock(id: string, occurredAt: string): string {
  return [
    '```gatedeck-event',
    `event_id: ${id}`,
    'schema_version: 1',
    'kind: evidence.submitted',
    `occurred_at: ${occurredAt}`,
    `recorded_at: ${occurredAt}`,
    'actor: {"actor_id":"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5","session_id":"f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0","tool":"gatedeck-mcp"}',
    'origin: managed-api',
    'integrity: unknown',
    'subject: {"object_id":"gate:G-001"}',
    'payload: {"validation_status":"pending","gate_id":"G-001","rule_id":"R-001"}',
    '```',
    '',
  ].join('\n');
}

/** 读取落盘收据库并按行解析（与 deck.ts readReceiptsJsonl 同口径） */
function readReceiptsJsonl(pmDir: string): EventReceipt[] {
  return readFileSync(join(pmDir, 'receipts.jsonl'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as EventReceipt);
}

function readAnchor(pmDir: string): ReceiptAnchor {
  return JSON.parse(readFileSync(join(pmDir, 'receipts.anchor.json'), 'utf8')) as ReceiptAnchor;
}

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function tmpPm(): string {
  const d = mkdtempSync(join(tmpdir(), 'gd-receipts-'));
  dirs.push(d);
  return d;
}

describe('rebuildReceiptsForFile（收据链装配）', () => {
  it('init 模拟：单事件重建后 receipts.jsonl + anchor 落盘，verifyEventChain 全 verified', () => {
    const pmDir = tmpPm();
    writeFileSync(join(pmDir, 'changelog.md'), `# 日志\n\n${coreEventBlock('01H800000000000000000000AA', T)}`, 'utf8');
    const r = rebuildReceiptsForFile(pmDir, 'changelog.md', T);
    expect(r).toEqual({ ok: true, count: 1 });
    expect(existsSync(join(pmDir, 'receipts.jsonl'))).toBe(true);
    expect(existsSync(join(pmDir, 'receipts.anchor.json'))).toBe(true);
    // 与 deck 读取路径集成：重读两文件做链验证
    const envelopes = parseEventBlocks(readFileSync(join(pmDir, 'changelog.md'), 'utf8')).envelopes;
    const verification = verifyEventChain(envelopes, readReceiptsJsonl(pmDir), readAnchor(pmDir));
    expect(verification.issues).toHaveLength(0);
    expect(verification.perEvent.every((p) => p.verdict === 'verified')).toBe(true);
  });

  it('多事件重建：链序 1..n 严格递增、prev_hash 链式衔接；重复重建字节幂等（receipts + anchor 同 nowIso 全等）', () => {
    const pmDir = tmpPm();
    writeFileSync(
      join(pmDir, 'changelog.md'),
      `# 日志\n\n${coreEventBlock('01H800000000000000000000A1', T)}${coreEventBlock('01H800000000000000000000A2', T)}`,
      'utf8',
    );
    const first = rebuildReceiptsForFile(pmDir, 'changelog.md', T);
    expect(first).toEqual({ ok: true, count: 2 });
    const receipts1 = readReceiptsJsonl(pmDir);
    const anchor1 = readFileSync(join(pmDir, 'receipts.anchor.json'), 'utf8');
    expect(receipts1.map((r) => r.seq)).toEqual([1, 2]);
    expect(receipts1[0]!.prev_hash).toBe('0'.repeat(64));
    expect(receipts1[1]!.prev_hash).toBe(receipts1[0]!.receipt_hash);
    // 重复重建（同输入同 nowIso）：receipts.jsonl 与 anchor 字节全等（幂等）
    rebuildReceiptsForFile(pmDir, 'changelog.md', T);
    expect(readFileSync(join(pmDir, 'receipts.jsonl'), 'utf8')).toBe(
      receipts1.map((r) => JSON.stringify(r)).join('\n') + '\n',
    );
    expect(readFileSync(join(pmDir, 'receipts.anchor.json'), 'utf8')).toBe(anchor1);
  });

  it('malformed 块忽略不建：无信封块如实跳过并计入 notes，合法事件照常验真', () => {
    const pmDir = tmpPm();
    const bad = ['```gatedeck-event', 'title: 不是信封字段', '```', '', ''].join('\n');
    writeFileSync(join(pmDir, 'changelog.md'), `# 日志\n\n${bad}${coreEventBlock('01H800000000000000000000A3', T)}`, 'utf8');
    const r = rebuildReceiptsForFile(pmDir, 'changelog.md', T);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.count).toBe(1);
    expect(r.notes?.some((n) => n.includes('1 个无法解析为合法信封'))).toBe(true);
  });

  it('managed-api 事件混入 changelog：不入链不抛错，core 事件 verified / managed unregistered，notes 如实说明', () => {
    const pmDir = tmpPm();
    writeFileSync(
      join(pmDir, 'changelog.md'),
      `# 日志\n\n${coreEventBlock('01H800000000000000000000A5', T)}${managedEventBlock('01H800000000000000000000A6', T)}`,
      'utf8',
    );
    const r = rebuildReceiptsForFile(pmDir, 'changelog.md', T);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.count).toBe(1); // 只有 core 事件入链（M0a-04 定稿）
    expect(r.notes?.some((n) => n.includes('1 笔 origin=managed-api/manual 事件不入链'))).toBe(true);
    const envelopes = parseEventBlocks(readFileSync(join(pmDir, 'changelog.md'), 'utf8')).envelopes;
    const verification = verifyEventChain(envelopes, readReceiptsJsonl(pmDir), readAnchor(pmDir));
    expect(verification.issues).toHaveLength(0);
    expect(verification.perEvent[0]!.verdict).toBe('verified');
    expect(verification.perEvent[1]!.verdict).toBe('unregistered'); // managed-api 事件不入链 → external-unverified
  });

  it('insights.md 跳过：不读不写收据库（changelog 链不被覆盖），notes 说明为后续项', () => {
    const pmDir = tmpPm();
    writeFileSync(join(pmDir, 'changelog.md'), `# 日志\n\n${coreEventBlock('01H800000000000000000000A7', T)}`, 'utf8');
    writeFileSync(join(pmDir, 'insights.md'), '# 洞察\n\n', 'utf8');
    const changelogRebuild = rebuildReceiptsForFile(pmDir, 'changelog.md', T);
    expect(changelogRebuild).toEqual({ ok: true, count: 1 });
    const before = readFileSync(join(pmDir, 'receipts.jsonl'), 'utf8');
    const anchorBefore = readFileSync(join(pmDir, 'receipts.anchor.json'), 'utf8');
    const r = rebuildReceiptsForFile(pmDir, 'insights.md', T);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.count).toBe(0);
    expect(r.notes?.join('\n')).toContain('insights.md 事件暂不登记收据链');
    expect(readFileSync(join(pmDir, 'receipts.jsonl'), 'utf8')).toBe(before);
    expect(readFileSync(join(pmDir, 'receipts.anchor.json'), 'utf8')).toBe(anchorBefore);
  });

  it('缺 pm 目录 / 缺日志文件：如实报错且不写任何文件', () => {
    const missing = join(tmpdir(), 'gd-receipts-nope-' + String(Date.now()) + '-' + String(Math.random()).slice(2));
    const r1 = rebuildReceiptsForFile(missing, 'changelog.md', T);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.code).toBe('pm-dir-missing');
    expect(existsSync(join(missing, 'receipts.jsonl'))).toBe(false);
    const emptyPm = tmpPm(); // pm 目录存在但无 changelog
    const r2 = rebuildReceiptsForFile(emptyPm, 'changelog.md', T);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('log-file-missing');
    expect(existsSync(join(emptyPm, 'receipts.jsonl'))).toBe(false);
    expect(existsSync(join(emptyPm, 'receipts.anchor.json'))).toBe(false);
  });

  it('nowIso 注入：anchor.generated_at 用注入值，不取系统时钟', () => {
    const pmDir = tmpPm();
    writeFileSync(join(pmDir, 'changelog.md'), `# 日志\n\n${coreEventBlock('01H800000000000000000000A4', T)}`, 'utf8');
    rebuildReceiptsForFile(pmDir, 'changelog.md', '2026-10-25T11:11:11+08:00');
    expect(readAnchor(pmDir).generated_at).toBe('2026-10-25T11:11:11+08:00');
  });

  it('deck 装配集成：projectEventLog + verifyEventChain 组合——entries 全 verified、needsAttention=false', () => {
    const pmDir = tmpPm();
    writeFileSync(
      join(pmDir, 'changelog.md'),
      `# 日志\n\n${coreEventBlock('01H800000000000000000000A8', T)}${coreEventBlock('01H800000000000000000000A9', T)}`,
      'utf8',
    );
    rebuildReceiptsForFile(pmDir, 'changelog.md', T);
    const md = readFileSync(join(pmDir, 'changelog.md'), 'utf8');
    const projection = projectEventLog(md, readReceiptsJsonl(pmDir), readAnchor(pmDir));
    expect(projection.malformedCount).toBe(0);
    expect(projection.needsAttention).toBe(false);
    expect(projection.chainIssues).toHaveLength(0);
    expect(projection.entries.every((e) => e.status === 'verified')).toBe(true);
    expect(projection.entries.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('写入失败如实报错不吞：receipts.jsonl 位置为目录 → ok=false（事件日志一字节未动）', () => {
    const pmDir = tmpPm();
    const changelogText = `# 日志\n\n${coreEventBlock('01H800000000000000000000AB', T)}`;
    writeFileSync(join(pmDir, 'changelog.md'), changelogText, 'utf8');
    mkdirSync(join(pmDir, 'receipts.jsonl')); // 预置同名目录：writeFileSync 必抛 EISDIR/EPERM
    const r = rebuildReceiptsForFile(pmDir, 'changelog.md', T);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('receipts-write-failed');
    expect(readFileSync(join(pmDir, 'changelog.md'), 'utf8')).toBe(changelogText);
  });

  it('空事件（仅人类说明）→ 0 笔收据：jsonl 为空内容，锚点 length=0 / chain_head=GENESIS', () => {
    const pmDir = tmpPm();
    writeFileSync(join(pmDir, 'changelog.md'), '# 日志\n\n仅说明文字，无事件块。\n', 'utf8');
    const r = rebuildReceiptsForFile(pmDir, 'changelog.md', T);
    expect(r).toEqual({ ok: true, count: 0 });
    expect(readFileSync(join(pmDir, 'receipts.jsonl'), 'utf8')).toBe('');
    const anchor = readAnchor(pmDir);
    expect(anchor.length).toBe(0);
    expect(anchor.chain_head).toBe('0'.repeat(64));
  });

  it('兼容别名 rebuildChangelogReceipts 与 writeReceipts：行为与规格函数一致', () => {
    const pmDir = tmpPm();
    writeFileSync(join(pmDir, 'changelog.md'), `# 日志\n\n${coreEventBlock('01H800000000000000000000AC', T)}`, 'utf8');
    const r = rebuildChangelogReceipts(pmDir, T);
    expect(r).toEqual({ ok: true, count: 1 });
    // writeReceipts 直写：与 rebuild 产物等价（jsonl 逐行 + anchor JSON）
    const receipts = readReceiptsJsonl(pmDir);
    const alt = tmpPm();
    writeReceipts(alt, receipts, {
      schema_version: '1',
      algorithm: 'sha256',
      chain_head: receipts[receipts.length - 1]!.receipt_hash,
      length: receipts.length,
      generated_at: T,
    });
    expect(readFileSync(join(alt, 'receipts.jsonl'), 'utf8')).toBe(readFileSync(join(pmDir, 'receipts.jsonl'), 'utf8'));
  });
});
