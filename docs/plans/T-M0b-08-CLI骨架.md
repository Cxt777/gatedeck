# T-M0b-08 CLI 骨架 计划日志

## 【范围】本次任务的范围

- 任务 ID / 任务名 / 目标：T-M0b-08 CLI 骨架——`pm`/`gatedeck` 双 bin 命令框架 + `init/discover/adopt/register/ls` 五子命令占位与帮助；discover/ls 纯只读。
- 边界 / 涉及文件：重写 `src/cli/index.ts`（命令注册表 + 可注入 IO + 直接执行守卫）；新增 `src/cli/index.test.ts`。package.json bin 双注册已存在，不改。
- 不做什么：五个子命令的真实逻辑（随 T-M1-01/T-M1-02）；不接 core 业务（骨架期占位连读也不做）；gatedeck-mcp 第三 bin 属 S3 冲刺任务。
- 风险点：占位命令被脚本误当成功——占位执行一律退出码 2 并明示未实现（W-06 诚实口径）；测试误触发主流程——加 `import.meta.url` 直接执行守卫。
- 红线自检：discover/ls 占位即无任何文件访问（B-7 纯只读前置）；帮助文案如实标注只读与未实现（W-06）；无密钥无个人数据。

## 【计划】具体实施的计划

- 步骤：① `CommandSpec` 注册表（name/summary/usage/lands/readOnly）；② `runCli(argv, io)` 可注入 IO 便于测试；③ help/--version/子命令 --help/未知命令/占位执行五类出口；④ 直接执行守卫；⑤ 测试覆盖全部出口 + 只读标注。
- 角色分工：AI 全部实现与验证；主理人无需介入。
- 验证手段：`pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` + `node dist/cli/index.js` 冒烟（help/version/占位/未知命令）。

## 【分类】分类标识

| 任务 ID | 阶段 | 类型 | 优先级 | 关联模块 | 关联 CHANGELOG 行号 |
|---|---|---|---|---|---|
| T-M0b-08 | M0b | cli 壳层 | 【必需】 | core/index（仅 CORE_VERSION） | （完成后回填） |

## 【结果】计划的执行结果（完成后追加）

- 实际产出：重写 `src/cli/index.ts`（CommandSpec 五命令注册表、runCli 可注入 IO、help/--version/子命令 --help/未知命令/占位执行五类出口、import.meta.url 直接执行守卫）+ `src/cli/index.test.ts`（9 用例覆盖全部出口与只读标注）。
- 验证结果：`pnpm typecheck` / `lint` / `test`（15 文件 208 用例全过）/ `build` 全绿；`node dist/cli/index.js` 冒烟通过（help/version/discover 占位 exit 2/未知命令 exit 2）。
- 计划偏差与原因：无。
- 未完成项与后续动作：五子命令真实逻辑随 T-M1-01/T-M1-02；gatedeck-mcp 第三 bin 属 WBS-W S3（DP-1 终裁）。
