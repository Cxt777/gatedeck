# 一休PM · 项目索引（PROJECT-INDEX）

> **唯一导航入口与状态快视图。只维护指针与索引，不编写内容**；内容变化时只追加「变更点」记录并同步子文档。
> IDE 通用 AI 工具不编辑本文件（防索引漂移）；工作内容写在各子文档。
> 上级：工作区级项目登记见 `D:\code\workspace\AI\PROJECTS-INDEX.md`。

## 状态快照

- **当前阶段**：（填写）
- **门禁**：G1 🔒 未开启
- **任务事实源**：`01-TASK-SPECTRUM.md`
- **待主理人决策/办理**：（填写）

## 治理与文档地图

| 文件 / 目录 | 作用 | 状态 |
|---|---|---|
| `00-开发基准.md` | 最高纲领（红线/契约/流程） | v1.0（占位章节待填充） |
| `AGENTS.md` | AI 准则速查层 | v1.0 |
| `01-TASK-SPECTRUM.md` | WBS 任务谱（任务 SSOT） | v1.0 |
| `02-CHANGELOG.md` | 变更日志（append-only） | 运行中 |
| `docs/plans/` | 每任务独立计划日志（含 `_TEMPLATE.md`） | 已建 |
| `docs/{progress,architecture,rules,design,review,archive}/` | 子文档区 | 骨架已建 |

## 变更点（append-only）

- [2026-10-19] 立项建档：治理四件套自工作区模板生成；端口段 8110–8119。
- [2026-10-19] T-M0a-01 工程骨架落地：TS + pnpm + Vitest + ESLint + GitHub Actions CI；分层 core（纯 TS）/ cli。
- [2026-10-19] 00-开发基准占位章节起草 + 48 项 WBS 迁入 01-TASK-SPECTRUM（均为 AI 起草，待主理人拍板）。
- [2026-10-19] 主理人确认状态枚举（双语并列）与基准指针（保持外部）；00/01/AGENTS 相关条目由 AI 起草转为已生效。
