# 安全策略 ｜ Security Policy

> 中文为主；报告安全漏洞时用中文或英文均可。
> Primary language is Chinese; vulnerability reports in Chinese or English are both welcome.

## 支持的版本 ｜ Supported versions

| 版本 / Version | 支持状态 / Support |
|---|---|
| 0.1.0-rc.x（npm dist-tag `early`） | ✅ 接收安全反馈 / accepts security feedback |
| 更早版本 / earlier | ❌ 不支持 / not supported |

正式 v0.1.0 发布后，此处更新受支持范围。

## 安全边界声明 ｜ Security boundary

Gatedeck 是**本地优先**的命令行工具，安全模型围绕两条底线设计——「数据不出你的机器」与「门禁命令不可被偷跑」：

1. **不采集不上传**：无遥测、无账号体系、无云依赖；项目数据只存在于本地 Markdown 文件中，工具本身不发起对外网络请求。
2. **门禁命令须显式信任**：执行任何门禁检查命令前，必须先对该命令**显式信任**——信任绑定「项目 ID + 规则 ID + 命令规范化文本 + 相关脚本/配置的 manifest 指纹 + runner 版本」；执行时限定工作目录、超时与输出捕获，危险命令模式触发告警。未显式信任的命令不会被运行。
3. **只读路径永不执行命令**：`discover` / `doctor` 与一切普通读取路径**永不执行**任何门禁命令——预览与体检不会变成代码执行。
4. **MCP 动作白名单**：gatedeck-mcp 仅暴露类型化动作；无 `pass_gate`、无通用日志写入；AI 不能代用户产生授权（`authorization.*`）事件；`submit_evidence` 只产生待验证据，不改变检查事实。
5. **事件完整性可验证**：系统事件带 SHA-256 收据链（内容与顺序双重绑定）；收据对不上即标 `invalid`，不参与状态推导，进入「需要处理」而不是被静默修复。

## 报告漏洞 ｜ Reporting a vulnerability

**请不要为安全漏洞开公开 issue、PR 或讨论。**

- **首选渠道**：GitHub **Private security advisory**——仓库页 **Security → Report a vulnerability** 私密提交；
- 备选：通过 GitHub 联系维护者（见仓库主页）私下沟通后再补录 advisory。

本项目为单人维护的开源项目，会尽力尽快回应，暂不承诺固定响应时限（SLA）。rc 阶段同样欢迎**设计层面**的安全反馈（例如 MCP 权限模型、信任绑定机制），请在 advisory 中说明影响面。
