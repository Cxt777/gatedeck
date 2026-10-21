# T-M0b-01 wbs.md 解析/校验/局部修改内核 计划日志

## 【范围】本次任务的范围

- 任务 ID / 任务名 / 目标（一句话）：T-M0b-01 —— 在 T-M0a-02 定稿语法之上落地 wbs.md 的解析、校验与局部修改内核，保证 round-trip 保真（R-04/P-04）。
- 边界 / 涉及文件：新增 `src/core/wbsKernel.ts`、`src/core/wbsKernel.test.ts`；`src/core/index.ts` 增加导出。
- 不做什么：乐观并发 CAS（T-M0b-03）、权威位置冲突显示（T-M0b-05，含标题/块内 title 冲突与时间语义字段拒绝）、CLI 接入（T-M0b-08）。
- 风险点：字段行号定位在 CRLF 下偏移；重复 id 的读取幂等口径（取首笔，B-13 精神）。
- 红线自检：P-04 未知内容保留并报错；R-04 round-trip 字节级保真；core 无 IO。

## 【计划】具体实施的计划

- 步骤 1：`wbsKernel.ts` —— 已知/必需字段集、状态枚举常量；`validateWbsDocument`（节点级：必需字段/状态枚举/deps 格式/未知字段 F-06；文档级：重复 id、悬空 deps）；`updateTaskFieldById`（按 id 定位节点 → updateField → reconstruct）。
- 步骤 2：`wbsKernel.test.ts` —— 富样本 round-trip 字节级（注释/未知字段/中文/CRLF/嵌套代码块/未闭合）；校验诊断逐项；局部修改只动目标行；重复 id 取首笔。
- 步骤 3：验证 `pnpm lint / typecheck / test / build` 全绿。

## 【分类】分类标识

| 任务 ID | 阶段 | 类型 | 优先级 | 关联模块 | 关联 CHANGELOG 行号 |
|---|---|---|---|---|---|
| T-M0b-01 | M0b | 内核实现 | 高 | src/core | 追加于 02-CHANGELOG.md |

## 【结果】计划的执行结果（完成后追加）

- 实际产出：`src/core/wbsKernel.ts`（validateWbsDocument 节点级+文档级校验 / updateTaskFieldById 局部修改 / getNodeField）与 17 用例测试；`index.ts` 导出。
- 验证结果：与 T-M0b-02 同批全量验证——pnpm lint / typecheck / test（9 文件 122 用例）/ build 全绿。
- 计划偏差与原因：用例数 22→17（部分场景合并），无功能偏差。
- 未完成项与后续动作：无（验收标准全部满足）。
