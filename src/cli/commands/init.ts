/**
 * gatedeck init —— 在当前目录初始化 pm/ 契约文件骨架（T-M1-01）。
 *
 * 壳层职责（允许 IO）：参数解析、目录名缺省、时钟与不透明身份注入、逐文件落盘与 R-06 检查；
 * 契约内容由 core/contractTemplates 纯函数生成（buildContractBundle），本层不拼模板。
 *
 * 参数：gatedeck init [--name <名>] [--slug <slug>] [--stage <初始阶段>]
 *  - --name/--slug 缺省取当前目录名；--stage 无合理缺省（须与 gates.md 首阶段一致），
 *    非交互环境不引入 prompt 包依赖——缺参直接报错要求显式传参（退出码 2）；
 *  - 初始化时间 = 壳层时钟 new Date().toISOString()（ISO 8601 带时区，满足信封 R-08）；
 *  - actorId/sessionId = node:crypto randomBytes hex（本地不透明 ID，D-19：
 *    不记邮箱/用户名/对话文本；actorPrivacy 模块当前不存在，自校验留待其落地）。
 *
 * R-06 不覆盖：pm/ 目录已存在 → 全部拒绝并中文提示（幂等重跑同样拒绝、提示已初始化）；
 * 逐文件写前存在性检查——任一目标文件已存在 → 立即中止，本次已写入文件保留并在输出列出
 * （不做回滚删除——W-03 不做删除动作，如实报告），退出码 2。
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  BUNDLE_FILE_ORDER,
  buildContractBundle,
  TEMPLATE_VERSION,
  type ProjectSeed,
} from '../../core/contractTemplates.js';
import type { CliIo } from '../index.js';

/** init 用法（参数错误输出与 --help 一致口径） */
export const INIT_USAGE = 'gatedeck init [--name <名>] [--slug <slug>] [--stage <初始阶段>]';

/** 解析后的 init 参数（原始字符串，缺省与合法性校验在 resolveSeedInputs） */
export interface InitOptions {
  name?: string;
  slug?: string;
  stage?: string;
}

const KNOWN_FLAGS: ReadonlySet<string> = new Set(['--name', '--slug', '--stage']);

export type ParseInitArgsResult =
  | { ok: true; options: InitOptions }
  | { ok: false; message: string };

/** 极简参数解析：`--flag 值` 与 `--flag=值` 两种形态；未知开关与缺值一律报错（不猜语义） */
export function parseInitArgs(argv: readonly string[]): ParseInitArgsResult {
  const options: InitOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    let flag = arg;
    let value: string | undefined;
    const eq = arg.indexOf('=');
    if (arg.startsWith('--') && eq > 2) {
      flag = arg.slice(0, eq);
      value = arg.slice(eq + 1);
    }
    if (!KNOWN_FLAGS.has(flag)) {
      return {
        ok: false,
        message: `未知参数：${arg}（仅支持 --name/--slug/--stage，可用空格或 = 传值；用法：${INIT_USAGE}）`,
      };
    }
    if (value === undefined) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        return { ok: false, message: `参数 ${flag} 缺少值（用法：${INIT_USAGE}）` };
      }
      value = next;
      i++;
    }
    if (flag === '--name') options.name = value;
    else if (flag === '--slug') options.slug = value;
    else options.stage = value;
  }
  return { ok: true, options };
}

export type SeedInputsResult =
  | { ok: true; projectName: string; slug: string; stage: string }
  | { ok: false; message: string };

/**
 * 输入校验与缺省补全：name/slug 缺省取当前目录名；stage 必填（非交互不 prompt，直接要求传参）。
 * 换行/控制字符拒绝：会破坏模板行结构（模板为逐行 key: value 与围栏块，宁拒不猜）。
 */
export function resolveSeedInputs(options: InitOptions, cwd: string): SeedInputsResult {
  const dirName = basename(cwd) !== '' ? basename(cwd) : 'untitled';
  const projectName = (options.name ?? dirName).trim();
  const slug = (options.slug ?? dirName).trim();
  const stage = options.stage !== undefined ? options.stage.trim() : undefined;
  if (stage === undefined || stage === '') {
    return {
      ok: false,
      message: `缺少 --stage 参数：非交互环境不引入 prompt 依赖，请显式传入初始阶段（须与 gates.md 首阶段一致）。用法：${INIT_USAGE}`,
    };
  }
  const checks: Array<readonly [string, string]> = [
    ['--name', projectName],
    ['--slug', slug],
    ['--stage', stage],
  ];
  for (const [flag, v] of checks) {
    if (v === '') {
      return { ok: false, message: `参数 ${flag} 不能为空（用法：${INIT_USAGE}）` };
    }
    // eslint-disable-next-line no-control-regex -- 防护性正则：参数值必须拒绝控制字符（防破坏模板行结构）
    if (/[\r\n\u0000]/.test(v)) {
      return { ok: false, message: `参数 ${flag} 含换行/控制字符，拒绝（会破坏模板行结构）` };
    }
  }
  return { ok: true, projectName, slug, stage };
}

/**
 * 执行 init：返回进程退出码（0 成功 / 2 参数或 R-06 拒绝）。
 * 写路径全在壳层；模板内容来自 core 纯函数，保证同 seed 字节一致。
 */
export function runInit(argv: readonly string[], io: CliIo, cwd: string = process.cwd()): number {
  const parsed = parseInitArgs(argv);
  if (!parsed.ok) {
    io.err(parsed.message);
    return 2;
  }
  const inputs = resolveSeedInputs(parsed.options, cwd);
  if (!inputs.ok) {
    io.err(inputs.message);
    return 2;
  }

  // 时钟与身份由壳层注入（core 不取系统时间/随机数）：时间 ISO 8601 带时区（Z），
  // 身份为 randomBytes hex 不透明 ID（D-19）；描述无对应参数，留待主理人补充的占位文案。
  const seed: ProjectSeed = {
    projectName: inputs.projectName,
    slug: inputs.slug,
    description: '（待主理人补充项目描述）',
    initializedAt: new Date().toISOString(),
    initialStage: inputs.stage,
    actorId: randomBytes(16).toString('hex'),
    sessionId: randomBytes(16).toString('hex'),
  };
  const bundle = buildContractBundle(seed);

  // R-06：pm/ 目录已存在（含同名文件）→ 全部拒绝；幂等重跑同样拒绝（提示已初始化）
  const pmDir = join(cwd, 'pm');
  if (existsSync(pmDir)) {
    io.err(`拒绝初始化：${pmDir} 已存在（R-06 不覆盖，绝不写入或修改既有文件）。`);
    io.err('若为重复执行：本项目疑似已初始化——幂等重跑同样拒绝。');
    io.err('如确需重建，请由主理人人工处理现有 pm/ 目录（本命令不做任何删除动作，W-03）。');
    return 2;
  }
  try {
    mkdirSync(pmDir, { recursive: true });
  } catch (error) {
    io.err(`创建 pm/ 目录失败：${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  // 逐文件写、写前逐文件存在性检查：任一已存在 → 立即中止；
  // 已写入的本次文件保留并列出（不回滚删除——W-03），如实报告（W-06）
  const written: string[] = [];
  for (const file of BUNDLE_FILE_ORDER) {
    const target = join(pmDir, file);
    if (existsSync(target)) {
      io.err(`拒绝覆盖：pm/${file} 已存在（R-06 不覆盖）——本次初始化立即中止。`);
      if (written.length > 0) {
        io.err('本次已写入的文件（按 W-03 保留、不回滚删除，请人工核查）：');
        for (const w of written) io.err(`  ${w}`);
      } else {
        io.err('本次尚未写入任何文件。');
      }
      return 2;
    }
    try {
      writeFileSync(target, bundle[file], 'utf8');
    } catch (error) {
      io.err(`写入 pm/${file} 失败：${error instanceof Error ? error.message : String(error)}——本次初始化中止。`);
      io.err('本次已写入的文件（保留，请人工核查）：');
      for (const w of written) io.err(`  ${w}`);
      return 2;
    }
    written.push(`pm/${file}`);
  }

  io.out(`初始化完成：${pmDir}（契约模板 v${TEMPLATE_VERSION}）`);
  for (const w of written) io.out(`  ${w}`);
  io.out(`初始阶段：${inputs.stage}（当前阶段由事件折叠派生，不落 project.md——D-24）`);
  io.out('首笔事件：project.initialized 已写入 pm/changelog.md。');
  io.out('下一步：gatedeck deck 查看决策台');
  return 0;
}
