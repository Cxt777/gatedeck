# T-M0a-07 slug 终核与命名收尾 · 核查报告

> 任务：T-M0a-07 ｜ 日期：2026-10-21 ｜ 执行者：夜间开发任务（AI）
> **状态：部分完成** —— 外部核查四项已执行；「结果回写基准 D-23 留痕」超出夜间任务文件修改边界（仅允许 WBS 状态迁移+留痕追加、gatedeck/ 内开发、新建确认文件），本报告作为 gatedeck/ 内留痕载体，回写待主理人执行或授权。

## 一、核查结果

| # | 核查项 | 命令 / 方法 | 结果 | 结论 |
|---|---|---|---|---|
| 1 | npm 包名 `gatedeck` | `npm view gatedeck version` → E404 | 未被注册 | **可注册** ✓（scoped 备选 `@gatedeck/cli` 无需启用） |
| 2 | npm 包名 `pm` | `npm view pm version` → 2.2.6 | 包名已被占用 | 不影响本项目：本包名为 `gatedeck`；`pm` 仅作 bin 别名 |
| 3 | CLI bin 名冲突评估 | `npm view pm bin` → 空（`pm` 包自身未声明 bin） | 无同名 bin 占用者（就 `pm` 包而言）；但 `pm` 为极通用名，npm 不强制 bin 独占，存在其他包声明同名 bin 导致 npx 歧义的风险 | **建议主命令用 `gatedeck`，`pm` 保留为别名**（与现 `package.json` bin 双注册一致）；文档与示例统一以 `gatedeck` 为准，落 T-M3-04 执行 |
| 4 | PyPI `gatedeck` 复核 | `GET pypi.org/pypi/gatedeck/json` → 404 | 未被占用 | **可用** ✓（本项目为 npm 包，PyPI 仅作占位防御参考） |
| 5 | 域名 gatedeck.com | RDAP rdap.org → 200（已注册） | 已被注册 | 不采用 |
| 6 | 域名 gatedeck.dev | RDAP rdap.org → 404（未注册） | 可注册 | **建议保留候选**（dev 后缀契合开发者工具定位） |
| 7 | 域名 gatedeck.io | RDAP rdap.org → 404（未注册） | 可注册 | 备选 |

核查时间：2026-10-21 23:19–23:22（+08:00 时区本机）；RDAP 经 rdap.org 重定向至权威注册局，HTTP 200=已注册、404=未注册。

## 二、结论与建议（供回写 D-23）

1. **slug `gatedeck` 终核通过**：npm 可注册、PyPI 未占用、`.dev`/`.io` 域名可注册，无需启用 scoped 备选。
2. **CLI bin 结论**：主命令 `gatedeck`、别名 `pm`（现 `package.json` bin 双注册维持不变）；README 与帮助文本以 `gatedeck` 为主（T-M3-04 执行时统一）。
3. **回写动作（待办）**：将上述结论追加入《06-产品基准-v2.1》D-23 留痕（append-only），由主理人执行或授权后续任务执行。

## 三、边界说明

- 本报告仅存于 gatedeck/ 内（夜间任务允许范围），**不构成基准 D-23 的回写**；基准文件未做任何改动。
- 域名注册状态随时可变，T-M3-04 发布前应复核一次（本报告时点结论不锁死）。

## 四、第二轮核查与收尾（2026-10-23，WBS-W / W-S0-2，主理人冲刺预授权下执行）

| # | 核查项 | 结果 | 结论 |
|---|---|---|---|
| 8 | npm `workbuddy`（曾拟 MCP 服务名） | E404 可注册；**但腾讯 WorkBuddy 为在营 agent 产品**（workbuddy.ai，全场景职场 AI 智能体，腾讯云有企业版 WorkBuddy Enterprise） | **弃用**（R2 商标混淆；主理人情报 + AI 核实属实） |
| 9 | npm `gatedeck-mcp` | E404 未注册 | **可注册 ✓ 定名**（对外 MCP 服务名与 bin 名） |
| 10 | npm `firstmate` | E404 未注册 | 备选保留（未采用） |
| 11 | npm `deckhand` | 已被占用 | 不采用 |
| 12 | npm `gatedeck`（复核） | E404 仍未注册 | 维持可注册 ✓ |

**收尾结论（bin 名终裁 + D-23 回写）**：

1. **bin 三注册终裁（DP-1，CP-1 依预授权拍板）**：`gatedeck`（主 CLI）/ `pm`（别名）/ `gatedeck-mcp`（MCP server 入口），单包 `gatedeck` 一次发布。
2. **基准 D-23 回写已执行（2026-10-23，主理人冲刺预授权 AI 代笔）**：外部基准《06-产品基准-v2.1》D-23 行追加两段增注（2026-10-21 终核 + 2026-10-23 MCP 服务名终裁 gatedeck-mcp）、开放问题第 6 条标记闭环；本项目《00-开发基准》第七节命名契约第 6 条同步终裁结论。
3. 域名注册状态随时可变，npm 发布（W-S4-3）前复核一次本表 1/9/12 三项。

**任务状态**：T-M0a-07 → done（2026-10-23）；W-S0-2 → done。
