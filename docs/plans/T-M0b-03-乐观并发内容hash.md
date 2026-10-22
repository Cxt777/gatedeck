# T-M0b-03-乐观并发（内容 hash compare-and-set）计划日志

> 复制自 `_TEMPLATE.md`；【结果】在任务实测完成后追加。

## 【范围】本次任务的范围

- 任务 ID / 任务名 / 目标：T-M0b-03｜乐观并发（内容 hash compare-and-set）｜写入前按真实字节 hash 检测，不一致即拒绝并提示重读重试（P-06 / B-1）。
- 边界 / 涉及文件：新增 `src/core/optimisticWrite.ts`、`src/core/optimisticWrite.test.ts`；`src/core/index.ts` 导出。
- 不做什么：不实现文件 IO 与文件锁（属 CLI/存储层，core 只做纯判定）；不实现外部编辑检测的 `observed_at` 回填（T-M0b-07）；不引入「任意编辑器零丢失」承诺。
- 风险点：base 版本必须来自调用方真实读取的字节，core 无法自行确认读取新鲜度——以 API 形状强制「先取版本、后提交」两步。
- 红线自检：P-01（纯投影判定，无缓存事实源）、P-05（无 IO、无网络）、P-06（乐观检测 + 拒绝不覆盖）、B-1。

## 【计划】具体实施的计划

- 步骤分解（按依赖顺序，每步标注产物）：
  1. `contentVersion(text)`：UTF-8 字节的 SHA-256 + 字节长度（复用 T-M0a-04 纯 hash）→ 产物：版本结构；
  2. `compareAndSet(current, { expectedHash, nextContent })`：成功返回 base/next 版本与新文本；失败返回 `content-hash-mismatch` / `invalid-expected-hash`，**不带新文本**（结构上杜绝误写）；
  3. 导出诚实边界声明常量（受管写路径 + 外部修改可检测，不承诺任意编辑器零丢失）；
  4. 测试：B-1 并发拒绝、他人修改后不覆盖、重读重试成功、CRLF/尾换行/中文逐字节敏感、非法 expectedHash。
- 角色分工：AI 负责实现与测试；主理人仅需在 G-M0b 过目时确认诚实边界措辞。
- 验证手段：`pnpm typecheck` + `pnpm test`（含 purity 守卫）+ `pnpm lint`。

## 【分类】分类标识

| 任务 ID | 阶段 | 类型 | 优先级 | 关联模块 | 关联 CHANGELOG 行号 |
|---|---|---|---|---|---|
| T-M0b-03 | M0b | core 内核 | 高 | P-06 / B-1 / MOD-02 写路径前置 | 提交后追加 |

## 【结果】计划的执行结果（完成任务后追加）

- 实际产出：`src/core/optimisticWrite.ts`（`contentVersion` / `normalizeContentHash` / `compareAndSet` / `WRITE_GUARANTEE_NOTICE`）+ `optimisticWrite.test.ts`（11 用例）+ `src/core/index.ts` 导出。
- 验证结果：本批 `pnpm typecheck` 0；`pnpm test` 12 文件 175 用例全过（本文件 11）；`pnpm lint` 0；`pnpm build` 0。
- 计划偏差与原因：无。失败结果结构上不携带 `nextContent`，比原计划更严格地杜绝误写。
- 未完成项与后续动作：真实落盘与进程级文件锁属 CLI 存储层（T-M0b-08 起）；外部编辑 `observed_at` 检测属 T-M0b-07。
