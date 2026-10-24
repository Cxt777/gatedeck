# 贡献指南 ｜ Contributing to Gatedeck

> 中文为主（关键术语保留英文）；issue 与 PR 讨论用中文或英文均可。
> Primary language is Chinese (key terms kept in English); discussions in Chinese or English are both welcome.

## 开发环境

- **Node.js ≥ 22**（`package.json` 的 `engines` 约束）
- **pnpm** 包管理器
- 安装依赖：

```bash
pnpm install
```

### 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm lint` | ESLint 检查 |
| `pnpm typecheck` | TypeScript 类型检查（`--noEmit`） |
| `pnpm test` | 运行全部 Vitest 用例 |
| `pnpm test:watch` | 监听模式（开发时常用） |
| `pnpm build` | 构建产物输出到 `dist/` |

提 PR 前请保证 `lint` / `typecheck` / `test` / `build` 全部通过；CI（GitHub Actions，Node 22）与分支保护会把 `lint · typecheck · test` 设为必需检查。

### 架构红线（改动前必读）

- `src/core/`：纯 TS 计算内核，**禁止任何 IO**（不引入文件/网络/进程/时钟依赖；时钟与随机由调用方注入）。`src/core/purity.test.ts` 在 CI 机器守卫。
- `src/cli/`：壳层，允许 IO；业务判定一律下沉 core。
- `src/mcp/`（规划中）：仅暴露类型化动作，不可越权产生状态。
- 项目业务红线 R-01~R-09 见 `00-开发基准.md` 第五节（Markdown SSOT、append-only、round-trip 保真、本地优先、乐观并发、门禁命令显式信任、未知如实展示、事件权威性），触碰任一条请先停下讨论。

## 提交规范

- 使用 Conventional Commits：`feat(core): …` / `fix(cli): …` / `docs: …` / `test: …` / `chore: …`；
- 摘要**可以用中文**（仓库既有提交即如此），建议末尾附任务 ID，例如：`feat(cli): pm/gatedeck 命令框架与五子命令只读占位 (T-M0b-08)`；
- 一个 PR 聚焦一件事；行为变更必须带测试，反例场景请入 CI 回归。

## 项目治理四件套

本仓库用一套轻量但严格的治理文件维持「单人 + AI 结对」的开发秩序，贡献前建议浏览：

| 文件 | 作用 |
|---|---|
| `00-开发基准.md` | 最高纲领：红线、契约、门禁 |
| `01-TASK-SPECTRUM.md` | 任务谱（SSOT）：任务状态的唯一事实来源 |
| `02-CHANGELOG.md` | 变更日志，**append-only**：历史条目永不改写 |
| `docs/plans/` | 计划日志：每个任务开工前独立建档 |

修改治理文件须遵循其内部留痕规则；请勿直接改写历史条目。

## 行为准则

保持友善与尊重、讨论对事不对人——任何形式的骚扰、贬损与歧视都不受欢迎（Be kind and respectful; critique ideas, not people — harassment or disparagement of any kind is unwelcome）。
