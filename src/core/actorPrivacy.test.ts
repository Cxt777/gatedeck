import { describe, expect, it } from 'vitest';

import {
  ACTOR_ID_PATTERN,
  ACTOR_PRIVACY_NOTICE,
  SESSION_ID_PATTERN,
  checkActorId,
  checkSessionId,
  isOpaqueId,
  scanForPrivacyLeaks,
} from './actorPrivacy.js';

/** 60 位纯字母数字样本，供切片构造各长度用例（不含黑名单词与「@」） */
const ALNUM_60 = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6';

describe('归因隐私：不透明 ID 形态校验（T-M1-11 / W-S2-8）', () => {
  it('合法 hex 形态 actor_id 通过：isOpaqueId 与 checkActorId 均通过', () => {
    const id = 'a1b2c3d4e5f60718';
    expect(ACTOR_ID_PATTERN.test(id)).toBe(true);
    expect(isOpaqueId(id)).toBe(true);
    const c = checkActorId(id);
    expect(c.ok).toBe(true);
    expect(c.reason).toBeUndefined();
    expect(c.message.length).toBeGreaterThan(0);
  });

  it('合法 ULID 形态 actor_id 通过（大小写不敏感）', () => {
    expect(isOpaqueId('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true);
    expect(checkActorId('01ARZ3NDEKTSV4RRFFQ69G5FAV').ok).toBe(true);
    expect(checkActorId('01arz3ndektsv4rrffq69g5fav').ok).toBe(true);
  });

  it('合法 UUID 连字符形态 session_id 通过：checkSessionId 复用同规则', () => {
    const sid = '3f9c2e1a-7b4d-4c8e-9f0a-1b2c3d4e5f60';
    expect(SESSION_ID_PATTERN.test(sid)).toBe(true);
    expect(isOpaqueId(sid)).toBe(true);
    const c = checkSessionId(sid);
    expect(c.ok).toBe(true);
    expect(c.reason).toBeUndefined();
  });

  it('边界长度通过：8/32 位 actor_id 与 48 位 session_id', () => {
    expect(checkActorId('a1b2c3d4').ok).toBe(true); // 8 位下界
    expect(checkActorId('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4').ok).toBe(true); // 32 位上界
    expect(checkSessionId('a'.repeat(48)).ok).toBe(true); // 48 位上界
    expect(checkSessionId('a1b2c3d4').ok).toBe(true); // actor 形态对 session 同样合法
  });

  it('邮箱样 ID 拒绝（email-like），且消息不回显 ID 本身', () => {
    const id = 'zhangsan@example.com';
    expect(isOpaqueId(id)).toBe(false);
    const a = checkActorId(id);
    expect(a.ok).toBe(false);
    expect(a.reason).toBe('email-like');
    expect(a.message).not.toContain(id); // 防止把疑似邮箱再写进诊断日志
    expect(checkSessionId(id).reason).toBe('email-like');
  });

  it('常见用户名拒绝（不区分大小写）：reason=username-like', () => {
    expect(checkActorId('admin').reason).toBe('username-like');
    expect(checkActorId('Root').reason).toBe('username-like');
    expect(checkSessionId('Test').reason).toBe('username-like');
    expect(isOpaqueId('ADMIN')).toBe(false);
    expect(isOpaqueId('User')).toBe(false);
  });

  it('过短/过长拒绝：reason=too-short / too-long', () => {
    expect(checkActorId('ab12').reason).toBe('too-short');
    expect(checkSessionId('').reason).toBe('too-short');
    expect(checkActorId('a'.repeat(33)).reason).toBe('too-long'); // actor 上界 32
    expect(checkSessionId('a'.repeat(33)).ok).toBe(true); // 同值对 session 仍在 48 上界内
    expect(checkSessionId('a'.repeat(49)).reason).toBe('too-long');
  });

  it('形态不符拒绝（not-opaque）：下划线/空格/中文/actor 含连字符', () => {
    expect(checkActorId('user_1234').reason).toBe('not-opaque'); // 下划线不在字符集
    expect(checkActorId('a b123456').reason).toBe('not-opaque'); // 空白
    expect(checkActorId('用户标识0001').reason).toBe('not-opaque'); // 中文
    expect(checkActorId('session-abc').reason).toBe('not-opaque'); // actor_id 不允许连字符
  });

  it('长度分档与 pattern 双口径一致：1..60 位逐长度比对（防上界漂移）', () => {
    for (let len = 1; len <= 60; len++) {
      const id = ALNUM_60.slice(0, len);
      expect(checkActorId(id).ok).toBe(ACTOR_ID_PATTERN.test(id));
      expect(checkSessionId(id).ok).toBe(SESSION_ID_PATTERN.test(id));
    }
  });

  it('isOpaqueId 为双 pattern 并集语义：session 形态对 checkActorId 不通过', () => {
    const sid = 'sess-abcd-1234';
    expect(isOpaqueId(sid)).toBe(true); // 命中 SESSION_ID_PATTERN
    expect(checkActorId(sid).ok).toBe(false); // 但不符合 actor_id 形态约定
  });
});

describe('归因隐私：自由文本泄漏扫描与须知', () => {
  it('含邮箱的自由文本命中：clean=false，findings 指明疑似邮箱', () => {
    const r = scanForPrivacyLeaks('有疑问请联系 zhangsan@example.com 处理。');
    expect(r.clean).toBe(false);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toContain('邮箱');
  });

  it('干净文本通过：clean=true 且 findings 为空（合法 ULID 也不误报）', () => {
    expect(scanForPrivacyLeaks('本次仅调整门禁顺序，事件块字节不变。')).toEqual({ clean: true, findings: [] });
    expect(scanForPrivacyLeaks('事件 actor_id 为 01ARZ3NDEKTSV4RRFFQ69G5FAV，形态合规。')).toEqual({ clean: true, findings: [] });
  });

  it('user:/username:/email: 前缀命中；前缀与邮箱同现时分别列出', () => {
    const e = scanForPrivacyLeaks('email: someone');
    expect(e.clean).toBe(false);
    expect(e.findings[0]).toContain('email');
    const u = scanForPrivacyLeaks('username: 张三');
    expect(u.clean).toBe(false);
    expect(u.findings[0]).toContain('username');
    const both = scanForPrivacyLeaks('email: zhangsan@example.com');
    expect(both.findings).toHaveLength(2); // 前缀 1 条 + 邮箱 1 条
  });

  it('ACTOR_PRIVACY_NOTICE 非空且覆盖四条关键口径', () => {
    expect(ACTOR_PRIVACY_NOTICE.length).toBeGreaterThan(0);
    expect(ACTOR_PRIVACY_NOTICE).toContain('不透明随机 ID');
    expect(ACTOR_PRIVACY_NOTICE).toContain('不记录邮箱');
    expect(ACTOR_PRIVACY_NOTICE).toContain('不作身份认证');
    expect(ACTOR_PRIVACY_NOTICE).toContain('本地');
  });
});
