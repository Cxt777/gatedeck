# T-M1-05 CLI 装配（gatedeck promote）计划日志

## 【范围】本次任务的范围

- 任务 ID / 任务名 / 目标（一句话）：W-S2-5 CLI（task=W-S2-5-cli）——`gatedeck promote` 写命令装配：读 changelog 找 pending 的 authorization.requested → 真人 TTY 交互确认（B-12）→ 依次追加 authorization.locally_confirmed 与 promotion.completed 两笔 core 事件（CAS 写盘）→ 同步重建收据链 → 输出新投影。
- 边界 / 涉及文件：
  - `src/cli/commands/promote.ts`（重写承接：本文件在本次会话早前已有一份同任务草稿，本次按规格补齐重写，见「计划偏差」）
  - `src/cli/commands/promote.test.ts`（新建，17 用例）
  - `docs/plans/T-M1-05-CLI装配.md`（本日志）
  - `src/cli/index.ts`：promote 的 COMMANDS 条目与路由**已由并行工作流先行加入**（本任务开工时 working tree 已含），本次核对签名匹配（`runPromote(argv.slice(1), io)`）后未再改动。
- 不做什么：不改 `src/cli/commands/gate.ts`（W-S2-4 并行任务产物）、`src/managed/receipts.ts`（收据链装配层，另一工作流产物，本任务只消费）、`src/cli/index.test.ts`（其「注册表恰为七命令」断言因 gate/promote 入册而过时，本任务红线禁改该文件）、`01-TASK-SPECTRUM.md` 与 `02-CHANGELOG.md`（沿 T-M1-05 core 任务先例，状态迁移与留痕由主理人流程处理）；不做门禁命令执行（R-07）；不实现 authorization.granted（B-4）。
- 风险点：apply 步事件 kind 的两套命名（promotionFlow 状态机 `task.transitioned` vs stageFold 折叠契约 `promotion.completed`）——本装配按 stageFold 契约落盘 `promotion.completed`（foldStage 唯一消费的阶段迁移 kind，D-24）；init 模板的 stage_order 仅含首阶段（contractTemplates.ts:99），对 init 直建项目任何推进预演都会判「非法跳跃」——属上游契约事项，本命令如实预演并提示，不擅自放宽折叠规则。
- 红线自检：R-02 append-only（appendEventBlock 前缀字节不动）；P-06/B-1 内容基线 CAS（读时记 hash→写前重读比对，不一致拒绝提示重跑）；B-12（isTtyInteractive 非交互 exit 2，默认拒绝）；B-4/kind×origin（两笔新事件 origin=core、kind 均在 CORE_KINDS）；B-10/B-11（既有链有问题或与文档 core 事件不一一对应 → 拒绝推进与重建，不静默重算）；R-09（无法归属/手工内容不假设）；D-22/W-02（主体只存 node:crypto 不透明随机 ID）；W-06（折叠预演拒绝时确认前明示、写入后如实报告，不虚报迁移生效）；R-07（本命令不执行任何命令）。

## 【计划】具体实施的计划

- 步骤分解：
  1. 先读 core 契约（checkFacts / promotionFlow / eventEnvelope / eventLog / stageFold / eventReceipt / optimisticWrite / derivedVersion）与装配参考（deck.ts 收据读取路径、mcp gates.ts request_promotion 的申请事件形状、managed/receipts.ts 重建口径）；核对并行工作流对 init.ts / index.ts / managed/receipts.ts 的既有改动。
  2. 重写 `src/cli/commands/promote.ts`：参数解析（`--operation-id` 两种形态）→ pm/ 预检 → 收据链现状预检（B-10/B-11）→ pending 挑选（规格指名调 `nextPromotionPhase`，phase==='requested'；缺省取文档序最新，`--operation-id` 精确指定）→ B-12 → 折叠预演 → 展示确认（逐行申请内容 + 默认拒绝）→ 两笔事件 appendEventBlock + CAS 落盘 → `rebuildReceiptsForFile` 重建收据链 → 新 as_of/源版本输出。
  3. 新建 `src/cli/commands/promote.test.ts`（≥8 条规格点全部覆盖，纯逻辑 + 临时项目编排路径，不做真 TTY 测试）。
  4. 验证：`pnpm typecheck` → `pnpm vitest run src/cli/commands/promote.test.ts` → `pnpm build` → 冒烟（无 pm/ 引导 exit 2；临时项目 `echo n | promote` 非交互拒绝 exit 2）→ eslint 新文件 → 全量套件（如实报告与红线冲突的既有断言）。
- 角色分工：AI 负责实现与验证；主理人负责任务谱迁移、CHANGELOG 留痕与验收。
- 验证手段：见【结果】验证结果。

## 【分类】分类标识

| 任务 ID | 阶段 | 类型 | 优先级 | 关联模块 | 关联 CHANGELOG 行号 |
|---|---|---|---|---|---|
| W-S2-5 / T-M1-05 | M1 | CLI 壳层装配（写命令） | 高 | src/cli/commands/promote.ts；上游 promotionFlow / stageFold / eventLog / eventReceipt / optimisticWrite / managed/receipts | （主理人留痕时回填） |

## 【结果】计划的执行结果

- 实际产出：
  - `src/cli/commands/promote.ts`（重写承接早前同任务草稿）：可测纯逻辑导出 `parsePromoteArgs` / `selectPendingPromotion` / `evaluateConfirmation` / `buildLocallyConfirmedEnvelope` / `buildPromotionEnvelope` / `planPromotionEvents`；编排入口 `runPromote(argv, io, cwd?, deps?)`（时钟/随机/TTY/stdin 全注入，默认真实实现）。
  - `src/cli/commands/promote.test.ts`：17 用例。
  - 本计划日志。
- 验证结果（W-06 如实留痕，全部为本次会话实际执行）：
  - `pnpm typecheck` → 退出码 0。
  - `pnpm vitest run src/cli/commands/promote.test.ts` → 17 passed。
  - `pnpm build` → 退出码 0。
  - 冒烟 1（临时空目录）：`node <dist>/cli/index.js promote` → 退出码 2，输出初始化引导（无 pm/ 路径）。
  - 冒烟 2（临时项目含待审申请）：`echo n | node <dist>/cli/index.js promote` → 退出码 2，B-12 拒绝文案，changelog 字节不变（非交互拒绝路径）；真实确认路径在 vitest happy-path 用例中以注入依赖覆盖（事件追加 + 收据链 3 条 + 折叠派生新阶段）。
  - `pnpm exec eslint src/cli/commands/promote.ts src/cli/commands/promote.test.ts` → 0 告警。
  - `pnpm vitest run`（全量）→ 如实记录：`src/cli/index.test.ts` 的「命令注册表恰为七个子命令」断言因 gate/promote 入册而失败（该断言过时，修复需改 `src/cli/index.test.ts`，本任务红线禁改），其余用例通过。
- 计划偏差与原因（含对早前草稿的承接与修正）：
  1. **承接说明**：本任务文件在会话早前已存在一份草稿（同一 W-S2-5 任务的中断产物），本次按规格重写承接。修正点：①申请挑选改按规格调 `nextPromotionPhase`（草稿手写的 DONE-set 扫描在多操作交错时误判 pending）；②`expected_sequence` 改取收据链**实际序位**（现有 core 事件数 + 2）——草稿复制申请声明值，折叠重放防护（stageFold expected_sequence≠链序即拒绝）会令推进永不生效；③新增收据链现状预检与折叠预演；④event_id 改用 adopt.generateUlid（草稿的 hex 截断拼凑可过 isUlid 但不合 ULID 语义）。
  2. **apply 步 kind**：按 stageFold FoldEvent 契约落盘 `promotion.completed`（stageFold.ts:12/158）；promotionFlow 状态机的 `task.transitioned` 命名不落盘（foldStage 不消费它）。相位判定仍按规格调 `nextPromotionPhase`（只取 phase==='requested'）。
  3. **收据链重建**：消费 `managed/receipts.rebuildReceiptsForFile`（managed=cli/mcp 共用装配层；origin=core 过滤 + receipts.jsonl/anchor 落盘），不另写第二套收据写入器；重建失败时事件保留、如实按 unregistered 态提示（规格的 fallback 分支）。CAS 仅护 changelog（SSOT）；收据为派生层，沿用 managed 层直接落盘口径。
  4. **折叠预演**：写入前把 core 信封按文档序视为 verified 干跑 foldStage——既覆盖「收据未建时阶段不可派生」的 fresh 项目（预演即建链后的真实折叠输入），也把「越级/过期申请」在确认前明示；预演拒绝**不硬拒**（事件由真人确认后合法产生，折叠层保留拒绝原因，硬拒会令 init 直建项目永远无法推进——stage_order 冻结于 init 事件属上游契约事项），写入后如实报告投影结果。
  5. **B-11 预检口径**：既有收据存在时要求与文档 core 事件一一对应（防重建把未登记的手工 core 事件「转正」，R-09）；changelog 中重复 event_id 块按 verifyEventChain 链级问题拒绝推进（B-11 调用方不得静默忽略）。
  6. **退出码**：0 成功；1 业务拒绝（无 pending / 用户拒绝 / 申请不可执行）；2 环境与状态错误（无 pm/、参数错、链需处理、非交互 B-12、CAS 竞争）。
- 未完成项与后续动作：
  - `src/cli/index.test.ts` 注册表断言收敛（gate/promote 入册后应更新为九命令）→ 需改该文件，超出本任务红线，留主理人/后续任务。
  - init 模板 stage_order 仅首阶段导致 init 直建项目推进预演必拒 → 上游契约事项（stage_order 扩展机制），留主理人裁决。
  - `01-TASK-SPECTRUM.md` / `02-CHANGELOG.md` 留痕 → 主理人流程。
