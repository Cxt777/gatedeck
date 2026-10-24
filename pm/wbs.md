# 工作分解（wbs.md）

<!-- 任务节点语法（T-M0a-02 定稿）：gatedeck-task 围栏块，字段一行式「key: value」；
     必需字段 id/title/status，status 取值 todo/doing/done/blocked/dropped（双语并列以英文为准）；
     deps 逗号分隔引用其他任务 id；未知字段原样保留并出诊断（F-06），不驱动受管状态。 -->

<!-- dogfooding 迁移（T-M1-01，2026-10-25）：本文件自 2026-10-25 起为活跃任务事实源（R-01）；
     历史已完成任务（M0a/M0b 全部、M1 已完成项）归档于 01-TASK-SPECTRUM.md（冻结留档，append-only 留痕表继续使用）；
     任务 ID 沿用原任务谱 ID（W-xxx / T-Mx-xx），保证跨文档可追溯。 -->

## WBS-W 周末上线冲刺（2026-10-24/25）

### W-S2-1 契约模板与 dogfooding 迁移收尾

```gatedeck-task
id: W-S2-1
title: 契约模板 v1 + pm init + 自举迁移（=T-M1-01）
status: doing
deps:
```

<!-- 迁移执行中：本仓 pm/ 已于 2026-10-25 初始化，本文件即迁移产物；收尾后迁 done。 -->

### W-S2-4 CLI gate check 装配

```gatedeck-task
id: W-S2-4
title: gatedeck gate check 检查事实 + 凭证 + 失效判定（=T-M1-04）
status: doing
deps:
```

### W-S2-5 CLI promote TTY 装配

```gatedeck-task
id: W-S2-5
title: TTY 三步 promote + B-12（=T-M1-05）
status: doing
deps: W-S2-4
```

### W-S3-4 一键接入体验

```gatedeck-task
id: W-S3-4
title: npx 冒烟 + 三客户端配置指南（V1/V2 判据可复验）
status: doing
deps:
```

### W-S4-3 发布工程与 npm rc.1

```gatedeck-task
id: W-S4-3
title: 发布工程 + npm 0.1.0-rc.1（dist-tag early）（=T-M3-04 rc 适配）
status: todo
deps: W-S3-4
```

### W-S4-5 上线验证与回滚演练

```gatedeck-task
id: W-S4-5
title: 干净环境 npx 冒烟 + MCP 接入冒烟（V1/V2 复验）+ npm deprecate 回滚演练
status: todo
deps: W-S4-3
```

### W-S4-2 落地页

```gatedeck-task
id: W-S4-2
title: gatedeck-mcp 落地页（可让路①：README 承载）
status: todo
deps: W-S4-3
```

### W-S4-4 社区发布

```gatedeck-task
id: W-S4-4
title: Show HN / V2EX / 掘金 / awesome-mcp-servers（可让路②：延 1-2 日）
status: todo
deps: W-S4-3
```

### W-S5-1 冲刺留痕同步

```gatedeck-task
id: W-S5-1
title: 每 WP 完成即状态迁移 + CHANGELOG 追加（贯穿全程）
status: doing
deps:
```

### W-S5-2 让路决策值守

```gatedeck-task
id: W-S5-2
title: 阻塞按预定义让路顺序裁剪并留痕（贯穿全程）
status: doing
deps:
```

### W-S5-3 门禁审核遗留清单值守

```gatedeck-task
id: W-S5-3
title: 遗留清单逐项维护与触发式修复重审（贯穿全程）
status: doing
deps:
```

## M1 收尾与自举（正式 v0.1.0 前后补）

### T-M1-12 自举接入与度量

```gatedeck-task
id: T-M1-12
title: 自举 dogfooding 2 周三项度量（自 2026-10-25 起算，记录机制已启动）
status: doing
deps: W-S2-1
```

### T-M1-10 一页 Web

```gatedeck-task
id: T-M1-10
title: 项目列表 + 决策台 + 证据面板（一页 Web，后补）
status: todo
deps:
```

### T-M1-13 地铁图组件

```gatedeck-task
id: T-M1-13
title: 阶段进度组件（地铁图形态，条件性，后补）
status: todo
deps:
```

### T-M3-02 spec 独立文档

```gatedeck-task
id: T-M3-02
title: gatedeck spec 契约 schema/兼容规则独立成文（后补）
status: todo
deps:
```

### T-M3-03 pm migrate

```gatedeck-task
id: T-M3-03
title: 契约版本升级迁移（迁移前自动归档快照，后补）
status: todo
deps: T-M3-02
```

### T-M3-05 外部用户验证

```gatedeck-task
id: T-M3-05
title: 1-3 个既有项目走通接入与升级路径（正式版前）
status: todo
deps:
```

## M2 数据可信与视图补齐（整体后补）

### T-M2a-01 query 完整 + JSON 索引

```gatedeck-task
id: T-M2a-01
title: 查询语言覆盖决策台/brief/风险分组 + JSON 索引派生层
status: todo
deps:
```

### T-M2a-02 pm lint

```gatedeck-task
id: T-M2a-02
title: 跨项目校验（契约违规/歧义数据/高危命令告警）
status: todo
deps:
```

### T-M2a-03 pm doctor

```gatedeck-task
id: T-M2a-03
title: 只读体检五项（检查与修复分离，永不执行门禁命令）
status: todo
deps: T-M2a-01
```

### T-M2a-04 活动热力图

```gatedeck-task
id: T-M2a-04
title: git 提交历史时间戳为主数据源（不声称完整工时）
status: todo
deps: T-M2a-01
```

### T-M2a-05 用量上报契约 + 三通道

```gatedeck-task
id: T-M2a-05
title: 开放轻量协议 + report_usage/手动/导入三通道
status: todo
deps:
```

### T-M2a-06 结构化导入参考实现

```gatedeck-task
id: T-M2a-06
title: 选作者在用工具的可导出统计（幂等去重 B-6）
status: todo
deps: T-M2a-05
```

### T-M2a-07 用量口径文档

```gatedeck-task
id: T-M2a-07
title: 分摊和≤1、覆盖率分母、折算非账单口径
status: todo
deps: T-M2a-05
```

### T-M2b-01 pm brief 晨报

```gatedeck-task
id: T-M2b-01
title: 跨项目日报投影（与决策台共用查询规则）
status: todo
deps: T-M2a-01
```

### T-M2b-02 任务看板拖拽写回

```gatedeck-task
id: T-M2b-02
title: 拖拽走 core 校验层 + 冲突乐观拒绝
status: todo
deps: T-M1-10
```

### T-M2b-03 风险解释性分组

```gatedeck-task
id: T-M2b-03
title: 按严重度/紧迫度/影响排序附原因（不做健康分）
status: todo
deps: T-M2a-01
```

### T-M2b-04 例外授权机制

```gatedeck-task
id: T-M2b-04
title: 申请/批准/失效流（绑定条件/指纹/批准者，红线不可豁免）
status: todo
deps:
```

### T-M2b-05 换算与投入推进线索

```gatedeck-task
id: T-M2b-05
title: 内置单价可覆盖 + D-28 四类线索只提示不判定（条件性）
status: todo
deps: T-M2a-07
```

### T-M2b-06 M2 门禁演练

```gatedeck-task
id: T-M2b-06
title: 3 真实项目接入 + 决策台规则真实数据可用
status: todo
deps: T-M2a-06
```
