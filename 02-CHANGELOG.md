# 一休PM · 变更日志（CHANGELOG）

> append-only：只允许追加，禁止修改或删除历史条目；清理须走授权流程（见 00-开发基准 三-2）。
> 条目格式：`[YYYY-MM-DD HH:MM] | 对象 | 操作人（AI/主理人）| 变更摘要`

- [2026-10-19 19:46] | 立项 | 主理人 + 项目 AI | 项目立项：自工作区 templates/ 脚手架生成治理四件套；分配端口段 8110–8119（登记于工作区 PORTS.md）；00-开发基准占位章节（红线/目录边界/契约/验证线/门禁）待主理人填充
- [2026-10-19 19:49] | T-M0a-01 工程骨架 | 项目 AI | 落地工程底座：Node 22 + TypeScript（NodeNext/strict）+ pnpm + Vitest + ESLint(flat) + GitHub Actions CI；分层 `src/core`（纯 TS，`purity.test.ts` 机器守卫无 IO 依赖）/ `src/cli`（壳层占位）；新增 `docs/plans/T-M0a-01-工程骨架.md`；本地 `pnpm lint`/`typecheck`/`test`/`build` 全绿（4 用例）。CI 待云端首次运行确认。计划日志见 docs/plans/
- [2026-10-19 20:18] | 00-开发基准 + 01-TASK-SPECTRUM + AGENTS | 项目 AI（起草） | 起草 `00-开发基准.md` 占位章节：项目身份（定位/固定约束/阶段路径）、红线 R-01~R-09（自基准 P-01~P-09 逐条转写）、目录边界（含 core 纯度约束与「读写双方」）、不可破坏契约（事件信封 schema/来源三分/Markdown SSOT/阶段派生）、按风险验证线、阶段门禁 G-M0a~G-M3；裁决任务状态枚举为 `todo/doing/done/blocked/dropped`（覆盖模板默认值，**待主理人拍板**）。48 项 WBS 迁入 `01-TASK-SPECTRUM.md`（M0a×7 / M0b×9 / M1×13 / M2a×7 / M2b×6 / M3×6），T-M0a-01 置 `doing`。`AGENTS.md` 速查节同步。以上 AI 起草，**待主理人拍板后生效**
- [2026-10-19 20:25] | 主理人确认（决策生效） | 主理人 | 确认两项决策并转生效：(1) 任务状态枚举定为**双语并列**——机器权威层 `todo/doing/done/blocked/dropped` + 显示层 未开始/进行中/已完成/阻塞/已放弃（以英文为准），覆盖工作区模板默认值；(2) 产品基准指针**保持外部**（`PM\docs\产品方案\06-产品基准-v2.1.md`），补记来源版本 v2.1 + 转写日期 2026-10-19 作漂移锚点，M1 前不复制入项目。已在 `00-开发基准` 第一节/第三节、`01-TASK-SPECTRUM` 表头与变更留痕、`AGENTS` 任务流程速查同步，并移除「待主理人拍板」限定词
