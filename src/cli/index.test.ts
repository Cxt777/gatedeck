import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildContractBundle } from '../core/contractTemplates.js';
import { COMMANDS, runCli, type CliIo } from './index.js';

/** 可断言的内存终端：out/err 分行收集 */
function captureIo(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

/**
 * T-M0b-08 命令框架测试（2026-10-24 随 T-M1-01/02/06+09/07 落地更新）：
 *  - 真实现命令（init/discover/adopt/deck/handoff）在此只测「参数校验/无 pm 引导」
 *    这类零副作用路径，真实现的行为测试随各命令模块与冒烟脚本；
 *  - 仍占位的命令（register/ls）维持骨架期契约：exit 2 + 明示未实现 + 零副作用声明；
 *  - B-7：discover/ls/deck 三只读命令在帮助中标注［纯只读］。
 */
describe('gatedeck CLI 命令框架（T-M0b-08 + T-M1 系列）', () => {
  it('无参数 / help / --help / -h → 显示全部子命令帮助，退出码 0', () => {
    for (const argv of [[], ['help'], ['--help'], ['-h']]) {
      const { io, out } = captureIo();
      expect(runCli(argv, io)).toBe(0);
      const text = out.join('\n');
      for (const c of COMMANDS) expect(text).toContain(c.name);
      expect(text).toContain('别名：pm');
    }
  });

  it('帮助中 readOnly 命令（discover/ls/deck）标注［纯只读］，其余不标注', () => {
    const { io, out } = captureIo();
    runCli([], io);
    for (const c of COMMANDS) {
      const line = out.find((l) => l.includes(c.usage)) ?? '';
      if (c.readOnly) expect(line).toContain('［纯只读］');
      else expect(line).not.toContain('［纯只读］');
    }
  });

  it('--version / -v → 输出版本（支持预发布后缀），退出码 0', () => {
    for (const argv of [['--version'], ['-v']]) {
      const { io, out } = captureIo();
      expect(runCli(argv, io)).toBe(0);
      expect(out[0]).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/); // 如 0.1.0-rc.1
    }
  });

  it('占位命令（register/ls）执行 → 退出码 2、明示未实现与零副作用（W-06）', () => {
    for (const name of ['register', 'ls']) {
      const { io, out, err } = captureIo();
      expect(runCli([name], io)).toBe(2);
      expect(err.join('\n')).toContain('尚未实现');
      expect(err.join('\n')).toContain('无任何副作用');
      expect(out).toEqual([]); // 占位不出正途输出
    }
  });

  it('ls 占位文案额外声明纯只读承诺（B-7 前置）', () => {
    const { io, err } = captureIo();
    runCli(['ls'], io);
    const text = err.join('\n');
    expect(text).toContain('纯只读');
    expect(text).toContain('不执行命令、不入册、不改文件');
  });

  it('init 真实现：无参数 → 参数校验失败提示 --stage，退出码 2（零副作用路径）', () => {
    const { io, err } = captureIo();
    expect(runCli(['init'], io)).toBe(2);
    expect(err.join('\n')).toContain('--stage');
  });

  it('deck 真实现：无 pm/ → 初始化引导 exit 2；有 pm/ → 渲染决策台标题 exit 0（自包含 fixture）', () => {
    const orig = process.cwd();
    const dir = mkdtempSync(join(tmpdir(), 'gd-deck-'));
    try {
      // 路径一：干净目录（CI 同构环境）→ 引导
      process.chdir(dir);
      const ioNone = captureIo();
      expect(runCli(['deck'], ioNone.io)).toBe(2);
      expect([...ioNone.out, ...ioNone.err].join('\n')).toContain('init');

      // 路径二：构造完整 pm/ 契约（模板工厂）→ 决策台渲染
      const bundle = buildContractBundle({
        projectName: 'deck 测试项目',
        slug: 'deck-test',
        description: '自包含 fixture',
        initializedAt: '2026-10-25T10:00:00+08:00',
        initialStage: 'M1',
        actorId: 'a'.repeat(32),
        sessionId: 'b'.repeat(32),
      });
      mkdirSync(join(dir, 'pm'), { recursive: true });
      for (const [name, text] of Object.entries(bundle)) {
        writeFileSync(join(dir, 'pm', name), text, 'utf8');
      }
      const ioDeck = captureIo();
      expect(runCli(['deck'], ioDeck.io)).toBe(0);
      expect(ioDeck.out.join('\n')).toContain('决策台');
    } finally {
      process.chdir(orig);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adopt 真实现：无参数 → 用法报错，退出码 2（零副作用路径）', () => {
    const { io, err } = captureIo();
    expect(runCli(['adopt'], io)).toBe(2);
    expect(err.join('\n').length).toBeGreaterThan(0);
  });

  it('revive 作为 handoff 别名：--help 显示 handoff 用法（T-M1-07）', () => {
    const { io, out } = captureIo();
    expect(runCli(['revive', '--help'], io)).toBe(0);
    expect(out.join('\n')).toContain('handoff');
  });

  it('子命令 --help → 显示 usage/摘要/落地任务，退出码 0', () => {
    const { io, out } = captureIo();
    expect(runCli(['init', '--help'], io)).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('gatedeck init');
    expect(text).toContain('T-M1-01');
  });

  it('未知命令 → 退出码 2、err 提示并回显帮助', () => {
    const { io, out, err } = captureIo();
    expect(runCli(['pass_gate'], io)).toBe(2);
    expect(err[0]).toContain('未知命令：pass_gate');
    expect(out.join('\n')).toContain('命令：');
  });

  it('命令注册表恰为九个子命令，readOnly 标注恰为 discover/ls/deck/gate', () => {
    expect(COMMANDS.map((c) => c.name)).toEqual([
      'init',
      'discover',
      'adopt',
      'register',
      'ls',
      'deck',
      'handoff',
      'gate',
      'promote',
    ]);
    expect(COMMANDS.filter((c) => c.readOnly).map((c) => c.name)).toEqual(['discover', 'ls', 'deck', 'gate']);
  });
});
