/**
 * gatedeck adopt —— 把候选项目显式收编入 native 注册表（T-M1-02 / W-S2-2）。
 *
 * 写边界（仅此两处，均在 cwd/.gatedeck/ 内）：
 *  - registry.md：append-only 登记（R-02）——已存在则走 core appendNativeRegistryEntry
 *    在表尾追加一行、既有字节不动；不存在才用 serializeNativeRegistry 首次创建
 *    （该函数的文档口径即「首次创建用」）；存在但无登记表则拒绝重建，绝不覆盖；
 *  - registry.local.md：机器本地绑定（binding_key + locator，B-14）——locator 记录
 *    项目路径，供后续 discover 标注「在线/离线」（路径失效显示「离线」不静默移除，R-08）。
 *
 * 重复登记拒绝口径与 core registry 模块一致（append-only，不覆盖）；随机性
 * （workspace_id ULID / binding_key）由 deps 注入，core 不取随机（core 纯度约束）。
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { classifyCandidates, type ScannedPath } from '../../core/discoverRules.js';
import {
  appendNativeRegistryEntry,
  parseNativeRegistry,
  parseNativeRegistryLocal,
  serializeNativeRegistry,
  serializeNativeRegistryLocal,
  type NativeLocalEntry,
  type NativeRegistryEntry,
} from '../../core/registry.js';
import type { CliIo } from '../index.js';
import { probeSignals, toPosix } from './discover.js';

export interface AdoptDeps {
  /** 工作区根（注册表所在），默认 process.cwd() */
  cwd: string;
  /** 登记时间（registered_at / observed_at 用） */
  now: () => Date;
  /** workspace_id ULID 生成（随机性由壳层注入） */
  ulid: () => string;
  /** binding_key 生成（不透明随机串，仅存 registry.local.md） */
  bindingKey: () => string;
}

const DEFAULT_DEPS: AdoptDeps = {
  cwd: process.cwd(),
  now: () => new Date(),
  ulid: () => generateUlid(Date.now(), (n) => randomBytes(n)),
  bindingKey: () => randomBytes(16).toString('hex'),
};

/** ULID 字母表（Crockford Base32，剔除 I/L/O/U） */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * 生成 ULID：10 字符 48 位毫秒时间戳 + 16 字符 80 位随机段 = 26 字符大写。
 * 满足 core isUlid 校验；随机源可注入（默认 crypto.randomBytes）。
 */
export function generateUlid(timeMs: number, random: (bytes: number) => Uint8Array = (n) => randomBytes(n)): string {
  const MAX48 = (1n << 48n) - 1n;
  let t = BigInt(Math.trunc(timeMs));
  if (t < 0n) t = 0n;
  if (t > MAX48) t = MAX48;
  let timePart = '';
  for (let i = 0; i < 10; i++) {
    timePart = CROCKFORD[Number(t & 31n)]! + timePart;
    t >>= 5n;
  }
  const bytes = random(10); // 80 bit 随机段
  let r = 0n;
  for (const b of bytes) r = (r << 8n) | BigInt(b);
  let randPart = '';
  for (let i = 0; i < 16; i++) {
    randPart = CROCKFORD[Number(r & 31n)]! + randPart;
    r >>= 5n;
  }
  return timePart + randPart;
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 展示用路径：cwd 内 → 「./相对路径」；cwd 外 → 绝对路径（posix 形态） */
function displayPath(cwd: string, abs: string): string {
  const rel = toPosix(path.relative(cwd, abs));
  if (rel === '') return '.';
  if (rel.startsWith('..')) return toPosix(abs);
  return `./${rel}`;
}

/**
 * adopt 命令入口。返回进程退出码：0 = 登记成功；2 = 用法错误 / 路径无效 /
 * 非候选 / 重复登记 / 注册表缺陷或写入失败（全部中文报错，如实拒绝不静默）。
 */
export function runAdopt(argv: readonly string[], io: CliIo, deps: AdoptDeps = DEFAULT_DEPS): number {
  if (argv.length === 0) {
    io.err('用法：gatedeck adopt <path>');
    io.err('拒绝执行：未指定 <path>——收编是显式动作，必须指明目标项目目录。');
    return 2;
  }
  if (argv.length > 1) {
    io.err(`拒绝执行：gatedeck adopt 仅接受一个 <path> 参数，实际收到 ${argv.length} 个。`);
    return 2;
  }
  const targetArg = argv[0]!;
  const abs = path.resolve(deps.cwd, targetArg);

  /* 1. 路径存在性校验（不存在 → 中文报错 exit 2） */
  let isDir = false;
  try {
    isDir = statSync(abs).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    io.err(`路径不存在或不是目录：${targetArg}（解析为 ${toPosix(abs)}）`);
    io.err('拒绝收编：目标必须真实存在的目录。可先运行 gatedeck discover 查看候选预览。');
    return 2;
  }

  /* 2. 候选校验（与 discover 同源的 core 判定：三信号至少其一，宁缺勿滥） */
  const observed: ScannedPath = { path: toPosix(abs), exists: probeSignals(abs) };
  const candidate = classifyCandidates([observed])[0];
  if (candidate === undefined) {
    io.err(`非候选项目：${displayPath(deps.cwd, abs)} 未命中任何候选信号（pm/ 目录、PROJECTS-INDEX.md、pm/wbs.md）。`);
    io.err('拒绝收编：adopt 与 discover 的候选判定同源，非候选不入册。');
    return 2;
  }

  /* 3. 只读解析现有注册表（先只读、后追加；缺陷不追加，R-02 append-only） */
  const deckDir = path.join(deps.cwd, '.gatedeck');
  const registryPath = path.join(deckDir, 'registry.md');
  const localPath = path.join(deckDir, 'registry.local.md');

  let baseRegistryMd: string | null = null; // null = 文件不存在
  if (existsSync(registryPath)) {
    try {
      baseRegistryMd = readFileSync(registryPath, 'utf8');
    } catch (e) {
      io.err(`registry.md 读取失败：${errMessage(e)}`);
      return 2;
    }
    const parsed = parseNativeRegistry(baseRegistryMd);
    const fatal = parsed.diagnostics.filter((d) => d.code !== 'column-count-mismatch');
    if (fatal.length > 0) {
      io.err(`registry.md 现有内容存在结构性缺陷，拒绝在其上追加：${fatal.map((d) => d.message).join('；')}`);
      return 2;
    }
    if (parsed.entries.some((e) => e.project_id === toPosix(path.relative(deps.cwd, abs)))) {
      io.err(
        `重复登记：project_id=${toPosix(path.relative(deps.cwd, abs))} 已存在（append-only 登记，不覆盖；R-02）。`,
      );
      return 2;
    }
  }

  const rel = toPosix(path.relative(deps.cwd, abs));
  const locator = rel === '' ? '.' : rel;

  let baseLocalEntries: NativeLocalEntry[] | null = null; // null = 文件不存在
  if (existsSync(localPath)) {
    let localMd: string;
    try {
      localMd = readFileSync(localPath, 'utf8');
    } catch (e) {
      io.err(`registry.local.md 读取失败：${errMessage(e)}`);
      return 2;
    }
    const parsedLocal = parseNativeRegistryLocal(localMd);
    if (parsedLocal.diagnostics.length > 0) {
      io.err(
        `registry.local.md 存在解析诊断，拒绝重写（避免丢弃无法解析的行）：${parsedLocal.diagnostics
          .map((d) => d.message)
          .join('；')}`,
      );
      return 2;
    }
    baseLocalEntries = parsedLocal.entries;
    const sameLocator = parsedLocal.entries.find((e) => e.locator.trim().replace(/\\/g, '/') === locator);
    if (sameLocator !== undefined) {
      io.err(
        `重复登记：locator=${locator} 已登记（workspace_id=${sameLocator.workspace_id}）——append-only 登记，不覆盖。`,
      );
      return 2;
    }
  }

  /* 4. 组装登记条目（随机性全部来自 deps 注入） */
  const registeredAt = deps.now().toISOString(); // Z 后缀，满足带时区 ISO 8601 校验
  const entry: NativeRegistryEntry = {
    project_id: locator,
    workspace_id: deps.ulid(),
    slug: path.basename(abs),
    display_name: path.basename(abs),
    managed: true,
    registered_at: registeredAt,
  };
  const localEntry: NativeLocalEntry = {
    workspace_id: entry.workspace_id,
    binding_key: deps.bindingKey(),
    locator,
    observed_at: registeredAt,
  };

  let newRegistryMd: string;
  if (baseRegistryMd === null) {
    newRegistryMd = serializeNativeRegistry([entry]); // 首次创建（serializeNativeRegistry 的文档口径）
  } else {
    try {
      newRegistryMd = appendNativeRegistryEntry(baseRegistryMd, entry); // 表尾追加一行，既有字节不动
    } catch (e) {
      io.err(`登记被拒绝（core append-only 守卫）：${errMessage(e)}`);
      return 2;
    }
  }
  const newLocalMd = serializeNativeRegistryLocal(
    baseLocalEntries === null ? [localEntry] : [...baseLocalEntries, localEntry],
  );

  /* 5. 落盘（adopt 是写命令；discover 永不走到这里） */
  try {
    mkdirSync(deckDir, { recursive: true });
    writeFileSync(registryPath, newRegistryMd, 'utf8');
  } catch (e) {
    io.err(`registry.md 写入失败：${errMessage(e)}`);
    return 2;
  }
  try {
    writeFileSync(localPath, newLocalMd, 'utf8');
  } catch (e) {
    io.err(`注意：registry.md 已完成登记（project_id=${entry.project_id}），但 registry.local.md 写入失败：${errMessage(e)}`);
    io.err('本地绑定缺失不影响登记本身；请检查 .gatedeck/ 目录权限后人工补写或重试。');
    return 2;
  }

  /* 6. 输出登记结果 */
  io.out('已收编登记（native provider · append-only，R-02）：');
  io.out(`  项目路径:       ${displayPath(deps.cwd, abs)}`);
  io.out(`  命中信号:       ${candidate.signals.join('、')}`);
  io.out(`  project_id:     ${entry.project_id}`);
  io.out(`  workspace_id:   ${entry.workspace_id}（ULID，不随目录移动改变，B-14）`);
  io.out(`  slug:           ${entry.slug}`);
  io.out(`  display_name:   ${entry.display_name}`);
  io.out(`  managed:        true`);
  io.out(`  registered_at:  ${entry.registered_at}`);
  io.out(`  locator:        ${localEntry.locator}（写入 .gatedeck/registry.local.md，机器本地）`);
  io.out('写入文件：');
  io.out(`  .gatedeck/registry.md（${baseRegistryMd === null ? '首次创建并登记 1 行' : '表尾追加登记行 1 行，既有字节未动'}）`);
  io.out(`  .gatedeck/registry.local.md（${baseLocalEntries === null ? '新建本地绑定 1 行' : '追加本地绑定 1 行'}）`);
  io.out('提示：项目路径失效时 discover 将显示「离线」，不会静默移除（R-08）。');
  return 0;
}
