# 发布手册 · gatedeck v0.1.0-rc.1（W-S4-3 / CP-3）

> 状态（2026-10-25 更新）：**A 轨已上线**——GitHub 直装可用（`npx github:Cxt777/gatedeck`，prepare 现场构建，三 bin 实测通过），零 npm 账号依赖；**B 轨（npm registry 正式发布）待主理人注册 npm 账号**（主理人尚无 npm 账号）。

## 〇、B 轨前置：注册 npm 账号（约 2 分钟，一次性）

1. 浏览器打开 <https://www.npmjs.com/signup>，用邮箱 + 用户名 + 密码注册（或点 Sign in with GitHub 直接用 GitHub 账号授权——更快，无需另记密码）；
2. 收验证邮件点确认；
3. 在本机执行一条命令完成登录（会弹浏览器确认）：`npm login`；
4. 登录后告知 AI，或自行执行下面的一键发布。

## 一、一键发布（主理人执行）

```bash
cd D:/code/workspace/AI/gatedeck
npm login                      # 首次：浏览器登录 npmjs.com
npm publish                    # prepublishOnly 自动跑 lint+typecheck+test+build；publishConfig 已设 tag=early
```

预期：npm 上出现 `gatedeck@0.1.0-rc.1`（dist-tag `early`）。`npx gatedeck@early` 即刻可用。

## 二、发布前检查清单（已由 AI 完成 2026-10-25）

| 项 | 状态 | 证据 |
|---|---|---|
| 版本与配置 | ✅ | package.json：0.1.0-rc.1 / private:false / publishConfig{tag:early,access:public} / bin 三注册（gatedeck/pm/gatedeck-mcp） / files:[dist] / repository/keywords/prepublishOnly |
| LICENSE/README 双语/CONTRIBUTING/SECURITY/issue 模板 | ✅ | 提交 205325b |
| CI 绿 | ✅ | GitHub Actions 全 run success（分支保护 strict 必需检查生效） |
| 全量验证 | ✅ | pnpm lint/typecheck/test 全绿（用例数以最新 CHANGELOG 留痕为准） |
| 干净环境安装冒烟 | ✅ | npm pack → 全新目录 npm i <tarball> → 三 bin 冒烟通过（见第四节） |
| 回滚路径 | ✅ | npm deprecate 命令预置 + 演练记录（见第五节） |

## 三、git tag（发布动作的伴随动作）

```bash
git tag -a v0.1.0-rc.1 -m "v0.1.0-rc.1 — early access（WBS-W 冲刺产出）"
git push origin v0.1.0-rc.1
```

（若主理人授权 AI 代打 tag：AI 已备好命令，随发布执行。）

## 四、干净环境安装冒烟（不依赖 registry 的 V1 判据复验）

```bash
pnpm build && npm pack                                    # 产出 gatedeck-0.1.0-rc.1.tgz
mkdir /tmp/gd-clean && cd /tmp/gd-clean
npm init -y >/dev/null && npm i <tarball 绝对路径>
npx gatedeck --version        # 0.1.0-rc.1
npx gatedeck help             # 命令清单
npx gatedeck-mcp              # MCP 启动横幅（stderr）
```

## 五、回滚路径（W-S4-5）

```bash
npm deprecate gatedeck@0.1.0-rc.1 "回滚原因：见 GitHub issue <N>"
# 或整 tag 下线（极端）：npm dist-tag rm gatedeck early
```

- 回滚决策属主理人（W-03：正式发布动作须授权，撤销同理）；
- 回滚后 git tag 保留（历史不可篡改，R-02），README 声明状态；
- 本地数据零影响（本地优先，用户 pm/ 目录不依赖 registry）。

## 六、诚实边界（对外文案口径）

- rc ≠ 正式版：README 与社区文案均声明 early access 与后补清单（一页 Web / 热力图 / 两周自举度量 / M2 全量 / spec / migrate）；
- 正式 v0.1.0 前门禁（G-M1~G-M3）回归主理人人工制度；
- 999 元为价值对照清单（质量标尺），非定价；rc 期免费开源（MIT）。
