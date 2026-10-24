/**
 * B-4/B-17 白名单机器守卫（W-S3-1；入 CI 即本文件）。
 *
 * 红线（基准 R-09/B-4/B-17，冲刺计划 3.1 节）：
 *  - MCP 工具注册表**不得**包含 pass_gate（门禁开启是主理人人工动作，R-03）；
 *  - **不得**包含 append_changelog 或任何通用事件追加工具（事件只能由类型化动作产生，R-09）；
 *  - 注册名单 ⊆ tools/registry.ts 的 TOOL_ALLOWLIST（MOD-06 十五工具全集唯一事实源）。
 * server 装配侧另有启动自检（structural guard），本文件保证越界注册在 CI 即刻红。
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isUlid, parseEventBlocks } from '../core/eventEnvelope.js';
import { buildAnchor, buildReceiptChain, type EventReceipt } from '../core/eventReceipt.js';
import { contentVersion } from '../core/optimisticWrite.js';
import { EVENT_TOOL_NAMES, recordNote, reportUsage, submitEvidence } from './tools/events.js';
import { checkGate, GATE_TOOL_NAMES, requestPromotion } from './tools/gates.js';
import { assertAllowlist, FORBIDDEN_TOOL_NAMES, TOOL_ALLOWLIST } from './tools/registry.js';
import { resolveProjectContext } from './context.js';
import { WRITER_TOOL_NAMES } from './tools/writers.js';

/** 读 7 名单（W-S3-2 读部分；与 readers.READER_TOOL_NAMES 一致性一并守卫） */
const READ7 = [
  'list_projects',
  'get_overview',
  'get_wbs',
  'get_task',
  'list_gates',
  'query',
  'get_report',
] as const;

describe('assertAllowlist（B-4 守卫核心）', () => {
  it('名单自身全部合法：TOOL_ALLOWLIST 15 个工具名通过断言（唯一事实源自洽）', () => {
    const names = TOOL_ALLOWLIST.map((t) => t.name);
    expect(names).toHaveLength(15);
    expect(new Set(names).size).toBe(15); // name 唯一
    const check = assertAllowlist(names);
    expect(check.ok).toBe(true);
    expect(check.violations).toEqual([]);
  });

  it('含 pass_gate → 拒绝（门禁开启不由 MCP 提供，R-03）', () => {
    const check = assertAllowlist(['get_overview', 'pass_gate']);
    expect(check.ok).toBe(false);
    expect(check.violations.some((v) => v.includes('pass_gate'))).toBe(true);
  });

  it('含 append_changelog → 拒绝（通用事件追加工具不得出现，R-09）', () => {
    const check = assertAllowlist(['record_note', 'append_changelog']);
    expect(check.ok).toBe(false);
    expect(check.violations.some((v) => v.includes('append_changelog'))).toBe(true);
  });

  it('未知工具 → 拒绝（注册名单 ⊆ TOOL_ALLOWLIST）', () => {
    const check = assertAllowlist(['get_overview', 'delete_everything']);
    expect(check.ok).toBe(false);
    expect(check.violations.some((v) => v.includes('delete_everything'))).toBe(true);
  });

  it('空名单 → 通过（无注册即无违规）', () => {
    expect(assertAllowlist([])).toEqual({ ok: true, violations: [] });
  });

  it('禁名即使被混入 TOOL_ALLOWLIST 也照样拒绝（守卫不依赖名单内容）', () => {
    expect(FORBIDDEN_TOOL_NAMES).toContain('pass_gate');
    expect(FORBIDDEN_TOOL_NAMES).toContain('append_changelog');
    // 直接对禁名断言：FORBIDDEN 检查先于名单 ⊆ 检查
    const check = assertAllowlist(FORBIDDEN_TOOL_NAMES);
    expect(check.ok).toBe(false);
  });
});

describe('MOD-06 十五工具全集名单结构（T-M1-08）', () => {
  const names = TOOL_ALLOWLIST.map((t) => t.name);

  it('读 7 全部在名单（W-S3-2 读部分）', () => {
    for (const name of READ7) expect(names).toContain(name);
  });

  it('红线点名的动作工具全部在名单且描述带语义承诺', () => {
    const required = [
      'update_task',
      'check_gate',
      'request_promotion',
      'record_note',
      'submit_evidence',
      'report_usage',
    ] as const;
    for (const name of required) expect(names).toContain(name);
    const byName = new Map(TOOL_ALLOWLIST.map((t) => [t.name, t.description]));
    // 描述即对外契约：语义承诺写入名单，后续阶段实现 handler 时不得弱化
    expect(byName.get('request_promotion')).toContain('authorization.requested');
    expect(byName.get('submit_evidence')).toContain('evidence.submitted');
    expect(byName.get('check_gate')).toContain('不是命令执行器');
    expect(byName.get('record_note')).toContain('非权威');
  });

  it('名单不含任何禁名（pass_gate / append_changelog）', () => {
    for (const forbidden of FORBIDDEN_TOOL_NAMES) {
      expect(names).not.toContain(forbidden);
    }
  });
});

/* ---------------------------------------------------------------- *
 * W-S3-2/W-S3-3：阶段二注册名单守卫（写 3 + 门禁 2 + 事件 3）
 * ---------------------------------------------------------------- */

describe('阶段二注册名单 ⊆ TOOL_ALLOWLIST（B-4/B-17 守卫①）', () => {
  const WRITE3 = ['create_task', 'update_task', 'move_task'] as const;

  it('写 3 全部在名单', () => {
    const names = TOOL_ALLOWLIST.map((t) => t.name);
    for (const name of WRITE3) expect(names).toContain(name);
    expect([...WRITER_TOOL_NAMES]).toEqual([...WRITE3]); // 模块导出名与名单一致
  });

  it('门禁 2 + 事件 3 全部在名单且模块导出名一致', () => {
    const names = TOOL_ALLOWLIST.map((t) => t.name);
    expect([...GATE_TOOL_NAMES].sort()).toEqual(['check_gate', 'request_promotion']);
    expect([...EVENT_TOOL_NAMES].sort()).toEqual(['record_note', 'report_usage', 'submit_evidence']);
    for (const name of [...GATE_TOOL_NAMES, ...EVENT_TOOL_NAMES]) expect(names).toContain(name);
  });

  it('全部注册名（读 7 + 写 3 + 门禁 2 + 事件 3）⊆ TOOL_ALLOWLIST 且恰为 15 不重名', () => {
    const all = [...READ7, ...WRITER_TOOL_NAMES, ...GATE_TOOL_NAMES, ...EVENT_TOOL_NAMES];
    expect(all).toHaveLength(15);
    expect(new Set(all).size).toBe(15);
    expect(assertAllowlist(all)).toEqual({ ok: true, violations: [] });
    expect(new Set(all)).toEqual(new Set(TOOL_ALLOWLIST.map((t) => t.name))); // 与名单全集一致
  });

  it('TOOL_ALLOWLIST 静态不含禁名（守卫②，独立于断言函数）', () => {
    const names = TOOL_ALLOWLIST.map((t) => t.name);
    expect(names).not.toContain('pass_gate');
    expect(names).not.toContain('append_changelog');
  });
});

/* ---------------------------------------------------------------- *
 * 源码文本守卫（B-4/B-17 机器守卫③④；注释与代码一并检查）
 * ---------------------------------------------------------------- */

describe('handler 源码文本守卫（B-4/B-17 机器守卫③④）', () => {
  const readSrc = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

  it('gates.ts 源码不含「authorization.granted」字面量（B-4：MCP 不代产授权终态）', () => {
    expect(readSrc('./tools/gates.ts')).not.toContain('authorization.granted');
  });

  it('gates.ts 源码不含「locally_confirmed」与「task.transitioned」字面量（D-22 通道分工）', () => {
    const src = readSrc('./tools/gates.ts');
    expect(src).not.toContain('locally_confirmed');
    expect(src).not.toContain('task.transitioned');
  });

  it('events.ts 源码不含「check.completed」字面量（B-17：MCP 不代裁定检查完成）', () => {
    expect(readSrc('./tools/events.ts')).not.toContain('check.completed');
  });

  it('events.ts 源码不含「task.transitioned」字面量（B-17：MCP 不代产状态迁移）', () => {
    expect(readSrc('./tools/events.ts')).not.toContain('task.transitioned');
  });

  it('writers.ts 不产事件块：源码不含事件围栏 info 字面量（写 3 不追加任何事件）', () => {
    expect(readSrc('./tools/writers.ts')).not.toContain('gatedeck-event');
  });

  it('守卫自证：gates.ts/events.ts 源码当前可读（读文件断言的前置自检）', () => {
    expect(readSrc('./tools/gates.ts').length).toBeGreaterThan(0);
    expect(readSrc('./tools/events.ts').length).toBeGreaterThan(0);
  });
});

/* ---------------------------------------------------------------- *
 * handler 单测（守卫⑤；直接调函数，不起 server）
 * ---------------------------------------------------------------- */

const NOW = '2026-10-24T08:00:00Z';
const ACTOR = { actor_id: 'actor-test', session_id: 'session-test' };

/** 合法 ULID 轮换表（event_id/operation_id 由注入 generator 产出） */
const ULIDS = [
  '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  '01ARZ3NDEKTSV4RRFFQ69G5FB0',
  '01ARZ3NDEKTSV4RRFFQ69G5FB1',
  '01ARZ3NDEKTSV4RRFFQ69G5FB2',
] as const;

function fixedDeps() {
  let i = 0;
  return {
    nowIso: () => NOW,
    newUlid: () => ULIDS[i++ % ULIDS.length]!,
  };
}

const WBS_MIN = ['# 工作分解', '', '```gatedeck-task', 'id: T-001', 'title: 示例任务', 'status: todo', 'deps:', '```', ''].join('\n');
const CHANGELOG_MIN = ['# 变更日志（changelog.md）', '', '<!-- append-only（R-02） -->', ''].join('\n');
const INSIGHTS_MIN = ['# 洞察与复盘（insights.md）', '', '<!-- append-only（R-02） -->', ''].join('\n');
const PROJECT_MIN = ['# 示例项目', '', '- slug: demo', '- 描述: 测试夹具', ''].join('\n');
const GATES_MIN = '# 门禁（gates.md）\n';

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gatedeck-mcp-'));
  mkdirSync(join(dir, 'pm'), { recursive: true });
  writeFileSync(join(dir, 'pm', 'wbs.md'), WBS_MIN);
  writeFileSync(join(dir, 'pm', 'changelog.md'), CHANGELOG_MIN);
  writeFileSync(join(dir, 'pm', 'insights.md'), INSIGHTS_MIN);
  writeFileSync(join(dir, 'pm', 'project.md'), PROJECT_MIN);
  writeFileSync(join(dir, 'pm', 'gates.md'), GATES_MIN);
  return dir;
}

describe('request_promotion handler（守卫⑤：只产待审申请事件）', () => {
  it('构造调用产出 authorization.requested 事件块（含 from/to/expected_sequence/manifest_hash），绝不出现授权终态 kind', () => {
    const dir = makeProject();
    const deps = fixedDeps();
    const expectedHash = contentVersion(CHANGELOG_MIN).contentHash;
    const result = requestPromotion(
      dir,
      {
        from: '阶段一',
        to: '阶段二',
        expected_sequence: 1,
        manifest_hash: 'a'.repeat(64),
        gate_id: 'G-001',
        ...ACTOR,
        expected_hash: expectedHash,
        note: 'MCP 通道发起的推进申请（测试）',
      },
      deps,
    ) as Record<string, unknown>;

    expect(result['ok']).toBe(true);
    expect(result['kind']).toBe('authorization.requested');
    expect(result['origin']).toBe('managed-api');
    expect(result['integrity']).toBe('unknown');
    expect(isUlid(String(result['eventId']))).toBe(true);
    expect(isUlid(String(result['operationId']))).toBe(true); // CLI confirm/apply 按 operation_id 归属

    const md = readFileSync(join(dir, 'pm', 'changelog.md'), 'utf8');
    expect(md).toContain('kind: authorization.requested');
    expect(md).toContain('"from":"阶段一"');
    expect(md).toContain('"to":"阶段二"');
    expect(md).toContain('"expected_sequence":1');
    expect(md).toContain('"manifest_hash":"' + 'a'.repeat(64) + '"');
    expect(md).toContain('MCP 通道发起的推进申请（测试）'); // 人类说明在块外
    // 产出文件级守卫：绝不出现授权终态/状态迁移 kind
    expect(md).not.toContain('authorization.granted');
    expect(md).not.toContain('locally_confirmed');
    expect(md).not.toContain('task.transitioned');
    expect(String(result['nextHash'])).not.toBe(expectedHash); // append-only 追加后内容版本必变
  });

  it('CAS 基线不一致 → 拒绝写入并返回磁盘当前 hash（P-06/B-1 不覆盖他人修改）', () => {
    const dir = makeProject();
    const result = requestPromotion(
      dir,
      { from: '阶段一', to: '阶段二', expected_sequence: 1, manifest_hash: 'b'.repeat(64), ...ACTOR, expected_hash: 'c'.repeat(64) },
      fixedDeps(),
    ) as Record<string, unknown>;
    expect(result['ok']).toBe(false);
    expect(result['error']).toBe('content-hash-mismatch');
    expect(result['current_hash']).toBe(contentVersion(CHANGELOG_MIN).contentHash);
  });

  it('from 与当前投影阶段不一致 → 附 warning 如实提示，不拒绝（requested 为待审事实）', () => {
    const dir = makeProject();
    // 先经 CLI 口径建立收据链，使 init 事件验真、阶段派生为「阶段一」（P-09：verified 才驱动状态）
    const initBlock = [
      '```gatedeck-event',
      'event_id: 01ARZ3NDEKTSV4RRFFQ69G5FC0',
      'schema_version: 1',
      'kind: project.initialized',
      'occurred_at: 2026-10-24T07:00:00Z',
      'recorded_at: 2026-10-24T07:00:00Z',
      'actor: {"actor_id":"a","session_id":"s"}',
      'origin: core',
      'integrity: verified',
      'subject: {"object_id":"demo"}',
      'payload: {"stage":"阶段一","stage_order":["阶段一","阶段二"],"template_version":1}',
      '```',
      '',
    ].join('\n');
    const changelogWithInit = CHANGELOG_MIN + initBlock;
    writeFileSync(join(dir, 'pm', 'changelog.md'), changelogWithInit);
    // 同源收据（core buildReceiptChain/buildAnchor，与 context.test.ts 夹具同口径）
    const envelopes = parseEventBlocks(changelogWithInit).envelopes;
    const receipts: EventReceipt[] = buildReceiptChain(envelopes);
    writeFileSync(join(dir, 'pm', 'receipts.jsonl'), receipts.map((r) => JSON.stringify(r)).join('\n') + '\n');
    writeFileSync(join(dir, 'pm', 'receipts.anchor.json'), JSON.stringify(buildAnchor(receipts, NOW)));

    const changelogNow = readFileSync(join(dir, 'pm', 'changelog.md'), 'utf8');
    const result = requestPromotion(
      dir,
      { from: '别的阶段', to: '阶段二', expected_sequence: 2, manifest_hash: 'd'.repeat(64), ...ACTOR, expected_hash: contentVersion(changelogNow).contentHash },
      fixedDeps(),
    ) as Record<string, unknown>;
    expect(result['ok']).toBe(true);
    expect(result['currentStage']).toBe('阶段一'); // verified init 驱动阶段派生
    expect(Array.isArray(result['warnings']) && (result['warnings'] as string[]).length > 0).toBe(true);
  });
});

describe('submit_evidence handler（守卫⑤：只产待验证据事件）', () => {
  it('构造调用产出 evidence.submitted 事件（validation_status=pending 在 payload），绝不出现检查完成 kind', () => {
    const dir = makeProject();
    const deps = fixedDeps();
    const expectedHash = contentVersion(CHANGELOG_MIN).contentHash;
    const result = submitEvidence(
      dir,
      { gate_id: 'G-001', rule_id: 'R-001', summary: '证据摘要（测试）', manifest_hash: 'e'.repeat(64), ...ACTOR, expected_hash: expectedHash },
      deps,
    ) as Record<string, unknown>;

    expect(result['ok']).toBe(true);
    expect(result['kind']).toBe('evidence.submitted');
    expect(result['origin']).toBe('managed-api');
    expect(result['validationStatus']).toBe('pending');

    const md = readFileSync(join(dir, 'pm', 'changelog.md'), 'utf8');
    expect(md).toContain('kind: evidence.submitted');
    expect(md).toContain('"validation_status":"pending"');
    expect(md).toContain('"gate_id":"G-001"');
    expect(md).toContain('"rule_id":"R-001"');
    // 产出文件级守卫：绝不出现检查完成 / 状态迁移 kind
    expect(md).not.toContain('kind: check.completed');
    expect(md).not.toContain('kind: task.transitioned');
  });

  it('gate_id/rule_id 空白 → 拒绝（成对定位检查对象，缺一不猜，core checkFacts 同口径）', () => {
    const dir = makeProject();
    const result = submitEvidence(
      dir,
      { gate_id: ' ', rule_id: 'R-001', ...ACTOR, expected_hash: contentVersion(CHANGELOG_MIN).contentHash },
      fixedDeps(),
    ) as Record<string, unknown>;
    expect(result['ok']).toBe(false);
    expect(result['error']).toBe('invalid-input');
  });
});

describe('record_note / report_usage handler（非权威事件 → insights.md）', () => {
  it('record_note 产出 note 事件（origin=managed-api），追加至 insights.md', () => {
    const dir = makeProject();
    const result = recordNote(
      dir,
      { note: '一条非权威备注', ...ACTOR, expected_hash: contentVersion(INSIGHTS_MIN).contentHash },
      fixedDeps(),
    ) as Record<string, unknown>;
    expect(result['ok']).toBe(true);
    expect(result['kind']).toBe('note');
    expect(result['file']).toBe('pm/insights.md');
    const md = readFileSync(join(dir, 'pm', 'insights.md'), 'utf8');
    expect(md).toContain('kind: note');
    expect(md).toContain('"note":"一条非权威备注"');
    expect(md).toContain('"object_id":"project:demo"'); // subject 缺省取 project.md slug
  });

  it('report_usage 产出 usage.reported 事件，且经 context 装配聚合可见（MOD-08 契约字段）', () => {
    const dir = makeProject();
    const result = reportUsage(
      dir,
      { date: '2026-10-24', model: 'test-model', input_tokens: 120, output_tokens: 45, source: 'mcp', ...ACTOR, expected_hash: contentVersion(INSIGHTS_MIN).contentHash },
      fixedDeps(),
    ) as Record<string, unknown>;
    expect(result['ok']).toBe(true);
    expect(result['kind']).toBe('usage.reported');
    const md = readFileSync(join(dir, 'pm', 'insights.md'), 'utf8');
    expect(md).toContain('kind: usage.reported');
    expect(md).toContain('"date":"2026-10-24"');
    expect(md).toContain('"input_tokens":120');
    expect(md).toContain('"output_tokens":45');

    // 集成：context.ts 用量聚合消费同一契约字段（input_tokens/output_tokens 累计）
    const ctx = resolveProjectContext(dir, NOW);
    expect(ctx.ok).toBe(true);
    if (ctx.ok) {
      expect(ctx.usage.events).toBe(1);
      expect(ctx.usage.inputTokens).toBe(120);
      expect(ctx.usage.outputTokens).toBe(45);
      expect(ctx.usage.byModel['test-model']).toBe(1);
    }
  });
});

describe('check_gate handler（只读：事实查询与失效判定，永不执行命令）', () => {
  it('pm/ 缺失 → not-initialized；manifest 指纹对同一输入稳定', () => {
    const result = checkGate(join(tmpdir(), 'gatedeck-mcp-not-exist'), {}, fixedDeps()) as Record<string, unknown>;
    expect(result['ok']).toBe(false);
    expect(result['error']).toBe('not-initialized');
  });

  it('无 changelog → 如实「未检查」；manifest 只采 pm/ 契约文件（changelog 默认排除，B-3）', () => {
    const dir = makeProject();
    rmSync(join(dir, 'pm', 'changelog.md'));
    const result = checkGate(dir, {}, fixedDeps()) as Record<string, unknown>;
    expect(result['ok']).toBe(true);
    const manifest = result['manifest'] as { hash: string; entries: Array<{ path: string; role: string }>; excluded: string[] };
    expect(manifest.entries.map((e) => e.path).sort()).toEqual(['pm/gates.md', 'pm/insights.md', 'pm/project.md', 'pm/wbs.md']);
    expect(manifest.entries.find((e) => e.path === 'pm/gates.md')?.role).toBe('rule-file');
    expect(result['checks']).toEqual([]);
    expect((result['summary'] as Record<string, number>)['not-checked']).toBe(0);
    expect((result['notes'] as string[]).some((n) => n.includes('changelog.md 缺失'))).toBe(true);
    // 指纹稳定性：同输入两次调用同 hash
    const again = checkGate(dir, {}, fixedDeps()) as Record<string, unknown>;
    expect((again['manifest'] as { hash: string }).hash).toBe(manifest.hash);
  });

  it('未验真的检查事件不参与检查事实推导（P-09），数量如实返回；凭证比对锚为 manifest hash', () => {
    const dir = makeProject();
    writeFileSync(
      join(dir, 'pm', 'changelog.md'),
      CHANGELOG_MIN +
        [
          '```gatedeck-event',
          'event_id: 01ARZ3NDEKTSV4RRFFQ69G5FD0',
          'schema_version: 1',
          'kind: check.completed',
          'occurred_at: 2026-10-24T07:00:00Z',
          'recorded_at: 2026-10-24T07:00:00Z',
          'actor: {"actor_id":"a","session_id":"s"}',
          'origin: core',
          'integrity: verified',
          'subject: {"object_id":"G-001"}',
          'payload: {"gateId":"G-001","ruleId":"R-001","outcome":"passed","subjectManifestHash":"' + 'f'.repeat(64) + '"}',
          '```',
          '',
        ].join('\n'),
    );
    // 无收据库：事件 unverified → 不进检查事实投影（P-09）
    const result = checkGate(dir, {}, fixedDeps()) as Record<string, unknown>;
    expect(result['ok']).toBe(true);
    expect(result['checks']).toEqual([]);
    expect((result['notes'] as string[]).some((n) => n.includes('未通过收据链验真'))).toBe(true);
    // gate_id 过滤与 evidence 登记口径：gateFilter 不存在的组合如实为空
    const filtered = checkGate(dir, { gate_id: 'G-999' }, fixedDeps()) as Record<string, unknown>;
    expect((filtered as Record<string, unknown>)['checks']).toEqual([]);
  });
});
