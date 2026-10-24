/**
 * `pm handoff`（别名 `revive`）——生成六段结构交接包（T-M1-07 / W-S2-7）。
 *
 * 分层约定：本层为「壳」，允许 IO（文件系统/终端）；段组装、预算校验、token 估算
 * 全部下沉 core（handoffCompose），本层只做 M1 简化装配与输出。
 *
 * M1 简化装配（尽力而为，缺失文件不编造——R-08 未知如实展示）：
 *  - scope      = pm/README.md 原文 + pm/wbs.md 任务标题列表（认得出才列）；
 *  - rules      = pm/gates.md 原文；
 *  - decisions  = pm/changelog.md 最近 N=5 笔事件的元数据摘要（M1 不提取块外人类说明）；
 *  - evidence   = 最近 5 笔中证据相关（evidence.submitted / check.completed）的摘要；
 *  - failed-paths / acceptance = 留空段，正文标注「（待补充——AI 会话或主理人填写）」；
 *  - version    = changelog 事件日志投影（projectEventLog + foldStage）；M1 阶段收据
 *    链路未接入 CLI（锚点路径待存储层定稿），以空收据集投影——未经验证的事件一律
 *    external-unverified、不驱动状态（P-09），版本如实显示，绝不虚报代数；
 *  - generatedAt 由本层时钟注入（new Date().toISOString()，壳层允许）；
 *  - 软预算默认 8000 token（B-8：超限中文提示后退出码 2，不静默裁剪）。
 *
 * 本版仅输出到 stdout（readOnly: false 是为未来 --write 落盘预留，当前零写入）。
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  composeHandoff,
  HANDOFF_SECTION_TITLES,
  type HandoffSection,
} from '../../core/handoffCompose.js';
import { parseEventBlocks } from '../../core/eventEnvelope.js';
import { projectEventLog } from '../../core/eventLog.js';
import { foldStage, type FoldEvent } from '../../core/stageFold.js';
import { EMPTY_DERIVED_VERSION, type DerivedVersion } from '../../core/derivedVersion.js';
import { parseFencedTaskBlocks } from '../../core/wbsSyntax.js';
import type { CliIo } from '../index.js';

/** changelog 事件摘要取样数（M1 固定 5；未来可参数化） */
const RECENT_EVENTS = 5;

/** 软预算默认值（token 粗估口径见 core estimateHandoffTokens） */
const DEFAULT_SOFT_BUDGET_TOKENS = 8000;

/** 待填充占位文案（failed-paths / acceptance 留空段的标准标注） */
const TODO_PLACEHOLDER = '（待补充——AI 会话或主理人填写）';

/** 尽力读取文本文件；不存在/读取失败返回 null（不抛出、不编造） */
function readTextOrNull(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 事件日志投影 → 派生源版本。
 * M1 阶段收据链路未接入 CLI：以空收据集投影，全部事件 external-unverified，
 * 不驱动折叠（P-09）——版本如实回落空投影，不虚报 as_of/源版本。
 */
function projectVersion(changelogMd: string | null): DerivedVersion {
  if (changelogMd === null) return EMPTY_DERIVED_VERSION;
  const parsed = parseEventBlocks(changelogMd);
  const log = projectEventLog(changelogMd, [], null);
  const envelopeById = new Map(parsed.envelopes.map((e) => [e.event_id, e]));
  const folds: FoldEvent[] = [];
  for (const entry of log.entries) {
    if (entry.eventId === null || entry.malformed) continue;
    const envelope = envelopeById.get(entry.eventId);
    if (envelope === undefined) continue;
    folds.push({
      envelope,
      effectiveIntegrity:
        entry.effectiveIntegrity === 'verified'
          ? 'verified'
          : entry.effectiveIntegrity === 'invalid'
            ? 'invalid'
            : 'unregistered',
      ...(entry.seq !== undefined ? { seq: entry.seq } : {}),
    });
  }
  const projection = foldStage(folds, { chainIssues: log.chainIssues });
  return { asOf: projection.asOf, sourceVersion: projection.sourceVersion };
}

/** 事件元数据摘要行（M1 简化：以信封元数据代替块外人类说明，块外自由文本未提取） */
function eventSummaryLine(env: {
  occurred_at: string;
  kind: string;
  event_id: string;
  origin: string;
}): string {
  return `- ${env.occurred_at} \`${env.kind}\` ${env.event_id.slice(0, 8)}…（${env.origin}）`;
}

/** 装配六段（尽力而为；缺失文件对应段标注待补充，不编造内容） */
function assembleSections(pmDir: string): { sections: HandoffSection[]; changelogMd: string | null } {
  const read = (name: string): string | null => readTextOrNull(path.join(pmDir, name));

  // scope：README 原文 + wbs.md 任务标题列表（wbs.md 格式未定稿前只认 title 字段，认不出不硬凑）
  let scope = read('README.md') ?? TODO_PLACEHOLDER;
  const wbsMd = read('wbs.md');
  if (wbsMd !== null) {
    const titles = parseFencedTaskBlocks(wbsMd, 'gatedeck-task')
      .nodes.map((n) => n.fields.find((f) => f.key === 'title')?.value)
      .filter((t): t is string => t !== undefined && t.length > 0);
    if (titles.length > 0) {
      scope += `\n\n### 任务标题列表\n\n${titles.map((t) => `- ${t}`).join('\n')}`;
    }
  }

  // rules：gates.md 原文
  const rules = read('gates.md') ?? TODO_PLACEHOLDER;

  // decisions / evidence：changelog 最近 N=5 笔事件元数据摘要（M1 简化装配）
  const changelogMd = read('changelog.md');
  const recent =
    changelogMd === null
      ? []
      : parseEventBlocks(changelogMd).envelopes.slice(-RECENT_EVENTS);
  const decisions =
    recent.length > 0 ? recent.map(eventSummaryLine).join('\n') : TODO_PLACEHOLDER;
  const evidenceRelated = recent.filter(
    (e) => e.kind === 'evidence.submitted' || e.kind === 'check.completed',
  );
  const evidence =
    evidenceRelated.length > 0 ? evidenceRelated.map(eventSummaryLine).join('\n') : TODO_PLACEHOLDER;

  const sections: HandoffSection[] = [
    { key: 'scope', title: HANDOFF_SECTION_TITLES.scope, body: scope },
    { key: 'rules', title: HANDOFF_SECTION_TITLES.rules, body: rules },
    { key: 'decisions', title: HANDOFF_SECTION_TITLES.decisions, body: decisions },
    { key: 'evidence', title: HANDOFF_SECTION_TITLES.evidence, body: evidence },
    { key: 'failed-paths', title: HANDOFF_SECTION_TITLES['failed-paths'], body: TODO_PLACEHOLDER },
    { key: 'acceptance', title: HANDOFF_SECTION_TITLES.acceptance, body: TODO_PLACEHOLDER },
  ];
  return { sections, changelogMd };
}

/**
 * 执行 `handoff`（`revive` 同一实现）：stdout 输出交接包，成功退出码 0；
 * 无 pm/ 目录 / 组装拒绝（含软预算超限）打印中文提示后退出码 2。
 */
export function runHandoff(cwd: string, io: CliIo): number {
  const pmDir = path.join(cwd, 'pm');
  if (!existsSync(pmDir)) {
    io.err(`未找到 pm/ 受管目录（${pmDir}）：先运行 gatedeck init 初始化契约文件骨架。`);
    return 2;
  }

  const { sections, changelogMd } = assembleSections(pmDir);
  const result = composeHandoff({
    project: path.basename(cwd),
    sections,
    version: projectVersion(changelogMd),
    generatedAt: new Date().toISOString(), // 壳层允许取系统时钟；core 侧只做带时区校验
    softBudgetTokens: DEFAULT_SOFT_BUDGET_TOKENS,
  });

  if (!result.ok) {
    if (result.code === 'budget-exceeded') {
      io.err(`交接包软预算超限：${result.message}`); // message 自带 B-8 口径与两个数值
    } else {
      io.err(`交接包组装失败（${result.code}）：${result.message}`);
    }
    return 2;
  }

  io.out(result.markdown);
  return 0;
}
