# gatedeck-mcp 客户端接入指南（Claude Desktop / Cursor / ZCode）

> 适用版本：gatedeck **0.1.0-rc.1**（npm dist-tag `early`）。gatedeck-mcp 是 gatedeck 包内的第三个 bin（MCP server，stdio 传输）——同一包三次注册：`gatedeck` / `pm`（CLI 及其别名）、`gatedeck-mcp`（MCP，见包 `package.json` 的 `bin` 段）。
> 本指南所有工具名以 `src/mcp/tools/registry.ts` 的 `TOOL_ALLOWLIST`（15 工具全集）为准；所有输出示意基于当前实现的真实返回形态（读工具 shape 见 `src/mcp/tools/readers.ts`，写/门禁见 `writers.ts` / `gates.ts`），字段值随你的项目数据而异。

## 1. 前置条件

1. **Node.js ≥ 22**（包 `engines` 要求 `node >=22`）。检查：`node -v`。
2. **你的项目已完成 `gatedeck init`**（项目根存在 `pm/` 目录，内含 project/wbs/gates/changelog/insights 五个 Markdown 契约文件骨架）。没初始化也能连上 MCP——未 init 时读工具会返回 `not-initialized` 引导而不是报错崩溃：
   ```json
   { "error": "not-initialized", "hint": "当前目录尚未初始化（无 pm/ 目录）：先运行 gatedeck init 生成 pm/ 契约文件骨架，再使用本工具。" }
   ```
   但只有 init 过才有真实数据可读。
3. AI 客户端支持 **MCP 本地 stdio server**（下述三家当前版本均支持）。

### 启动命令的正确姿势（重要，先读这段再抄配置）

gatedeck 包是**三 bin 注册**（`gatedeck` / `pm` / `gatedeck-mcp`）。`npx gatedeck@early` 启动的是与包同名的 bin，即 **CLI**（CLI 也没有 `--mcp` 参数），不是 MCP server。

- ❌ 错误姿势：`npx -y gatedeck@early --mcp`（启动的是 CLI，客户端会连不上工具）
- ✅ 正确姿势：`npx -y -p gatedeck@early gatedeck-mcp`——`-p` 先指定包，再执行包内名为 `gatedeck-mcp` 的 bin

### 项目目录如何确定（rc.1 现状，如实说明）

gatedeck-mcp 从**其进程工作目录（cwd）**解析项目（读取 `<cwd>/pm/`）。该 cwd 由客户端启动 server 时决定，**不一定是你的项目目录**——如果工具返回 `not-initialized` 但你的项目明明 init 过，多半是 cwd 不对。

- `GATEDECK_PROJECT_DIR` 环境变量是为「在配置里指定项目目录」规划的约定；**截至 0.1.0-rc.1 尚未实现**（server 代码不读取该变量），预填无害但不会生效，落地后无需改配置即自动生效。
- **rc.1 当下指定项目目录的可靠做法**：用 shell 包装先把 cwd 切到项目目录再启动——

  Windows（cmd 包装）：

  ```json
  {
    "mcpServers": {
      "gatedeck": {
        "command": "cmd",
        "args": ["/c", "cd /d D:\\path\\to\\your-project && npx -y -p gatedeck@early gatedeck-mcp"]
      }
    }
  }
  ```

  macOS / Linux（sh 包装）：

  ```json
  {
    "mcpServers": {
      "gatedeck": {
        "command": "sh",
        "args": ["-c", "cd /path/to/your-project && npx -y -p gatedeck@early gatedeck-mcp"]
      }
    }
  }
  ```

## 2. 三个客户端的配置

### 2.1 Claude Desktop

- **适用**：支持 MCP 本地 server 的 Claude Desktop 桌面版；配置入口 Settings → Developer → Edit Config，编辑 `claude_desktop_config.json`（Windows 在 `%APPDATA%\Claude\`，macOS 在 `~/Library/Application Support/Claude/`）。
- **配置**（`mcpServers` 段）：

  ```json
  {
    "mcpServers": {
      "gatedeck": {
        "command": "npx",
        "args": ["-y", "-p", "gatedeck@early", "gatedeck-mcp"]
      }
    }
  }
  ```

- **说明**：
  - Claude Desktop 启动 stdio server 时的 cwd 由其自行决定（通常不是你的项目目录）——按上文「项目目录如何确定」用 shell 包装指定项目目录，或预填 `env.GATEDECK_PROJECT_DIR` 等待其落地（rc.1 不读取）。
  - Windows 下若 `npx` 直连失败（npx 实为 `.cmd` 脚本），把入口换成 `cmd` 包装：`"command": "cmd", "args": ["/c", "npx", "-y", "-p", "gatedeck@early", "gatedeck-mcp"]`。
  - 改完保存后**完全重启** Claude Desktop；对话中可让 AI「列出你的 gatedeck 工具」验证 15 个工具已挂载。

### 2.2 Cursor

- **适用**：支持 MCP 的 Cursor 版本；项目级配置为项目根 `.cursor/mcp.json`（全局配置在 Cursor 设置 → MCP 里管理，结构相同）。
- **配置**（`.cursor/mcp.json`，同样 `mcpServers` 结构）：

  ```json
  {
    "mcpServers": {
      "gatedeck": {
        "command": "npx",
        "args": ["-y", "-p", "gatedeck@early", "gatedeck-mcp"]
      }
    }
  }
  ```

- **说明**：
  - `.cursor/mcp.json` 放在**哪个项目根**，就服务于哪个项目——结合上文 cwd 说明，Cursor 是否把项目目录传给 server 以其实际行为为准；拿不准就用 shell 包装把 `cd` 写死。
  - 保存后在 Cursor MCP 设置面板确认 server 显示已连接、工具列表出现（应为 15 个）。

### 2.3 ZCode

- **适用**：支持 MCP 的 ZCode 版本。
- **配置方式**：在 ZCode 的 **MCP 配置界面**添加一个 **stdio 类型** server，命令行与上文相同——command `npx`，args `-y -p gatedeck@early gatedeck-mcp`（等价的 JSON `mcpServers` 结构也一致）。
- **说明**：
  - ZCode 会话通常在你打开的项目目录内运行，server 的 cwd 随会话工作目录走，是三个客户端里最接近「打开即用」的；若仍 `not-initialized`，按故障排查第 4 条处理。
  - 配置后让 AI 先跑一次 `get_overview` 验证连通。

## 3. 三分钟接管动线（价值准出 V2）

> 判据（README 价值清单 #2）：新开一个 AI 会话，经 gatedeck-mcp 读取项目概览与任务谱后，能准确复述项目状态并指出下一步。以下动线直接把「读 → 领 → 查 → 请」四步交给 AI；**示意 JSON 均为当前实现的真实返回形态**（字段值是占位示例，以你项目实际数据为准）。

**第 1 步 `get_overview`（参数 `{}`）** ——决策台四区投影（等您决定/可以推进/需要关注/进行中），AI 由此复述「现在最该干什么」：

```json
{
  "currentStage": "开发",
  "asOf": "2026-10-25T10:00:00.000Z",
  "sourceVersion": 7,
  "counts": { "…": "各分区计数（结构以实际返回为准）" },
  "zones": { "…": "四区条目数组，条目来自 core decisionBoard" },
  "needsAttention": [],
  "diagnostics": [],
  "notes": [],
  "observedAt": "2026-10-25T10:00:01.000Z"
}
```

**第 2 步 `get_wbs`（参数 `{}`）** ——任务列表（id/title/status/deps/stage）+ 解析诊断如实附列：

```json
{
  "count": 12,
  "tasks": [{ "id": "T-001", "title": "…", "status": "todo", "deps": [], "stage": "开发" }],
  "diagnostics": [],
  "notes": []
}
```

AI 依据 deps（前置）与 status 选定要领的任务，例如 `T-003`。

**第 3 步 `update_task` 领任务（status 置 `doing`）** ——参数至少含 `id`、`expected_hash`（`pm/wbs.md` 当前内容的 SHA-256，64 位十六进制——**内容 hash 乐观并发 CAS 基线**）：

```json
{
  "ok": true,
  "tool": "update_task",
  "id": "T-003",
  "updatedFields": ["status"],
  "files": [{ "path": "pm/wbs.md", "expectedHash": "…64位十六进制…", "nextHash": "…64位十六进制…" }],
  "projectionVersionCheck": "skipped",
  "diagnostics": [],
  "notes": ["status 变更已直接落盘 pm/wbs.md（任务状态唯一权威位置）。task.transitioned 权威事件按 D-22/B-4 通道分工仅由本机 CLI 真人确认流程产生，本通道（origin=managed-api）按 kind×origin 矩阵不可产生该 kind，故本次不追加事件块、不伪装留痕。"]
}
```

诚实提示（当前实现边界）：rc.1 的读工具**不返回** `wbs.md` 的内容 hash，`expected_hash` 需在本地计算（如 `sha256sum pm/wbs.md`，或 PowerShell `Get-FileHash pm/wbs.md`）。基线不一致时工具拒绝落盘并返回磁盘当前 hash（`current_hash`），重读重试即可，绝不静默覆盖。

**第 4 步 `check_gate`（参数可带 `gate_id`）** ——只读的检查事实查询与失效判定：重算 manifest 指纹并与凭证锚比对，**永不执行任何门禁/shell 命令**：

```json
{
  "ok": true,
  "tool": "check_gate",
  "manifest": { "hash": "…64位十六进制（manifest_hash）…", "entries": ["…pm/ 四契约文件与各自 contentHash…"], "excluded": ["…"] },
  "checks": [],
  "staleKeys": [],
  "summary": { "not-checked": 0, "passed": 0, "failed": 0, "error": 0, "stale": 0 },
  "gate_id": null,
  "evidenceNotice": "…",
  "notes": ["本工具为检查事实查询与失效判定，永不执行任何门禁/shell 命令（R-07/D-26）；…"]
}
```

记下 `manifest.hash`——下一步要用。

**第 5 步 `request_promotion`** ——发起阶段推进申请。参数：`from` / `to`（阶段）、`expected_sequence`（事件链序，取读工具返回的 `sourceVersion` 口径）、`manifest_hash`（第 4 步产出）、`actor_id` / `session_id`（非空本地不透明 ID，归因匿名 D-19，不采集个人数据）、`expected_hash`（`pm/changelog.md` 内容基线）、可选 `note`：

```json
{
  "ok": true,
  "tool": "request_promotion",
  "eventId": "…ULID…",
  "kind": "authorization.requested",
  "origin": "managed-api",
  "integrity": "unknown",
  "operationId": "…ULID…",
  "payload": { "from": "开发", "to": "验收", "expected_sequence": 7, "manifest_hash": "…" },
  "file": "pm/changelog.md",
  "nextHash": "…64位十六进制…",
  "currentStage": "开发",
  "nextStep": "批准与执行仅限本机 CLI 真人 TTY 流程（D-22/B-4/B-12）：请携带 operation_id 在 CLI 侧继续 confirm/apply；本通道绝不代产授权终态或状态迁移 kind。"
}
```

到这一步 AI 的工作就结束了：它只产出一条**待审申请**。你（主理人）在本机终端跑：

```bash
gatedeck promote --operation-id <上面返回的 operationId>
```

TTY 三步编排（confirm/apply）确认后才发生真正的授权与状态迁移。

## 4. 安全边界（AI 权限的天花板）

gatedeck-mcp 的 15 个工具由结构性白名单把守（`src/mcp/tools/registry.ts` 唯一事实源；server 启动即自检，越界拒绝启动）：

- **没有 `pass_gate`**：门禁开启是主理人人工动作（R-03），该名字在注册表层被永久禁止（B-4/B-17 禁名清单），配上也不存在。
- **没有通用事件写入**（无 `append_changelog`）：事件只能由类型化动作产生——`record_note`（非权威备注）、`submit_evidence`（待验证据）、`report_usage`（用量）、`request_promotion`（推进申请）；AI 造不出任意 kind 的事件。
- **`request_promotion` 只产生申请**：只写 `authorization.requested`（integrity=unknown，不驱动状态），**绝不**产生 `authorization.granted` / `authorization.locally_confirmed`；批准与执行必须本机 CLI 真人 TTY（`gatedeck promote`）。
- **`submit_evidence` 只产生待验证据**：只写 `evidence.submitted`，不产生 `check.completed` / `task.transitioned`。
- **`check_gate` 只读**：语义是检查事实查询与失效判定，**永不执行**任何门禁/shell 命令（R-07/D-26）——它不会替你跑测试。
- **状态变更的诚实留痕**：`update_task` 改状态直接落盘 `pm/wbs.md` 并明示「不追加 `task.transitioned` 权威事件、不伪装留痕」；该权威事件仅由本机 CLI 真人确认流程产生。
- **归因匿名**：`actor_id` / `session_id` 是本地不透明 ID（D-19），不记录邮箱、用户名或对话文本。

## 5. 故障排查

| 症状 | 原因与处理 |
|---|---|
| server 起不来 / `npx` 报 Node 版本错误 | Node < 22。包要求 `node >=22`：`node -v` 确认，升级后再试。 |
| 工具全返回 `not-initialized` 但项目明明 init 过 | server 的 cwd 不是你的项目目录（见第 1 节「项目目录如何确定」）。用 shell 包装 `cd` 到项目目录，或等 `GATEDECK_PROJECT_DIR` 落地。真未 init 就先在项目根跑 `gatedeck init`。 |
| 客户端显示 server 已连接但看不到工具 / stdio 无输出 | stdout 是 JSON-RPC 通道，**人眼看到的「无输出」是正常的**；gatedeck-mcp 的启动横幅与错误信息走 **stderr**（客户端日志面板里看 stderr）。本地机器自检：`pnpm build` 后跑 `node scripts/mcp-smoke.mjs`（见下节）。 |
| Windows 上 `npx` 直连失败 | npx 是 `.cmd` 脚本，部分客户端需要 `cmd` 包装：`"command": "cmd", "args": ["/c", "npx", "-y", "-p", "gatedeck@early", "gatedeck-mcp"]`。 |
| 连上了但行为像旧版本 | `npx` 缓存命中旧包。`gatedeck@early` dist-tag 始终指向最新 rc；必要时清 npx 缓存或改用全局安装 `npm i -g gatedeck@early` 后 command 直接写 `gatedeck-mcp`。 |
| 写工具报 hash 不一致（CAS 拒绝） | 基线过期：有人（或别的会话）改过文件。按返回的 `current_hash` 重读重试，绝不静默覆盖——这是并发保护在工作，不是故障。 |

## 6. 价值准出复验（V1 / V2）与冒烟脚本

- **V1 · 5 分钟接入**（README 价值清单 #1）：陌生环境 `npx gatedeck@early`（CLI）→ `gatedeck init` → `gatedeck deck` 首屏决策台可见，全程 ≤ 5 分钟。
- **V2 · 3 分钟 AI 接管**（README 价值清单 #2）：按本指南第 3 节动线，新 AI 会话依次 `get_overview` → `get_wbs` →（领任务）`update_task` → `check_gate` → `request_promotion`，AI 能复述状态并指出下一步。
- **机器可判冒烟**（协议通 + 名单对 + 首工具可用）：

  ```bash
  pnpm build                      # 先构建出 dist/mcp/server.js
  node scripts/mcp-smoke.mjs      # 全部通过输出：MCP 冒烟通过：15 工具，无禁名
  ```

  脚本硬断言：JSON-RPC id 匹配、`serverInfo` 为 `gatedeck-mcp`、工具恰 15 个且与 `TOOL_ALLOWLIST` 逐一相等、不含 `pass_gate` / `append_changelog`（B-4）、`get_overview` 返回 ok 或 not-initialized（裸仓无 `pm/` 属正常）。
