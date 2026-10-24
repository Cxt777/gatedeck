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
| T-M0a-01 | 工程骨架：Node 22 + TS + pnpm + Vitest + GitHub Actions CI | done | — | G-M0a | `pnpm test` / `pnpm lint` / CI 全绿；目录分层含 `core`（纯 TS，无 IO 依赖） | 【必需】 |
| T-M0a-02 | wbs.md 节点语法三方案对比原型并定稿 | done | T-M0a-01 | G-M0a | fenced block / HTML comment / 独立任务文件三方案各出原型；真实含注释样本 round-trip 对比报告；定稿结论写入设计文档 | 【必需】 |
| T-M0a-03 | 规范事件块语法 + 事件信封 schema 定稿 | done | T-M0a-01 | G-M0a | 信封字段含 event_id/schema_version/kind/occurred_at/recorded_at/actor/origin/integrity/subject/operation_id/payload（基准 3.5）；机器权威字段与人类说明分离；与 T-M0a-02 同批原型 | 【必需】 |
| T-M0a-04 | 事件来源收据机制（hash chain + 本地锚点） | done | T-M0a-03 | G-M0a | 收据存 git 忽略的本地安全位置；加载时验证内容+顺序；失败 → integrity=invalid 不参与折叠、进入「需处理」状态、不静默重算；B-10/B-11 口径可实现 | 【必需】 |
| T-M0a-05 | 状态折叠规则实现（当前阶段派生） | done | T-M0a-03 | G-M0a | 按 sequence 折叠不按 occurred_at（B-16）；project.initialized 派生初始阶段=gates.md 首阶段；promotion 携带 from/to/expected_sequence/manifest_hash，非法跳跃拒绝；重复 event_id 幂等（B-13）；补偿/撤销走追加事件 | 【必需】 |
| T-M0a-06 | 注册表 provider：native + projects-index | done | T-M0a-01 | G-M0a | native 读写 `.gatedeck/registry.md`（workspace_id=ULID + binding_key）+ registry.local.md（默认 git 忽略）；projects-index 只读解析根 PROJECTS-INDEX.md 投影，不写工作区根（D-30）；B-14/B-15 测试过 | 【必需】 |
| T-M0a-07 | slug 终核与命名收尾 | done | — | G-M0a | npm 包名 `gatedeck` 可注册确认；CLI bin 名冲突评估结论（`pm` 或主命令 `gatedeck`）；PyPI 复核 + 域名检索；结果回写基准 D-23 留痕（2026-10-23 WBS-W/W-S0-2 完成回写：bin 三注册终裁 + MCP 服务名 gatedeck-mcp，见 docs/review/T-M0a-07 报告第四节） | 【必需】 |

**G-M0a 准出**：M0a 全部必需任务 done；语法/schema/收据/折叠/provider 五项设计文档齐备且经主理人过目。

## WBS-M0b · 可靠写入（门禁 G-M0b）

| ID | 任务 | 状态 | 前置 | 门禁 | 验收标准 | 必需性 |
|---|---|---|---|---|---|---|
| T-M0b-01 | wbs.md 解析/校验/局部修改内核 | done | T-M0a-02 | G-M0b | round-trip 保真：不吞注释、不重排手写顺序、未知字段保留（P-04）；含注释/未知字段/中文/换行差异测试集全过 | 【必需】 |
| T-M0b-02 | changelog/insights 规范事件块解析器 | done | T-M0a-03, T-M0a-04 | G-M0b | 按 M0a schema 稳定解析；缺少合法 event_id 或未在收据链登记 → external-unverified（S2.1-04）；append-only 行为规则 | 【必需】 |
| T-M0b-03 | 乐观并发（内容 hash compare-and-set） | done | T-M0b-01 | G-M0b | 写入前按真实字节 hash 检测，不一致拒绝并提示重读重试；B-1 过；对外声明不承诺任意编辑器零丢失 | 【必需】 |
| T-M0b-04 | 操作恢复状态机（跨文件四相） | done | T-M0b-02 | G-M0b | prepared→applied→logged→committed/aborted；逐中断点注入验证可恢复，不留状态与日志不一致；中断提交保留可恢复材料；B-2 过 | 【必需】 |
| T-M0b-05 | 校验内核：每事实唯一权威位置 + 冲突显示 | done | T-M0b-01 | G-M0b | 当前阶段不落 project.md（D-24）；发现重复存储/推导冲突以权威位置为准显示差异并告警 | 【必需】 |
| T-M0b-06 | 派生状态版本（as_of + compare-and-set） | done | T-M0b-05 | G-M0b | 决策台/风险分组/handoff 携带 as_of/源版本；过期投影提交被拒 | 【必需】 |
| T-M0b-07 | 外部编辑检测（指纹比对 + observed_at） | done | T-M0a-04 | G-M0b | 受管写路径外的内容变更可检测；外部修改只记 observed_at 不回填 occurred_at；观察不到的中间过程标未知 | 【必需】 |
| T-M0b-08 | CLI 骨架 | done | T-M0b-01 | G-M0b | `pm` 命令框架 + `init/discover/adopt/register/ls` 子命令占位与帮助；discover/ls 纯只读 | 【必需】 |
| T-M0b-09 | M0 门禁演练：合成样本回归 | done | T-M0b-01~07 | G-M0b | 保真/并发/中断三类合成样本全过；B-10/B-11 收据口径入 CI；CI 绿（2026-10-24 完成：`src/core/m0Drill.test.ts` 25 用例全过随 CI 运行；全量 24 文件 370 用例绿；提交 b716601） | 【必需】 |

**G-M0b 准出**：M0b 全部必需任务 done；三类合成样本全过；CI 绿。

## WBS-M1 · 最小产品闭环（门禁 G-M1）

| ID | 任务 | 状态 | 前置 | 门禁 | 验收标准 | 必需性 |
|---|---|---|---|---|---|---|
| T-M1-01 | 契约模板 v1 + `pm init` | doing | T-M0b-01 | G-M1 | 生成 project.md/wbs.md/gates.md/changelog.md/insights.md 骨架；模板内容对齐基准第五节契约；本 WBS 迁移为首个 `pm/wbs.md`（dogfooding）（2026-10-24：模板+init 命令+测试+冒烟完成提交 b716601；**dogfooding 迁移待执行**，随后补） | 【必需】 |
| T-M1-02 | 最小注册：discover 预览 + adopt 收编 | done | T-M0b-08, T-M0a-06 | G-M1 | discover 只读预览不执行任何命令不入册（B-7）；adopt 显式收编；路径失效显示「离线」不静默移除；.gatedeckignore 生效（2026-10-24 完成：discover/adopt 真实现 + discoverRules 14 用例；register/ls 维持占位不阻塞本项验收） | 【必需】 |
| T-M1-03 | canonical manifest 指纹（D-25） | done | T-M0b-01 | G-M1 | 纳入被检文件（含未提交 diff）/规则文件/引用脚本/runner 配置；排除 changelog 自身/缓存/构建产物；凭证存 subject_manifest_hash（2026-10-24 完成：manifestFingerprint 18 用例，提交 b716601） | 【必需】 |
| T-M1-04 | `pm gate check`：检查事实 + 凭证 + 失效判定 | doing | T-M1-03 | G-M1 | 产出检查事实（未检查/通过/失败/错误/待复验）；命令执行受 P-07/D-26 约束（信任绑定 manifest+runner，证据只存退出码/时长/摘要）；对象或规则变化 → 待复验（B-3）（2026-10-24：core checkFacts 15 用例完成；CLI `gate check` 命令装配待做） | 【必需】 |
| T-M1-05 | 本地交互确认（TTY 三步编排） | doing | T-M1-04 | G-M1 | request_promotion→confirm_promotion→apply_promotion；`pm promote` 交互逐条确认，非交互拒绝；事件 authorization.locally_confirmed，只写不透明 principal/session id；B-12 过（2026-10-24：core promotionFlow 22 用例含 B-12 完成；TTY `pm promote` 命令装配待做） | 【必需】 |
| T-M1-06 | 当前阶段派生接入总览 | done | T-M0a-05 | G-M1 | 总览墙阶段进度来自事件折叠投影；携带 as_of（2026-10-24 完成：`gatedeck deck` 命令，提交 b716601） | 【必需】 |
| T-M1-07 | `pm handoff` 交接包（含 revive 别名） | done | T-M0b-06 | G-M1 | 六段结构（目标范围/适用规则/依赖决定/有效失效证据/已试败路径/下一步验收）；携带源版本+生成时间；软预算超限明确提示不静默裁剪（B-8）；token 数估算或标字符数（2026-10-24 完成：handoffCompose + `gatedeck handoff`/revive，提交 b716601） | 【必需】 |
| T-M1-08 | MCP 通道 | doing | T-M1-04, T-M1-05 | G-M1 | tools 对齐基准 MOD-06：读 7 + 写 3 + check_gate/request_promotion/record_note/submit_evidence/report_usage；**无 pass_gate、无 append_changelog**；MCP 不可生成 authorization.granted（B-4）；submit_evidence 不改检查事实（B-17）；report_usage 携带归因（2026-10-24：S3 工作流进行中——SDK 装配/十五工具/B-4+B-17 守卫） | 【必需】 |
| T-M1-09 | 决策台查询规则（M1 四条） | done | T-M1-06 | G-M1 | ① 待验收门禁/待审申请→等您决定；② blocked→需要关注；③ 证据过期/待复验→需要关注；④ 可领取任务→可以推进；共用查询规则层供 brief 复用（2026-10-24 完成：decisionBoard 21 用例，提交 b716601） | 【必需】 |
| T-M1-10 | 一页 Web：项目列表 + 决策台 + 证据面板 | todo | T-M1-09 | G-M1 | 三区（等您决定/可以推进/需要关注）每卡含触发原因/证据/影响/动作；显式提交（无拖拽）；打开 1 分钟内找到最重要待办并能解释原因；只读投影+显式写回 | 【必需】 |
| T-M1-11 | 归因隐私落地 | done | T-M0b-02 | G-M1 | actor_id/session_id 为本地不透明随机 ID；不记邮箱/用户名/对话文本；不作身份认证（2026-10-24 完成：actorPrivacy 8+ 用例 + 隐私泄露扫描，提交 b716601） | 【必需】 |
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

## WBS-W · 周末上线冲刺（2026-10-24/25 ｜ gatedeck v0.1.0-rc.1 + gatedeck-mcp MCP 上线）

> **编排层段落**：只列工作包（WP）级条目，不拆内部步骤（主理人指令 2026-10-23）；总计划与排期见 `docs/plans/WBS-W-周末上线冲刺计划.md`。
> **gatedeck-mcp**（对外 MCP 服务产品名，**2026-10-23 定名**；曾拟名 workBuddy 因腾讯同名产品弃用，R2）= 一休PM 对外 MCP 服务：MOD-06 十五工具全集（读 7 + 写 3 + check_gate/request_promotion + record_note/submit_evidence/report_usage），供 AI 客户端直接接管项目；gatedeck 为引擎包名（单包三 bin：`gatedeck` / `pm` / `gatedeck-mcp`，DP-1）。
> **rc 诚实边界**：G-M1 两周自举度量与 G-M3 外部验证物理上无法周末达成 → 周末上线 **v0.1.0-rc.1**（dist-tag `early`，对外明示 early access），正式 v0.1.0 按原门禁后补；M2a/M2b 全量后补。
> **999 元 = 价值准出锚**（V1 5 分钟接入 / V2 3 分钟 AI 接管 / V3 证据可复验 / V4 本地优先 / V5 文档 / V6 稳定性），非 rc 期定价；商业形式 DP-2 已拍板（rc 期开源免费 + README 价值对照清单）。
> **主理人检查点**：CP-1 已依 2026-10-23 晚预授权完成拍板（DP-1~DP-5 按推荐 + gatedeck-mcp 改名，见 CHANGELOG）｜CP-2 周六 17:00–19:00 G-M0a/G-M0b 准出审核（**外部模型双轮审核机制，主理人授权 2026-10-23，限本冲刺**：2 轮封顶即通过、未关闭项入遗留清单、命中影响面的后续 WP 必须修复后重审；硬准出条件与门禁开启权不在授权内）+ 主理人开启｜CP-3 周日 20:00 发布授权。门禁开启仍须主理人人工执行，AI 不得代开。
> 原任务状态仍在原段落维护，本段「=」行仅引用原任务 ID 与其验收标准。

### S0 定向与地基（周五晚–周六早）

| ID | 任务 | 状态 | 前置 | 门禁 | 验收标准 | 必需性 |
|---|---|---|---|---|---|---|
| W-S0-1 | S0 决策包：DP-1~DP-5 拍板 + 冲刺范围冻结 | done | 本段立项 | — | 五项决策结论留痕 CHANGELOG；让路顺序获主理人确认（依 2026-10-23 预授权按推荐拍板，可否决重跑） | 【必需】 |
| W-S0-2 | T-M0a-07 收尾：gatedeck-mcp 名核查（npm/域名/商标）+ 基准 D-23 回写 + bin 名终裁 | done | W-S0-1 | G-M0a | 见 T-M0a-07 行；名核查结论落 `docs/review/`（已落，第四节）；回写经主理人执行或授权（已依冲刺预授权执行） | 【必需】 |
| W-S0-3 | 远程仓库与 CI 基线 | done | W-S0-1 | — | GitHub 仓库建立；CI 云端首跑真实通过；分支保护开启（2026-10-24 完成：repo Cxt777/gatedeck + run 39976770561 success + strict required checks；CHANGELOG 留痕） | 【必需】 |
| W-S1-1 | 派生状态版本 as_of + compare-and-set（=T-M0b-06） | done | T-M0b-05 | G-M0b | 见 T-M0b-06 行（夜间任务完成 + 主会话验收通过，CHANGELOG 2026-10-24 15:05） | 【必需】 |
| W-S1-2 | 外部编辑检测 指纹 + observed_at（=T-M0b-07） | done | T-M0a-04 | G-M0b | 见 T-M0b-07 行（同上） | 【必需】 |
| W-S1-3 | CLI 骨架 命令框架 + 五子命令占位（=T-M0b-08） | done | T-M0b-01 | G-M0b | 见 T-M0b-08 行（同上） | 【必需】 |

### S1 内核收尾（周六日间，G-M0b 准出）

| ID | 任务 | 状态 | 前置 | 门禁 | 验收标准 | 必需性 |
|---|---|---|---|---|---|---|
| W-S1-4 | M0 门禁演练：三类合成样本回归（=T-M0b-09） | done | T-M0b-01~07 | G-M0b | 见 T-M0b-09 行（2026-10-24 done，25 用例） | 【必需】 |
| W-S1-5 | CP-2 门禁检查点：G-M0a / G-M0b DeepSeek 双轮审核 + 主理人开启 | todo | W-S0-3, W-S1-1~4 | — | 准出材料（脱敏 + token 预算标注）周六 17:00 前备齐；DeepSeek 轮 1 → 修复 → 轮 2，至多 2 轮；轮 2 无致命问题即审核通过、未关闭项入遗留清单（W-S5-3）；门禁由主理人人工开启并留痕——硬准出条件（任务 done/样本全过/CI 真实绿）与开启权不随授权转移 | 【必需】 |

### S2 产品闭环垂直切面（周六夜–周日上午）

| ID | 任务 | 状态 | 前置 | 门禁 | 验收标准 | 必需性 |
|---|---|---|---|---|---|---|
| W-S2-1 | 契约模板 v1 + `pm init` + 自举迁移启动（=T-M1-01） | doing | W-S1-3, W-S1-5 | G-M1 | 见 T-M1-01 行；两周度量降级为「启动 + 记录机制」，度量自 10-25 起算后补（诚实边界）（2026-10-24：模板+init done，dogfooding 迁移待执行；度量记录机制待建） | 【必需】 |
| W-S2-2 | discover 预览 + adopt 收编 + .gatedeckignore（=T-M1-02） | done | W-S1-3 | G-M1 | 见 T-M1-02 行（2026-10-24 done） | 【必需】 |
| W-S2-3 | canonical manifest 指纹（=T-M1-03，D-25） | done | T-M0b-01 | G-M1 | 见 T-M1-03 行（2026-10-24 done） | 【必需】 |
| W-S2-4 | `pm gate check` 检查事实 + 凭证 + 失效判定（=T-M1-04） | doing | W-S2-3 | G-M1 | 见 T-M1-04 行（2026-10-24：core 完成，CLI 装配待做） | 【必需】 |
| W-S2-5 | TTY 三步 promote + B-12（=T-M1-05） | doing | W-S2-4 | G-M1 | 见 T-M1-05 行（2026-10-24：core 完成，TTY 装配待做） | 【必需】 |
| W-S2-6 | 总览墙 + 决策台四条规则，CLI 文本投影（=T-M1-06 + T-M1-09） | done | T-M0a-05 | G-M1 | 见两原任务行；一页 Web（T-M1-10）后补，本包仅 CLI 投影并携带 as_of（2026-10-24 done：deck 命令） | 【必需】 |
| W-S2-7 | `pm handoff` 交接包（=T-M1-07） | done | T-M0b-06 | G-M1 | 见 T-M1-07 行（2026-10-24 done） | 【必需】 |
| W-S2-8 | 归因隐私最小落地核验（=T-M1-11） | done | T-M0b-02 | G-M1 | 见 T-M1-11 行（2026-10-24 done） | 【必需】 |

### S3 gatedeck-mcp MCP 封装（周日下午）

| ID | 任务 | 状态 | 前置 | 门禁 | 验收标准 | 必需性 |
|---|---|---|---|---|---|---|
| W-S3-1 | gatedeck-mcp MCP server 骨架：stdio 传输 + 工具注册框架 + core 装配 | doing | W-S2-1, W-S2-6 | G-M1 | 时钟/随机由壳层注入，core 纯度守卫不破；依赖选型 15 分钟时间盒（R6）——**裁定：官方 @modelcontextprotocol/sdk@1.32.2 + zod 直接依赖（2026-10-24）**；S3 工作流进行中 | 【必需】 |
| W-S3-2 | MOD-06 工具全集 15 个（=T-M1-08 主体） | doing | W-S3-1 | G-M1 | 读 7 + 写 3 + check_gate/request_promotion + record_note/submit_evidence/report_usage 全量可用；写操作全走 core 校验层；AI 动线（get_overview→领任务→update_task→check_gate→request_promotion）走通（2026-10-24：S3 工作流进行中；安全裁定——MCP check_gate 只做检查事实与失效判定，永不执行门禁命令） | 【必需】 |
| W-S3-3 | MCP 红线回归入 CI（=T-M1-08 验收子项） | doing | W-S3-2 | G-M1 | B-4（无 pass_gate / 无通用 append_changelog / MCP 不产生 authorization.granted）+ B-17（submit_evidence 仅待验）机器守卫入 CI（2026-10-24：随 S3 工作流，allowlist.test.ts + assertAllowlist 结构守卫设计就位） | 【必需】 |
| W-S3-4 | 一键接入体验：npx 冒烟 + 客户端配置指南 | todo | W-S3-2 | — | Claude Desktop / Cursor / ZCode 配置文档 + MCP inspector 冒烟脚本；价值准出 V1/V2 判据可复验 | 【必需】 |

### S4 发布与价值包装（周日晚）

| ID | 任务 | 状态 | 前置 | 门禁 | 验收标准 | 必需性 |
|---|---|---|---|---|---|---|
| W-S4-1 | 双语 README + 首屏素材（=T-M3-01 rc 适配） | doing | W-S2-6, W-S3-4 | G-M3 | 见 T-M3-01 行；rc 首屏素材=决策台 + gatedeck-mcp 接管演示（热力图后补）；999 元价值对照清单入 README（2026-10-24：README/README.en + community files 主体完成提交 205325b；首屏素材与 MCP 配置段待 S3 完成后补） | 【必需】 |
| W-S4-2 | gatedeck-mcp 落地页 | todo | W-S4-1 | — | 痛点→方案→证明→价值锚点四段式；部署形式按 DP-4（推荐 GitHub Pages） | 【可让路①：README 承载】 |
| W-S4-3 | 发布工程 + npm 0.1.0-rc.1（=T-M3-04 rc 适配） | todo | W-S4-1, W-S0-3 | G-M3 | LICENSE/CONTRIBUTING/SECURITY/issue 模板齐；CP-3 授权后发布（dist-tag `early`）；bin 名按 T-M0a-07 终裁（DP-1） | 【必需】 |
| W-S4-4 | 社区发布：Show HN / V2EX / 掘金 / awesome-mcp-servers（=T-M3-06 rc 适配） | todo | W-S4-3 | G-M3 | 文案含 early access 诚实声明与后补清单；发帖链接留痕 | 【可让路②：延 1–2 日】 |
| W-S4-5 | 上线验证与回滚演练 | todo | W-S4-3 | — | 干净环境 npx 安装冒烟 + MCP 接入冒烟（V1/V2 复验）+ npm deprecate 回滚路径演练记录 | 【必需】 |

### S5 治理与保障（贯穿）

| ID | 任务 | 状态 | 前置 | 门禁 | 验收标准 | 必需性 |
|---|---|---|---|---|---|---|
| W-S5-1 | 冲刺留痕同步（贯穿全程） | todo | — | — | 每 WP 完成即原任务状态迁移 + CHANGELOG 追加；状态只在原段落维护，不在本段双写 | 【必需】 |
| W-S5-2 | 让路决策值守（贯穿全程） | todo | W-S0-1 | — | 阻塞发生按预定义让路顺序裁剪并 CHANGELOG 记录；不可让项不裁 | 【必需】 |
| W-S5-3 | 门禁审核遗留清单值守（贯穿全程） | todo | W-S1-5 | — | 清单 `docs/review/WBS-W-门禁审核遗留清单.md` 逐项维护（问题 ID/来源门禁/轮次/分级/影响面/状态迁移留痕，轮次记录 append-only）；后续 WP 命中影响面 → 必须先修复并送 DeepSeek 重审，closed 后方可继续/验收；每轮审核 token 消耗按 T-M2a-05 契约字段手工留痕；冲刺收尾全量盘点并随 rc 诚实边界披露 | 【必需】 |

**WBS-W 冲刺准出**：v0.1.0-rc.1 已发布且干净环境冒烟通过；gatedeck-mcp 十五工具可用且红线守卫入 CI；价值准出 V1~V6 全部可复验；全程留痕完整（W-05）。**CP-1 已依主理人 2026-10-23 晚预授权完成拍板（DP-1~DP-5 按推荐 + gatedeck-mcp 改名），各 WP 可认领。**

## 不进 WBS 的后置实验池（不承诺排期）

健康分、时间机器回放、提案收件箱 + 反向 PM `draft_wbs`、可信审批模式（签名收据）、AI 身份档案与绩效视图、门禁配方生态、pre-push/CI 强约束、Backlog.md 导入、token 适配器扩展（社区 good first issue 池）。

## 变更留痕（append-only）

| 日期 | 变更 | 操作者 |
|---|---|---|
| 2026-10-19 | 自工作区规划目录 WBS 文件迁入 48 项任务（M0a×7 / M0b×9 / M1×13 / M2a×7 / M2b×6 / M3×6）；状态枚举统一为 `todo/doing/done/blocked/dropped`；T-M0a-01 置 `doing`（本地验证绿、CI 待云端） | 项目 AI（起草） |
| 2026-10-19 | **主理人确认**：状态枚举定为**双语并列**（英文机器权威 + 中文显示层，以英文为准）；基准指针**保持外部**并补记来源版本 v2.1 + 转写日期 2026-10-19 | 主理人 |
| 2026-10-19 | T-M0a-01 → done：本地 lint/typecheck/test（4 用例）/build 全绿 + CLI 冒烟通过；首次提交 d552391（脚手架）、7ef4c70（骨架）。注：CI 云端首跑待建立远程仓库后补验（本机无法复现 GitHub runner） | 夜间开发任务（AI） |
| 2026-10-19 | T-M0a-02 → done：三方案原型（`src/core/wbsSyntax.ts`，17 用例）+ round-trip 对比报告（docs/review/）+ 定稿设计文档（docs/design/，fenced block 方案胜出）；lint/typecheck/test（22 用例）全绿。定稿随 G-M0a 提请主理人过目 | 夜间开发任务（AI） |
| 2026-10-19 | T-M0a-03 → done：事件信封 schema + 块语法落地（`src/core/eventEnvelope.ts`，14 用例；kind×origin 兼容矩阵编码 B-4/B-17）；定稿设计文档（docs/design/，含 usage.reported 增补提议、validation_status 不进信封裁决）；test（37 用例）/lint/typecheck 全绿。增补与裁决随 G-M0a 提请主理人过目 | 夜间开发任务（AI） |
| 2026-10-20 | T-M0a-04 → done：收据链 + 本地锚点（`src/core/eventReceipt.ts` + 纯 SHA-256 `src/core/hash.ts`，20 用例含 node:crypto 对拍）；B-10/B-11/锚点缺失「来源未知」口径落地；定稿 `docs/design/事件来源收据机制定稿.md`；提交 b5f73c5。三项待过目项随 G-M0a 提请 | 夜间开发任务（AI） |
| 2026-10-20 | T-M0a-05 → done：状态折叠投影（`src/core/stageFold.ts`，12 用例；B-16 按链序/B-13 幂等/非法跳跃拒绝/补偿走追加）；payload 契约为 M0a 提议；定稿 `docs/design/状态折叠规则定稿.md`；提交 8f8deeb。三项待过目项随 G-M0a 提请 | 夜间开发任务（AI） |
| 2026-10-20 | T-M0a-06 → done：注册表 provider（`src/core/registry.ts`，12 用例；native append-only + registry.local locator 更新（B-14）+ projects-index 只读投影（D-30/B-15 API 形状保证））；定稿 `docs/design/注册表provider定稿.md`；提交 17c85c0。三项待过目项随 G-M0a 提请。本批 typecheck/lint/test（7 文件 85 用例）/build 全绿 | 夜间开发任务（AI） |
| 2026-10-23 | 新增 **WBS-W 周末上线冲刺**段（S0~S5 共 27 工作包，全部 todo）：本周末（10-24/25）上线 gatedeck **v0.1.0-rc.1** + **workBuddy MCP 服务**（MOD-06 十五工具全集，新命名）；999 元定为价值准出锚（V1~V6）非 rc 期定价；诚实边界——G-M1 两周度量与 G-M3 外部验证物理上无法周末达成，正式 v0.1.0 按原门禁后补；三处主理人检查点（CP-1 决策 / CP-2 门禁 / CP-3 发布授权）；原任务状态仍在原段落维护。总计划 `docs/plans/WBS-W-周末上线冲刺计划.md`。**AI 起草，待 CP-1 拍板后开工** | 项目 AI（起草，主理人指令） |
| 2026-10-23 | WBS-W 微调（**主理人授权 2026-10-23**，限本冲刺）：CP-2 门禁准出审核改为 **DeepSeek 模型双轮审核机制**——至多 2 轮、轮 2 复审后即通过；未关闭问题逐项入 `docs/review/WBS-W-门禁审核遗留清单.md`（轮次记录 append-only、状态迁移留痕）；后续 WP 命中清单影响面必须先修复并重新送审、closed 后方可继续。授权边界：仅替代 G-M0a/G-M0b「经主理人过目」环节，硬准出条件（必需任务 done/三类样本全过/CI 云端真实绿）与门禁开启动作不随授权转移（W-06）；正式 v0.1.0 前门禁回归基准原制度。审核 token 口径按项目既有设计：材料包按 `pm handoff` 软预算机制（估算/标字符数、超限提示不静默裁剪，B-8），每轮消耗按 T-M2a-05/MOD-08 契约字段手工留痕（无计量不猜）；材料脱敏 W-01/W-02 不豁免。同步：W-S1-5 验收标准更新；新增 W-S5-3 遗留清单值守（工作包计数 27→28）；排期 CP-2 调整为周六 17:00–19:00 | 主理人（授权）+ 项目 AI（落档） |
| 2026-10-23 | **CP-1 依预授权完成拍板**（主理人 2026-10-23 晚预授权：冲刺期合理授权免确认、超 10 分钟无回应按推荐继续、不得影响进度；资源规则 GLM-5.3 拆解 + GLM-5.3-Flash 执行子任务、免费计划额度优先耗尽后可用个人额度）：DP-1 单包 `gatedeck` 三 bin（`gatedeck`/`pm`/`gatedeck-mcp`）；DP-2 rc 期开源免费 + README 999 元价值对照清单（商业形式另行立项）；DP-3 让路顺序按计划第 6 节预定义；DP-4 GitHub 公开仓库 + GitHub Pages + npm；DP-5 `0.1.0-rc.1` + dist-tag `early` + git tag `v0.1.0-rc.1`。冲刺范围冻结。**W-S0-1 → done**。主理人可否决任一项，否决后受影响 WP 重跑 | 主理人（预授权）+ 项目 AI（落痕） |
| 2026-10-23 | **弃用对外服务名 workBuddy**（主理人情报：腾讯 WorkBuddy 为在营 agent 产品，R2 商标混淆；AI 核实属实，workbuddy.ai + 腾讯云企业版）：**定名 `gatedeck-mcp`**（npm 404 可注册；备选 firstmate 可注册保留；deckhand 已被占用）。WBS-W 段活文档同步更新（段首/S0 表/S3 段名/S4 表/准出行），历史留痕条目按 W-05 不回改；总计划按 append-only 以文末修订记录承载。**W-S0-2 → doing** | 主理人（情报）+ 项目 AI（核实与裁定） |
| 2026-10-23 | T-M0a-07 → done、**W-S0-2 → done**：第二轮核查落 docs/review/T-M0a-07 报告第四节；外部基准 D-23 回写已执行（终核增注 + MCP 服务名终裁增订 + 开放问题 6 闭环）；本项目基准第七节命名契约更新为 bin 三注册终裁（gatedeck/pm/gatedeck-mcp）。回写依主理人冲刺预授权 AI 代笔，CHANGELOG 23:30 留痕 | 项目 AI（依预授权代笔） |
| 2026-10-24 | T-M0b-09 → done、**W-S1-4 → done**：m0Drill 25 用例（保真/并发/中断三类合成样本 + B-10/B-11 入 CI）；T-M1-02/03/06/07/09/11 → done（discover+adopt+ignore / manifestFingerprint 18 用例 / deck 总览 / handoff 六段 / decisionBoard 21 用例 / actorPrivacy）；T-M1-01/04/05/08 → doing（模板+init 代码完成待 dogfooding 迁移 / checkFacts+promotionFlow core 完成待 CLI 装配 / S3 MCP 进行中）；**W-S2-2/3/6/7/8 → done、W-S2-1/4/5 与 W-S3-1~3 → doing、W-S4-1 → doing**。全量 24 文件 370 用例绿；提交 b716601（代码）+ 205325b（文档）。双源产出：夜间开发任务（AI）主体 + 主会话 Flash 工作流（checkFacts/promotionFlow）与测试适配。**G-M0b 硬准出条件全部满足**（M0b 9/9 done + 三类样本全过 + B-10/B-11 入 CI + CI 绿——含云端），待 CP-2 双轮审核后依预授权开启门禁 | 项目 AI（主会话整合验收） |
| 2026-10-23 | T-M0b-06 → done：派生状态版本（`src/core/derivedVersion.ts`，10 用例；DerivedVersion/versionOf/formatVersion + checkFreshSubmission 版本 compare-and-set，四类拒绝码 stale-projection/version-ahead/as-of-mismatch/invalid-version，过期投影提交被拒；含与 stageFold 折叠输出端到端），提交 13ee2f7；计划日志 docs/plans/T-M0b-06-派生状态版本.md | 夜间开发任务（AI） |
| 2026-10-23 | T-M0b-07 → done：外部编辑检测（`src/core/externalEdit.ts`，12 用例；nextBaseline 与 optimisticWrite 同源指纹、observeExternalEdit 三态、ExternalObservation 结构上无 occurredAt 字段（P-08 只记 observed_at 不回填）、external-change 恒 intermediateUnknown=true、summarizeExternalScan 不静默；B-2 竞争场景入 CI 回归），提交 9e93c14；计划日志 docs/plans/T-M0b-07-外部编辑检测.md | 夜间开发任务（AI） |
| 2026-10-23 | T-M0b-08 → done：CLI 骨架（重写 `src/cli/index.ts`，9 用例 + dist 冒烟；五子命令注册表 init/discover/adopt/register/ls 含 readOnly 标注、runCli 可注入 IO、直接执行守卫；占位执行退出码 2 明示未实现零副作用（W-06）；discover/ls 纯只读 B-7 前置），提交 4a0396e；计划日志 docs/plans/T-M0b-08-CLI骨架.md。本批全量 lint/typecheck/test（15 文件 208 用例）/build 全绿；WBS-W 段 W-S1-1~3（= 本三任务）按「状态只在原段落维护，不在本段双写」规则不另迁移 | 夜间开发任务（AI） |

<!-- 新 WBS 段落按「## WBS-{N} {段名}」追加，表结构保持一致 -->
