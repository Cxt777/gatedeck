#!/usr/bin/env node
/**
 * gatedeck CLI（T-M0b-08）：`gatedeck` / `pm` 双 bin 命令框架 + 五子命令占位与帮助。
 *
 * 分层约定：本层为「壳」，允许 IO（文件系统/终端）；判定与推导逻辑一律下沉 core。
 *  - init：写路径已落地（T-M1-01，R-06 不覆盖）；adopt：写路径已落地（T-M1-02，显式收编）；
 *    register：写路径占位，随 T-M1-02 后续落地；
 *  - discover：**纯只读**真实现（T-M1-02）——零写动作，不执行命令、不入册、不改文件（B-7）；
 *    ls：仍为**纯只读**占位（「discover/ls 纯只读」自骨架期成立，B-7）；
 *  - 占位命令执行一律退出码 2 并明示未实现：脚本不得把「无效果」当成功（W-06）；
 *  - gatedeck-mcp 第三 bin（MCP server 入口，DP-1 终裁）随独立任务落地。
 */
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { CORE_VERSION } from '../core/index.js';

/** 包版本（package.json version；--version 展示口径）；CORE_VERSION 为 core 内核协议版本 */
const PACKAGE_VERSION: string = createRequire(import.meta.url)('../../package.json').version ?? CORE_VERSION;
import { runAdopt } from './commands/adopt.js';
import { runDeck } from './commands/deck.js';
import { runDiscover } from './commands/discover.js';
import { runGateCheck } from './commands/gate.js';
import { runHandoff } from './commands/handoff.js';
import { runInit } from './commands/init.js';
import { runPromote } from './commands/promote.js';

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
    summary: '在当前目录初始化 pm/ 契约文件骨架（project/wbs/gates/changelog/insights；R-06 不覆盖，已存在即拒绝）',
    usage: 'gatedeck init [--name <名>] [--slug <slug>] [--stage <初始阶段>]',
    lands: 'T-M1-01',
    readOnly: false,
  },
  {
    name: 'discover',
    summary: '只读扫描工作区候选项目并预览（.gatedeckignore 生效；不执行命令、不入册、不写文件，B-7）',
    usage: 'gatedeck discover',
    lands: 'T-M1-02',
    readOnly: true,
  },
  {
    name: 'adopt',
    summary: '把候选项目显式收编入 .gatedeck/registry.md（append-only 登记；重复登记拒绝）',
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
  {
    name: 'deck',
    summary: '决策台——等您决定/可以推进/需要关注 三区总览',
    usage: 'gatedeck deck',
    lands: 'T-M1-06 + T-M1-09',
    readOnly: true,
  },
  {
    name: 'handoff',
    summary: '生成六段结构 handoff 交接包（携带源版本与生成时间；revive 为别名，同一实现）',
    usage: 'gatedeck handoff（别名 revive）',
    lands: 'T-M1-07',
    readOnly: false,
  },
  {
    name: 'gate',
    summary: '检查事实查询与失效判定（只读；本版不执行门禁命令，R-07/D-26）',
    usage: 'gatedeck gate check [--gate <门禁id>]',
    lands: 'T-M1-04',
    readOnly: true,
  },
  {
    name: 'promote',
    summary: '本地交互确认推进（TTY 三步编排收口；非交互拒绝，B-12）',
    usage: 'gatedeck promote [--operation-id <id>]',
    lands: 'T-M1-05',
    readOnly: false,
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
    io.out(PACKAGE_VERSION);
    return 0;
  }

  // handoff（别名 revive，T-M1-07）：已实现命令，先于占位查找路由——
  // revive 作为别名不注册进 COMMANDS（帮助只列正名），故必须在 spec 查找前拦截
  if (command === 'handoff' || command === 'revive') {
    if (argv[1] === '--help' || argv[1] === '-h') {
      const spec = COMMANDS.find((c) => c.name === 'handoff');
      if (spec !== undefined) {
        io.out(spec.usage);
        io.out(`  ${spec.summary}`);
        io.out(`  落地任务：${spec.lands}${spec.readOnly ? '（纯只读命令，实现后也不写文件）' : ''}`);
      }
      return 0;
    }
    return runHandoff(process.cwd(), io);
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

  // init 真实现路由（T-M1-01）：写路径，R-06 不覆盖；参数解析与落盘在 commands/init.ts
  if (spec.name === 'init') {
    return runInit(argv.slice(1), io);
  }

  // deck 为首个已落地实现（W-S2-6）：只读投影，装配与渲染在 commands/deck.ts
  if (spec.name === 'deck') {
    return runDeck(io);
  }

  // discover 真实现路由（T-M1-02）：纯只读预览——零写动作，不执行命令、不入册（B-7）；
  // 扫描、ignore 过滤与候选判定的口径在 commands/discover.ts + core/discoverRules.ts
  if (spec.name === 'discover') {
    return runDiscover(argv.slice(1), io);
  }

  // adopt 真实现路由（T-M1-02）：显式收编入 .gatedeck/registry.md（append-only，R-02）；
  // 候选校验与重复登记拒绝口径在 commands/adopt.ts + core registry 模块
  if (spec.name === 'adopt') {
    return runAdopt(argv.slice(1), io);
  }

  // gate 子树路由（gate check 为唯一子命令，缺省即 check）
  if (spec.name === 'gate') {
    return runGateCheck(argv.slice(1), io);
  }

  // promote 真实现路由（T-M1-05）：TTY 三步编排收口（confirm/apply 仅本命令，B-12）
  if (spec.name === 'promote') {
    return runPromote(argv.slice(1), io);
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
