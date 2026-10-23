import { describe, expect, it } from 'vitest';

import { COMMANDS, runCli, type CliIo } from './index.js';

/** 可断言的内存终端：out/err 分行收集 */
function captureIo(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

describe('gatedeck CLI 骨架（T-M0b-08）', () => {
  it('无参数 / help / --help / -h → 显示五子命令帮助，退出码 0', () => {
    for (const argv of [[], ['help'], ['--help'], ['-h']]) {
      const { io, out } = captureIo();
      expect(runCli(argv, io)).toBe(0);
      const text = out.join('\n');
      for (const c of COMMANDS) expect(text).toContain(c.name);
      expect(text).toContain('别名：pm');
      expect(text).toContain('占位说明');
    }
  });

  it('帮助中 discover/ls 标注［纯只读］，其余命令不标注', () => {
    const { io, out } = captureIo();
    runCli([], io);
    const text = out.join('\n');
    expect(text).toContain('gatedeck discover');
    for (const c of COMMANDS) {
      const line = out.find((l) => l.includes(c.usage)) ?? '';
      if (c.readOnly) expect(line).toContain('［纯只读］');
      else expect(line).not.toContain('［纯只读］');
    }
  });

  it('--version / -v → 输出版本，退出码 0', () => {
    for (const argv of [['--version'], ['-v']]) {
      const { io, out } = captureIo();
      expect(runCli(argv, io)).toBe(0);
      expect(out[0]).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('五个子命令占位执行 → 退出码 2、明示未实现与落地任务、零副作用声明', () => {
    for (const c of COMMANDS) {
      const { io, out, err } = captureIo();
      const code = runCli([c.name], io);
      expect(code).toBe(2);
      expect(err.join('\n')).toContain('尚未实现');
      expect(err.join('\n')).toContain(c.lands);
      expect(err.join('\n')).toContain('无任何副作用');
      expect(out).toEqual([]); // 占位不出正途输出
    }
  });

  it('discover/ls 占位文案额外声明纯只读承诺（B-7 前置）', () => {
    for (const name of ['discover', 'ls']) {
      const { io, err } = captureIo();
      runCli([name], io);
      const text = err.join('\n');
      expect(text).toContain('纯只读');
      expect(text).toContain('不执行命令、不入册、不改文件');
    }
  });

  it('adopt/register 占位不声称只读（写路径诚实标注）', () => {
    for (const name of ['adopt', 'register', 'init']) {
      const { io, err } = captureIo();
      runCli([name], io);
      expect(err.join('\n')).not.toContain('纯只读');
    }
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

  it('命令注册表恰为五个子命令，readOnly 标注仅 discover/ls', () => {
    expect(COMMANDS.map((c) => c.name)).toEqual(['init', 'discover', 'adopt', 'register', 'ls']);
    expect(COMMANDS.filter((c) => c.readOnly).map((c) => c.name)).toEqual(['discover', 'ls']);
  });
});
