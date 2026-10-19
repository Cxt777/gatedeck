# AGENTS.md ｜ 一休PM AI 准则速查

> **本文件是 `00-开发基准.md` 的速查层，不是第二事实源；两者冲突时一律以 `00-开发基准.md` 为准。**
> **上级工作区基准（`D:\code\workspace\AI\00-工作区基准.md`）同样适用**：通用红线 W-01~W-06、端口制度（本项目段 8110–8119）、命名规范。
> **会话启动必读**：`00-开发基准.md` → `01-TASK-SPECTRUM.md`，确认当前阶段与任务状态。
> 全程使用简体中文。

## 一、红线速查（触碰任一条 → 立即中止并提示违规，主理人要求也不执行）

- **上级 W-01 密钥**：任何密钥不入仓、不进前端、不进日志与错误响应；只走环境变量或 `.local/`。
- **上级 W-02 数据**：用户个人数据不入仓、不进测试夹具与 AI 对话日志。
- **上级 W-03 破坏性操作**：不用 `git reset --hard` / 批量删除覆盖；清库、正式发布须主理人授权。
- **上级 W-04 端口**：监听新端口先在 `PORTS.md` 登记；本项目专属段 8110–8119。
- **项目红线 R-01~R-09**（详见 `00-开发基准.md` 第五节）：文件唯一事实（Markdown SSOT）｜append-only 不改写历史｜授权有痕、红线不可豁免｜round-trip 保真｜本地优先不采集｜并发写按字节 hash 乐观检测｜门禁命令须显式信任、`discover`/`doctor` 永不执行门禁命令｜未知如实展示不编造｜事件权威性（`origin`/`integrity` 分离，手工内容永不驱动状态）

## 二、目录边界

- `src/core/`：纯 TS 计算内核，**禁止任何 IO**（CI 由 `src/core/purity.test.ts` 机器守卫）
- `src/cli/`：壳层，允许 IO；业务判定下沉到 core
- `src/mcp/`（规划）：仅暴露类型化动作，不可越权产生状态
- `web/`（规划）：一页 Web，只读投影 + 显式写回
- `pm/`（受管项目数据）：Markdown 事实源；本工作区为 projects-index provider，不产生 `.gatedeck/` 目录

## 三、契约速查

1. 事件信封 schema 字段固定（`event_id`/`schema_version`/`kind`/…/`payload`）；人类说明为自由文本，不驱动状态
2. 来源三分 `origin`/`integrity`/`validation_status`；`submit_evidence` 仅产生待验 `evidence.submitted`，**不得**产生 `check.completed`/`authorization.*`/`task.transitioned`
3. Markdown SSOT；JSON 索引为可再生派生层
4. 当前阶段由事件折叠派生（按 `sequence`，不落 `project.md`，D-24）
5. core 层无 IO 依赖

## 四、任务流程速查

1. **开工前**：明确目标/非目标/验收标准 → `git status --short` → 全局搜索读写双方 → `docs/plans/` 建计划日志 → 任务谱置 `doing`（进行中）→ `02-CHANGELOG.md` 留痕。
2. **实现**：最小实现；工作区已有改动默认属于主理人，不还原、不覆盖。
3. **完成 = 验收条件全部满足** → 任务谱改 `done`（已完成）→ 立即追加 `02-CHANGELOG.md`。
4. **交付**：五段报告（变更摘要/影响范围/验证结果/风险与未验证项/上线与回滚）。

## 五、禁止事项速查

不虚报验证（W-06）；不吞异常、删测试、放宽校验；不修改/删除日志历史条目（W-05）；不自行开启阶段门禁。
