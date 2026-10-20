import { describe, expect, it } from 'vitest';

import * as registryExports from './registry.js';
import {
  appendNativeRegistryEntry,
  nativeToProjection,
  parseNativeRegistry,
  parseNativeRegistryLocal,
  parseProjectsIndex,
  projectsIndexToProjection,
  serializeNativeRegistry,
  serializeNativeRegistryLocal,
  updateLocalLocator,
  type NativeRegistryEntry,
} from './registry.js';

const WS_A = '01J9WSPC000000000000000000';
const WS_B = '01J9WSPD000000000000000000';
const PRJ_A = '01J9PRJA000000000000000000';
const PRJ_B = '01J9PRJB000000000000000000';
const AT = '2026-10-20T03:00:00Z';

function entryA(): NativeRegistryEntry {
  return { project_id: PRJ_A, workspace_id: WS_A, slug: 'gatedeck', display_name: '一休PM', managed: true, registered_at: AT };
}

describe('native provider · registry.md（append-only 登记）', () => {
  it('生成 → 解析 round-trip：条目无损', () => {
    const md = serializeNativeRegistry([entryA()]);
    const { entries, diagnostics } = parseNativeRegistry(md);
    expect(diagnostics).toEqual([]);
    expect(entries).toEqual([entryA()]);
  });

  it('追加：既有字节不动（前缀相等），新行落在表尾；重复登记拒绝', () => {
    const b: NativeRegistryEntry = { project_id: PRJ_B, workspace_id: WS_B, slug: 'demo', display_name: '示例', managed: false, registered_at: AT };
    const before = serializeNativeRegistry([entryA()]);
    const after = appendNativeRegistryEntry(before, b);
    expect(after.startsWith(before)).toBe(true); // append-only：前缀字节级一致
    expect(parseNativeRegistry(after).entries).toEqual([entryA(), b]);
    expect(() => appendNativeRegistryEntry(after, b)).toThrow(/重复登记/);
    expect(() => appendNativeRegistryEntry(after, { ...b, project_id: '01J9PRJC000000000000000000' })).toThrow(/重复登记/);
  });

  it('CRLF 文档追加后 EOL 风格不变（R-04）', () => {
    const crlf = serializeNativeRegistry([entryA()]).replace(/\n/g, '\r\n');
    const b: NativeRegistryEntry = { project_id: PRJ_B, workspace_id: WS_B, slug: 'demo', display_name: '示例', managed: false, registered_at: AT };
    const after = appendNativeRegistryEntry(crlf, b);
    expect(after).toContain('\r\n');
    expect(after.includes('\n')).toBe(true); // 所有换行均为 CRLF
    expect(after.split('\r\n').length).toBe(after.split('\n').length);
    expect(parseNativeRegistry(after).entries).toHaveLength(2);
  });

  it('坏值出诊断：workspace_id 非 ULID / registered_at 无时区 / managed 非 bool', () => {
    const bad = serializeNativeRegistry([
      { project_id: PRJ_A, workspace_id: 'not-a-ulid', slug: 'x', display_name: 'x', managed: true, registered_at: AT },
      { project_id: PRJ_B, workspace_id: WS_B, slug: 'y', display_name: 'y', managed: false, registered_at: '2026-10-20 03:00:00' },
    ]);
    const { diagnostics } = parseNativeRegistry(bad);
    expect(diagnostics.filter((d) => d.code === 'bad-value')).toHaveLength(2);
  });

  it('未知列保留原表并出诊断（F-06）；缺必需列报 missing-column', () => {
    const withUnknown = '# 注册表\n\n| project_id | workspace_id | slug | display_name | managed | registered_at | 备注 |\n|---|---|---|---|---|---|---|\n| p1 | ' + WS_A + ' | s | 名 | true | ' + AT + ' | 手写备注 |\n';
    const r1 = parseNativeRegistry(withUnknown);
    expect(r1.entries).toHaveLength(1);
    expect(r1.diagnostics.some((d) => d.code === 'column-count-mismatch' && d.message.includes('备注'))).toBe(true);

    const missing = '# 注册表\n\n| project_id | workspace_id |\n|---|---|\n| p1 | ' + WS_A + ' |\n';
    const r2 = parseNativeRegistry(missing);
    expect(r2.entries).toEqual([]);
    expect(r2.diagnostics[0]!.code).toBe('missing-column');
  });
});

describe('native provider · registry.local.md（B-14 locator 就地更新）', () => {
  const localMd = () =>
    serializeNativeRegistryLocal([
      { workspace_id: WS_A, binding_key: 'bnd_alpha_0001', locator: 'D:\\ws\\alpha', observed_at: AT },
      { workspace_id: WS_B, binding_key: 'bnd_beta_0002', locator: 'D:\\ws\\beta', observed_at: AT },
    ]);

  it('生成 → 解析 round-trip', () => {
    const { entries, diagnostics } = parseNativeRegistryLocal(localMd());
    expect(diagnostics).toEqual([]);
    expect(entries).toHaveLength(2);
  });

  it('B-14 目录移动：workspace_id/binding_key 不变，仅 locator/observed_at 更新，其余行字节不动', () => {
    const movedAt = '2026-10-21T10:00:00Z';
    const after = updateLocalLocator(localMd(), WS_A, 'E:\\moved\\alpha', movedAt);
    const { entries } = parseNativeRegistryLocal(after);
    expect(entries[0]).toEqual({ workspace_id: WS_A, binding_key: 'bnd_alpha_0001', locator: 'E:\\moved\\alpha', observed_at: movedAt });
    expect(entries[1]).toEqual({ workspace_id: WS_B, binding_key: 'bnd_beta_0002', locator: 'D:\\ws\\beta', observed_at: AT });
    // 未涉及行字节级不动
    expect(after).toContain('| ' + WS_B + ' | bnd_beta_0002 | D:\\ws\\beta | ' + AT + ' |');
    expect(() => updateLocalLocator(after, '01J9N0PE000000000000000000', 'x', movedAt)).toThrow(/不存在/);
  });

  it('CRLF 文档更新后 EOL 风格不变', () => {
    const crlf = localMd().replace(/\n/g, '\r\n');
    const after = updateLocalLocator(crlf, WS_A, 'E:\\moved', '2026-10-21T10:00:00Z');
    expect(after).toContain('\r\n');
    expect(parseNativeRegistryLocal(after).entries[0]!.locator).toBe('E:\\moved');
  });
});

describe('projects-index provider（D-30 只读投影，B-15）', () => {
  // 合成夹具：仿工作区根 PROJECTS-INDEX.md 登记表格式（不复制真实项目数据）
  const FIXTURE = [
    '# 工作区项目登记表',
    '',
    '## 二、项目登记表（append-only，新条目追加在表尾）',
    '',
    '| slug | 中文名 | 目录 | 状态 | 端口段 | 技术栈 | 项目级入口 |',
    '|---|---|---|---|---|---|---|',
    '| demo-alpha | 示例甲 | `demo-alpha/` | 在研（示例） | 8100–8109 | Node 22 + TS | `demo-alpha/PROJECT-INDEX.md` |',
    '| demo-beta | 示例乙 | `demo-beta/` | 预留 | 8110–8119 | 待定 | `demo-beta/README.md` |',
    '',
    '## 三、变更点（append-only）',
    '',
    '- [2026-10-09] 示例登记。',
  ].join('\n');

  it('只读解析：登记行 → 投影条目', () => {
    const { entries, diagnostics } = parseProjectsIndex(FIXTURE);
    expect(diagnostics).toEqual([]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      slug: 'demo-alpha',
      display_name: '示例甲',
      dir: '`demo-alpha/`',
      status: '在研（示例）',
      port_range: '8100–8109',
      stack: 'Node 22 + TS',
      entry: '`demo-alpha/PROJECT-INDEX.md`',
    });
  });

  it('B-15 结构性断言：模块不存在任何以 PROJECTS-INDEX 为目标的写入函数（只读由 API 形状保证）', () => {
    const valueExports = Object.keys(registryExports);
    expect(valueExports).toContain('parseProjectsIndex'); // 读存在
    const writerPattern = /(append|update|serialize|write|save)[A-Za-z]*Index|Index[A-Za-z]*(append|update|serialize|write|save)/i;
    expect(valueExports.filter((name) => writerPattern.test(name))).toEqual([]); // 写不存在
  });

  it('投影：projects-index 条目 managed 恒为 false（是否收编由本地绑定决定，M1-02）', () => {
    const { entries } = parseProjectsIndex(FIXTURE);
    const p = projectsIndexToProjection(entries[0]!);
    expect(p).toEqual({ source: 'projects-index', project_id: 'demo-alpha', display_name: '示例甲', locator: '`demo-alpha/`', managed: false });
  });
});

describe('统一投影', () => {
  it('native 投影携带本地 locator；workspace_id 不匹配抛出', () => {
    const e = entryA();
    expect(nativeToProjection(e, { workspace_id: WS_A, binding_key: 'bnd', locator: 'D:\\ws\\alpha', observed_at: AT })).toEqual({
      source: 'native',
      project_id: PRJ_A,
      display_name: '一休PM',
      locator: 'D:\\ws\\alpha',
      managed: true,
    });
    expect(() =>
      nativeToProjection(e, { workspace_id: WS_B, binding_key: 'bnd', locator: 'x', observed_at: AT }),
    ).toThrow(/不匹配/);
  });
});
