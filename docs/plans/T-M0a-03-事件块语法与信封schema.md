# T-M0a-03 规范事件块语法与事件信封schema定稿 计划日志

> 创建：2026-10-19 23:45 ｜ 状态：进行中

## 【范围】本次任务的范围

- 任务 ID / 任务名 / 目标（一句话）：T-M0a-03 —— 规范事件块语法与事件信封 schema 定稿（基准 3.5/D-21），机器权威字段与人类说明分离，与 T-M0a-02 同批原型（复用 fenced block 包裹机制）。
- 边界 / 涉及文件：
  - `src/core/wbsSyntax.ts`（小改：fence info string 参数化，事件块复用包裹机制）
  - `src/core/eventEnvelope.ts`（信封类型、kind 白名单、来源兼容矩阵、校验、块解析/序列化）
  - `src/core/eventEnvelope.test.ts`
  - `docs/design/事件块语法与信封schema定稿.md`
  - 本计划日志
- 不做什么：不做来源收据 hash chain 与本地锚点（T-M0a-04）；不做事件折叠与状态派生（T-M0a-05）；不做 changelog/insights 完整解析器与 external-unverified 判定（T-M0b-02，需收据链登记）。
- 风险点：`usage.reported` kind 为基准未显式命名的增补（report_usage 动作需落事件），随 G-M0a 提请主理人确认；`validation_status` 不入信封属设计裁决，需留痕说明依据。
- 红线自检：R-09（事件权威性）——kind 白名单与 kind-origin 兼容矩阵在 schema 层编码 B-4/B-17 口径（外部通道不可声明 core 专属 kind）；R-02（append-only）——本任务只提供序列化/解析，不改写语义归 T-M0b-02。

## 【计划】具体实施的计划

- 步骤分解：
  1. `wbsSyntax.parseFencedTaskBlocks` 增加可选 info 参数（默认 `gatedeck-task` 不变）。
  2. `src/core/eventEnvelope.ts`：信封字段固定 schema（event_id/schema_version/kind/occurred_at/recorded_at/actor/origin/integrity/subject/operation_id/payload）；ULID 与带时区 ISO8601 格式校验；kind 白名单 × origin 兼容矩阵；`parseEventBlocks`（info=`gatedeck-event`）与 `serializeEventBlock`。
  3. 测试：round-trip 字节级、人类说明分离（块外文本）、缺字段/坏格式/越权 kind-origin、B-4/B-17 口径样本、CRLF。
  4. `pnpm lint` / `typecheck` / `test`。
  5. 定稿设计文档落 `docs/design/`。
- 角色分工：AI 负责实现/测试/文档；主理人于 G-M0a 过目（含 usage.reported 增补与 validation_status 裁决）。
- 验证手段：`pnpm lint` + `pnpm typecheck` + `pnpm test`（含 purity 守卫），对应基准第八节「src/core/**」验证线。

## 【分类】分类标识

| 任务 ID | 阶段 | 类型 | 优先级 | 关联模块 | 关联 CHANGELOG 行号 |
|---|---|---|---|---|---|
| T-M0a-03 | M0a 契约验证 | 契约设计 + core 实现 | 高 | core | 见 02-CHANGELOG 2026-10-19 条目 |

## 【结果】计划的执行结果（完成后追加）

- 实际产出：`src/core/wbsSyntax.ts` 参数化 info string（事件块复用包裹机制）；`src/core/eventEnvelope.ts`（11 字段固定 schema、ULID/带时区 ISO8601 校验、kind×origin 兼容矩阵、全量诊断单一致命门、parse/serialize/reconstruct）；`src/core/eventEnvelope.test.ts`（14 用例）；`docs/design/事件块语法与信封schema定稿.md`（含 usage.reported 增补提议与 validation_status 不进信封裁决）。
- 验证结果（真实执行）：`pnpm typecheck` 退出码 0；`pnpm lint` 退出码 0；`pnpm test` 4 文件 37 用例全过（本任务新增 14；purity 守卫随 core 文件数自动扩展至 3 项）。
- 开发中修复的缺陷：① parseEventBlocks 行号定位初版两分支等价（无效代码），修正为 raw 起始行 + 字段偏移；② buildEnvelope 逐段提前返回会掩盖后续诊断（payload 坏 JSON 在缺字段场景下被吞），重构为全量收集 + 单一致命门并落测试。
- 计划偏差与原因：无。
- 未完成项与后续动作：usage.reported kind 增补与 validation_status 裁决随 G-M0a 提请主理人过目；integrity 判定依赖收据链（T-M0a-04），external-unverified 判定归 T-M0b-02。
