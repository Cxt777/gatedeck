import { describe, expect, it } from 'vitest';

import {
  compareAndSet,
  contentVersion,
  normalizeContentHash,
  WRITE_GUARANTEE_NOTICE,
} from './optimisticWrite.js';
import { sha256Hex } from './hash.js';

const BASE = '# 项目\n\n```gatedeck-task\nid: T-A\nstatus: todo\n```\n';

describe('T-M0b-03 · 内容版本（真实字节 hash）', () => {
  it('hash 与 sha256Hex 同源：同一文本得到同一 64 位 hex', () => {
    const v = contentVersion(BASE);
    expect(v.contentHash).toBe(sha256Hex(BASE));
    expect(v.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('byteLength 按 UTF-8 字节计（中文 3 字节），不是字符数', () => {
    expect(contentVersion('a').byteLength).toBe(1);
    expect(contentVersion('中').byteLength).toBe(3);
    expect(contentVersion('中').byteLength).not.toBe('中'.length);
  });

  it('逐字节敏感：CRLF、尾换行、单个空格差异都会改变 hash', () => {
    const base = contentVersion(BASE).contentHash;
    expect(contentVersion(BASE.replace(/\n/g, '\r\n')).contentHash).not.toBe(base);
    expect(contentVersion(BASE + '\n').contentHash).not.toBe(base);
    expect(contentVersion(BASE.replace('status: todo', 'status: todo ')).contentHash).not.toBe(base);
    expect(contentVersion(BASE.replace('todo', 'done')).contentHash).not.toBe(base);
  });

  it('hash 归一化容忍大小写与空白；非法形态返回 null', () => {
    const h = sha256Hex('x');
    expect(normalizeContentHash(`  ${h.toUpperCase()} `)).toBe(h);
    expect(normalizeContentHash('abc')).toBeNull();
    expect(normalizeContentHash('z'.repeat(64))).toBeNull();
  });
});

describe('T-M0b-03 · compare-and-set（B-1）', () => {
  it('基线一致 → 返回 base/next 版本与新文本', () => {
    const base = contentVersion(BASE);
    const nextContent = BASE.replace('todo', 'done');
    const r = compareAndSet(BASE, { expectedHash: base.contentHash, nextContent });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.base).toEqual(base);
    expect(r.next.contentHash).toBe(sha256Hex(nextContent));
    expect(r.nextContent).toBe(nextContent);
  });

  it('B-1 他人并发修改后提交旧基线 → 拒绝、不返回新文本、提示重读重试', () => {
    const staleBase = contentVersion(BASE);
    // 另一写入方先改了文件
    const current = BASE.replace('status: todo', 'status: doing');
    const r = compareAndSet(current, {
      expectedHash: staleBase.contentHash,
      nextContent: BASE.replace('status: todo', 'status: done'),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('content-hash-mismatch');
    expect(r.actual.contentHash).toBe(sha256Hex(current));
    expect(r.actual.contentHash).not.toBe(staleBase.contentHash);
    expect(r.message).toContain('重读');
    // 结构上不携带新文本，调用方无法误写
    expect('nextContent' in r).toBe(false);
  });

  it('B-1 重读后以新基线重试 → 成功，且只覆盖已确认的当前内容', () => {
    const current = BASE.replace('status: todo', 'status: doing');
    const retry = compareAndSet(current, {
      expectedHash: contentVersion(current).contentHash,
      nextContent: current.replace('status: doing', 'status: done'),
    });
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.nextContent).toContain('status: done');
    expect(retry.nextContent).not.toContain('status: doing');
  });

  it('空基线/非法 hash → invalid-expected-hash 拒绝，不当作"无并发"放行', () => {
    for (const expectedHash of ['', '   ', 'NOT-A-HASH', 'a'.repeat(63)]) {
      const r = compareAndSet(BASE, { expectedHash, nextContent: 'x' });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.code).toBe('invalid-expected-hash');
      expect(r.expectedHash).toBeNull();
      expect('nextContent' in r).toBe(false);
    }
  });

  it('空文件也有确定版本，可从空基线创建内容', () => {
    const r = compareAndSet('', {
      expectedHash: contentVersion('').contentHash,
      nextContent: BASE,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.base.byteLength).toBe(0);
    expect(r.next.byteLength).toBe(contentVersion(BASE).byteLength);
  });

  it('等价输入（同字节）即通过：hash 判据不含时间/路径元数据', () => {
    const r = compareAndSet(BASE, {
      expectedHash: contentVersion(BASE).contentHash,
      nextContent: BASE,
    });
    expect(r.ok).toBe(true);
  });

  it('诚实边界声明包含"不承诺零丢失"与"可检测"两句（对外文案不可漂移）', () => {
    expect(WRITE_GUARANTEE_NOTICE).toContain('不承诺零丢失');
    expect(WRITE_GUARANTEE_NOTICE).toContain('可检测');
    expect(WRITE_GUARANTEE_NOTICE).toContain('不覆盖他人修改');
  });
});
