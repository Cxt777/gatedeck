# T-M1-07-handoff交接包 计划日志

## 【范围】本次任务的范围

- 任务 ID / 任务名 / 目标（一句话）：W-S2-7（=T-M1-07）`pm handoff` 交接包（含 `revive` 别名）——生成六段结构、携带源版本与生成时间的 Markdown 交接包，软预算超限明示不裁剪（B-8）。
- 边界 / 涉及文件：新建 `src/core/handoffCompose.ts`、`src/core/handoffCompose.test.ts`、`src/cli/commands/handoff.ts`、`docs/plans/T-M1-07-handoff交接包.md`；修改 `src/cli/index.ts`（仅 COMMANDS 追加 handoff 条目 + 路由）。
- 不做什么：`--write` 落盘（本版仅 stdout）；brief 复用估算函数的调用方；收据链路接入 CLI（锚点路径待存储层定稿，M1 以空收据集投影）；任务谱（01-TASK-SPECTRUM.md）与 CHANGELOG 留痕（本任务红线禁止改其他文件，由主理人/后续流程补记）；`index.test.ts` 中「五子命令占位执行」用例的适配（见下）。
- 风险点：`src/cli/index.ts` 为共享热点（并行任务加 deck 命令）——采用「先 Read 最新再精确 Edit 追加」；`COMMANDS` 追加后 `index.test.ts` 的占位断言将遍历到 handoff 而失败（该文件被红线禁止修改）。
- 红线自检：core 零 IO/零时钟（生成时间由壳层 `new Date().toISOString()` 注入）；未知/缺段拒绝不静默补段（R-08）；预算超限拒绝不裁剪（B-8）；无密钥、无用户数据入仓（W-01/W-02）；非破坏性操作（W-03）；未虚报验证（W-06）。

## 【计划】具体实施的计划

- 步骤分解（按依赖顺序，每步标注产物）：
  1. 读 `derivedVersion.ts`（DerivedVersion/formatVersion）、`eventEnvelope.ts`（isIsoDateTimeWithTz）、`eventLog.ts`/`stageFold.ts`（投影接口）、`cli/index.ts` → 产物：接口设计定稿；
  2. core：六段常量表 + `composeHandoff`（未知段→缺段→非法生成时间→渲染→软预算五步校验）+ `estimateHandoffTokens`（ASCII×0.25 + 非 ASCII×1 向上取整） → `handoffCompose.ts`；
  3. core 测试 ≥9 用例（结构顺序断言代替快照文件，避免落盘测试产物） → `handoffCompose.test.ts`；
  4. cli：`runHandoff`（无 pm/ 引导 exit 2；有 pm/ 尽力装配六段；version=projectEventLog+foldStage 空收据集投影） → `commands/handoff.ts`；
  5. `cli/index.ts` COMMANDS 追加 + `handoff`/`revive` 提前路由（revive 不注册进 COMMANDS，须在 spec 查找前拦截）；
  6. 自验：`pnpm typecheck` / `pnpm vitest run src/core/handoffCompose.test.ts` / `pnpm build` / 冒烟 `node dist/cli/index.js handoff`（无 pm/ 引导 exit 2）。
- 角色分工：AI 负责步骤 1–6 全部实现与验证；主理人负责验收报告复核与 CHANGELOG/任务谱留痕。
- 验证手段：基准第八节最低验证线——core 单测（12 用例）+ typecheck + build + CLI 冒烟（真实跑，W-06）。

## 【分类】分类标识

| 任务 ID | 阶段 | 类型 | 优先级 | 关联模块 | 关联 CHANGELOG 行号 |
|---|---|---|---|---|---|
| T-M1-07（W-S2-7） | M1 | feat（core+cli） | 高 | src/core/handoffCompose、src/cli | （待主理人留痕） |

## 【结果】计划的执行结果（完成后追加）

- 实际产出：`src/core/handoffCompose.ts`（六段常量 + composeHandoff 五步校验 + estimateHandoffTokens）、`src/core/handoffCompose.test.ts`（12 用例）、`src/cli/commands/handoff.ts`（M1 装配 + runHandoff）、`src/cli/index.ts`（COMMANDS 追加 handoff 条目；handoff/revive 提前路由；未动既有条目与结构）、本计划日志。
- 验证结果：`pnpm vitest run src/core/handoffCompose.test.ts` 12/12 通过；`pnpm typecheck` 通过；`pnpm build` 通过；冒烟 `node dist/cli/index.js handoff` 在无 pm/ 的仓库根输出「未找到 pm/ 受管目录：先运行 gatedeck init…」退出码 2，`node dist/cli/index.js handoff --help` 退出码 0 显示 usage；`node dist/cli/index.js help` 帮助含 handoff 条目（readOnly=false 不标［纯只读］）。
- 计划偏差与原因：
  1. 测试用例从计划 9 例扩为 12 例（补「恰好等于预算放行」边界）；
  2. 未跑 `pnpm vitest run`（全量）：任务自验指定单文件；已知 `src/cli/index.test.ts`「五个子命令占位执行」用例遍历 COMMANDS 断言所有命令均为占位（含「尚未实现」文案），handoff 真实现落地后该用例会失败——红线禁止修改 `index.test.ts`，留待后续任务适配（并行任务加 deck 命令后同样受影响，非本任务独有）。
- 未完成项与后续动作：CHANGELOG 留痕与任务谱状态迁移（主理人/后续流程）；收据链路接入 CLI 投影（随存储层锚点路径定稿）；`--write` 落盘参数（后续写路径任务）。
