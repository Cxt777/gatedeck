/**
 * 校验内核：每事实唯一权威位置 + 冲突显示（T-M0b-05；基准 3.1 / 3.3 / D-24 / P-01 / P-08）。
 *
 * 规则：
 *  - 每种事实只有一个权威位置，可推导状态不重复落盘（基准 3.1 表）；
 *  - **当前阶段不落 project.md**（D-24）：阶段由 promotion 事件折叠派生，任何落盘即冲突；
 *  - **任务时间语义不落任务文件**（基准 3.3）：updated_at / last_seen_at / last_progress_at
 *    由 changelog/insights 事件派生，写入 wbs.md 即冲突；
 *  - 发现重复存储/推导冲突时，**以权威位置为准显示差异并告警，不静默合并**（基准 3.1）。
 *
 * 本模块只产出诊断，不修复、不改写用户文件（P-04）。纯字符串计算，无 IO。
 */

import type { WbsNode, WbsParseResult } from './wbsSyntax.js';

/** 事实类别（基准 3.1 表逐条对应） */
export type FactKey =
  | 'project-meta'
  | 'task-content'
  | 'gate-definition'
  | 'check-records'
  | 'current-stage'
  | 'task-time'
  | 'usage-records'
  | 'registry';

export interface FactAuthority {
  fact: FactKey;
  /** 权威位置；派生态为口径描述而非路径 */
  location: string;
  kind: 'file' | 'derived' | 'config';
  note: string;
}

/** 事实权威表（基准 3.1；数字/措辞变更须同步基准） */
export const FACT_AUTHORITY: Readonly<Record<FactKey, FactAuthority>> = {
  'project-meta': {
    fact: 'project-meta',
    location: 'pm/project.md',
    kind: 'file',
    note: '项目元信息唯一权威',
  },
  'task-content': {
    fact: 'task-content',
    location: 'pm/wbs.md',
    kind: 'file',
    note: '任务内容与状态唯一权威',
  },
  'gate-definition': {
    fact: 'gate-definition',
    location: 'pm/gates.md',
    kind: 'file',
    note: '门禁定义唯一权威',
  },
  'check-records': {
    fact: 'check-records',
    location: 'pm/changelog.md',
    kind: 'file',
    note: '检查/授权/破例/阶段推进记录的唯一权威（append-only 事件）',
  },
  'current-stage': {
    fact: 'current-stage',
    location: '派生：promotion 事件折叠（D-24）',
    kind: 'derived',
    note: '当前阶段不落 project.md，由事件折叠派生',
  },
  'task-time': {
    fact: 'task-time',
    location: '派生：changelog/insights 事件（基准 3.3）',
    kind: 'derived',
    note: 'updated_at / last_seen_at / last_progress_at 不存于任务文件',
  },
  'usage-records': {
    fact: 'usage-records',
    location: 'pm/insights.md',
    kind: 'file',
    note: '用量与活动原始记录唯一权威（append-only 事件）',
  },
  registry: {
    fact: 'registry',
    location: '<工作区根>/.gatedeck/registry.md',
    kind: 'config',
    note: '注册表为配置而非缓存；projects-index 工作区只读投影根 PROJECTS-INDEX.md（D-30）',
  },
};

/** 路径归一化：统一分隔符/去首尾空白/忽略大小写（Windows） */
export function normalizeLocation(location: string): string {
  return location.trim().replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

export interface FactClaim {
  fact: FactKey;
  /** 该值实际所在位置（路径或派生态描述） */
  location: string;
  value: string;
  /** 1-based 行号（可选，供诊断定位） */
  line?: number;
}

export type ClaimVerdict = 'authoritative' | 'non-authoritative' | 'derived-field-forbidden';

export interface ClaimClassification {
  verdict: ClaimVerdict;
  authority: FactAuthority;
  message: string;
}

/** 判定一条落盘声明是否位于该事实的权威位置 */
export function classifyClaim(claim: FactClaim): ClaimClassification {
  const authority = FACT_AUTHORITY[claim.fact];
  if (authority.kind === 'derived') {
    return {
      verdict: 'derived-field-forbidden',
      authority,
      message:
        `事实「${claim.fact}」的权威位置是${authority.location}；` +
        `在 ${claim.location} 落盘即重复存储（${authority.note}）`,
    };
  }
  if (normalizeLocation(claim.location) === normalizeLocation(authority.location)) {
    return { verdict: 'authoritative', authority, message: `位于权威位置 ${authority.location}` };
  }
  return {
    verdict: 'non-authoritative',
    authority,
    message:
      `事实「${claim.fact}」的权威位置是 ${authority.location}，` +
      `而该值出现在 ${claim.location}（重复存储）`,
  };
}

export type FactConflictCode = 'derived-fact-stored' | 'duplicate-storage' | 'conflicting-values';

export interface FactConflict {
  code: FactConflictCode;
  fact: FactKey;
  /** 权威位置（路径或派生态口径） */
  authoritativeLocation: string;
  /** 权威位置上的值；纯派生态且无落盘值时为 null */
  authoritativeValue: string | null;
  conflictingLocation: string;
  conflictingValue: string;
  line: number | null;
  /** 以权威位置为准的差异展示（不合并） */
  display: string;
  /** 面向用户的告警文本 */
  message: string;
}

function buildConflict(args: {
  code: FactConflictCode;
  fact: FactKey;
  authoritativeLocation: string;
  authoritativeValue: string | null;
  claim: FactClaim;
  reason: string;
}): FactConflict {
  const authorityValue = args.authoritativeValue ?? '（无落盘值：派生态）';
  return {
    code: args.code,
    fact: args.fact,
    authoritativeLocation: args.authoritativeLocation,
    authoritativeValue: args.authoritativeValue,
    conflictingLocation: args.claim.location,
    conflictingValue: args.claim.value,
    line: args.claim.line ?? null,
    display: `权威位置 ${args.authoritativeLocation} = ${authorityValue} ≠ ${args.claim.location} = ${args.claim.value}`,
    message:
      `${args.reason}。以权威位置为准显示差异并告警，不静默合并（基准 3.1 冲突显示规则）。`,
  };
}

/**
 * 重复存储检测：同一事实的多处落盘声明中，非权威位置一律告警；
 * 派生态事实（当前阶段/任务时间语义）任何落盘均告警。
 */
export function detectDuplicateStorage(claims: readonly FactClaim[]): FactConflict[] {
  const conflicts: FactConflict[] = [];
  const byFact = new Map<FactKey, FactClaim[]>();
  for (const claim of claims) {
    const list = byFact.get(claim.fact) ?? [];
    list.push(claim);
    byFact.set(claim.fact, list);
  }

  for (const [fact, list] of byFact) {
    const authority = FACT_AUTHORITY[fact];
    const authoritativeClaims = list.filter(
      (c) => normalizeLocation(c.location) === normalizeLocation(authority.location),
    );
    const authoritativeValue = authoritativeClaims[0]?.value ?? null;

    for (const claim of list) {
      const classification = classifyClaim(claim);
      if (classification.verdict === 'derived-field-forbidden') {
        conflicts.push(
          buildConflict({
            code: 'derived-fact-stored',
            fact,
            authoritativeLocation: authority.location,
            authoritativeValue: null,
            claim,
            reason: `可推导事实被落盘（${authority.note}）`,
          }),
        );
      } else if (classification.verdict === 'non-authoritative') {
        conflicts.push(
          buildConflict({
            code: 'duplicate-storage',
            fact,
            authoritativeLocation: authority.location,
            authoritativeValue,
            claim,
            reason: `事实「${fact}」在非权威位置重复存储`,
          }),
        );
      }
    }

    // 权威位置自身出现取值不一致的多笔声明（同文件重复键/多来源合并）
    const first = authoritativeClaims[0];
    if (first !== undefined && authority.kind !== 'derived') {
      for (const duplicate of authoritativeClaims.slice(1)) {
        if (duplicate.value.trim() !== first.value.trim()) {
          conflicts.push({
            code: 'conflicting-values',
            fact,
            authoritativeLocation: authority.location,
            authoritativeValue: first.value,
            conflictingLocation: duplicate.location,
            conflictingValue: duplicate.value,
            line: duplicate.line ?? null,
            display: `权威位置 ${authority.location} 内取值不一致：${first.value} ≠ ${duplicate.value}`,
            message: `${authority.location} 内同一事实出现多个不同取值。以首笔（读取幂等，B-13 精神）为准展示差异并告警，不静默合并。`,
          });
        }
      }
    }
  }
  return conflicts;
}

/* ---------------------------------------------------------------- *
 * project.md：派生态字段落盘检测（D-24）
 * ---------------------------------------------------------------- */

/** 当前阶段的禁写字段名（归一化后比较：小写、去 -/_/空白） */
const PROJECT_FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  'stage',
  'currentstage',
  'currentphase',
  'phase',
  '阶段',
  '当前阶段',
]);

/** 行级 `key: value`（允许列表项前缀），键名支持中文（F-06） */
const KEY_VALUE_LINE = /^[ \t]*(?:[-*][ \t]+)?([\p{L}_][\p{L}\p{N}_-]*)[ \t]*:[ \t]?([^\r\n]*)$/u;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '');
}

/**
 * 审计 project.md：当前阶段等派生态字段不得落盘（D-24）。
 * 未知字段不误报——只有命中禁写名单才产冲突。
 */
export function auditProjectMarkdown(md: string, location = 'pm/project.md'): FactConflict[] {
  const conflicts: FactConflict[] = [];
  const lines = md.split(/\r?\n/);
  for (const [idx, line] of lines.entries()) {
    const m = KEY_VALUE_LINE.exec(line);
    if (m === null) continue;
    const key = m[1]!;
    if (!PROJECT_FORBIDDEN_KEYS.has(normalizeKey(key))) continue;
    conflicts.push(
      buildConflict({
        code: 'derived-fact-stored',
        fact: 'current-stage',
        authoritativeLocation: FACT_AUTHORITY['current-stage'].location,
        authoritativeValue: null,
        claim: { fact: 'current-stage', location, value: (m[2] ?? '').trim(), line: idx + 1 },
        reason: `project.md 出现阶段字段「${key}」——当前阶段不落 project.md（D-24）`,
      }),
    );
  }
  return conflicts;
}

/* ---------------------------------------------------------------- *
 * wbs.md：任务时间语义字段落盘检测（基准 3.3）
 * ---------------------------------------------------------------- */

/** 任务时间语义的禁写字段（归一化后比较） */
const TASK_TIME_FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  'updatedat',
  'lastseenat',
  'lastprogressat',
]);

function fieldLine(md: string, node: WbsNode, key: string): number {
  const startLine = md.slice(0, node.rawSpan.start).split('\n').length;
  const idx = node.raw.split('\n').findIndex((l) => l.trimStart().startsWith(`${key}:`) || l.trimStart().startsWith(`${key} :`));
  return idx === -1 ? startLine : startLine + idx;
}

/**
 * 审计任务块内的派生态时间字段：时间语义从 changelog/insights 事件派生，
 * 不存于任务文件（基准 3.3「时间信息优先从受管记录派生」）。
 */
export function auditWbsTimeFields(
  md: string,
  result: WbsParseResult,
  location = 'pm/wbs.md',
): FactConflict[] {
  const conflicts: FactConflict[] = [];
  for (const node of result.nodes) {
    const taskId = node.fields.find((f) => f.key === 'id')?.value ?? '（无 id）';
    for (const field of node.fields) {
      if (!TASK_TIME_FORBIDDEN_KEYS.has(normalizeKey(field.key))) continue;
      conflicts.push(
        buildConflict({
          code: 'derived-fact-stored',
          fact: 'task-time',
          authoritativeLocation: FACT_AUTHORITY['task-time'].location,
          authoritativeValue: null,
          claim: {
            fact: 'task-time',
            location,
            value: field.value.trim(),
            line: fieldLine(md, node, field.key),
          },
          reason: `任务 ${taskId} 出现时间字段「${field.key}」——任务时间语义从事件派生，不存于任务文件（基准 3.3）`,
        }),
      );
    }
  }
  return conflicts;
}

/* ---------------------------------------------------------------- *
 * 派生值与落盘值差异展示（不静默合并）
 * ---------------------------------------------------------------- */

/**
 * 比较权威派生值与落盘声明：不同即产出 `conflicting-values` 冲突，
 * 展示以权威位置（派生态）为准的差异；相同返回 null（无告警）。
 */
export function compareDerivedValue(
  fact: FactKey,
  derivedValue: string,
  stored: FactClaim,
): FactConflict | null {
  if (stored.value.trim() === derivedValue.trim()) return null;
  const authority = FACT_AUTHORITY[fact];
  return buildConflict({
    code: 'conflicting-values',
    fact,
    authoritativeLocation: authority.location,
    authoritativeValue: derivedValue,
    claim: stored,
    reason: `${stored.location} 的取值与权威派生值不一致（${authority.note}）`,
  });
}
