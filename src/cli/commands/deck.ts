/**
 * `gatedeck deck` —— 决策台文本投影（W-S2-6 = T-M1-06 总览墙 + T-M1-09 决策台四条规则）。
 *
 * 分层约定：本命令为「壳」，只做文件读取与文本渲染；归区判定全部下沉
 * src/core/decisionBoard.ts（decideBoard 纯函数，brief/一页 Web 复用）。
 *
 * 只读承诺（B-7 同源）：本命令只读 pm/ 下的事实源，不写任何文件、不执行任何命令。
 *
 * 装配口径（M1 阶段的诚实边界，随后续任务演进）：
 *  - pm/ 目录不存在 → 输出初始化引导，退出码 2（未初始化不是成功态，W-06）；
 *  - 任务：解析 pm/wbs.md（parseFencedTaskBlocks + wbsKernel 校验）→ BoardTask；
 *    节点 gate 字段视为任务所属阶段（与 foldStage.currentStage 同一命名空间）；
 *  - 阶段：解析 pm/changelog.md（parseEventBlocks）→ 收据验证（verifyEventChain）→
 *    foldStage 折叠 → current/asOf/sourceVersion/needsAttention；
 *    收据库读 pm/receipts.jsonl + pm/receipts.anchor.json（布局草案，待 T-M1-01 定稿对齐）；
 *  - 门禁：gates.md 解析器尚未落地（T-M1-04）→ 暂以空门禁装配，输出中如实注明，
 *    「等您决定」区在此期间不会出现门禁卡；
 *  - 数据不全（如 changelog 缺失）不阻塞只读投影：按空装配 + 输出「数据说明」注明，
 *    未知与缺失如实展示、不编造（W-06）。
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  decideBoard,
  type BoardGate,
  type BoardTask,
  type BoardTaskStatus,
  type DecisionZone,
} from '../../core/decisionBoard.js';
import { formatVersion } from '../../core/derivedVersion.js';
import { parseEventBlocks } from '../../core/eventEnvelope.js';
import { verifyEventChain, type EventReceipt, type ReceiptAnchor } from '../../core/eventReceipt.js';
import { foldStage, type FoldEvent } from '../../core/stageFold.js';
import { getNodeField, validateWbsDocument, WBS_STATUS_VALUES } from '../../core/wbsKernel.js';
import { parseFencedTaskBlocks } from '../../core/wbsSyntax.js';
import type { CliIo } from '../index.js';

/** 渲染区顺序：等您决定 → 可以推进 → 需要关注 → 进行中 */
const ZONE_ORDER: readonly DecisionZone[] = ['awaiting-decision', 'can-proceed', 'needs-attention', 'in-progress'];

/** 区名映射（与 core 四规则的中文名一致，渲染层不做第二套口径） */
const ZONE_TITLES: Record<DecisionZone, string> = {
  'awaiting-decision': '等您决定',
  'can-proceed': '可以推进',
  'needs-attention': '需要关注',
  'in-progress': '进行中',
};

/** wbs 节点 status → BoardTaskStatus 白名单（与 wbsKernel.WBS_STATUS_VALUES 同源） */
const BOARD_STATUS_SET: ReadonlySet<string> = new Set<string>(WBS_STATUS_VALUES);

/** 需处理明细行（装配层把 foldStage.attention 与装配侧异常归一成此形状展示） */
interface AttentionLine {
  source: string;
  message: string;
}

/**
 * deck 命令入口：只读装配 pm/ 事实源 → decideBoard 归区 → 文本墙渲染。
 * 返回进程退出码（0 投影成功渲染 / 2 未初始化或读取失败）。
 */
export function runDeck(io: CliIo, cwd: string = process.cwd()): number {
  const pmDir = join(cwd, 'pm');
  if (!existsSync(pmDir) || !statSync(pmDir).isDirectory()) {
    renderInitGuide(io);
    return 2;
  }

  try {
    renderDeck(io, cwd, pmDir);
    return 0;
  } catch (e) {
    io.err(`deck 读取失败（只读命令未产生任何写入）：${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
}

/** 未初始化引导：不假装能看到决策台，明示下一步（W-06） */
function renderInitGuide(io: CliIo): void {
  io.out('尚未初始化：先运行 gatedeck init（在当前目录生成 pm/ 契约文件骨架）。');
  io.out('');
  io.out('决策台（decision deck）三区一览——初始化后运行 gatedeck deck 查看：');
  io.out('  ◆ 等您决定 —— 待验收门禁 / 待审推进申请，等待主理人裁决的事项');
  io.out('  ◆ 可以推进 —— 前置依赖已满足、当前阶段内可领取的任务');
  io.out('  ◆ 需要关注 —— 任务阻塞 / 证据过期待复验 / 事件链需处理');
  io.out('（另有「进行中」区展示正在进行的任务；尾部携带 as_of 与源版本。）');
}

/** 有 pm/ 目录时的完整装配与渲染；文件读取异常向上抛（由 runDeck 统一兜底） */
function renderDeck(io: CliIo, cwd: string, pmDir: string): void {
  const notes: string[] = [];
  const diagnostics: string[] = [];

  // —— 任务：pm/wbs.md ——
  const tasks: BoardTask[] = [];
  const wbsPath = join(pmDir, 'wbs.md');
  if (existsSync(wbsPath)) {
    const wbsMd = readFileSync(wbsPath, 'utf8');
    const parsed = parseFencedTaskBlocks(wbsMd, 'gatedeck-task');
    const validation = validateWbsDocument(wbsMd, parsed);
    for (const node of parsed.nodes) {
      const id = getNodeField(node, 'id')?.trim();
      const title = getNodeField(node, 'title')?.trim();
      const status = getNodeField(node, 'status')?.trim();
      // 缺必需字段 / status 非法的节点不入墙（诊断如实展示，不编造状态）
      if (id === undefined || title === undefined || status === undefined || !BOARD_STATUS_SET.has(status)) continue;
      const deps = (getNodeField(node, 'deps') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '');
      // 装配口径：节点 gate 字段 = 任务所属阶段门禁 id（与 foldStage.currentStage 同命名空间）
      const stage = getNodeField(node, 'gate')?.trim();
      tasks.push({
        id,
        title,
        status: status as BoardTaskStatus,
        deps,
        ...(stage !== undefined && stage !== '' ? { stage } : {}),
      });
    }
    for (const d of [...parsed.diagnostics, ...validation.diagnostics]) {
      const at = 'line' in d && d.line !== undefined ? `（line ${d.line}）` : '';
      diagnostics.push(`[wbs] [${d.code}] ${d.message}${at}`);
    }
  } else {
    notes.push('pm/wbs.md 缺失：任务数据为空。');
  }

  // —— 阶段：pm/changelog.md 事件流 + 收据验证 → foldStage ——
  const changelogPath = join(pmDir, 'changelog.md');
  let envelopes: ReturnType<typeof parseEventBlocks>['envelopes'] = [];
  let malformedCount = 0;
  if (existsSync(changelogPath)) {
    const parsedEvents = parseEventBlocks(readFileSync(changelogPath, 'utf8'));
    envelopes = parsedEvents.envelopes;
    malformedCount = parsedEvents.blocks.nodes.length - envelopes.length;
    for (const d of parsedEvents.diagnostics) {
      diagnostics.push(`[changelog] [${d.code}] ${d.message}（line ${d.line}）`);
    }
  } else {
    notes.push('pm/changelog.md 缺失：事件流为空，阶段无法派生。');
  }

  // 需处理明细：foldStage.attention（链级 + 折叠诊断）+ 装配侧异常（malformed 块 / 收据解析失败）
  const needsAttentionLines: AttentionLine[] = [];

  const receiptsPath = join(pmDir, 'receipts.jsonl');
  const anchorPath = join(pmDir, 'receipts.anchor.json');
  let receipts: EventReceipt[] = [];
  let anchor: ReceiptAnchor | null = null;
  if (existsSync(receiptsPath)) {
    const read = readReceiptsJsonl(readFileSync(receiptsPath, 'utf8'));
    receipts = read.receipts;
    for (const e of read.errors) {
      needsAttentionLines.push({ source: 'receipts', message: e });
    }
  } else {
    notes.push('收据库未找到（pm/receipts.jsonl）：changelog 事件暂无来源验证，均不参与状态推导。');
  }
  if (existsSync(anchorPath)) {
    try {
      anchor = JSON.parse(readFileSync(anchorPath, 'utf8')) as ReceiptAnchor;
    } catch (e) {
      needsAttentionLines.push({
        source: 'receipts',
        message: `锚点文件解析失败（pm/receipts.anchor.json）：${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  const verification = verifyEventChain(envelopes, receipts, anchor);
  const foldEvents: FoldEvent[] = envelopes.map((envelope, i) => {
    const verdict = verification.perEvent[i]!; // perEvent 与输入同序（eventReceipt 契约）
    return {
      envelope,
      effectiveIntegrity: verdict.verdict,
      ...(verdict.seq !== undefined ? { seq: verdict.seq } : {}),
    };
  });
  const stageProj = foldStage(foldEvents, { chainIssues: verification.issues });

  // 折叠投影的需处理条目（链级 + 折叠诊断）并入明细
  for (const a of stageProj.attention) {
    needsAttentionLines.push({
      source: a.source,
      message: a.event_id !== undefined ? `${a.message}（event_id=${a.event_id}）` : a.message,
    });
  }
  if (malformedCount > 0) {
    needsAttentionLines.push({
      source: 'changelog',
      message: `changelog 中有 ${malformedCount} 个无法解析为合法信封的事件块（按 external-unverified 处理，不参与状态推导）`,
    });
  }

  // —— 决策台归区（core 纯函数）——
  const gates: BoardGate[] = []; // gates.md 解析器待 T-M1-04 接入，M1 以空门禁装配
  const board = decideBoard({
    tasks,
    gates,
    stage: {
      current: stageProj.currentStage,
      asOf: stageProj.asOf,
      sourceVersion: stageProj.sourceVersion,
      needsAttention: needsAttentionLines,
    },
    currentStageName: stageProj.currentStage,
  });

  // —— 渲染 ——
  io.out(`gatedeck 决策台（decision deck）—— ${cwd}`);
  io.out('');
  for (const zone of ZONE_ORDER) {
    const zoneItems = board.items.filter((i) => i.zone === zone);
    io.out(`◆ ${ZONE_TITLES[zone]}（${zoneItems.length}）`);
    if (zoneItems.length === 0) {
      io.out('  （空）');
    }
    for (const item of zoneItems) {
      const id = item.task?.id ?? item.gate?.id ?? item.stageIssue ?? '—';
      const title = item.task?.title ?? item.gate?.title ?? (item.stageIssue !== undefined ? '事件链需处理' : '—');
      io.out(`  [${id}] ${title} —— ${item.reason}`);
      if (item.stageIssue !== undefined && needsAttentionLines.length > 0) {
        for (const line of needsAttentionLines) {
          io.out(`      · [${line.source}] ${line.message}`);
        }
      }
    }
    io.out('');
  }

  io.out('────');
  if (diagnostics.length > 0) {
    io.out('数据诊断（如实展示，不阻塞只读投影）：');
    for (const d of diagnostics) io.out(`  · ${d}`);
    io.out('');
  }
  if (notes.length > 0) {
    io.out('数据说明：');
    for (const n of notes) io.out(`  · ${n}`);
  }
  io.out('  · 门禁数据待 T-M1-04 接入：本投影暂以空门禁装配，「等您决定」区暂不含门禁卡。');
  io.out(`当前阶段：${stageProj.currentStage ?? '未派生'}`);
  io.out(formatVersion({ asOf: board.asOf, sourceVersion: board.sourceVersion }));
}

/** 收据库 JSONL 解析：每行一个 EventReceipt；空行跳过，坏行跳过并记错误（不静默吞掉，W-06） */
function readReceiptsJsonl(text: string): { receipts: EventReceipt[]; errors: string[] } {
  const receipts: EventReceipt[] = [];
  const errors: string[] = [];
  for (const [idx, line] of text.split(/\r?\n/).entries()) {
    if (line.trim() === '') continue;
    try {
      receipts.push(JSON.parse(line) as EventReceipt);
    } catch {
      errors.push(`收据库第 ${idx + 1} 行不是合法 JSON，已跳过（pm/receipts.jsonl）`);
    }
  }
  return { receipts, errors };
}
