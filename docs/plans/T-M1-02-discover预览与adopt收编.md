# T-M1-02 discover预览与adopt收编 计划日志

> 每个 WBS 任务开工前复制本模板到 `docs/plans/{WBS-ID}-{简述}.md` 填写前三区块；【结果】完成后追加。
> 创建动作与任务状态变更都必须在 `02-CHANGELOG.md` 留痕。

## 【范围】本次任务的范围

- 任务 ID / 任务名 / 目标（一句话）：T-M1-02（W-S2-2）最小注册——discover 只读预览 + adopt 显式收编 + .gatedeckignore，让「发现→收编」路径走通且 discover 全程零写动作（B-7）。
- 边界 / 涉及文件（本次创建或修改的文件清单）：
  - 新建 `src/core/discoverRules.ts`（候选三信号判定 / .gatedeckignore 最小 glob / markOffline 离线标记，纯计算无 IO）；
  - 新建 `src/core/discoverRules.test.ts`（13 用例）；
  - 新建 `src/cli/commands/discover.ts`（只读扫描预览：向下 1~3 层、单目录条目上限 500、读取 .gatedeckignore、离线标注，零写动作）；
  - 新建 `src/cli/commands/adopt.ts`（显式收编：候选校验 → registry.md append-only 登记 + registry.local.md 本地绑定，重复登记拒绝）；
  - 修改 `src/cli/index.ts`（仅 discover/adopt 真实现路由 + summary 更新；init/deck/handoff 既有路由不动）；
  - 新建本计划日志。
- 不做什么：`register` / `ls` / `init` 命令逻辑（维持占位或他人已落地实现）；projects-index provider 接入（T-M1-12 自举）；registry.local.md 的 locator 就地更新（updateLocalLocator 的 CLI 化）；任何门禁命令执行（R-07）。
- 风险点：巨型目录误扫（用 500 条目上限 + 截断提示兜底）；registry.md 首次创建与追加两条路径混用（严格区分：文件不存在才 serialize 创建，存在则只 append，存在但无登记表则拒绝重建）；并行任务共改 src/cli/index.ts（按既有 inline 路由模式最小插入，不还原他人改动）。
- 红线自检：R-01（Markdown SSOT——登记只写 .gatedeck/registry.md/.local.md）；R-02（append-only——追加行走 core appendNativeRegistryEntry，既有字节不动）；R-04（core append 保 EOL 风格）；R-07（discover 永不执行任何命令）；R-08（路径失效显示「离线」不静默移除；忽略路径记入 ignored 展示）；W-01/02（无密钥无个人数据）；W-04（无端口）；core 纯度（无 node:* import、无 Date.now/Math.random，随机性由 CLI deps 注入）。

## 【计划】具体实施的计划

- 步骤分解（按依赖顺序，每步标注产物）：
  1. core：`discoverRules.ts`——classifyCandidates（三信号布尔映射、全无非候选）、applyIgnore（`**` 多段 / `*` 单段 / 精确，ignored 如实记录）、markOffline（同序同量输出，不剔除）；
  2. core 测试：13 用例覆盖三信号组合 / 全无 / glob 边界（a/b/c vs `a/**` vs `a/*`）/ ignored 记录 / 中文路径 / offline 判定 / 空输入；
  3. cli discover：BFS 扫描（跳过 `.` 隐藏目录与 node_modules）→ .gatedeckignore 逐行（# 注释与空行忽略）→ applyIgnore → classifyCandidates → 文本预览（候选 + 信号 + 「未入册，adopt 显式收编」提示；已登记项目在线/离线标注；截断/不可读/诊断如实提示），零写动作，恒返回 0（无参时）；
  4. cli adopt：路径存在校验（不存在 exit 2）→ 同源候选校验（非候选 exit 2）→ 只读解析 registry.md/registry.local.md（缺陷拒绝追加）→ 重复登记拒绝（project_id / locator 双口径，与 core 既有拒绝文案同源）→ registry.md 追加（不存在则 serialize 首建；存在但无登记表拒绝重建）→ registry.local.md 追加本地绑定 → 输出登记结果，全程中文报错 exit 2；
  5. cli index：按既有 inline 路由模式注册 discover/adopt，readOnly 标注保持 discover=true / adopt=false，summary 更新为真实现语义；
  6. 计划日志 + 自验（typecheck / 新测试 / build / 双冒烟）。
- 角色分工：AI 负责全部实现与自验；主理人负责 G-M1 人工验收项与任务谱状态确认（本子任务在文件边界内不改任务谱/CHANGELOG，由编排方统一留痕）。
- 验证手段：`pnpm typecheck`；`pnpm vitest run src/core/discoverRules.test.ts`；`pnpm build`；冒烟 `node dist/cli/index.js discover`（仓库根，零写动作）与 `node dist/cli/index.js adopt ./nonexist`（应 exit 2）；另跑全量 `pnpm vitest run` 如实记录（含并行任务造成的既有失败，见【结果】）。

## 【分类】分类标识

| 任务 ID | 阶段 | 类型 | 优先级 | 关联模块 | 关联 CHANGELOG 行号 |
|---|---|---|---|---|---|
| T-M1-02（W-S2-2） | M1 最小产品闭环 | 功能（最小注册） | 【必需】 | src/core/discoverRules、src/cli/commands/discover、src/cli/commands/adopt、src/cli/index | 待编排方补记 |

## 【结果】计划的执行结果（完成后追加）

- 实际产出：
  - `src/core/discoverRules.ts`：classifyCandidates / applyIgnore（含段内 `*` 通配与 `**` 零或多段语义，已用测试钉死 `a/**` 命中 `a/b`、`a/b/c` 亦命中 `a` 本身）/ markOffline 三组纯函数；
  - `src/core/discoverRules.test.ts`：13 用例全绿；
  - `src/cli/commands/discover.ts`：只读扫描（深度 3、单目录 500 条上限、跳过 `.` 隐藏目录与 node_modules）+ ignore 过滤 + 候选/已登记/忽略三段预览；零写动作；无参返回 0、带参 exit 2；
  - `src/cli/commands/adopt.ts`：显式收编全流程 + ULID 生成器（Crockford Base32，时间戳 + 随机段，满足 core isUlid）+ deps 注入（now/ulid/bindingKey，随机性不入 core）；
  - `src/cli/index.ts`：discover/adopt inline 路由 + summary 更新，既有五子命令及 init/deck/handoff 路由未动。
- 验证结果：typecheck ✓；`pnpm vitest run src/core/discoverRules.test.ts` 13/13 ✓；`pnpm build` ✓；冒烟 discover（仓库根）退出 0、输出只读承诺与三段预览 ✓（git 文件树前后比对零变化，.gatedeck 未产生，零写动作实证）；冒烟 `adopt ./nonexist` 退出 2 中文报错 ✓；另在仓库外临时目录完成端到端验证：首收编建 registry.md/registry.local.md、重复收编拒绝 exit 2、第二次收编 append-only 追加、删目录后 discover 显示「离线」、.gatedeckignore 中文精确模式生效、已入册候选交叉标注。`pnpm lint` 本任务文件零告警（余 2 个 error 属并行任务文件 deck.ts/init.ts，按边界不动，见 notes）；全量 vitest 见「计划偏差」。
- 计划偏差与原因：
  - 发现并行任务（T-M1-01 init / W-S2-6 deck / T-M1-07 handoff）已先行修改 src/cli/index.ts 且 src/cli/index.test.ts 未同步（仍断言五子命令占位退出码 2）——本任务按红线不改 index.test.ts，仅按既有 inline 路由模式插入 discover/adopt；index.test.ts 的过期断言属既有现状，已在交付 notes 中如实报告，由编排方/后续任务统一更新；
  - 修一处 `noUncheckedIndexedAccess` 下的解构类型错误（matchSegments 改用 pattern[0] 判空）。
- 未完成项与后续动作：`register` / `ls` 落地（T-M1-02 剩余面）；projects-index provider 的 discover 接入（T-M1-12）；adopt 后更名/移动目录的 locator 就地更新 CLI 化（B-14 后续）。
