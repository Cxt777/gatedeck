# 注册表 provider · 定稿设计文档（T-M0a-06）

> 任务：T-M0a-06 ｜ 日期：2026-10-20 ｜ 状态：AI 定稿建议，**随 G-M0a 提请主理人过目后生效**
> 依据：《[06-产品基准-v2.1](../../../../../PM/docs/产品方案/06-产品基准-v2.1.md)》MOD-01 / D-27 / D-30 / B-14 / B-15

## 一、定稿结论

1. **两 provider 统一投影 `RegistryProjection`**（discover/总览消费）：`{ source, project_id, display_name, locator, managed }`。
2. **native**（通用工作区默认）：
   - `.gatedeck/registry.md`（git 管理）：登记行 **append-only**（R-02），列 = `project_id / workspace_id / slug / display_name / managed / registered_at`；`appendNativeRegistryEntry` 只在表尾追加、前缀字节不动，重复 project_id/workspace_id 拒绝；
   - `registry.local.md`（默认 git 忽略）：`binding_key / locator / observed_at` 属机器本地状态；**locator 就地震荡更新**（`updateLocalLocator` 只改 locator/observed_at 两格，workspace_id/binding_key 不变——B-14），registry.md 与 registry.local.md 的 append/update 不对称是设计使然（历史登记 vs 可变本地状态）。
3. **projects-index**（本 AI 工作区采用，D-30）：**只读**解析工作区根 PROJECTS-INDEX.md 登记表投影；**只读由 API 形状保证**——模块不存在任何以 PROJECTS-INDEX 为写入目标的函数，`registry.test.ts` 以结构性断言守护（B-15）；不创建第二注册表、不向工作区根写 `.gatedeck/`。
4. **ULID/ISO 校验复用 eventEnvelope 同源实现**（避免双口径）；ULID 与 binding_key 的**随机生成由调用方注入**（core 纯度约束），core 只做校验与格式化。
5. 表格解析行级保真：单元格文本原样、未知列保留并出诊断（F-06）、CRLF/LF EOL 风格在追加与更新中保持（R-04）。

## 二、实现落点与测试证据

| 项 | 落点 |
|---|---|
| provider 内核 | `src/core/registry.ts`（纯函数，无 IO） |
| 测试 | `registry.test.ts` 12 用例：registry.md 生成→解析 round-trip、追加前缀字节一致 + 重复拒绝、CRLF 保持、坏值诊断（非 ULID/无时区/managed 非bool）、未知列保留（F-06）、缺列诊断、registry.local round-trip、**B-14** locator 更新（ws/binding_key 不变 + 他行字节不动）、CRLF 更新、projects-index 解析、**B-15** 结构性断言（无写入导出）、投影（projects-index managed 恒 false；native 本地绑定不匹配抛出） |
| 下游 | T-M0b-08 CLI（discover/ls 只读消费）、T-M1-02 discover/adopt、本工作区接入时 projects-index provider 接 PM 根 PROJECTS-INDEX.md |
| 待主理人过目项 | ① native registry.md 列集与 append-only 纪律；② registry.local.md 与 registry.md 的 append/update 不对称；③ projects-index 只读由 API 形状保证的方式 |

## 三、计划日志

[docs/plans/T-M0a-06-注册表provider.md](../plans/T-M0a-06-注册表provider.md)
