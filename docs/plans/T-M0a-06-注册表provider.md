# T-M0a-06 注册表 provider 计划日志

## 【范围】本次任务的范围

- 任务 ID / 任务名 / 目标：T-M0a-06 注册表 provider（native + projects-index）——统一投影供 discover/总览消费
- 边界 / 涉及文件：`src/core/registry.ts`、`src/core/registry.test.ts`、`src/core/index.ts`（出口）、`docs/design/注册表provider定稿.md`
- 不做什么：文件落盘与 `.gatedeck/` 目录创建（存储层 M0b）；discover 扫描与 adopt 收编（T-M1-02）；对真实工作区 PROJECTS-INDEX.md 的任何读写
- 风险点：projects-index 只读的保证方式（以 API 形状 + 结构性测试化解）；表格解析对含「|」单元格不支持（报诊断不静默）
- 红线自检：D-30（不建第二注册表、不写工作区根）✓；B-14（workspace_id 稳定）✓；B-15（只读）✓；R-04（EOL/未知列保真）✓

## 【计划】具体实施的计划

- 步骤：① 行级表格解析（保真）→ ② native registry.md（append-only）→ ③ registry.local.md（locator 就地更新）→ ④ projects-index 只读解析 → ⑤ 统一投影 → ⑥ 测试
- 角色分工：AI 全量实现；主理人随 G-M0a 过目定稿
- 验证手段：`pnpm typecheck` + `pnpm test`（B-14/B-15 样本入回归）

## 【分类】分类标识

| 任务 ID | 阶段 | 类型 | 优先级 | 关联模块 | 关联 CHANGELOG 行号 |
|---|---|---|---|---|---|
| T-M0a-06 | M0a | 功能（core） | 高 | src/core | 追加于 02-CHANGELOG.md |

## 【结果】计划的执行结果

- 实际产出：与【范围】一致；ULID/ISO 校验复用 eventEnvelope 同源实现
- 验证结果：`pnpm typecheck` / `lint` / `test`（7 文件 85 用例）/ `build` 全绿；12 用例含 B-14/B-15 与 CRLF 保真
- 计划偏差与原因：无
- 未完成项与后续动作：存储层落盘（M0b）；T-M0b-08 CLI discover/ls 接线
