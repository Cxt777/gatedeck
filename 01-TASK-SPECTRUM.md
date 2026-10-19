# 一休PM｜WBS 任务谱

> **唯一任务事实来源（SSOT）**。所有任务的认领、进度、完成以此文件为准。
> 修改本文件任何状态，必须同步在 `02-CHANGELOG.md` 追加一条日志（W-05）。
> 状态枚举（主理人确认 2026-10-19，**双语并列**，覆盖工作区模板默认值）：机器权威层 `todo / doing / done / blocked / dropped` ｜ 显示层 未开始 / 进行中 / 已完成 / 阻塞 / 已放弃（**以英文为准**）；只能认领前置依赖已满足的任务。
> 来源：自《06-产品基准-v2.1》（转写日期 2026-10-19）第八节路线图与工作区规划目录 WBS 文件迁入；每项任务附可验收标准，引用反例 B-x 须入 CI 回归。

## 阶段门禁看板（人工开启，AI 不得自行开启；准出条件详见 `00-开发基准.md` 第九节）

| 门禁 | 条件 | 状态 | 评审记录 |
|---|---|---|---|
| G-M0a | M0a 全部必需任务 done；五项设计文档定稿并经主理人过目 | 🔒 未开启 | — |
| G-M0b | 保真/并发/中断三类合成样本全过；B-10/B-11 入 CI；CI 绿 | 🔒 未开启 | — |
| G-M1 | 完整路径走通；B-1/B-3/B-4/B-12 CI 全过；自举 2 周度量齐 | 🔒 未开启 | — |
| G-M2a | B-6 过；用量口径文档经主理人确认 | 🔒 未开启 | — |
| G-M2b | 3 真实项目接入；决策台真实数据可用 | 🔒 未开启 | — |
| G-M3 | v0.1.0 已发布；外部用户验证记录人工签认 | 🔒 未开启 | — |

## WBS-0 治理与基础设施

| ID | 任务 | 状态 | 前置 | 门禁 | 验收标准 | 必需性 |
|---|---|---|---|---|---|---|
| WBS-0.1 | 治理文件体系初始化 | done | — | — | 00/AGENTS/01/02/PROJECT-INDEX + docs 骨架齐备 | 【必需】 |
| WBS-0.2 | 产品方案与任务谱展开（WBS 迁入） | doing | WBS-0.1 | — | 产品方案与 M0a~M3 全量任务迁入本谱，覆盖方案全部交付物 | 【必需】 |
| WBS-0.3 | 工程骨架（= T-M0a-01） | doing | WBS-0.1 | G-M0a | 见 WBS-M0a 段 T-M0a-01 | 【必需】 |

## WBS-M0a · 契约验证（门禁 G-M0a）

| ID | 任务 | 状态 | 前置 | 门禁 | 验收标准 | 必需性 |
|---|---|---|---|---|---|---|
| T-M0a-01 | 工程骨架：Node 22 + TS + pnpm + Vitest + GitHub Actions CI | doing | — | G-M0a | `pnpm test` / `pnpm lint` / CI 全绿；目录分层含 `core`（纯 TS，无 IO 依赖） | 【必需】 |
| T-M0a-02 | wbs.md 节点语法三方案对比原型并定稿 | todo | T-M0a-01 | G-M0a | fenced block / HTML comment / 独立任务文件三方案各出原型；真实含注释样本 round-trip 对比报告；定稿结论写入设计文档 | 【必需】 |
| T-M0a-03 | 规范事件块语法 + 事件信封 schema 定稿 | todo | T-M0a-01 | G-M0a | 信封字段含 event_id/schema_version/kind/occurred_at/recorded_at/actor/origin/integrity/subject/operation_id/payload（基准 3.5）；机器权威字段与人类说明分离；与 T-M0a-02 同批原型 | 【必需】 |
| T-M0a-04 | 事件来源收据机制（hash chain + 本地锚点） | todo | T-M0a-03 | G-M0a | 收据存 git 忽略的本地安全位置；加载时验证内容+顺序；失败 → integrity=invalid 不参与折叠、进入「需处理」状态、不静默重算；B-10/B-11 口径可实现 | 【必需】 |
| T-M0a-05 | 状态折叠规则实现（当前阶段派生） | todo | T-M0a-03 | G-M0a | 按 sequence 折叠不按 occurred_at（B-16）；project.initialized 派生初始阶段=gates.md 首阶段；promotion 携带 from/to/expected_sequence/manifest_hash，非法跳跃拒绝；重复 event_id 幂等（B-13）；补偿/撤销走追加事件 | 【必需】 |
| T-M0a-06 | 注册表 provider：native + projects-index | todo | T-M0a-01 | G-M0a | native 读写 `.gatedeck/registry.md`（workspace_id=ULID + binding_key）+ registry.local.md（默认 git 忽略）；projects-index 只读解析根 PROJECTS-INDEX.md 投影，不写工作区根（D-30）；B-14/B-15 测试过 | 【必需】 |
| T-M0a-07 | slug 终核与命名收尾 | todo | — | G-M0a | npm 包名 `gatedeck` 可注册确认；CLI bin 名冲突评估结论（`pm` 或主命令 `gatedeck`）；PyPI 复核 + 域名检索；结果回写基准 D-23 留痕 | 【必需】 |

**G-M0a 准出**：M0a 全部必需任务 done；语法/schema/收据/折叠/provider 五项设计文档齐备且经主理人过目。

## WBS-M0b · 可靠写入（门禁 G-M0b）

| ID | 任务 | 状态 | 前置 | 门禁 | 验收标准 | 必需性 |
|---|---|---|---|---|---|---|
| T-M0b-01 | wbs.md 解析/校验/局部修改内核 | todo | T-M0a-02 | G-M0b | round-trip 保真：不吞注释、不重排手写顺序、未知字段保留（P-04）；含注释/未知字段/中文/换行差异测试集全过 | 【必需】 |
| T-M0b-02 | changelog/insights 规范事件块解析器 | todo | T-M0a-03, T-M0a-04 | G-M0b | 按 M0a schema 稳定解析；缺少合法 event_id 或未在收据链登记 → external-unverified（S2.1-04）；append-only 行为规则 | 【必需】 |
| T-M0b-03 | 乐观并发（内容 hash compare-and-set） | todo | T-M0b-01 | G-M0b | 写入前按真实字节 hash 检测，不一致拒绝并提示重读重试；B-1 过；对外声明不承诺任意编辑器零丢失 | 【必需】 |
| T-M0b-04 | 操作恢复状态机（跨文件四相） | todo | T-M0b-02 | G-M0b | prepared→applied→logged→committed/aborted；逐中断点注入验证可恢复，不留状态与日志不一致；中断提交保留可恢复材料；B-2 过 | 【必需】 |
| T-M0b-05 | 校验内核：每事实唯一权威位置 + 冲突显示 | todo | T-M0b-01 | G-M0b | 当前阶段不落 project.md（D-24）；发现重复存储/推导冲突以权威位置为准显示差异并告警 | 【必需】 |
| T-M0b-06 | 派生状态版本（as_of + compare-and-set） | todo | T-M0b-05 | G-M0b | 决策台/风险分组/handoff 携带 as_of/源版本；过期投影提交被拒 | 【必需】 |
| T-M0b-07 | 外部编辑检测（指纹比对 + observed_at） | todo | T-M0a-04 | G-M0b | 受管写路径外的内容变更可检测；外部修改只记 observed_at 不回填 occurred_at；观察不到的中间过程标未知 | 【必需】 |
| T-M0b-08 | CLI 骨架 | todo | T-M0b-01 | G-M0b | `pm` 命令框架 + `init/discover/adopt/register/ls` 子命令占位与帮助；discover/ls 纯只读 | 【必需】 |
| T-M0b-09 | M0 门禁演练：合成样本回归 | todo | T-M0b-01~07 | G-M0b | 保真/并发/中断三类合成样本全过；B-10/B-11 收据口径入 CI；CI 绿 | 【必需】 |

**G-M0b 准出**：M0b 全部必需任务 done；三类合成样本全过；CI 绿。

## WBS-M1 · 最小产品闭环（门禁 G-M1）

| ID | 任务 | 状态 | 前置 | 门禁 | 验收标准 | 必需性 |
|---|---|---|---|---|---|---|
| T-M1-01 | 契约模板 v1 + `pm init` | todo | T-M0b-01 | G-M1 | 生成 project.md/wbs.md/gates.md/changelog.md/insights.md 骨架；模板内容对齐基准第五节契约；本 WBS 迁移为首个 `pm/wbs.md`（dogfooding） | 【必需】 |
| T-M1-02 | 最小注册：discover 预览 + adopt 收编 | todo | T-M0b-08, T-M0a-06 | G-M1 | discover 只读预览不执行任何命令不入册（B-7）；adopt 显式收编；路径失效显示「离线」不静默移除；.gatedeckignore 生效 | 【必需】 |
| T-M1-03 | canonical manifest 指纹（D-25） | todo | T-M0b-01 | G-M1 | 纳入被检文件（含未提交 diff）/规则文件/引用脚本/runner 配置；排除 changelog 自身/缓存/构建产物；凭证存 subject_manifest_hash | 【必需】 |
| T-M1-04 | `pm gate check`：检查事实 + 凭证 + 失效判定 | todo | T-M1-03 | G-M1 | 产出检查事实（未检查/通过/失败/错误/待复验）；命令执行受 P-07/D-26 约束（信任绑定 manifest+runner，证据只存退出码/时长/摘要）；对象或规则变化 → 待复验（B-3） | 【必需】 |
| T-M1-05 | 本地交互确认（TTY 三步编排） | todo | T-M1-04 | G-M1 | request_promotion→confirm_promotion→apply_promotion；`pm promote` 交互逐条确认，非交互拒绝；事件 authorization.locally_confirmed，只写不透明 principal/session id；B-12 过 | 【必需】 |
| T-M1-06 | 当前阶段派生接入总览 | todo | T-M0a-05 | G-M1 | 总览墙阶段进度来自事件折叠投影；携带 as_of | 【必需】 |
| T-M1-07 | `pm handoff` 交接包（含 revive 别名） | todo | T-M0b-06 | G-M1 | 六段结构（目标范围/适用规则/依赖决定/有效失效证据/已试败路径/下一步验收）；携带源版本+生成时间；软预算超限明确提示不静默裁剪（B-8）；token 数估算或标字符数 | 【必需】 |
| T-M1-08 | MCP 通道 | todo | T-M1-04, T-M1-05 | G-M1 | tools 对齐基准 MOD-06：读 7 + 写 3 + check_gate/request_promotion/record_note/submit_evidence/report_usage；**无 pass_gate、无 append_changelog**；MCP 不可生成 authorization.granted（B-4）；submit_evidence 不改检查事实（B-17）；report_usage 携带归因 | 【必需】 |
| T-M1-09 | 决策台查询规则（M1 四条） | todo | T-M1-06 | G-M1 | ① 待验收门禁/待审申请→等您决定；② blocked→需要关注；③ 证据过期/待复验→需要关注；④ 可领取任务→可以推进；共用查询规则层供 brief 复用 | 【必需】 |
| T-M1-10 | 一页 Web：项目列表 + 决策台 + 证据面板 | todo | T-M1-09 | G-M1 | 三区（等您决定/可以推进/需要关注）每卡含触发原因/证据/影响/动作；显式提交（无拖拽）；打开 1 分钟内找到最重要待办并能解释原因；只读投影+显式写回 | 【必需】 |
| T-M1-11 | 归因隐私落地 | todo | T-M0b-02 | G-M1 | actor_id/session_id 为本地不透明随机 ID；不记邮箱/用户名/对话文本；不作身份认证 | 【必需】 |
| T-M1-12 | 自举接入（dogfooding 2 周） | todo | T-M1-01, T-M1-02 | G-M1 | 本工作区多项目接入（经 projects-index provider）；记录三项度量：找下一事项耗时/新会话人工纠正次数/证据不足过期发现次数 | 【必需】 |
| T-M1-13 | 阶段进度组件（地铁图形态） | todo | T-M1-06 | G-M1 | 静态站点图、非独立页面、无动态布局引擎；作为总览页内组件渲染 | 【条件性】 |

**G-M1 准出**：完整路径走通（打开总览→找到待处理→生成交接包→AI 推进→提交证据→校验并更新状态）；B-1/B-3/B-4/B-12 通过；自举 2 周度量齐；`get_overview`+`get_wbs` 新会话复述准确（人工核对清单）。

> 让路预案：若 M1 体量失控，一页 Web（T-M1-10）可拆 M1b 后置，先保 CLI 写回+门禁+凭证主线；T-M1-13 不阻塞准出。

## WBS-M2a · 数据可信（门禁 G-M2a）

| ID | 任务 | 状态 | 前置 | 门禁 | 验收标准 | 必需性 |
|---|---|---|---|---|---|---|
| T-M2a-01 | `pm query` 完整 + JSON 索引 | todo | T-M1-09 | G-M2a | 查询语言覆盖决策台/brief/风险分组所需；JSON 索引标记为可再生派生层，可随时重建 | 【必需】 |
| T-M2a-02 | `pm lint`（跨项目校验） | todo | T-M0b-05 | G-M2a | 契约违规/歧义数据报错；高危命令模式告警；手写未知内容保留并报错（F-06） | 【必需】 |
| T-M2a-03 | `pm doctor` 只读体检 | todo | T-M2a-01 | G-M2a | 缺件/卡点/停滞/索引/契约版本五项；检查与修复分离；永不执行门禁命令 | 【必需】 |
| T-M2a-04 | 活动热力图（Insights） | todo | T-M2a-01 | G-M2a | git 提交历史时间戳为主数据源，mtime 仅未提交补充；浅克隆/改写历史如实标注覆盖；不声称完整工时 | 【必需】 |
| T-M2a-05 | 用量上报契约 + 三通道 | todo | T-M1-11 | G-M2a | 开放轻量协议（日期/项目/模型/token/关联任务/来源/actor/session）；report_usage/手动/导入；无真实计量留空不猜 | 【必需】 |
| T-M2a-06 | 1 个结构化导入参考实现 | todo | T-M2a-05 | G-M2a | 选作者实际在用工具的可导出统计；来源记录稳定 ID、幂等去重（B-6）；只提取统计不复制原始对话入仓；更正走追加记录 | 【必需】 |
| T-M2a-07 | 用量口径文档 | todo | T-M2a-05 | G-M2a | 分摊和 ≤1、未分配单列、父子不重复计；覆盖率写明分母；金额带价格版本/币种、标「折算非账单」；价格目录带生效日期不回算历史 | 【必需】 |

**G-M2a 准出**：M2a 全部必需任务 done；附 B-6 通过；口径文档经主理人确认。

## WBS-M2b · 视图补齐（门禁 G-M2b）

| ID | 任务 | 状态 | 前置 | 门禁 | 验收标准 | 必需性 |
|---|---|---|---|---|---|---|
| T-M2b-01 | `pm brief` 晨报 | todo | T-M2a-01 | G-M2b | 决策台的跨项目日报投影（昨夜动态/卡点/今日三问）；确定性规则生成；与决策台共用查询规则 | 【必需】 |
| T-M2b-02 | 任务看板拖拽写回 | todo | T-M1-10, T-M0b-03 | G-M2b | 拖拽走 core 校验层；冲突走乐观并发拒绝提示；迁移写规范事件 | 【必需】 |
| T-M2b-03 | 风险解释性分组视图 | todo | T-M2a-01 | G-M2b | 按严重度/紧迫度/影响排序、每项附原因；不做健康分；停滞只标「待检查」不改状态 | 【必需】 |
| T-M2b-04 | 例外授权机制 | todo | T-M1-05 | G-M2b | 申请/批准/失效流；绑定条件/指纹/批准者/适用范围/失效条件；不可重放到变化后对象；红线不可豁免；失败记录不改写 | 【必需】 |
| T-M2b-05 | ¥ 换算 + 投入×推进关联线索 | todo | T-M2a-07 | G-M2b | 内置单价可覆盖、标「折算非账单」、订阅/缓存/免费额度不混入；D-28 四类线索只提示不判定、附触发数据引用 | 【条件性：有价格数据源/数据积累足够】 |
| T-M2b-06 | M2 门禁演练：真实项目验证 | todo | T-M2a-06, T-M2b-01~04 | G-M2b | 3 真实项目接入；决策台规则（M1 四条 + M2 补齐）在真实数据上可用 | 【必需】 |

**G-M2b 准出**：3 真实项目接入；用量口径文档化且 B-6 过；决策台规则真实数据可用。

> 功能会计（MOD-08.4）与 HTML 报告（MOD-05）为【可延期】，不入 M2 门禁，实现后挂 M3 前。

## WBS-M3 · 发布准备（门禁 G-M3）

| ID | 任务 | 状态 | 前置 | 门禁 | 验收标准 | 必需性 |
|---|---|---|---|---|---|---|
| T-M3-01 | 双语 README | todo | T-M2b-06 | G-M3 | 首句钉死 deck=decision deck；EN slogan "Know what's next. Prove what's done."；主线：决策台→证据化→投入统计，门禁细节入 power users 段；首屏素材=决策台+热力图 | 【必需】 |
| T-M3-02 | `gatedeck spec` 独立文档 + 兼容规则 | todo | T-M0b-05 | G-M3 | 契约 schema/兼容规则独立成文；模板更新不静默覆盖用户规则 | 【必需】 |
| T-M3-03 | `pm migrate` | todo | T-M3-02 | G-M3 | 契约版本升级迁移；迁移前自动归档快照到 pm/archive/ | 【必需】 |
| T-M3-04 | npm 首发 + community files | todo | T-M0a-07, T-M1-13 | G-M3 | 包名 `gatedeck`（scoped 备选）；CLI bin 名按 T-M0a-07 结论；LICENSE/CONTRIBUTING/SECURITY/issue 模板齐 | 【必需】 |
| T-M3-05 | 外部用户接入验证 | todo | T-M3-01 | G-M3 | 1–3 个既有项目走通接入与升级路径；反馈记录进 changelog 留痕 | 【必需】 |
| T-M3-06 | v0.1.0 发布 | todo | T-M3-04, T-M3-05 | G-M3 | npm 公开 + Show HN/V2EX/掘金 + awesome-mcp-servers；若 T-M1-13 未做，地铁图组件此批补齐 | 【必需】 |

**G-M3 准出**：v0.1.0 公开；接入与升级路径被外部用户验证。

## 不进 WBS 的后置实验池（不承诺排期）

健康分、时间机器回放、提案收件箱 + 反向 PM `draft_wbs`、可信审批模式（签名收据）、AI 身份档案与绩效视图、门禁配方生态、pre-push/CI 强约束、Backlog.md 导入、token 适配器扩展（社区 good first issue 池）。

## 变更留痕（append-only）

| 日期 | 变更 | 操作者 |
|---|---|---|
| 2026-10-19 | 自工作区规划目录 WBS 文件迁入 48 项任务（M0a×7 / M0b×9 / M1×13 / M2a×7 / M2b×6 / M3×6）；状态枚举统一为 `todo/doing/done/blocked/dropped`；T-M0a-01 置 `doing`（本地验证绿、CI 待云端） | 项目 AI（起草） |
| 2026-10-19 | **主理人确认**：状态枚举定为**双语并列**（英文机器权威 + 中文显示层，以英文为准）；基准指针**保持外部**并补记来源版本 v2.1 + 转写日期 2026-10-19 | 主理人 |

<!-- 新 WBS 段落按「## WBS-{N} {段名}」追加，表结构保持一致 -->
