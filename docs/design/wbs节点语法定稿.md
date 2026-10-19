# wbs.md 节点语法 · 定稿设计文档（T-M0a-02）

> 任务：T-M0a-02 ｜ 日期：2026-10-19 ｜ 状态：AI 定稿建议，**随 G-M0a 提请主理人过目后生效**
> 依据：《[06-产品基准-v2.1](../../../../../PM/docs/产品方案/06-产品基准-v2.1.md)》MOD-02 / 3.1 / P-04（R-04）｜ 对比证据：《[三方案 round-trip 对比报告](../review/T-M0a-02-wbs节点语法三方案对比报告.md)》

## 一、定稿结论

**wbs.md 任务节点机器权威字段采用 fenced block 方案**（三方案对比胜出），包裹语法与 changelog/insights 的规范事件块共用同一机制（基准 3.5"具体 Markdown 语法 M0 原型定稿，与 WBS 节点语法同批比较"）。

## 二、节点语法规格

### 2.1 包裹（fence）

- 开 fence：行首至多 3 个空格 + 至少 3 个 `` ` `` 或 `~` + 空白 + info string **`gatedeck-task`** + 行尾（`/^ {0,3}(`{3,}|~{3,})[ \t]*gatedeck-task[ \t]*$/`）。
- 闭 fence：同字符、长度不小于开 fence、不得携带 info string（CommonMark 闭合规则）。
- **嵌套约定**：节点内若需代码块，内层 fence 必须与外层**不同字符**或**更短**；同字符同长度冲突可被 lint 静态检出（归 T-M2a-02 告警项）。实测确认：违反约定时节点字段静默截断但原文不丢失（round-trip 仍字节级成立）。

### 2.2 字段行（机器权威区）

- 每行一条：`key: value`；key 以 Unicode 字母/下划线开头（**允许中文键**），后续字母/数字/下划线/连字符。
- **已知字段**（对齐基准 MOD-02 字段分级，M0 定稿基线）：
  - 必需：`id`、`title`、`status`（`todo/doing/done/blocked/dropped`，双语并列以英文为准——00-开发基准 三-4）
  - 可选：`owner`、`deps`（逗号分隔任务 id）、`gate`、`acceptance`、`scope`（自由文本）
  - `estimate` 不入字段（基准 MOD-02：移出必需；M2 后可以 `size: S|M|L` 复杂度代理回归）
- **未知字段**：保留原文并出 `unparsed-line`/字段级诊断，不驱动受管状态（F-06）；未知字段值可以含中文与全角符号。
- 重复 key：两处均保留并出 `duplicate-key` 诊断，交由权威位置规则裁决（T-M0b-05）。
- 时间语义字段（updated_at/last_seen_at/last_progress_at）**禁止**手写进节点——从 changelog/insights 事件派生（基准 3.1/3.3），校验内核（T-M0b-05）拒绝此类字段驱动状态。

### 2.3 节点在 wbs.md 中的段落结构

- 每任务 = 一个段落：人类可读标题行（如 `### T-xxx 任务名`）+ fenced block（机器权威字段）+ 自由文本（人类说明，不参与状态推导）。
- 段落标题与块内 `title` 是两处表达：**以块内为准**，冲突按冲突显示规则告警（基准 3.1），不静默合并。
- **表格视图（如现有 WBS 文件的 Markdown 表格）是派生投影**，不得与 fenced block 落在同一文件——每事实唯一权威位置（基准 3.1 / T-M0b-05）。既有两份 WBS（工作区规划目录与本项目 `01-TASK-SPECTRUM.md`）保持现状，作为人类视图使用；M1 `pm init` 生成的首个 `pm/wbs.md`（dogfooding）按本规格落地。

### 2.4 round-trip 保真机制（实现契约，T-M0b-01 沿用）

- 解析器输出 `{nodes, diagnostics}`；每个节点携带 `span`（整体区间）/ `rawSpan`（内部区间）/ `wrapper`（包裹符原文切片）。
- `reconstruct(md, result)`：节点区间按（包裹符 + 内部原文）原样回填，区间外一字节不动；raw 未修改时与输入**字节级一致**（LF/CRLF 均实测）。
- `updateField(node, key, value)`：仅重写目标行的值文本，保留 key、冒号、冒号后空白、行终止符。
- 测试样本要求（入 CI 回归，R-04）：含用户注释、未知字段、中文键值、节点内嵌代码块、CRLF 变体、同字符 fence 冲突样本、未闭合样本。

## 三、落点与影响

| 项 | 落点 |
|---|---|
| 原型实现 | `src/core/wbsSyntax.ts`（纯函数，无 IO，purity 守卫覆盖） |
| 测试 | `src/core/wbsSyntax.test.ts`，17 用例 |
| 下游任务 | T-M0b-01（解析/校验/局部修改内核）按本规格实现；T-M1-01（契约模板 v1）按 2.3 生成 `pm/wbs.md` |
| 待主理人过目项 | ① 方案 A 胜出结论；② 已知字段必需/可选划分；③ 段落结构 2.3 的"标题以块内为准"裁决 |
