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
