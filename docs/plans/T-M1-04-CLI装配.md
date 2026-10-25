# T-M1-04-CLI装配 计划日志（W-S2-4）

> 复制自 `docs/plans/_TEMPLATE.md`；与 `docs/plans/T-M1-04-检查事实与失效判定.md`（core 内核）同任务 ID 分册：本册只记 CLI 装配层。

## 【范围】本次任务的范围

- 任务 ID / 任务名 / 目标：W-S2-4 = T-M1-04 CLI 装配——落地 `gatedeck gate check [--gate <门禁id>]` 只读命令（检查事实查询与失效判定）。
- 边界 / 涉及文件：
  - 新建 `src/cli/commands/gate.ts`（命令装配 + 渲染 + 可测纯函数）、`src/cli/commands/gate.test.ts`；
  - 修改 `src/cli/index.ts`（仅 import + COMMANDS 追加 gate 条目 + 路由，精确 Edit）；
  - 新建本计划日志。
- 不做什么：不实现 promote（W-S2-5 分册）；不执行任何门禁/shell 命令（R-07）；不改 core、mcp、测试骨架 `index.test.ts`、`02-CHANGELOG.md`、`01-TASK-SPECTRUM.md`（留痕由主流程统一落档）。
- 风险点：
  - `src/cli/index.test.ts` 既有断言「命令注册表恰为七个子命令 / readOnly 恰为 discover/ls/deck」与 COMMANDS 追加 gate 冲突——受「禁改其他文件」约束不修该测试，如实上报（修法：把 gate 补进两处期望列表）。
  - 仓库根 `pm/` 由并发会话新建（dogfooding），冒烟前提「无 pm/ → exit 2」需另在临时目录复现。
- 红线自检：R-01 文件唯一事实（不落派生态）｜R-02 本命令零写、changelog 只读｜R-03 无授权不执行命令（本版永不执行，R-07）｜R-04 不改写任何既有字节｜R-07 只读事实查询｜R-09 只喂 verified 事件（P-09）｜W-01/W-02 不触密钥与个人数据｜W-06 只列真实跑过的检查。

## 【计划】具体实施的计划

- 步骤分解：
  1. 读 core 契约：checkFacts（投影/失效/证据告示）、manifestFingerprint（四步 canonical）、eventEnvelope（信封/解析）、eventReceipt（verifyEventChain 裁定）、stageFold（B-16 链序口径）、derivedVersion（formatVersion）、mcp/tools/gates.ts（manifest 四契约文件口径与映射先例）；产物：口径确认。
  2. 写 `src/cli/commands/gate.ts`：可测纯函数 `parseGateCheckArgs` / `toCheckEventInput`（驼峰+下划线归一，与 mcp gates.ts 同口径）/ `collectVerifiedCheckEvents`（只取 verified、按链序 seq 喂入——B-16，core checkFacts JSDoc 明示装配方按收据链序喂入）/ `filterByGate` / `toRows` / `renderGateCheck`；IO 装配 `runGate`（无 pm/ → 引导 exit 2 同 deck；读取失败 exit 2；查询语义 exit 0）。
  3. 写 `src/cli/commands/gate.test.ts`（≥6，纯函数层面、不依赖真实文件）：映射完整/缺字段/not-checked、verified 链序重排、staleness 改判透传（不符→待复验、相符→保持通过）、--gate 过滤、渲染关键文案、参数解析。
  4. `src/cli/index.ts` 三处精确 Edit（import / COMMANDS 条目 / 路由）。
  5. 自验：`pnpm typecheck`；`pnpm vitest run src/cli/`；`pnpm build`；冒烟双场景（临时目录无 pm/ → exit 2；仓库根有 pm/ → 真实现状观察）。
- 角色分工：AI 全部实现与验证；主理人/主流程负责 CHANGELOG 与任务谱留痕、index.test.ts 期望列表收口。
- 验证手段：typecheck / vitest / build 三命令真实运行 + dist 冒烟退出码观察（W-06：只列真实跑过的）。

## 【分类】分类标识

| 任务 ID | 阶段 | 类型 | 优先级 | 关联模块 | 关联 CHANGELOG 行号 |
|---|---|---|---|---|---|
| T-M1-04（CLI 装配分册）/ W-S2-4 | M1 / WBS-W S2 | 壳层装配 | 【必需】 | src/cli/commands/gate.ts、src/cli/index.ts | 待主流程落档 |

## 【结果】计划的执行结果（完成后追加）

- 实际产出：
  - `src/cli/commands/gate.ts`（前向修复版，保留既有基线结构：`STATUS_LABELS` 词表、`currentManifest` 四契约口径、`runGateCheck` 入口名与 index.ts 路由零改）——新增/修复八个导出：`parseGateCheckArgs` / `toCheckEventInput` / `collectVerifiedCheckEvents` / `filterByGate` / `toRows` / `GateCheckRow` / `GateCheckView` / `renderGateCheck`；
  - `src/cli/commands/gate.test.ts`（11 用例，纯函数层面、不依赖真实文件）；
  - 本计划日志；`02-CHANGELOG.md` 与任务谱留痕按文件边界由主流程/兄弟会话落档（未越界）。
- **并发仲裁与如实记录（R-03/W-06）**：装配时发现并发会话已于 08:08 写入同任务的 gate.ts/promote.ts/index.ts 路由（收据链装配批量会话），经升级裁定按 **(c) 前向修复** 执行——以现有 gate.ts 为基线最小精准修复，不整文件重写。修复的三处硬伤：
  1. **映射缺陷**：原 `toCheckEventInputs` 从不映射 gateId/ruleId（payload 原样透传而 core `checkFacts.parsePair` 只读 `payload['gateId']`），下划线键（gate_id/rule_id，core/MCP 通道实际命名）事件被整笔丢弃、检查事实恒空——现按 mcp gates.ts 同口径归一到顶层便捷字段（`toCheckEventInput`）；
  2. **verified 识别键碰撞**：原以 `kind|recorded_at|operation_id` 拼键识别验真事件（同 kind 同时刻无 operation_id 即碰撞，P-09 破防）——现按 `verifyEventChain` 契约 perEvent 与 envelopes 同序按位配对（`collectVerifiedCheckEvents`），并按收据链 seq 升序喂入（B-16，checkFacts JSDoc「装配方按收据链序喂入」）；
  3. **缺失面补齐**：--help（exit 0）、无 pm/ 初始化引导（exit 2，同 deck）、--gate 严格解析（缺值/重复/未知参数拒绝 exit 2）、尾部 manifest 指纹与 as_of 行（formatVersion，口径=验真事件按链序最后一笔 recorded_at/验真笔数）、R-07/D-26 诚实声明 + CHECK_EVIDENCE_NOTICE（复用 core 常量不另立措辞）、manifest 缺失文件/坏收据行/坏锚点/未验真/malformed/链级问题全部如实注记；另修 `currentManifest` 补缺失清单返回并消除「零条目时静默跳过失效比对」的 B-3 盲区（改为如实注记不猜测改判）。
- 验证结果（真实运行）：
  - `pnpm typecheck`：首轮 exit 2（唯一报错 `promote.test.ts:84` TS2375，属 S2-5 兄弟职权文件的瞬时中间态，其随后自修）；终轮 **exit 0**。另隔离 `npx tsc --noEmit …gate.ts gate.test.ts` exit 0；
  - `pnpm vitest run src/cli/`：**39/40 用例通过**——唯一失败 `index.test.ts:106`「命令注册表恰为七个子命令」系 gate/promote 入册前的过时断言（该文件不在本任务可改边界内，如实上报；修法：期望列表补 `gate`/`promote`、readOnly 列表补此二只读命令）；`pnpm vitest run src/cli/commands/gate.test.ts` **11/11 绿**；
  - `pnpm build`：exit 0（`dist/cli/commands/gate.js` 产出）；
  - 冒烟：仓库根 `node dist/cli/index.js gate check` → 查询语义 exit 0（1 笔验真事件、0 检查事实、manifest 4 条目、as_of/指纹行齐全）；无 pm/ 临时目录 → 初始化引导 **exit 2**（任务命名前提因 pm/ 已由并发会话建立，另以临时目录复现）；`gate check --help` → exit 0；`gate check --gate G-M1` → 过滤头 + exit 0。
- 计划偏差与原因：未按原案整文件新建 gate.ts——并发仲裁改为基线上前向修复（产出等价、保留基线正确部分）；promote.ts/promote.test.ts 依裁定未触碰（S2-5 兄弟职权，其测试 17 用例已绿）。
- 未完成项与后续动作：①`index.test.ts` 期望列表待主流程收口（两处断言补 gate/promote）；②`02-CHANGELOG.md` 留痕与 W-S2-4 状态迁移由主流程执行（本任务边界未动）；③gates.md 门禁定义解析器仍未落地，检查事实暂以事件流被引用组合为口径（沿用 mcp gates.ts 诚实注记）。
