# W-S4-前置文档包 计划日志

> 每个 WBS 任务开工前复制 `_TEMPLATE.md` 到 `docs/plans/{WBS-ID}-{简述}.md` 填写前三区块；【结果】完成后追加。
> 创建动作与任务状态变更都必须在 `02-CHANGELOG.md` 留痕（本任务文件边界禁止改既有文件，留痕由主会话 / W-S5-1 落档）。

## 【范围】本次任务的范围

- 任务 ID / 任务名 / 目标（一句话）：**W-S4-1 主体 + W-S4-3 community files 初稿**——为 v0.1.0-rc.1（npm dist-tag `early`）发布产出双语 README、LICENSE、CONTRIBUTING、SECURITY 与双语 issue 模板，全部对外文案遵守 W-06（不声称未实现能力，明示 early access 与后补清单）。
- 边界 / 涉及文件（全部新建）：`README.md`、`README.en.md`、`LICENSE`（MIT，版权行 Copyright (c) 2026 Cxt777）、`CONTRIBUTING.md`、`SECURITY.md`、`.github/ISSUE_TEMPLATE/bug_report.md`、`.github/ISSUE_TEMPLATE/feature_request.md`、本计划日志。
- 不做什么：**不改任何既有文件**（含 `01-TASK-SPECTRUM.md` 状态迁移与 `02-CHANGELOG.md` 留痕——超出本任务文件边界）；不写落地页（W-S4-2 可让路①）；不产生任何付费承诺（DP-2：999 元仅为「价值对照清单」质量标尺，rc 期免费开源）；不启用 badges（npm 包发布后由后续任务取消注释启用）。
- 风险点：①命令落地进度在冲刺中动态变化（`deck`/`handoff` 随 S2 工作包落地，本计划日志写作时 HEAD 仅五子命令占位），README 须按「即将在本 rc 提供」措辞 + 示意标注处理，防虚报；②gatedeck-mcp 尚未发布，MCP 客户端配置只能留占位；③首屏截图素材未产出（无浏览器截图链路），首屏以文本演示承载。
- 红线自检：W-06 不虚报——示例输出全部标注「示意/以实际为准」，CLI 帮助文本直接引用 `node dist/cli/index.js help` 实跑输出，并声明「未落地子命令明示未实现（退出码 2）」；W-01/W-02——全部文档不含密钥与个人数据，事件块示例标注「非真实数据」；R-05 本地优先表述如实（不承诺任意编辑器零丢失，随 optimisticWrite 诚实口径）；DP-2 措辞照搬拍板口径（自设质量标尺/锚定价格带/未来若收费另行公告）；R-08 未知如实——无法验证的能力一律后补清单化。

## 【计划】具体实施的计划

- 步骤分解：① 取证：`00-开发基准.md`（定位/红线 R-01~R-09）、`01-TASK-SPECTRUM.md`（T-M1-09 三区四规则、T-M1-07 handoff 六段、WBS-W 段 V1~V6 价值准出）、`docs/plans/WBS-W-周末上线冲刺计划.md`（DP-1~DP-5、诚实边界、999 元准出表）、`02-CHANGELOG.md` 尾部（gatedeck-mcp 定名、三 bin、仓库地址）、`src/cli/index.ts` + `package.json`（命令集与 engines）→ `node dist/cli/index.js help` 实跑取证；② 写 LICENSE + 本计划日志；③ 写 `README.md`（按任务指派的 9 段顺序）；④ 写 `README.en.md`（结构逐段对应、行文自然、首句钉 decision deck）；⑤ 写 `CONTRIBUTING.md` / `SECURITY.md` / 两个 issue 模板；⑥ 自验：`wc -c` 全文件非空 + 标题层级连贯性 grep 自检。
- 角色分工：AI 全部执行；主理人后续审阅对外文案并执行 CP-3 发布授权。
- 验证手段：`wc -c` 各文件字节数 > 0；`grep -E '^#{1,6} '` 标题层级检查（H1→H2→H3 无跳级）；关键事实（命令集 / 版本 / bin 名 / dist-tag / 仓库地址）与 `package.json`、`src/cli/index.ts:34-70`、WBS-W 计划逐项对照。

## 【分类】分类标识

| 任务 ID | 阶段 | 类型 | 优先级 | 关联模块 | 关联 CHANGELOG 行号 |
|---|---|---|---|---|---|
| W-S4-1（主体）+ W-S4-3（community files 初稿） | WBS-W · S4 发布与价值包装 | 文档 | P0 | 仓库根文档 + `.github/` | 待 W-S5-1 追加 |

## 【结果】计划的执行结果（完成后追加）

- 实际产出：8 个新建文件全部落盘（清单见【范围】）。
- 验证结果：`wc -c` 全部非空（LICENSE 1059B / README.md 约 7KB / README.en.md 约 6KB / CONTRIBUTING.md / SECURITY.md / 两个 issue 模板 / 本日志）；标题层级 grep 检查无跳级；CLI 帮助文本取自 `node dist/cli/index.js help` 实跑（EXIT=0），非编造。
- 计划偏差与原因：快速上手命令示例按任务指派的冲刺目标流程书写（`npx gatedeck@early` → `init --name/--slug/--stage` → `deck`），输出块全部标注「示意/以实际为准」，并在快速上手脚注声明「本 rc 冲刺期快速演进；未落地子命令明示未实现（退出码 2），不静默装成功」——与 HEAD 实况（五子命令占位）及 W-06 一致。
- 未完成项与后续动作：① badges HTML 注释待 npm 包发布后启用；② MCP 配置代码块占位待 gatedeck-mcp 发布后补充真实配置；③ 首屏截图/接管演示素材未产出（W-S4-1 验收的「首屏素材」以决策台文本演示承载，如需图片由后续任务补）；④ `01-TASK-SPECTRUM.md` W-S4-1 / W-S4-3 状态迁移与 `02-CHANGELOG.md` 留痕待主会话 / W-S5-1 执行（本任务文件边界禁止改既有文件）。
