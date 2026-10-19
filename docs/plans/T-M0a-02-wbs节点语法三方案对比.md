# T-M0a-02 wbs节点语法三方案对比 计划日志

> 创建：2026-10-19 23:30 ｜ 状态：已完成（本地验证通过）

## 【范围】本次任务的范围

- 任务 ID / 任务名 / 目标（一句话）：T-M0a-02 —— wbs.md 节点语法在 fenced block / HTML comment / 独立任务文件三方案上各出原型，以真实含注释样本做 round-trip 对比后定稿。
- 边界 / 涉及文件：
  - `src/core/wbsSyntax.ts`（三方案解析器 + span 追踪 + 局部修改 + 重建）
  - `src/core/wbsSyntax.test.ts`（含注释/未知字段/中文/CRLF/嵌套冲突样本）
  - `docs/review/T-M0a-02-wbs节点语法三方案对比报告.md`
  - `docs/design/wbs节点语法定稿.md`
  - 本计划日志
- 不做什么：不实现 wbs.md 完整解析/校验/局部修改内核（T-M0b-01）；不定事件块语法与信封 schema（T-M0a-03，另行同批原型）；不做 CLI。
- 风险点：fence 嵌套歧义（节点内含代码块）与 HTML 注释不可嵌套（`-->` 死锁）是两方案的结构性缺陷，原型必须实测暴露；定稿结论为 AI 建议，G-M0a 过门时仍需主理人过目。
- 红线自检：R-04（round-trip 保真）为本任务验收核心，测试直接覆盖；不触碰 W-01~W-06；core 内纯函数无 IO（purity 守卫覆盖）。

## 【计划】具体实施的计划

- 步骤分解：
  1. `src/core/wbsSyntax.ts`：三方案解析器（fenced block / HTML comment / 独立任务文件 frontmatter），统一返回 nodes + diagnostics + spans，提供 `reconstruct`（原文重建）与 `updateField`（局部修改）。
  2. `src/core/wbsSyntax.test.ts`：真实含注释样本（中文、用户注释、未知字段、节点内嵌代码块、CRLF 变体、同字符 fence 冲突）驱动三方案对比；断言 round-trip 字节级一致。
  3. 运行 `pnpm lint` / `typecheck` / `test`。
  4. 产出对比报告（review）与定稿设计文档（design）。
- 角色分工：AI 负责原型、测试、报告与定稿建议；主理人在 G-M0a 过门时过目定稿。
- 验证手段：`pnpm lint` + `pnpm typecheck` + `pnpm test`（含 purity 守卫），对应基准第八节「src/core/**」验证线；round-trip 断言即 R-04 的可执行口径。

## 【分类】分类标识

| 任务 ID | 阶段 | 类型 | 优先级 | 关联模块 | 关联 CHANGELOG 行号 |
|---|---|---|---|---|---|
| T-M0a-02 | M0a 契约验证 | 契约设计 + core 实现 | 高 | core | 见 02-CHANGELOG 2026-10-19 条目 |

## 【结果】计划的执行结果（完成后追加）

- 实际产出：`src/core/wbsSyntax.ts`（三方案解析器，spans + reconstruct + updateField，未知字段/未解析行保留并出诊断）、`src/core/wbsSyntax.test.ts`（17 用例：三方案 round-trip 字节级、CRLF、同字符 fence 冲突、`-->` 死锁、局部修改不碰邻域）、`docs/review/T-M0a-02-wbs节点语法三方案对比报告.md`、`docs/design/wbs节点语法定稿.md`（定稿：fenced block 方案）。
- 验证结果（真实执行）：`pnpm lint` 退出码 0；`pnpm typecheck` 退出码 0；`pnpm test` 3 文件 22 用例全过（本任务新增 17 + purity 守卫随 core 文件数自动扩展 1）。开发中修复两处实现缺陷：字段 key 未支持中文（F-06 场景）、未闭合注释检测切片截断。
- 计划偏差与原因：无。
- 未完成项与后续动作：定稿结论随 G-M0a 提请主理人过目；wbs.md 完整内核（含非法行恢复策略细化）归 T-M0b-01。
