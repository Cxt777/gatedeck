# 规范事件块语法与事件信封 schema · 定稿设计文档（T-M0a-03）

> 任务：T-M0a-03 ｜ 日期：2026-10-19 ｜ 状态：AI 定稿建议，**随 G-M0a 提请主理人过目后生效**
> 依据：《[06-产品基准-v2.1](../../../../../PM/docs/产品方案/06-产品基准-v2.1.md)》3.5 / D-21 / P-09（R-09）/ B-4 / B-17 ｜ 同批语法：《[wbs节点语法定稿](wbs节点语法定稿.md)》

## 一、定稿结论

1. **事件块复用 fenced block 包裹机制**（T-M0a-02 三方案对比胜出方案），info string 固定 **`gatedeck-event`**；与 wbs 节点块（`gatedeck-task`）同一套 wrapper/span/raw 契约与解析器实现。
2. **信封固定 11 字段**，机器权威字段一行式呈现（`key: value`；嵌套对象为紧凑 JSON）；**人类说明为块外自由文本**，物理分离、不参与状态推导。
3. **kind 白名单 × origin 兼容矩阵**在 schema 层编码 B-4/B-17 口径：外部通道（managed-api）不可声明 core 专属 kind（如 `check.completed`、`authorization.*`），违者 schema-invalid。
4. **`validation_status` 不进信封**（裁决，见 3.4）。

## 二、信封字段规格（基准 3.5 固定 schema）

| 字段 | 类型 | 必填 | 规则 |
|---|---|---|---|
| `event_id` | ULID | ✅ | 26 位 Crockford Base32（接受小写，规范化输出大写）；缺失/非法 → 致命 |
| `schema_version` | 数字字符串 | ✅ | 当前 `1`；契约升级走 T-M3-03 migrate，不静默变更 |
| `kind` | 枚举 | ✅ | 白名单见 2.1；越界 → 致命 |
| `occurred_at` / `recorded_at` | ISO 8601 | ✅ | **必须带时区**（`Z` 或 `±HH:MM`）；无时区拒绝（R-08 不猜语义） |
| `actor` | JSON 对象 | ✅ | `{actor_id, session_id, tool?, model?}`；ID 为本地不透明 ID（D-19，不记邮箱/用户名/对话文本） |
| `origin` | 枚举 | ✅ | `core` / `managed-api` / `manual` |
| `integrity` | 枚举 | ✅ | `verified` / `unknown` / `invalid`（收据链判定归 T-M0a-04；手工伪造→invalid→不参与推导） |
| `subject` | JSON 对象 | ✅ | `{object_id, manifest_hash?}`；指纹本体由 canonical manifest 承载（D-25） |
| `operation_id` | 字符串 | 可缺省 | 跨文件操作关联（P-06 四相恢复）；单文件操作缺省 |
| `payload` | JSON 对象 | ✅ | 自由 schema 随 kind 定义；`validation_status` 由 `check.completed` 的 payload 承载 |

未知字段：**保留原文 + 非致命诊断**（F-06），不参与状态推导。

### 2.1 kind 白名单与来源矩阵（3.5 表的 schema 层编码）

| origin | 允许 kind | 基准依据 |
|---|---|---|
| `core` | `task.transitioned`、`check.completed`、`authorization.granted`、`authorization.denied`、`authorization.locally_confirmed`、`promotion.completed`、`project.initialized`、`correction`、`operation.recovery` | 3.5 core 动作白名单 |
| `managed-api` | `note`（record_note）、`evidence.submitted`（submit_evidence）、`authorization.requested`（request_promotion）、`usage.reported`（report_usage）* | 3.5 类型化动作 |
| `manual` | 任何已知 kind 均可解析，但 integrity 判定通道决定其不驱动受管状态（external-unverified，T-M0b-02） | 3.5 手工追加规则 |

\* **`usage.reported` 为增补提议**：基准 3.5 表未显式命名 report_usage 的事件 kind（MOD-08 仅规定 insights.md 记录携带 origin 标注）。为让用量事件走同一信封契约，本设计提议增补该 kind，随 G-M0a 提请主理人确认；确认前 report_usage 通道维持 insights.md 直录不变。

## 三、关键裁决

### 3.4 `validation_status` 为何不进信封

- 术语三分（v2.1a）中 `validation_status`（待验/通过/失败）是**检查事实维度**的执行状态，随检查行为产生、随复核变化，是**可变派生态**；
- 信封是**不可变事实记录**（append-only，R-02）：把可变状态放信封必然要求改写历史事件，直接违反 R-02；
- 落地口径：`check.completed` 的 `payload.validation_status` 承载**检查时点**的状态快照；当前生效状态由折叠投影（T-M0a-05）从事件流派生。
- 信封内出现 `validation_status` 字段行时：保留原文 + unknown-field 诊断（测试覆盖），绝不静默采纳。

### 3.5 致命 / 非致命诊断分层

- **致命**（事件不入信封序列，原文保留）：`missing-field`、`bad-format`、`bad-enum`、`bad-json`、`kind-origin-mismatch`；
- **非致命**（事件产出，附诊断）：`unknown-field`；
- 校验**全量收集**诊断后单一致命门裁决（单条事件一次性暴露全部缺陷，避免逐字段提前返回掩盖后续问题——实现中曾因此吞掉 payload 坏 JSON 诊断，已修正并落测试）。

## 四、实现落点与测试证据

| 项 | 落点 |
|---|---|
| 信封类型/白名单/校验/解析/序列化 | `src/core/eventEnvelope.ts`（纯函数，无 IO，purity 守卫覆盖） |
| 包裹机制复用 | `src/core/wbsSyntax.ts` `parseFencedTaskBlocks(md, info)` 参数化（默认 `gatedeck-task` 不变，向后兼容） |
| 测试 | `src/core/eventEnvelope.test.ts` 14 用例：round-trip 字节级（LF/CRLF）、人类说明块外保留、多块共存、缺失字段、ULID、无时区拒绝、枚举越界、B-4/B-17 越权、manual 通道、嵌套坏 JSON、payload 缺失/坏 JSON、未知字段保留、operation_id 缺省 |
| 下游 | T-M0a-04（收据链回填 integrity）、T-M0b-02（changelog/insights 解析 + external-unverified 判定）、T-M0a-05（折叠投影读 payload.validation_status） |
| 待主理人过目项 | ① `usage.reported` kind 增补；② `validation_status` 不进信封的裁决；③ event_id 采用 ULID |
