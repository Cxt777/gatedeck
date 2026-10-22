/**
 * 乐观并发写入：内容 hash compare-and-set（T-M0b-03；基准 P-06 / B-1）。
 *
 * 设计要点：
 *  - **版本 = 真实字节的 SHA-256**（UTF-8），不是 mtime/大小/行数：任何一字节差异
 *    （含 CRLF、尾换行、中文）都会改变 hash，避免"看起来没变"的覆盖；
 *  - **两段式 API 强制先读后写**：调用方必须先读取磁盘字节得到 `ContentVersion`，
 *    再把该 hash 作为 `expectedHash` 提交；core 不做 IO、不自行取时钟或路径状态；
 *  - **失败不返回新文本**：`content-hash-mismatch` 时结果对象里没有 `nextContent`，
 *    结构上杜绝调用方误把旧基线生成的内容写回（B-1「不覆盖他人修改」）；
 *  - **诚实边界**：只承诺受管写路径的检测与拒绝，不承诺对任意编辑器零丢失
 *    （基准 F-05 同口径）。
 *
 * 纯字符串计算，无 IO（core 纯度约束）。
 */

import { sha256HexBytes } from './hash.js';

const utf8 = new TextEncoder();

/** 内容版本：权威判据是 contentHash，byteLength 仅用于展示与粗检 */
export interface ContentVersion {
  contentHash: string;
  /** UTF-8 字节长度（与磁盘字节数一致，可作展示/粗检辅助） */
  byteLength: number;
}

/** 计算文本的内容版本 */
export function contentVersion(text: string): ContentVersion {
  const bytes = utf8.encode(text);
  return { contentHash: sha256HexBytes(bytes), byteLength: bytes.length };
}

const HASH_RE = /^[0-9a-f]{64}$/;

/** 归一化外部传入的 hash（容忍首尾空白与大写）；形态非法返回 null */
export function normalizeContentHash(hash: string): string | null {
  const normalized = hash.trim().toLowerCase();
  return HASH_RE.test(normalized) ? normalized : null;
}

export interface CasWriteRequest {
  /** 调用方读取文件时得到的版本 hash */
  expectedHash: string;
  /** 基于该基线生成的完整新内容 */
  nextContent: string;
}

export type CasWriteFailureCode = 'content-hash-mismatch' | 'invalid-expected-hash';

export type CasWriteResult =
  | {
      ok: true;
      /** 提交时的基线版本（等于磁盘实际版本） */
      base: ContentVersion;
      /** 写入后版本 */
      next: ContentVersion;
      nextContent: string;
    }
  | {
      ok: false;
      code: CasWriteFailureCode;
      message: string;
      /** 磁盘实际版本（供重读比对） */
      actual: ContentVersion;
      /** 归一化后的期望 hash；形态非法时为 null */
      expectedHash: string | null;
    };

/**
 * 内容 hash compare-and-set：
 * 仅当 `expectedHash` 与 `currentContent` 的真实字节 hash 一致时才返回可写入结果。
 *
 * 失败语义（B-1）：
 *  - `content-hash-mismatch`：磁盘内容已被他人修改 → 拒绝写入，提示重读重试；
 *  - `invalid-expected-hash`：调用方传入的基线 hash 形态非法 → 拒绝，避免"空基线"绕过检测。
 */
export function compareAndSet(currentContent: string, request: CasWriteRequest): CasWriteResult {
  const actual = contentVersion(currentContent);
  const expected = normalizeContentHash(request.expectedHash);
  if (expected === null) {
    return {
      ok: false,
      code: 'invalid-expected-hash',
      message:
        '写入拒绝（P-06）：expectedHash 不是 64 位十六进制 SHA-256，无法作为基线；请先读取文件取得真实字节 hash 后重试。',
      actual,
      expectedHash: null,
    };
  }
  if (expected !== actual.contentHash) {
    return {
      ok: false,
      code: 'content-hash-mismatch',
      message:
        `写入拒绝（P-06/B-1）：基线 hash ${expected.slice(0, 12)}… 与磁盘实际 ${actual.contentHash.slice(0, 12)}… 不一致，` +
        '内容已被其他写入方修改。请重读文件、基于最新字节重新生成修改后重试；本次不写入、不覆盖他人修改。',
      actual,
      expectedHash: expected,
    };
  }
  return {
    ok: true,
    base: actual,
    next: contentVersion(request.nextContent),
    nextContent: request.nextContent,
  };
}

/**
 * 对外诚实边界声明（T-M0b-03 acceptance：不承诺任意编辑器零丢失）。
 * 展示层/文档引用此常量，避免各端措辞漂移。
 */
export const WRITE_GUARANTEE_NOTICE =
  '受管写路径按真实字节 hash 做乐观版本检测：基线不一致即拒绝并提示重读重试，不覆盖他人修改。' +
  '受管写路径之外、且不在本工具观察范围内的任意编辑器改动，本工具不承诺零丢失；' +
  '只承诺可检测（指纹比对）与如实标注（P-05 / P-08）。';
