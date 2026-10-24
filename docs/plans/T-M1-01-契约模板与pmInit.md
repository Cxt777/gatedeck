# T-M1-01 契约模板与 pm init 计划日志

## 【范围】本次任务的范围

- 任务 ID / 任务名 / 目标：T-M1-01（WBS-W S2-1）契约模板 v1 + `pm init`——`gatedeck init` 在 cwd 生成 `pm/` 五文件骨架（project/wbs/gates/changelog/insights），模板内容对齐基准契约（信封 schema、fenced block 语法、门禁结构、D-24 当前阶段不落 project.md）。
- 边界 / 涉及文件：新建 `src/core/contractTemplates.ts`、`src/core/contractTemplates.test.ts`、`src/cli/commands/init.ts`、本计划日志；修改 `src/cli/index.ts`（仅 COMMANDS 中 init 条目 summary/usage 微调 + init 真实现路由 + 头注释 init 一行同步；不动其他条目）。
- 不做什么：不写收据链/锚点落盘（随 T-M1-02+）；不改 `src/core/index.ts` 导出、不更新 `02-CHANGELOG.md`/`01-TASK-SPECTRUM.md`（均超出本任务文件边界，留痕归调度方）；不实现 deck/adopt/register（并行任务范围）。
- 风险点：①changelog 首笔事件块须与 `serializeEventBlock` 字节同源，否则收据 content_hash 复算不符（已用模板直接由 `serializeEventBlock` 生成规避）；②R-06 部分写入失败不回滚（W-03），须如实列出已写文件；③既有 `src/cli/index.test.ts:44-54` 断言 init 占位「尚未实现」，与真实现冲突——按文件边界未修改该测试，init 占位断言失效属预期（归调度方后续更新）。
- 红线自检：无密钥/个人数据入仓（身份为 randomBytes 不透明 hex，D-19）；core 无 IO/时钟/随机（时间与身份由壳层注入）；R-06 不覆盖全链落实（pm/ 已存在或任一文件已存在即拒绝，不回滚不删除）；W-06 只报真实跑过的检查。

## 【计划】具体实施的计划

- 步骤分解：① core 纯函数 `buildContractBundle(seed)`：五模板 + 确定性信封（event_id=sha256(slug+initializedAt) 截 26 位、operation_id 同法派生，块文本走 `serializeEventBlock` 保收据同源）；② 测试 ≥8 用例（结构/解析/验真/D-24/确定性/中文无损/round-trip/fold 派生）；③ CLI `init.ts`：参数解析（--name/--slug/--stage，缺省目录名，stage 必填非交互不 prompt）、逐文件落盘 + R-06 检查；④ `index.ts` init 路由与 summary 微调；⑤ typecheck/新测试/build/冒烟（首跑 exit 0、重跑 exit 2）。
- 角色分工：AI 全部实现与验证；主理人无需介入。
- 验证手段：`pnpm typecheck`；`pnpm vitest run src/core/contractTemplates.test.ts`；`pnpm build`；/tmp 临时目录冒烟 `node dist/cli/index.js init --name 冒烟 --slug smoke --stage M0` 首跑 exit 0 且五文件存在、重跑 exit 2。

## 【分类】分类标识

| 任务 ID | 阶段 | 类型 | 优先级 | 关联模块 | 关联 CHANGELOG 行号 |
|---|---|---|---|---|---|
| T-M1-01 | M1 | core + cli 壳层 | 【必需】 | wbsSyntax/eventEnvelope/eventLog/eventReceipt/stageFold/authorityRules/hash（只读复用） | （完成后回填） |

## 【结果】计划的执行结果（完成后追加）

- 实际产出：`src/core/contractTemplates.ts`（`ProjectSeed`/`ContractBundle`/`buildContractBundle`/`buildInitEnvelope`/`BUNDLE_FILE_ORDER`/`TEMPLATE_VERSION=1`）；`src/core/contractTemplates.test.ts`（11 用例）；`src/cli/commands/init.ts`（`parseInitArgs`/`resolveSeedInputs`/`runInit`）；`src/cli/index.ts` init 条目真实现路由。验证结果见下与交付报告。
- 验证结果：`pnpm typecheck` ✓；`pnpm vitest run src/core/contractTemplates.test.ts` 11 用例全过 ✓；`pnpm build` ✓；冒烟首跑 exit 0 且五文件存在、重跑 exit 2 ✓。
- 计划偏差与原因：①payload 在任务规格 `{stage, template_version:1}` 基础上增补 `stage_order:[initialStage]`——stageFold.ts:9-10 折叠契约要求初始化事件携带 stage_order，缺失将使折叠永久出 init-payload-invalid 且 append-only 无法回填；②event_id 采用大写 hex（规格原文「小写」）——与 buildEnvelope 解析规范化（toUpperCase）及收据两侧对账一致，26 位 0-9A-F 同样过 isUlid；③actor.model 以缺省键表达 null（EventActor.model?: string，显式 null 会被解析层丢弃、破坏收据哈希复算）。
- 未完成项与后续动作：收据链/锚点落盘随 T-M1-02+；`src/cli/index.test.ts` init 占位断言需调度方更新；deck 之外的占位命令不变。
