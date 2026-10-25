/**
 * MCP 工具注册表中心（W-S3-1 / T-M1-08；基准 MOD-06 十五工具全集 / B-4 / B-17）。
 *
 * 本文件是 **gatedeck-mcp 全部 15 个工具名单与描述的唯一事实源**：
 *  - 读 7：list_projects / get_overview / get_wbs / get_task / list_gates / query / get_report；
 *  - 写 3：create_task / update_task / move_task（MOD-06 权威名单；写操作全走 core 校验层）；
 *  - 门禁/推进 2：check_gate / request_promotion；
 *  - 类型化事件动作 3：record_note / submit_evidence / report_usage。
 *
 * 红线编码（B-4/B-17，server 装配自检 + allowlist.test.ts CI 机器守卫双重保险）：
 *  - **不得**包含 `pass_gate`：门禁开启是项目负责人人工动作，AI 不得代开（R-03）；
 *  - **不得**包含 `append_changelog` 或任何通用事件追加工具：事件只能由类型化动作产生，
 *    MCP 永不提供「直接写事件」的通道（R-09 事件权威性）；
 *  - request_promotion 只产生 `authorization.requested`（绝不产生 authorization.granted/
 *    locally_confirmed）；submit_evidence 只产生待验 `evidence.submitted`（绝不产生
 *    check.completed/task.transitioned）；record_note 只产生非权威 `note` 事件；
 *    kind×origin 兼容矩阵由 src/core/eventEnvelope.ts schema 层编码（origin=managed-api）。
 *
 * 本阶段（W-S3-1/2）先定义全量名单，读 7 handler 同步注册；写 3 + 门禁 2 + 事件 3 的
 * handler 由后续阶段（W-S3-2 后半 / W-S3-3）按本名单注册，描述文字即对外契约。
 */

/** 单个工具的名单条目（name 唯一；description 为对 MCP 客户端展示的对外契约） */
export interface ToolDef {
  name: string;
  description: string;
}

/** B-4/B-17 永久禁止出现在注册表中的工具名（与名单是否包含无关，一律拒绝） */
export const FORBIDDEN_TOOL_NAMES: readonly string[] = ['pass_gate', 'append_changelog'];

/**
 * 全量 15 工具名单（唯一事实源）。
 * 描述中的语义承诺与红线逐字对齐，后续阶段实现 handler 时不得弱化。
 */
export const TOOL_ALLOWLIST: readonly ToolDef[] = [
  // —— 读 7 ——
  {
    name: 'list_projects',
    description:
      '列出受管项目。M1 最小实现：返回当前上下文项目自述；若 .gatedeck/registry.md 存在则一并列出注册表登记（native provider）。跨项目枚举待 M2 扩展。',
  },
  {
    name: 'get_overview',
    description:
      '决策台总览（只读投影）：返回四区条目（等您决定/可以推进/需要关注/进行中）+ 分区计数 + as_of 与源版本戳 + 诊断与数据说明。归区判定全部来自 core decisionBoard，本工具不自行判定。',
  },
  {
    name: 'get_wbs',
    description:
      '任务列表（只读）：返回 wbs.md 全部可解析任务的 id/title/status/deps/stage（gate 字段即任务所属阶段）。解析诊断如实附列，不静默丢弃（W-06）。',
  },
  {
    name: 'get_task',
    description:
      '按 id 查询单个任务详情（只读）：返回受管字段全集（id/title/status/deps/stage/owner/acceptance/scope）。任务不存在时如实返回 not-found，不编造。',
  },
  {
    name: 'list_gates',
    description:
      '门禁与阶段投影（只读）。gates.md 解析器待 T-M1-04 接入：本工具现返回事件折叠派生的阶段投影（当前阶段/阶段序/as_of/源版本）并明示「门禁数据待 T-M1-04 接入」，与 cli deck 口径一致。',
  },
  {
    name: 'query',
    description:
      '按条件过滤任务（只读）：支持按 status（todo/doing/done/blocked/dropped）与 stage（任务所属阶段门禁 id）过滤；两个条件可同时使用，未提供条件时返回全部任务。',
  },
  {
    name: 'get_report',
    description:
      '事件与用量报告（只读投影）：changelog 事件计数（verified/unverified/invalid，含无法解析块数）+ 需处理项明细（链级问题/折叠诊断）+ insights 用量汇总（usage.reported 事件计数与 token 累计，无数据如实为空）。',
  },
  // —— 写 3（handler 由后续阶段注册；描述即契约） ——
  {
    name: 'update_task',
    description:
      '更新任务字段/状态（写入）：只改目标字段行的值文本（wbsKernel.updateTaskFieldById 局部修改，R-04），内容 hash 乐观并发检测（T-M0b-03）+ 投影版本 compare-and-set（T-M0b-06）通过后方可落盘；「领任务」即 status 置 doing。',
  },
  {
    name: 'create_task',
    description:
      '向 wbs.md 追加新任务节点（写入）：按契约模板生成规范节点并追加，既有字节不动（R-02/R-04）；追加内容全走 core 校验层（wbsKernel 零诊断方可落盘）。',
  },
  {
    name: 'move_task',
    description:
      '移动任务（写入）：修改任务的阶段归属（gate 字段）与前置（deps 字段）。与 update_task 同 core 路径（wbsKernel.updateTaskFieldById 局部修改 + 内容 hash CAS）；目标字段须已存在于节点（不静默新增字段），缺失如实拒绝并提示人工补字段。',
  },
  // —— 门禁/推进 2（handler 由后续阶段注册；描述即契约） ——
  {
    name: 'check_gate',
    description:
      '检查门禁事实（只读）：语义=检查事实查询与失效判定（读既有凭证、manifest 指纹比对），**不是命令执行器**——永不执行任何门禁/shell 命令（R-07/D-26）。',
  },
  {
    name: 'request_promotion',
    description:
      '发起阶段推进申请（写入）：只产生待审 authorization.requested 事件；**绝不**产生 authorization.granted / authorization.locally_confirmed（B-4/R-03：批准是项目负责人人工动作）。',
  },
  // —— 类型化事件动作 3（handler 由后续阶段注册；描述即契约） ——
  {
    name: 'record_note',
    description:
      '记录一条非权威备注（写入）：只产生非权威 note 事件（origin=managed-api），不驱动状态推导（P-09）；人类说明为自由文本，机器字段走固定信封 schema。',
  },
  {
    name: 'submit_evidence',
    description:
      '提交检查证据（写入）：只产生待验 evidence.submitted 事件（integrity=unknown，不驱动状态）；**绝不**产生 check.completed / task.transitioned（B-17：检查事实维度不由 MCP 声明）。',
  },
  {
    name: 'report_usage',
    description:
      '上报用量（写入）：产生 usage.reported 事件（origin=managed-api），按 T-M2a-05/MOD-08 用量契约字段（日期/项目/模型/输入输出 token/关联任务/来源/actor/session）；归因只记本地不透明 ID（D-19，W-02 不采集个人数据）。',
  },
];

/** 名单内工具名集合（assertAllowlist 内部使用） */
const ALLOWED_NAMES: ReadonlySet<string> = new Set(TOOL_ALLOWLIST.map((t) => t.name));

/** 禁止名单集合（assertAllowlist 内部使用） */
const FORBIDDEN_SET: ReadonlySet<string> = new Set(FORBIDDEN_TOOL_NAMES);

/**
 * B-4 守卫核心：断言注册器实际注册名单 ⊆ TOOL_ALLOWLIST，且不含 pass_gate/append_changelog。
 *  - 未知工具（不在名单）→ violation；
 *  - 禁止工具（pass_gate/append_changelog）→ violation（即使有人把禁名加进名单也照样拒绝）；
 *  - 供 allowlist.test.ts（CI 机器守卫）与 server 装配自检（结构性守卫）复用。
 * 违规非空即 ok=false，调用方必须拒绝启动/拒绝注册。
 */
export function assertAllowlist(names: readonly string[]): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const name of names) {
    if (FORBIDDEN_SET.has(name)) {
      violations.push(`禁止工具出现在注册表：${name}（B-4/B-17：门禁开启与通用事件追加不由 MCP 提供）`);
      continue;
    }
    if (!ALLOWED_NAMES.has(name)) {
      violations.push(`未登记工具：${name}（注册表只允许 MOD-06 十五工具全集内的名字）`);
    }
  }
  return { ok: violations.length === 0, violations };
}
