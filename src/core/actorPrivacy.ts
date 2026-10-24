/**
 * 归因隐私最小落地（T-M1-11 / W-S2-8；D-19）。
 *
 * 三条验收口径：
 *   1. actor_id/session_id 为**本地生成的不透明随机 ID**——本模块只定义形态约定与校验，
 *      随机数生成一律在壳层（core 纯度：无 IO、无随机源）；
 *   2. 不记录邮箱/用户名/对话文本——isOpaqueId / checkActorId / checkSessionId 拒绝
 *      邮箱样与常见用户名样取值；scanForPrivacyLeaks 对自由文本（如人类说明）做泄漏
 *      可见性扫描（供 lint/展示层告警，不阻断；对话文本不落盘由壳层负责）；
 *   3. 不作身份认证——形态校验只影响归因统计的数据质量，绝不作为身份凭据或权限依据。
 *
 * 消息策略：check* 的 message 不回显被检 ID 本身——若 ID 疑似邮箱/用户名，回显会把
 * 泄漏再写进诊断日志；scanForPrivacyLeaks 的 findings 回显命中片段便于定位，仅供
 * 本地展示层使用，不应被持久化或上报（本地优先）。
 *
 * 与 eventEnvelope 的关系：信封层（buildEnvelope）当前对 actor_id/session_id 仅校验
 * 「必填非空字符串」（eventEnvelope.ts:237-244），不透明形态校验尚未接入；差距分析与
 * 建议落点见任务 notes（本任务红线：不改既有文件）。
 *
 * 纯字符串计算，无 IO（core 纯度约束）。
 */

/**
 * actor_id 形态约定：8~32 位字母/数字（hex/ULID 风格；26 位 ULID Crockford Base32
 * 大小写不敏感可直接通过）。**形态约定而非身份**：仅约束取值「长得像」不透明随机 ID，
 * 不承载任何身份语义，也不作认证依据（D-19）。
 */
export const ACTOR_ID_PATTERN = /^[a-z0-9]{8,32}$/i;

/**
 * session_id 形态约定：8~48 位字母/数字/连字符（hex/ULID/UUID 风格）。
 * **形态约定而非身份**：仅形态校验，不承载身份语义，也不作认证依据（D-19）。
 */
export const SESSION_ID_PATTERN = /^[a-z0-9-]{8,48}$/i;

/** 归因隐私须知（中文常量，供 CLI/Web 展示层直接引用） */
export const ACTOR_PRIVACY_NOTICE =
  'actor_id/session_id 为本地生成的不透明随机 ID，仅用于归因统计；不记录邮箱/用户名/对话文本；不作身份认证；不离开本机（本地优先）';

/** 常见用户名黑名单：不区分大小写的**精确匹配**（前缀/模糊匹配属后续加固，不在本最小落地范围） */
const USERNAME_BLACKLIST: readonly string[] = ['admin', 'root', 'user', 'test'];

/** 长度分档下界（须与两条 pattern 的 {8,...} 下界一致；由一致性测试守住） */
const OPAQUE_ID_MIN_LENGTH = 8;
/** actor_id 长度上界（须与 ACTOR_ID_PATTERN 的 {...,32} 上界一致） */
const ACTOR_ID_MAX_LENGTH = 32;
/** session_id 长度上界（须与 SESSION_ID_PATTERN 的 {...,48} 上界一致） */
const SESSION_ID_MAX_LENGTH = 48;

/** 归因 ID 检查结果：reason 细分拒绝原因；message 为中文说明（不回显被检 ID 本身） */
export type ActorIdCheck = {
  ok: boolean;
  reason?: 'not-opaque' | 'email-like' | 'username-like' | 'too-short' | 'too-long';
  message: string;
};

function isUsernameLike(id: string): boolean {
  return USERNAME_BLACKLIST.includes(id.toLowerCase());
}

/**
 * 不透明随机 ID 判定（actor_id/session_id 通用规则核）：
 * 同时满足 ① 匹配 ACTOR_ID_PATTERN 或 SESSION_ID_PATTERN 之一（不透明形态）；
 * ② 不含「@」（邮箱特征）；③ 不命中常见用户名黑名单（不区分大小写精确匹配）。
 * 注意：这是**形态**判定而非身份判定，通过与否均不作认证依据（D-19）。
 */
export function isOpaqueId(id: string): boolean {
  if (id.includes('@')) return false;
  if (isUsernameLike(id)) return false;
  return ACTOR_ID_PATTERN.test(id) || SESSION_ID_PATTERN.test(id);
}

/**
 * 共享校验核，拒绝原因细分优先级：
 * email-like（含「@」）→ username-like（黑名单）→ too-short / too-long（长度分档）→
 * not-opaque（长度合轨但字符集不符）。
 * 黑名单先于长度：'admin'/'Root' 这类短用户名应报 username-like 而非 too-short。
 */
function checkOpaqueId(kind: 'actor_id' | 'session_id', id: string, pattern: RegExp, maxLength: number): ActorIdCheck {
  if (id.includes('@')) {
    return { ok: false, reason: 'email-like', message: `${kind} 含「@」，疑似邮箱地址，违反 D-19（归因 ID 不记录邮箱）` };
  }
  if (isUsernameLike(id)) {
    return { ok: false, reason: 'username-like', message: `${kind} 命中常见用户名黑名单（admin/root/user/test，不区分大小写），违反 D-19（归因 ID 不记录用户名）` };
  }
  if (id.length < OPAQUE_ID_MIN_LENGTH) {
    return { ok: false, reason: 'too-short', message: `${kind} 长度 ${id.length} 低于不透明随机 ID 最短 ${OPAQUE_ID_MIN_LENGTH} 位` };
  }
  if (id.length > maxLength) {
    return { ok: false, reason: 'too-long', message: `${kind} 长度 ${id.length} 超过形态约定上限 ${maxLength} 位` };
  }
  if (!pattern.test(id)) {
    return { ok: false, reason: 'not-opaque', message: `${kind} 含形态约定之外的字符（actor_id 仅限字母/数字，session_id 另允许连字符），不是不透明随机 ID 形态` };
  }
  return { ok: true, message: `${kind} 符合本地不透明随机 ID 形态约定（仅形态校验，非身份，不作认证）` };
}

/** 校验 actor_id：细分拒绝原因 + 中文 message（消息不回显 ID 本身） */
export function checkActorId(actorId: string): ActorIdCheck {
  return checkOpaqueId('actor_id', actorId, ACTOR_ID_PATTERN, ACTOR_ID_MAX_LENGTH);
}

/** 校验 session_id：同规则复用（同一黑名单与原因细分，仅形态上界与连字符规则不同） */
export function checkSessionId(sessionId: string): ActorIdCheck {
  return checkOpaqueId('session_id', sessionId, SESSION_ID_PATTERN, SESSION_ID_MAX_LENGTH);
}

/** 疑似邮箱（启发式，供本地告警；不做严格 RFC 5322 校验） */
const EMAIL_LIKE_PATTERN = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

/** 明显用户名字段前缀：user: / username: / email:（兼容全角冒号） */
const USERNAME_FIELD_PREFIX_PATTERN = /\b(?:user|username|email)\s*[:：]/gi;

/**
 * 自由文本（如事件块外的人类说明）泄漏扫描：命中疑似邮箱或明显用户名字段前缀即列入
 * findings。供 lint/展示层告警用——**不阻断**（自由文本不做硬校验，但要有可见性）。
 * findings 回显命中片段便于定位，仅供本地展示，不应被持久化或上报（本地优先）。
 */
export function scanForPrivacyLeaks(freeText: string): { clean: boolean; findings: string[] } {
  const findings: string[] = [];
  for (const m of freeText.matchAll(EMAIL_LIKE_PATTERN)) {
    findings.push(`疑似邮箱地址：「${m[0]!}」（位置 ${m.index ?? 0}）——人类说明不应记录邮箱（D-19）`);
  }
  for (const m of freeText.matchAll(USERNAME_FIELD_PREFIX_PATTERN)) {
    findings.push(`疑似用户名/邮箱字段前缀：「${m[0]!.trimEnd()}」（位置 ${m.index ?? 0}）——人类说明不应携带用户名字段（D-19）`);
  }
  return { clean: findings.length === 0, findings };
}
