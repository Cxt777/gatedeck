/**
 * 受管事件写入的收据链装配（收据链装配闭环；M0a-04 定稿口径的写入侧承接）。
 *
 * 背景：init / MCP 类型化事件 / request_promotion 只追加事件块，未登记收据链
 * （pm/receipts.jsonl + pm/receipts.anchor.json），导致全部事件 external-unverified、
 * 阶段无法派生（P-09：未验真事件不参与状态推导）。本模块补齐「写入后登记」一环。
 *
 * 契约（与 cli/commands/deck.ts 的读取实现逐字对齐——deck.ts:149-173 为唯一读取契约）：
 *  - pm/receipts.jsonl：每行一个 EventReceipt（紧凑 JSON，一行一条）；空行跳过、坏行记错不静默；
 *  - pm/receipts.anchor.json：ReceiptAnchor 对象（JSON）；
 *  - **链只覆盖 changelog.md 事件**：deck 与 check_gate 的收据验证都只喂 changelog 事件流
 *    （deck.ts:131-144 只解析 changelog.md；gates.ts assembleVerifiedCheckEvents 同口径），
 *    若 insights 事件也写入同一收据文件会互相覆盖——故 insights 事件（record_note /
 *    report_usage）暂不建链（返回 ok 且 notes 说明，为后续项）：它们是非权威事件，不驱动
 *    状态（P-09），unverified 即其正确状态。
 *
 * 全量重建口径（append-only 下与增量等价，简单正确）：每次受管写入后对日志当前全部
 * 事件重建——buildReceiptChain 对同一事件序列确定性输出，重复重建字节幂等。
 *
 * 建链过滤（M0a-04 定稿，eventReceipt.ts 文件头）：
 *  - 收据只为 origin=core 的权威事件生成；managed-api / manual 事件不入链，加载时按
 *    S2.1-04 判定 external-unverified（有效 integrity=unknown，不驱动状态）；
 *  - 因此本模块在调用 buildReceiptChain 前过滤 origin=core——否则混入 managed-api 事件
 *    会令 buildReceiptChain 抛错（eventReceipt.ts:66-68），受管写入路径整体失败；
 *  - malformed 块（无法构造合法信封）无 event_id 可登记，如实跳过不建（与 deck 的
 *    malformedCount 口径一致：块总数 − 合法信封数）。
 *
 * 分层：managed = cli/mcp 共用装配层（允许 IO）；链计算全在 core（eventReceipt/
 * eventEnvelope）。时间戳默认 new Date()（壳层），测试注入固定值。
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseEventBlocks } from '../core/eventEnvelope.js';
import {
  buildAnchor,
  buildReceiptChain,
  type EventReceipt,
  type ReceiptAnchor,
} from '../core/eventReceipt.js';

/** 受管日志文件名（收据装配的对象口径；本版链只覆盖 changelog.md） */
export type ManagedLogFileName = 'changelog.md' | 'insights.md';

/** 重建结果：ok 时 count 为链长（收据条数）；notes 承载跳过与后续项的如实说明 */
export type RebuildReceiptsResult =
  | { ok: true; count: number; notes?: string[] }
  | { ok: false; code: string; message: string };

/**
 * 序列化落盘：receipts 逐行紧凑 JSON（deck readReceiptsJsonl 按行解析）+ anchor
 * 美化 JSON（deck JSON.parse 整文件）。空链写空文件（deck 侧空收据库 + 锚点
 * length=0/chain_head=GENESIS 可正常验真为「全部未登记」）。
 */
export function writeReceipts(pmDir: string, receipts: readonly EventReceipt[], anchor: ReceiptAnchor): void {
  const text = receipts.length > 0 ? receipts.map((r) => JSON.stringify(r)).join('\n') + '\n' : '';
  writeFileSync(join(pmDir, 'receipts.jsonl'), text, 'utf8');
  writeFileSync(join(pmDir, 'receipts.anchor.json'), JSON.stringify(anchor, null, 2) + '\n', 'utf8');
}

/**
 * 对 pmDir/<logFileName> 当前全部事件全量重建收据链并落盘（本版仅 changelog.md 建链）。
 *
 * - changelog.md：读原文 → parseEventBlocks 取合法信封（malformed 块如实跳过）→
 *   过滤 origin=core → buildReceiptChain → buildAnchor(nowIso) → writeReceipts；
 * - insights.md：跳过不读不写（deck 契约只读 changelog 链，notes 说明为后续项）；
 * - 任何 IO/解析异常转 { ok:false, code, message } 如实返回，不吞（W-06）；
 *   事件日志本身不被本函数改动，重试安全。
 */
export function rebuildReceiptsForFile(
  pmDir: string,
  logFileName: ManagedLogFileName,
  nowIso: string = new Date().toISOString(),
): RebuildReceiptsResult {
  if (logFileName === 'insights.md') {
    return {
      ok: true,
      count: 0,
      notes: [
        'insights.md 事件暂不登记收据链（后续项）：deck 收据契约只覆盖 changelog.md 事件流' +
          '（cli/commands/deck.ts 读取口径），共用一个收据文件会互相覆盖；insights 事件为非权威事件不驱动状态（P-09）。',
      ],
    };
  }
  const logPath = join(pmDir, logFileName);
  try {
    if (!existsSync(pmDir) || !statSync(pmDir).isDirectory()) {
      return {
        ok: false,
        code: 'pm-dir-missing',
        message: `pm 目录不存在（${pmDir}）：无受管事件可登记，先运行 gatedeck init。`,
      };
    }
    if (!existsSync(logPath)) {
      return { ok: false, code: 'log-file-missing', message: `pm/${logFileName} 不存在（${pmDir}）：无事件可登记。` };
    }
    const text = readFileSync(logPath, 'utf8');
    const parsed = parseEventBlocks(text);
    // 只对「能构造合法信封且 origin=core」的事件建收据（M0a-04 定稿：managed-api/manual 不入链）
    const coreEnvelopes = parsed.envelopes.filter((e) => e.origin === 'core');
    const managedCount = parsed.envelopes.length - coreEnvelopes.length;
    const malformedCount = parsed.blocks.nodes.length - parsed.envelopes.length;
    const receipts = buildReceiptChain(coreEnvelopes);
    const anchor = buildAnchor(receipts, nowIso);
    writeReceipts(pmDir, receipts, anchor);
    const notes: string[] = [];
    if (managedCount > 0) {
      notes.push(
        `${managedCount} 笔 origin=managed-api/manual 事件不入链（M0a-04 定稿：收据只为 core 权威事件生成），加载时按 external-unverified 处理。`,
      );
    }
    if (malformedCount > 0) {
      notes.push(
        `${malformedCount} 个无法解析为合法信封的事件块未建收据（原文保留，按 external-unverified 处理）。`,
      );
    }
    return { ok: true, count: receipts.length, ...(notes.length > 0 ? { notes } : {}) };
  } catch (e) {
    return {
      ok: false,
      code: 'receipts-write-failed',
      message:
        `收据链重建失败（${logPath}）：${e instanceof Error ? e.message : String(e)}` +
        '——事件日志未被本函数改动，可修复后重试。',
    };
  }
}

/**
 * 兼容别名：对 pm/changelog.md 重建收据链（= rebuildReceiptsForFile(pmDir, 'changelog.md', nowIso)）。
 * 保留原因：src/cli/commands/promote.ts（另一工作流）已引用本函数（promote.ts:32/214），
 * 签名与返回形态保持兼容（ok 分支新增的可选 notes 不影响其 count/message 消费）。
 */
export function rebuildChangelogReceipts(
  pmDir: string,
  nowIso: string = new Date().toISOString(),
): RebuildReceiptsResult {
  return rebuildReceiptsForFile(pmDir, 'changelog.md', nowIso);
}
