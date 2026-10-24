# T-M1-03 canonical manifest 指纹 计划日志（W-S2-3）

## 【范围】本次任务的范围

- 任务 ID / 任务名 / 目标：T-M1-03（=W-S2-3）canonical manifest 指纹（D-25）——把门禁检查对象的快照清单（被检文件含未提交 diff / 规则文件 / 引用脚本 / runner 配置）折叠为单一 manifestHash，供 T-M1-04 写入凭证 `subject_manifest_hash` 并以 hash 变化判定「待复验」（B-3）。
- 边界 / 涉及文件：仅新建 `src/core/manifestFingerprint.ts` + `src/core/manifestFingerprint.test.ts` + 本计划日志。**红线：不改动任何既有文件**（含 `src/core/index.ts` 导出、`01-TASK-SPECTRUM.md` 置 doing、`02-CHANGELOG.md` 留痕——三者均属既有文件，留痕由主理人流程补记）。
- 不做什么：不做文件扫描/内容读取（IO 属壳层，core 只接收条目）；不实现凭证字段与待复验判定（T-M1-04）；不做信任绑定（P-07/D-26 随 T-M1-04）。
- 风险点：canonical 序列化分隔符歧义（path 含 \u0000/\n）——规格未列为拒绝条件，模块头以「诚实边界」如实披露；glob 语义口径（'**' 含 0 段）已写入 isExcluded JSDoc。
- 红线自检：core 无 IO、无 `node:*`、无 Date.now/Math.random（purity.test.ts 机器守卫覆盖新文件）；指纹哈希复用 `hash.ts` sha256Hex（同源杜绝双口径）；拒绝码 P-08 口径（重复/非法宁可拒绝）；被排除项记入 excluded 不静默。

## 【计划】具体实施的计划

- 步骤：① 类型与常量：`ManifestRole` 四类角色、`ManifestEntry`（contentHash JSDoc 写明「磁盘当前内容」口径，壳层用 optimisticWrite.contentVersion 计算）、`MANIFEST_EXCLUDE_DEFAULTS`（pm/changelog.md + 四类缓存/派生产物；insights 不排除）；② `isExcluded` 最小 glob（分段回溯：'**' 任意多段含 0 段、'*' 单段内任意、精确）；③ `canonicalJson` 稳定序列化（`path\0role\0contentHash` 行式，\n 连接、无尾随 \n，避开 JSON 键序歧义）；④ `computeManifestFingerprint`：条目校验（含同 path 冲突，先于排除）→ 排除过滤（默认+额外，excluded 如实返回）→ path 字典序排序 → sha256Hex；⑤ 测试 16 用例。
- 角色分工：AI 全部实现与验证；主理人无需介入（CHANGELOG/任务谱留痕除外）。
- 验证手段：`pnpm typecheck`；`pnpm vitest run src/core/manifestFingerprint.test.ts`（先 `export PATH="/d/code/nvm/v22.20.0:$PATH"`）。

## 【分类】分类标识

| 任务 ID | 阶段 | 类型 | 优先级 | 关联模块 | 关联 CHANGELOG 行号 |
|---|---|---|---|---|---|
| T-M1-03（=W-S2-3） | M1 | core 内核 | 【必需】 | hash（sha256Hex 同源）/ optimisticWrite（contentHash 计算口径）/ derivedVersion（拒绝码 message 风格） | （本任务按红线不改 02-CHANGELOG.md，行号由主理人补记） |

## 【结果】计划的执行结果（完成后追加）

- 实际产出：`src/core/manifestFingerprint.ts`（ManifestRole/ManifestEntry/MANIFEST_EXCLUDE_DEFAULTS/isExcluded 最小 glob/canonicalJson 稳定序列化/computeManifestFingerprint 四步流程）+ `src/core/manifestFingerprint.test.ts`（18 用例：glob 精确/'*'/'**' 边界、canonical 排序稳定性、changelog 排除与 insights 保留、excluded 不静默、extraExcludes、内部对拍 canonicalJson、同 path 重复两态拒绝、非法 hash/空 path/非法 role、校验先于排除、一字节/role/新增条目 hash 敏感性、中文路径、node:crypto 外部手算向量对拍）。
- 验证结果：① `pnpm typecheck` 于 2026-10-24 20:53 首跑通过（exit 0，本任务两 TS 文件当时已在编译范围）；② `pnpm vitest run src/core/manifestFingerprint.test.ts` 18 用例全过（exit 0）；③ 附加跑 `pnpm vitest run src/core/purity.test.ts` 19 用例全过（新文件通过纯度机器守卫）；④ 附加跑 `pnpm lint` 当前仅 1 error，位于 `src/cli/commands/init.ts:107`（no-control-regex，属并行任务 untracked 新文件，非本任务产物，本任务文件零告警）。
- 计划偏差与原因：① '**' 匹配口径定为「含 0 段」（目录整体排除语义），与 gitignore 的 'dist/**' 不含目录自身口径不同，已在 isExcluded JSDoc 显式写明；② 用例「段内 '*'」首跑失败——期望写错（'a*b.ts' 中 '*' 取空串本应命中 'ab.ts'），修正用例为 'ab.tsx' 不命中后全绿，实现未改。
- 未完成项与后续动作：`src/core/index.ts` 导出追加、任务谱置 doing/done、CHANGELOG 留痕——均因本任务红线「不改动既有文件」未执行，需主理人在合并时补记；凭证字段 `subject_manifest_hash` 与「待复验」判定（B-3）随 T-M1-04。
- 并行工作区观察（notes，未修改任何他人文件）：本任务执行期间同仓库有并行会话写入大量文件（src/cli/commands/、src/core/{actorPrivacy,contractTemplates,decisionBoard,handoffCompose,m0Drill} 等）。① 21:14 起复跑 `pnpm typecheck` 报 exit 2，唯一错误 `src/core/handoffCompose.test.ts(59,88) TS2345`（'number | undefined' 不能赋给 'number | bigint'）——并行任务中间状态，与本任务文件无关；② `src/cli/commands/init.ts:107` 的 `/[\r\n\u0000]/` 触发 eslint no-control-regex——同上，留给该任务处理。
