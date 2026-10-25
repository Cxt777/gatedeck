# Gatedeck (一休PM)

**Gatedeck is your decision deck — a desk that makes you stop one step, figure out what's next, and only then act.** Opening it shows three zones — *Waiting on you / Ready to push / Needs attention* — and every push leaves verifiable evidence. Built for solo developers pairing with AI across multiple projects; local-first, and your data stays your own Markdown files.

> **"Know what's next. Prove what's done."**

<!-- badges placeholder: uncomment after the npm package is published
[![npm version](https://img.shields.io/npm/v/gatedeck.svg)](https://www.npmjs.com/package/gatedeck)
[![license](https://img.shields.io/npm/l/gatedeck.svg)](./LICENSE)
[![CI](https://github.com/Cxt777/gatedeck/actions/workflows/ci.yml/badge.svg)](https://github.com/Cxt777/gatedeck/actions/workflows/ci.yml)
-->

> ⚠️ **Early Access (0.1.0-rc.1)**: this is a release candidate, not a stable release. The npm dist-tag is `early`. See the [Early-access honesty note](#early-access-honesty-note) below for scope and what's coming.

## Why Gatedeck

Three real pain points of solo development with AI pair:

| Pain point | What Gatedeck does |
|---|---|
| **Multiple projects in parallel — you open your laptop and don't know what to do next**, with work scattered across TODOs, notes and chat logs | **The decision deck**: triage into three zones — *Waiting on you / Ready to push / Needs attention* — so the one thing that matters is visible at a glance |
| **AI session handoff is word of mouth** — every new session needs a human to re-explain the project, and one omitted detail sends it off track | **The handoff package**: one command produces a structured handoff (goal & scope / applicable rules / decisions & dependencies / valid & expired evidence / failed attempts / next step & acceptance) that a fresh session can use as-is; AI can also read it directly via gatedeck-mcp |
| **Progress leaves no evidence** — at retro time you can't tell "actually done" from "assumed done" | **The evidence chain**: every state transition is a Markdown event with a SHA-256 receipt — replayable, auditable, `git diff`-able |

## Get started in 5 minutes

Requires Node.js ≥ 22.

Naming: `gatedeck` is the main command and `pm` is an equivalent alias; both ship in the same npm package.

### Step 1: try without installing

```bash
npx gatedeck@early
```

Running it with no arguments prints the help (excerpt of the actual output; the CLI messages are localized in Chinese — `gatedeck --help` always shows the current command set):

```text
gatedeck（一休PM）— 决策台优先、证据可校验的本地项目管理工具

用法：gatedeck <command> [options]      （别名：pm）
```

### Step 2: initialize your project contract

From the root of your project repository:

```bash
gatedeck init --name "My App" --slug myapp --stage dev
```

Illustrative output — this creates a skeleton of five Markdown contract files under `pm/` (exact wording depends on the version you installed):

```text
pm/project.md     project identity & basics
pm/wbs.md         task spectrum (WBS)
pm/gates.md       stages & gate definitions
pm/changelog.md   event log (append-only)
pm/insights.md    insights & retros
```

### Step 3: open the deck

```bash
gatedeck deck
```

On first run there is nothing to show yet, so the deck prints onboarding text instead of a board (illustrative):

```text
(first run) No events recorded yet.
The deck has three zones:
  Waiting on you  — things that need your call (gates pending acceptance, requests to review)
  Ready to push   — tasks you can pick up right now
  Needs attention — blocked tasks, expired evidence, signals like that
Run init and start pushing your project; this updates as events come in.
```

For a fresh AI session, `gatedeck handoff` produces the handoff package (coming in this rc), or let the AI read the project directly through gatedeck-mcp (see "AI takeover" below).

> **Honesty note**: this rc is evolving quickly during a weekend sprint (2026-10-24/25). The authoritative command set is whatever `gatedeck --help` prints for your installed version; subcommands that haven't landed yet **exit with code 2 and say so explicitly** — they produce no files and never pretend to succeed.

## Core concepts

### The three zones (deck)

The rule in one sentence: **things awaiting your call (gates pending acceptance, requests to review) go to "Waiting on you"; tasks you can pick up go to "Ready to push"; anything that smells wrong (blocked tasks, expired or to-be-reverified evidence) goes to "Needs attention".**

Every deck view carries a data version stamp (`as_of`): if you submit a change based on a stale version, it is rejected with a re-read hint — never silently overwritten.

### The evidence chain

Project facts live in **Markdown as the single source of truth (SSOT)**. Inside `changelog` / `insights` are canonical event blocks with a fixed envelope (`event_id` / `kind` / `actor` / `origin` / `integrity` / `payload` …) plus a **SHA-256 receipt chain** binding both content and order. It's all plain text: you can `git diff` it and read it by eye; if a receipt doesn't match, the event is marked `invalid`, excluded from state derivation, and surfaced as "needs handling" instead of being silently repaired.

An event block looks like this (illustrative format, not real data):

```gatedeck-event
event_id: 01JC6Z0W8G9Q2X7V5T3R4S6K1A
schema_version: 1
kind: task.transitioned
occurred_at: 2026-10-24T21:00:00+08:00
recorded_at: 2026-10-24T21:00:00+08:00
actor: {"actor_id":"01JCACTOR…","session_id":"01JCSESS…"}
origin: core
integrity: verified
subject: {"object_id":"task:T-001"}
payload: {"from":"doing","to":"done"}
```

### AI takeover (gatedeck-mcp)

gatedeck-mcp is the third bin in the same package (an MCP server): AI clients such as Claude Desktop, Cursor or ZCode use typed MCP actions to read the deck, pick up tasks and submit evidence — but AI **can only produce to-be-verified evidence and typed events; it can never authorize a promotion on your behalf** (no `pass_gate`, no `authorization.*` events). The decision stays with you.

Client configuration examples will be added once gatedeck-mcp ships with the rc:

<!-- MCP 配置随 gatedeck-mcp 发布后补充 -->

## Early-access honesty note

The current version is **0.1.0-rc.1** (npm dist-tag `early`) — a release candidate, not the official release. To ship the shortest valuable path first (onboard → deck → evidence → handoff → AI takeover), the following are explicitly deferred (all on the roadmap for the official release / M2):

- **One-page web projection** — today there is only the CLI text deck;
- **Activity heatmap** (Insights view);
- **Two-week dogfooding metrics** — we measure "time to find the next item / manual corrections per new AI session / missed evidence expiries" on our own projects, starting 2026-10-25;
- **Cross-project `query` / `lint` / `doctor`**;
- **Usage & cost accounting** (token / cost accounting, planned for M2a);
- Stage subway-map component, the `spec` contract document, `migrate` contract migration, and more.

**Path to official v0.1.0**: the original gates still apply — two-week dogfooding metrics → real multi-project validation → external user verification; expected mid-to-late November 2026. All external copy during the rc period states early access plainly; the rc never poses as the official release.

## Local-first & privacy

- **Plain Markdown SSOT**: project facts live only in your own `.md` files; JSON indexes are a regenerable derived layer — delete them and rebuild anytime.
- **No collection, no upload**: no telemetry, no accounts, no cloud dependency; fully usable offline.
- **Anonymous attribution**: `actor_id` / `session_id` in events are opaque locally-generated random IDs — no email, no usernames, no conversation text.
- **Concurrency protection**: before writing, a real byte-level hash is compared optimistically; if someone (or another tool) changed the file, the write is rejected with a re-read hint — never silently overwritten (honest caveat: we don't promise zero loss in every conceivable editor scenario).

## Contributing & support

- To contribute: see [CONTRIBUTING.md](./CONTRIBUTING.md) (environment, commands, commit conventions, project governance).
- Security issues: **do not open a public issue** — use the private reporting channel in [SECURITY.md](./SECURITY.md).
- Bugs & feature requests: GitHub Issues (bilingual bug / feature templates are configured): <https://github.com/Cxt777/gatedeck/issues>

## License

[MIT](./LICENSE) © 2026 Cxt777
