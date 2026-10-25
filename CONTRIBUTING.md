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
- `src/mcp/`：仅暴露类型化动作，不可越权产生状态。
- 核心业务不变量（在源码注释与测试中落地）：Markdown 单一事实源、append-only、round-trip 保真、本地优先不采集、乐观并发拒绝覆盖、门禁命令须显式信任（`discover`/`doctor` 永不执行门禁命令）、未知如实展示不编造、事件权威性（`origin`/`integrity` 分离）。触碰任一条请先停下讨论。

## 提交规范

- 使用 Conventional Commits：`feat(core): …` / `fix(cli): …` / `docs: …` / `test: …` / `chore: …`；
- 摘要**可以用中文**（仓库既有提交即如此）；
- 一个 PR 聚焦一件事；行为变更必须带测试，反例场景请入 CI 回归。

## 设计文档

关键机制设计定稿（事件信封与收据链、状态折叠、canonical manifest 等）见仓库内源码模块头注释与 `docs/design/`（若你的克隆不含该目录，以源码注释与测试为最准确的事实源）。

## 行为准则

保持友善与尊重、讨论对事不对人——任何形式的骚扰、贬损与歧视都不受欢迎（Be kind and respectful; critique ideas, not people — harassment or disparagement of any kind is unwelcome）。
