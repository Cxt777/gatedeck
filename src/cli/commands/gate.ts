/**
 * gatedeck gate check —— 检查事实查询与失效判定（T-M1-04 / W-S2-4 CLI 装配）。
 *
 * 版本口径（2026-10-25 裁定）：本版**不执行任何门禁命令**（R-07：命令
 * 信任绑定机制（D-26）未建，执行能力后补，诚实边界）；本命令为只读查询：
 * 读 changelog 事件流中的检查凭证（check.completed，收据验真后仅喂 verified
 * 事件——P-09）→ checkFacts 投影每 (门禁,规则) 最近检查事实 → manifest 指纹
 * 比对做失效判定（B-3：对象或规则变化 → 待复验）。与 MCP check_gate 同口径。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { formatVersion } from '../../core/derivedVersion.js';
import { parseEventBlocks, type EventEnvelope } from '../../core/eventEnvelope.js';
import {
  verifyEventChain,
  type EventReceipt,
  type EventVerdict,
  type ReceiptAnchor,
} from '../../core/eventReceipt.js';
import {
  assessStaleness,
  CHECK_EVIDENCE_NOTICE,
  projectLatestCheckFacts,
  type CheckEventInput,
  type CheckFact,
  type CheckStatus,
} from '../../core/checkFacts.js';
import { computeManifestFingerprint, type ManifestEntry } from '../../core/manifestFingerprint.js';
import { contentVersion } from '../../core/optimisticWrite.js';
import type { CliIo } from '../index.js';

/** 检查状态中文显示（显示层中文，机器权威层以英文为准） */
const STATUS_LABELS: Record<CheckStatus, string> = {
  'not-checked': '未检查',
  passed: '通过',
  failed: '失败',
  error: '错误',
  stale: '待复验',
};

/** gate check 参数解析结果（ok=false 时 message 为面向用户的用法说明） */
export type ParsedGateCheckArgs =
  | { ok: true; /** --gate 过滤值（trim 后）；未提供为 null */
      gateId: string | null }
  | { ok: false; message: string };

const GATE_USAGE = '用法：gatedeck gate check [--gate <门禁id>]';

/**
 * gate check 参数解析（可测纯函数）：首个参数须为子命令 check；其后仅接受
 * `--gate <id>` / `--gate=<id>`（至多一次、值 trim 后非空）；其余一律拒绝
 * （不猜测未知参数意图，W-06/P-08）。
 */
export function parseGateCheckArgs(argv: readonly string[]): ParsedGateCheckArgs {
  if (argv[0] !== 'check') {
    return {
      ok: false,
      message: `${GATE_USAGE}\n首个参数须为子命令 check（收到：${argv[0] ?? '（空）'}）。`,
    };
  }
  let gateId: string | null = null;
  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i]!;
    if (tok === '--gate' || tok.startsWith('--gate=')) {
      const raw = tok === '--gate' ? rest[i + 1] : tok.slice('--gate='.length);
      if (raw === undefined || raw.trim() === '') {
        return { ok: false, message: `${GATE_USAGE}\n--gate 需要非空的门禁 id 值（如：--gate G-M1）。` };
      }
      if (gateId !== null) {
        return { ok: false, message: `${GATE_USAGE}\n--gate 只能出现一次（重复过滤不猜测意图，P-08）。` };
      }
      gateId = raw.trim();
      if (tok === '--gate') i++; // 消费值参数
      continue;
    }
    return { ok: false, message: `${GATE_USAGE}\n无法识别的参数：${tok}。` };
  }
  return { ok: true, gateId };
}

/** 非空字符串提取（payload 宽接口映射用；空白按缺失，P-08 不猜）——与 mcp gates.ts 同口径 */
function asNonEmpty(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/**
 * 事件信封 → CheckEventInput 映射（可测纯函数）。
 *
 * gateId/ruleId 兼容驼峰与下划线两种 payload 键名：core checkFacts.parsePair 只读
 * payload['gateId']，而 core 权威事件与 MCP 通道均用下划线命名（gate_id/rule_id），
 * 装配层归一后放顶层便捷字段（口径与 mcp/tools/gates.ts 的 toCheckEventInput 一致），
 * 否则下划线键事件会被 parsePair 判「无法定位检查对象」整笔丢弃、检查事实恒空。
 * payload 原样透传（outcome/exitCode/durationMs/summary/subjectManifestHash 由
 * checkFacts 自行读取）；gateId/ruleId 双缺时返回不含便捷字段的输入（core 侧裁定）。
 */
export function toCheckEventInput(envelope: EventEnvelope): CheckEventInput {
  const p = envelope.payload;
  const gateId = asNonEmpty(p['gateId']) ?? asNonEmpty(p['gate_id']);
  const ruleId = asNonEmpty(p['ruleId']) ?? asNonEmpty(p['rule_id']);
  return {
    kind: envelope.kind,
    payload: envelope.payload,
    recordedAt: envelope.recorded_at,
    ...(gateId !== null ? { gateId } : {}),
    ...(ruleId !== null ? { ruleId } : {}),
  };
}

/**
 * 收据验真后收集参与投影的检查事件（可测纯函数）。
 *
 * 替换旧「kind|recorded_at|operation_id 拼键识别 verified」口径——该拼键在同 kind
 * 同 recorded_at 且无 operation_id 的事件间碰撞，会把未验真事件误当验真喂入（P-09
 * 破防）。现按 verifyEventChain 契约改为 perEvent 与 envelopes **同序按位配对**
 * （eventReceipt.ts「与输入 envelopes 同序，逐块裁定」），天然防碰撞。
 * 只取 verified（P-09），并按收据链 seq 升序重排后喂入（B-16：checkFacts 按输入
 * 顺序折叠、「最近」=链序最后一笔，装配方负责按收据链序喂入——checkFacts JSDoc）；
 * 未验真事件笔数如实返回（W-06 不静默）。
 */
export function collectVerifiedCheckEvents(
  envelopes: readonly EventEnvelope[],
  verdicts: readonly EventVerdict[],
): { events: CheckEventInput[]; unverifiedCount: number } {
  const verified: Array<{ env: EventEnvelope; seq: number }> = [];
  for (const [i, verdict] of verdicts.entries()) {
    const env = envelopes[i];
    if (env === undefined) continue; // 防御：perEvent 与输入同序，越界裁定不消费（不猜）
    if (verdict.verdict === 'verified') {
      verified.push({ env, seq: verdict.seq ?? 0 }); // verified 事件必有 seq（eventReceipt 契约）；缺省 0 仅兜底排序
    }
  }
  verified.sort((a, b) => a.seq - b.seq); // B-16：按收据链序喂入（不按文档序、不按 occurred_at）
  return {
    events: verified.map((v) => toCheckEventInput(v.env)),
    unverifiedCount: envelopes.length - verified.length,
  };
}

/**
 * --gate 门禁过滤（可测纯函数）：gateId 为 null/空 → 全量事实；否则只保留该门禁
 * 的检查事实（保持 facts Map 迭代序 = 插入序，确定）。
 */
export function filterByGate(
  facts: ReadonlyMap<string, CheckFact>,
  gateId: string | null,
): CheckFact[] {
  const all = [...facts.values()];
  if (gateId === null || gateId === '') return all;
  return all.filter((f) => f.gateId === gateId);
}

/** 检查事实表行（渲染层形状：门禁/规则/状态中文/检查时间/摘要） */
export interface GateCheckRow {
  gateId: string;
  ruleId: string;
  status: CheckStatus;
  statusZh: string;
  checkedAt: string | null;
  /** D-26 证据摘要；无则为 null → 渲染「—」（不编造） */
  summary: string | null;
}

/** CheckFact 列表 → 渲染行（纯函数；状态中文统一走 STATUS_LABELS 词表，不另立口径） */
export function toRows(facts: readonly CheckFact[]): GateCheckRow[] {
  return facts.map((f) => ({
    gateId: f.gateId,
    ruleId: f.ruleId,
    status: f.status,
    statusZh: STATUS_LABELS[f.status],
    checkedAt: f.checkedAt,
    summary: f.summary ?? null,
  }));
}

/** gate check 渲染视图（装配产出、渲染消费的纯数据） */
export interface GateCheckView {
  cwd: string;
  /** --gate 过滤值；未过滤为 null */
  gateId: string | null;
  rows: GateCheckRow[];
  /** 当前 canonical manifest 指纹（重算值，B-3 比对基准）；无纳入条目为占位说明 */
  manifestHash: string;
  /** 纳入指纹的条目数 */
  manifestEntryCount: number;
  /** manifest 采集跳过的缺失文件（pm/ 相对路径），如实展示 */
  missingManifestFiles: string[];
  /** 本投影事件基准的 as_of：验真事件按链序最后一笔的 recorded_at；无验真事件为 null */
  asOf: string | null;
  /** 本投影事件基准的源版本：验真事件笔数 */
  sourceVersion: number;
  /** 数据说明（缺失/未验真/坏档等如实提示，W-06） */
  notes: string[];
}

/**
 * gate check 渲染（可测纯函数）：检查事实表（门禁/规则/状态中文/检查时间/摘要）+
 * 状态合计 + 数据说明 + 尾部 manifest 指纹与 as_of 行 + R-07/D-26 诚实声明与
 * CHECK_EVIDENCE_NOTICE（措辞复用 core 常量，各端不漂移）。
 */
export function renderGateCheck(view: GateCheckView): string[] {
  const lines: string[] = [];
  lines.push('gatedeck gate check —— 检查事实查询与失效判定（只读查询；本版不执行门禁命令）');
  lines.push(`目录：${view.cwd}`);
  if (view.gateId !== null) lines.push(`过滤：仅门禁 ${view.gateId}`);
  lines.push('');
  lines.push(`检查事实（${view.rows.length} 条，状态词表：未检查/通过/失败/错误/待复验）：`);
  if (view.rows.length === 0) {
    lines.push('  （无检查事实记录——全部未检查）');
  }
  for (const r of view.rows) {
    lines.push(
      `  [${r.gateId} / ${r.ruleId}] ${r.statusZh}${r.checkedAt !== null ? `（${r.checkedAt}）` : ''}` +
        (r.summary !== null ? ` —— ${r.summary}` : ''),
    );
  }
  const count = (s: CheckStatus): number => view.rows.filter((r) => r.status === s).length;
  lines.push('');
  lines.push(
    `合计：通过 ${count('passed')} ｜ 失败 ${count('failed')} ｜ 错误 ${count('error')} ｜ ` +
      `待复验 ${count('stale')} ｜ 未检查 ${count('not-checked')}`,
  );
  if (view.notes.length > 0) {
    lines.push('');
    lines.push('数据说明（如实提示，不阻塞只读查询）：');
    for (const n of view.notes) lines.push(`  · ${n}`);
  }
  lines.push('');
  lines.push('────');
  lines.push(`manifest 指纹：${view.manifestHash}（pm/ 四契约文件；changelog 排除，纳入 ${view.manifestEntryCount} 条）`);
  lines.push(formatVersion({ asOf: view.asOf, sourceVersion: view.sourceVersion }));
  lines.push('  as_of/源版本口径：事件基准 = 收据链验真（verified）事件，按链序取最后一笔');
  lines.push('  recorded_at 为 as_of、验真笔数为源版本（B-16）');
  lines.push('本版不执行命令——检查事实来自事件流凭证（R-07）；命令执行能力随信任机制（D-26）后补。');
  lines.push(`说明：${CHECK_EVIDENCE_NOTICE}`);
  return lines;
}

/** 计算当前 canonical manifest 指纹（pm/ 四契约文件；changelog 排除——B-3 口径） */
export function currentManifest(pmDir: string): {
  manifestHash: string | null;
  entries: ManifestEntry[];
  /** 采集时跳过的缺失契约文件（pm/ 相对路径），如实返回不静默（W-06） */
  missing: string[];
} {
  const files: Array<{ name: string; role: ManifestEntry['role'] }> = [
    { name: 'project.md', role: 'checked-file' },
    { name: 'wbs.md', role: 'checked-file' },
    { name: 'gates.md', role: 'rule-file' },
    { name: 'insights.md', role: 'checked-file' },
  ];
  const entries: ManifestEntry[] = [];
  const missing: string[] = [];
  for (const f of files) {
    const p = join(pmDir, f.name);
    if (!existsSync(p)) {
      missing.push(`pm/${f.name}`);
      continue;
    }
    entries.push({ path: `pm/${f.name}`, role: f.role, contentHash: contentVersion(readFileSync(p, 'utf8')).contentHash });
  }
  if (entries.length === 0) return { manifestHash: null, entries, missing };
  const result = computeManifestFingerprint({ entries });
  if (!result.ok) return { manifestHash: null, entries, missing };
  return { manifestHash: result.manifestHash, entries, missing };
}

/** 未初始化引导（同 deck 模式）：不假装能查到检查事实，明示下一步（W-06） */
function renderInitGuide(io: CliIo): void {
  io.out('尚未初始化：先运行 gatedeck init（在当前目录生成 pm/ 契约文件骨架）。');
  io.out('');
  io.out('门禁检查事实查询（gate check）两问——初始化后运行 gatedeck gate check 查看：');
  io.out('  ◆ 检查事实 —— 每（门禁, 规则）最近一笔验真检查事件的状态（未检查/通过/失败/错误/待复验）');
  io.out('  ◆ 失效判定 —— 对象或规则变化（manifest 指纹与凭证锚不符）→ 待复验（B-3）');
  io.out('（本版不执行任何命令（R-07）：只读查询事实，查询语义 exit 0。）');
}

/** gate check 用法（--help 与参数错误共用同一段口径） */
function renderUsage(io: CliIo): void {
  io.out(GATE_USAGE);
  io.out('  门禁检查事实查询与失效判定——读 changelog 既有验真检查事件投影事实（P-09），');
  io.out('  并按当前 canonical manifest 指纹改判「待复验」（B-3）；本版不执行任何命令（R-07）。');
  io.out('  落地任务：T-M1-04（纯只读命令，实现后也不写文件）');
  io.out('  选项：--gate <门禁id>  只看指定门禁的检查事实（查询语义，exit 0）');
}

export function runGateCheck(argv: readonly string[], io: CliIo): number {
  // --help 常规：位于任何位置均显示用法（gatedeck gate --help 由 index.ts 壳层拦截）
  if (argv.includes('--help') || argv.includes('-h')) {
    renderUsage(io);
    return 0;
  }
  // 路由契约（index.ts）：gate 子树缺省即 check
  const args = argv.length === 0 ? ['check'] : argv;
  const parsed = parseGateCheckArgs(args);
  if (!parsed.ok) {
    io.err(parsed.message);
    return 2;
  }

  const rootDir = process.cwd();
  const pmDir = join(rootDir, 'pm');
  if (!existsSync(pmDir) || !statSync(pmDir).isDirectory()) {
    renderInitGuide(io);
    return 2; // 未初始化不是成功态（W-06），同 deck 模式
  }

  const notes: string[] = [];
  const changelogPath = join(pmDir, 'changelog.md');
  let envelopes: EventEnvelope[] = [];
  let malformedCount = 0;
  if (existsSync(changelogPath)) {
    const parsedEvents = parseEventBlocks(readFileSync(changelogPath, 'utf8'));
    envelopes = parsedEvents.envelopes;
    malformedCount = parsedEvents.blocks.nodes.length - parsedEvents.envelopes.length;
  } else {
    notes.push('pm/changelog.md 缺失：无检查记录，事件流检查事实为空。');
  }

  // 收据验真（P-09）：仅 verified 事件参与检查事实投影；收据库/锚点缺失与坏档如实注记
  const receipts: EventReceipt[] = [];
  let badReceiptLines = 0;
  const receiptsPath = join(pmDir, 'receipts.jsonl');
  if (existsSync(receiptsPath)) {
    for (const line of readFileSync(receiptsPath, 'utf8').split(/\r?\n/)) {
      if (line.trim() === '') continue;
      try {
        receipts.push(JSON.parse(line) as EventReceipt);
      } catch {
        badReceiptLines++;
      }
    }
  } else {
    notes.push('收据库未找到（pm/receipts.jsonl）：事件暂无来源验证，检查事实将全部为「未检查」。');
  }
  const anchorPath = join(pmDir, 'receipts.anchor.json');
  let anchor: ReceiptAnchor | null = null;
  if (existsSync(anchorPath)) {
    try {
      anchor = JSON.parse(readFileSync(anchorPath, 'utf8')) as ReceiptAnchor;
    } catch {
      anchor = null;
      notes.push('锚点文件解析失败（pm/receipts.anchor.json）：按无锚点处理（来源未知，不静默重算）。');
    }
  }
  if (badReceiptLines > 0) {
    notes.push(`收据库存在 ${badReceiptLines} 个坏行（pm/receipts.jsonl），已跳过（W-06 不静默）。`);
  }

  let events: CheckEventInput[] = [];
  let unverifiedCount = 0;
  let chainIssueCount = 0;
  if (envelopes.length > 0) {
    const verification = verifyEventChain(envelopes, receipts, anchor);
    chainIssueCount = verification.issues.length;
    const collected = collectVerifiedCheckEvents(envelopes, verification.perEvent);
    events = collected.events;
    unverifiedCount = collected.unverifiedCount;
  }
  if (unverifiedCount > 0) {
    notes.push(`changelog 中 ${unverifiedCount} 笔事件未通过收据链验真：不参与检查事实推导（P-09）。`);
  }
  if (malformedCount > 0) {
    notes.push(`changelog 中 ${malformedCount} 个事件块无法解析为合法信封（按 external-unverified 处理，不参与推导）。`);
  }
  if (chainIssueCount > 0) {
    notes.push(`收据链验证存在 ${chainIssueCount} 处问题（如锚点缺失/内容不符）：受影响事件不参与推导，明细见 gatedeck deck 需处理区。`);
  }
  notes.push('gates.md 门禁定义解析器尚未落地：检查事实仅覆盖事件流中被引用过的（门禁, 规则）组合，不展开门禁条件明细。');

  // 投影 + 失效判定（B-3：manifest 指纹变化 → 待复验）+ 门禁过滤
  const facts = projectLatestCheckFacts(events);
  const manifest = currentManifest(pmDir);
  if (manifest.missing.length > 0) {
    notes.push(`manifest 采集跳过缺失文件：${manifest.missing.join('、')}（不编造条目，W-06）。`);
  }
  const judged =
    manifest.manifestHash !== null
      ? assessStaleness(facts, manifest.manifestHash)
      : { facts, staleKeys: [] as string[] };
  if (manifest.manifestHash === null) {
    // 无指纹可比（契约文件全缺失/指纹不可算）：失效比对无从做起，如实说明而非假装已判（P-08/W-06）
    notes.push('manifest 无纳入条目：无法做失效比对（B-3），本版不猜测改判。');
  }
  const rows = toRows(filterByGate(judged.facts, parsed.gateId));

  // as_of / 源版本：本投影事件基准（验真事件按链序）最后一笔的 recorded_at / 笔数
  const asOf = events.length > 0 ? (events[events.length - 1]!.recordedAt || null) : null;
  const view: GateCheckView = {
    cwd: rootDir,
    gateId: parsed.gateId,
    rows,
    manifestHash: manifest.manifestHash ?? '（无受管文件）',
    manifestEntryCount: manifest.entries.length,
    missingManifestFiles: manifest.missing,
    asOf,
    sourceVersion: events.length,
    notes,
  };
  for (const line of renderGateCheck(view)) io.out(line);
  return 0; // 查询语义：检查结果好坏不影响退出码（如实展示即职责完成）
}
