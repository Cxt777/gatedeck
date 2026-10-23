#!/usr/bin/env node
/**
 * gatedeck CLI（T-M0b-08）：`gatedeck` / `pm` 双 bin 命令框架 + 五子命令占位与帮助。
 *
 * 分层约定：本层为「壳」，允许 IO（文件系统/终端）；判定与推导逻辑一律下沉 core。
 *  - init / adopt / register：写路径占位，随 T-M1-01 / T-M1-02 落地；
 *  - discover / ls：**纯只读**占位——骨架期连读也不做（零文件访问），只输出命令契约
 *    与只读承诺，确保「discover/ls 纯只读」从骨架期就成立（B-7 前置）；
 *  - 占位命令执行一律退出码 2 并明示未实现：脚本不得把「无效果」当成功（W-06）；
 *  - gatedeck-mcp 第三 bin 为 WBS-W S3 冲刺任务（DP-1 终裁），不在本任务范围。
 */
import { pathToFileURL } from 'node:url';
import { CORE_VERSION } from '../core/index.js';

/** 可注入终端 IO（测试零侵入；默认 console） */
export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

const consoleIo: CliIo = { out: (l) => console.log(l), err: (l) => console.error(l) };

export interface CommandSpec {
  name: string;
  summary: string;
  usage: string;
  /** 落地任务（WBS id），占位提示与 --help 展示用 */
  lands: string;
  /** true = 设计为纯只读命令（实现后也不写任何文件；骨架期零文件访问） */
  readOnly: boolean;
}

/** 五个子命令注册表（顺序即帮助展示顺序） */
export const COMMANDS: readonly CommandSpec[] = [
  {
    name: 'init',
    summary: '在当前目录初始化 pm/ 契约文件骨架（project/wbs/gates/changelog/insights）',
    usage: 'gatedeck init',
    lands: 'T-M1-01',
    readOnly: false,
  },
  {
    name: 'discover',
    summary: '只读扫描工作区候选项目并预览（不执行命令、不入册，B-7）',
    usage: 'gatedeck discover',
    lands: 'T-M1-02',
    readOnly: true,
  },
  {
    name: 'adopt',
    summary: '把 discover 预览中的项目显式收编入注册表',
    usage: 'gatedeck adopt <path>',
    lands: 'T-M1-02',
    readOnly: false,
  },
  {
    name: 'register',
    summary: '登记项目到注册表（native provider）',
    usage: 'gatedeck register <path>',
    lands: 'T-M1-02',
    readOnly: false,
  },
  {
    name: 'ls',
    summary: '只读列出注册表项目总览',
    usage: 'gatedeck ls',
    lands: 'T-M1-02',
    readOnly: true,
  },
];

function renderHelp(io: CliIo): void {
  io.out('gatedeck（一休PM）— 决策台优先、证据可校验的本地项目管理工具');
  io.out('');
  io.out('用法：gatedeck <command> [options]      （别名：pm）');
  io.out('');
  io.out('命令：');
  for (const c of COMMANDS) {
    io.out(`  ${c.usage.padEnd(24)} ${c.summary}${c.readOnly ? '［纯只读］' : ''}`);
  }
  io.out('  help / --help / -h         显示本帮助；--version / -v 显示版本');
  io.out('');
  io.out('占位说明：T-M0b-08 仅落地命令框架与帮助；各子命令随对应 WBS 任务实现，');
  io.out('在其落地前执行一律退出码 2（未实现），不产生任何文件副作用。');
}

function run(argv: readonly string[], io: CliIo): number {
  const command = argv[0];

  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    renderHelp(io);
    return 0;
  }

  if (command === '--version' || command === '-v') {
    io.out(CORE_VERSION);
    return 0;
  }

  const spec = COMMANDS.find((c) => c.name === command);
  if (spec === undefined) {
    io.err(`未知命令：${command}`);
    renderHelp(io);
    return 2;
  }

  if (argv[1] === '--help' || argv[1] === '-h') {
    io.out(spec.usage);
    io.out(`  ${spec.summary}`);
    io.out(`  落地任务：${spec.lands}${spec.readOnly ? '（纯只读命令，实现后也不写文件）' : ''}`);
    return 0;
  }

  io.err(
    `「${spec.name}」尚未实现（随 ${spec.lands} 落地）——当前为占位：未读取、未写入任何文件，无任何副作用。`,
  );
  if (spec.readOnly) {
    io.err('该命令设计为纯只读（B-7 前置）：实现后也只读预览，不执行命令、不入册、不改文件。');
  }
  io.err(`可用命令：${COMMANDS.map((c) => c.name).join(' / ')}；详见 gatedeck help。`);
  return 2;
}

/** 供测试与嵌入方调用；返回进程退出码（0 成功 / 2 用法或未实现错误） */
export function runCli(argv: readonly string[], io: CliIo = consoleIo): number {
  return run(argv, io);
}

/* 直接执行（node dist/cli/index.js）时进入主流程；被测试/嵌入方 import 时不自动执行 */
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = runCli(process.argv.slice(2));
}
