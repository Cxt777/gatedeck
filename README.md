# Gatedeck（一休PM）

**Gatedeck（一休PM）是你的 decision deck——一张先停一步、想清楚下一步再动手的决策台**：打开即见「等您决定 / 可以推进 / 需要关注」三区，每一次推进都留下可复验的证据。为「单人开发者 + AI 结对 + 多项目并行」而造，本地优先，数据永远是你自己的 Markdown 文件。

> **"Know what's next. Prove what's done."**

<!-- badges 占位：npm 包发布后取消本注释启用
[![npm version](https://img.shields.io/npm/v/gatedeck.svg)](https://www.npmjs.com/package/gatedeck)
[![license](https://img.shields.io/npm/l/gatedeck.svg)](./LICENSE)
[![CI](https://github.com/Cxt777/gatedeck/actions/workflows/ci.yml/badge.svg)](https://github.com/Cxt777/gatedeck/actions/workflows/ci.yml)
-->

> ⚠️ **Early Access（0.1.0-rc.1）**：本工具处于 rc（候选版）阶段，npm 分发 dist-tag 为 `early`，不是正式版。功能边界与后补清单见下文 [Early Access 诚实声明](#early-access-诚实声明)。

## 为什么是 Gatedeck

单人开发者 + AI 结对，最常见的三个真痛点：

| 真痛点 | Gatedeck 的对策 |
|---|---|
| **多项目并行，打开电脑不知道下一步该干什么**——任务散落在 N 个仓库的 TODO、便签和聊天记录里 | **决策台（deck）**：三区分诊——「等您决定 / 可以推进 / 需要关注」，一眼锁定此刻最该处理的一件事 |
| **AI 会话交接靠口口相传**——新会话要人工重新口述项目状态，讲漏一句就跑偏 | **交接包（handoff）**：一条命令生成结构化交接包（目标范围 / 适用规则 / 依赖决定 / 有效与失效证据 / 已试败路径 / 下一步验收），新会话拿去即用；AI 还可经 gatedeck-mcp 直接读取 |
| **推进缺证据，回顾说不清**——月底复盘时，「真做完了」和「以为做完了」分不开 | **证据链（evidence chain）**：每次状态迁移都是一条带 SHA-256 收据的 Markdown 事件，可重放、可审计、可 `git diff` |

## 5 分钟上手

环境要求：Node.js ≥ 22。

命令名说明：`gatedeck` 是主命令，`pm` 是等价别名，两者随同一个 npm 包分发。

### 第 1 步：免安装试用

```bash
npx gatedeck@early
```

不带参数运行会打印帮助（下为当前实际输出节选，随版本演进以 `gatedeck --help` 实际输出为准）：

```text
gatedeck（一休PM）— 决策台优先、证据可校验的本地项目管理工具

用法：gatedeck <command> [options]      （别名：pm）

命令：
  gatedeck init            在当前目录初始化 pm/ 契约文件骨架（project/wbs/gates/changelog/insights）
  gatedeck discover        只读扫描工作区候选项目并预览（不执行命令、不入册）［纯只读］
  gatedeck adopt <path>    把 discover 预览中的项目显式收编入注册表
  gatedeck register <path> 登记项目到注册表（native provider）
  gatedeck ls              只读列出注册表项目总览［纯只读］
  …（其余命令与说明见完整帮助）
```

### 第 2 步：初始化项目契约

在你的项目仓库根目录执行：

```bash
gatedeck init --name 我的应用 --slug myapp --stage 开发
```

输出示意——会在 `pm/` 目录生成五个 Markdown 契约文件骨架（实际文案以你安装的版本为准）：

```text
已生成 pm/ 契约骨架：
  pm/project.md     项目身份与基本信息
  pm/wbs.md         任务谱（WBS）
  pm/gates.md       阶段与门禁定义
  pm/changelog.md   事件日志（append-only）
  pm/insights.md    洞察与复盘
```

### 第 3 步：打开决策台

```bash
gatedeck deck
```

首次运行时还没有可展示的事项，决策台会输出引导文案（示意）：

```text
（首次运行）这里还没有任何事件记录。
决策台分三个区：
  等您决定 —— 需要您拍板的事（待验收门禁、待审申请）
  可以推进 —— 可直接领取推进的任务
  需要关注 —— blocked、证据过期/待复验等信号
完成 init 并开始推进项目后，这里会随事件增长实时更新。
```

换新 AI 会话时，可用 `gatedeck handoff` 生成交接包（随本 rc 提供），或让 AI 经 gatedeck-mcp 直接读取项目（见下文「AI 接管」）。

> **诚实说明**：本 rc 于 2026-10-24/25 周末冲刺期内快速演进，各子命令以你安装版本的 `gatedeck --help` 实际输出为准；尚未落地的子命令执行时会**明示「未实现」并以退出码 2 结束**，不产生任何文件副作用——不会静默假装成功。

## 核心概念

### 决策台三区（deck）

一句话规则：**待您拍板的事（待验收门禁、待审申请）进「等您决定」；可直接领取的任务进「可以推进」；出问题的信号（任务 blocked、证据过期/待复验）进「需要关注」。**

决策台每次展示都携带数据版本戳（`as_of`）：您基于过期版本提交的修改会被拒绝并提示重读重试，而不是悄悄覆盖。

### 证据链（evidence chain）

项目事实以 **Markdown 为唯一事实源（SSOT）**。changelog / insights 中是规范事件块（固定信封字段：`event_id` / `kind` / `actor` / `origin` / `integrity` / `payload`……），并配 **SHA-256 hash 收据链**（内容与顺序双重绑定）。它们都是普通文本：可以 `git diff`、可以肉眼审；收据对不上就标 `invalid`，不参与状态推导，进入「需要处理」而不是被静默修复。

事件块长这样（格式示意，非真实数据）：

```gatedeck-event
event_id: 01JC6Z0W8G9Q2X7V5T3R4S6K1A
schema_version: 1
kind: task.transitioned
occurred_at: 2026-10-24T21:00:00+08:00
recorded_at: 2026-10-24T21:00:00+08:00
actor: {"actor_id":"01JCACTOR…","session_id":"01JCSESS…"}
origin: core
integrity: verified
subject: {"object_id":"task:T-001"}
payload: {"from":"doing","to":"done"}
```

### AI 接管（gatedeck-mcp）

gatedeck-mcp 是同一个包内的第三个 bin（MCP server）：Claude Desktop / Cursor / ZCode 等 AI 客户端经 MCP 的类型化动作读取决策台、领取任务、提交证据——但 AI **只能产生待验证据与类型化事件，不能代您授权推进**（无 `pass_gate`，不产生 `authorization.*` 事件），决定权始终在您手里。

客户端配置示例将在 gatedeck-mcp 随 rc 发布后补充：

<!-- MCP 配置随 gatedeck-mcp 发布后补充 -->

## 999 元价值对照清单

这不是售价——**rc 期免费开源（MIT）**。这是我们自设的质量标尺（锚定一个合理付费工具的价格带）：用完之后，它值不值 999 元？未来若收费会另行公告，本清单不构成任何付费承诺。

| # | 价值主张 | 对应验收判据 |
|---|---|---|
| 1 | **5 分钟接入** | 陌生环境 `npx gatedeck@early` → `init` → 首屏决策台可见，全程 ≤ 5 分钟 |
| 2 | **3 分钟 AI 接管** | 新开一个 AI 会话，经 gatedeck-mcp 读取项目概览与任务谱后，能准确复述项目状态并指出下一步 |
| 3 | **证据可复验** | 推进全链路（门禁检查 → 申请推进 → TTY 本地确认 → 状态迁移）可重放；事件带 hash 收据，篡改可检测 |
| 4 | **本地优先可迁移** | 断网完全可用；数据纯 Markdown，可 `git diff`、可整目录迁移带走 |
| 5 | **文档与支持** | 中英双语 README + 客户端接入指南 + FAQ + 回滚说明齐备 |
| 6 | **稳定性底线** | CI 绿（云端真实首跑）+ 干净环境安装冒烟 + npm 回滚路径演练 |

判据是验收线，不是宣传语：发布说明将逐项如实标注达成情况。

## Early Access 诚实声明

当前版本 **0.1.0-rc.1**（npm dist-tag `early`），是候选版，不是正式版。为了先打通「接入 → 决策台 → 证据链 → 交接 → AI 接管」这条最短价值路径，以下能力**显式后补**（均在正式版路线图 / M2 计划内）：

- **一页 Web 投影页**——当前只有 CLI 文本决策台；
- **活动热力图**（Insights 视图）；
- **两周自举度量**——我们用自己的工具实测「找下一事项耗时 / 新会话人工纠正次数 / 证据不足过期发现次数」三项度量，自 2026-10-25 起算；
- **跨项目 `query` / `lint` / `doctor`**；
- **用量统计与投入换算**（token / 成本口径，M2a 计划内）；
- 阶段地铁图组件、`spec` 契约文档、`migrate` 契约迁移等。

**正式 v0.1.0 路线**：按原定门禁推进——两周自举度量达标 → 真实多项目验证 → 外部用户接入验证，预计 2026 年 11 月中下旬发布。rc 期间所有对外文案明示 early access，不冒充正式版。

## 本地优先与隐私

- **纯 Markdown SSOT**：项目事实只存在你自己的 `.md` 文件里；JSON 索引仅为可再生派生层，删了可随时重建。
- **不采集、不上传**：无遥测、无账号体系、无云依赖，断网完全可用。
- **归因匿名**：事件里的 `actor_id` / `session_id` 是本地不透明随机 ID，不记录邮箱、用户名或对话文本。
- **并发保护**：写入前按真实字节 hash 做乐观检测，发现他人/其他工具改过即拒绝并提示重读重试——绝不静默覆盖（诚实口径：不承诺任意编辑器场景的零丢失）。

## 贡献与支持

- 参与开发：见 [CONTRIBUTING.md](./CONTRIBUTING.md)（开发环境、常用命令、提交规范与项目治理）。
- 安全漏洞：**不要开公开 issue**，请走 [SECURITY.md](./SECURITY.md) 的私密上报渠道。
- 报 bug / 提建议：GitHub Issues（仓库已配置 bug / feature 两套中英双语模板）：<https://github.com/Cxt777/gatedeck/issues>

## License

[MIT](./LICENSE) © 2026 Cxt777
