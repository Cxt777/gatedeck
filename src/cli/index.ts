#!/usr/bin/env node
/**
 * gatedeck CLI 入口（骨架）。
 *
 * 分层约定：本层为「壳」，允许 IO（文件系统/终端）；判定与推导逻辑一律下沉到 core。
 * 子命令清单（init/discover/adopt/register/ls/gate/promote/handoff/...）
 * 将在 T-M0b-08 与 M1 任务中逐步落地，当前仅提供可执行占位与帮助输出。
 */
import { CORE_VERSION } from '../core/index.js';

const USAGE = `gatedeck（一休PM）— 决策台优先的本地项目管理工具

用法：gatedeck <command> [options]      （别名：pm）

当前为工程骨架占位，命令清单将随 M0b / M1 任务落地。`;

function run(argv: readonly string[]): number {
  const command = argv[0];

  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    return 0;
  }

  if (command === '--version' || command === '-v') {
    console.log(CORE_VERSION);
    return 0;
  }

  console.error(`未知命令：${command}`);
  console.log(USAGE);
  return 2;
}

process.exitCode = run(process.argv.slice(2));
