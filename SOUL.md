# SOUL.md

VS Code / Cursor extension for **budi** — renders Cursor-only spend in a single status bar item by polling a locally-running `budi-daemon` over HTTP (`/analytics/statusline?provider=cursor` + `/health`).

This repo is **presentation only**. It does not touch SQLite, does not compute cost, does not classify prompts, does not read Cursor transcripts. Business logic — including the transcript tailer that feeds the daemon — lives in [`siropkin/budi`](https://github.com/siropkin/budi). Keep it that way.

## Product boundaries

| Product | Repo | Role |
|---------|------|------|
| **budi-core** | [`siropkin/budi`](https://github.com/siropkin/budi) | Rust: daemon, CLI, transcript tailer, all business logic. Owns SQLite. |
| **budi-cursor** | **this repo** (`siropkin/budi-cursor`) | VS Code/Cursor extension (TypeScript). Renders what the daemon returns. |
| **budi-cloud** | [`siropkin/budi-cloud`](https://github.com/siropkin/budi-cloud) | Next.js + Supabase cloud dashboard at `app.getbudi.dev`. Unrelated to this extension. |

Repo-split boundaries are pinned by [ADR-0086](https://github.com/siropkin/budi/blob/main/docs/adr/0086-extraction-boundaries.md) in the main repo — read it before crossing boundaries.

## Build & test

```bash
npm ci
npm run build         # tsc to out/
npm run watch         # tsc in watch mode
npm test              # Vitest
npm run lint
npm run format:check
npm run package       # produce cursor-budi.vsix via vsce
```

Marketplace publishing is driven from `.github/workflows/release.yml`; there is no local `publish` script.

## Install (for users)

- VS Code Marketplace: search for "budi"
- From CLI: `budi integrations install --with cursor-extension` (main repo drives this)
- Manual: `cursor --install-extension cursor-budi.vsix --force`

Extension activates on `onStartupFinished`. No configuration required; it auto-discovers the daemon on `127.0.0.1:7878`.

## What the extension does

Per ADR-0088 §7, the extension is intentionally **statusline-only**:

1. **One status bar item** — renders the shared provider-scoped status contract from the daemon, filtered to `provider=cursor`, in the same byte-for-byte shape the Claude Code statusline uses: `budi · $X 1d · $Y 7d · $Z 30d`. A leading dot glyph (🟢 / 🟡 / 🔴 / ⚪) reports extension health.
2. **Workspace signal** — writes the active workspace folder to `~/.local/share/budi/cursor-sessions.json` (v1 contract, ADR-0086 §3.4) so the daemon can resolve which workspace a Cursor session belongs to.
3. **Click-through** — opens the cloud dashboard, mirroring the Claude Code statusline URL composition (`/dashboard/sessions` when a Cursor session is active, `/dashboard` otherwise).
4. **Onboarding entry point (ADR-0088 §6)** — when the daemon has never been seen healthy on this install, the extension enters `firstRun` mode: the status bar shows `⚪ budi · setup` and clicking it opens a WebView welcome view with the canonical platform-specific install command and a `budi init && budi doctor` hand-off. The welcome view retires automatically on the first Cursor reading. Local-only counters (`~/.local/share/budi/cursor-onboarding.json`) are readable by `budi doctor`. Cross-surface local→cloud linking is owned by the main repo; the extension's onboarding scope is strictly local.

No sidebar, no session list, no vitals grid, no tips feed. If real usage demands a richer surface it must come back behind a flag; it must never become the default.

## Data contract with the daemon

- HTTP: `GET http://127.0.0.1:7878/analytics/statusline?provider=cursor` (plus `project_dir` when a workspace is open) and `GET /health`.
- The response shape is the shared provider-scoped status contract pinned in [`docs/statusline-contract.md`](https://github.com/siropkin/budi/blob/main/docs/statusline-contract.md) in the main repo. The contract evolves in `siropkin/budi` first, then here — never the other way.
- On startup, read `/health` and verify `api_version`. If the daemon is older than this extension's `MIN_API_VERSION`, show a one-time warning that points at `budi update` and keep polling. Do not crash.
- Legacy aliases (`today_cost` / `week_cost` / `month_cost`) are still read as a fallback when the canonical `cost_1d` / `cost_7d` / `cost_30d` fields are missing. Drop the fallback the release after the main repo drops the aliases.

## Key files

- `src/extension.ts` — activation, status bar item, configuration plumbing, refresh loop, welcome-view lifecycle (`firstRun` → `green/yellow` transition).
- `src/budiClient.ts` — fetch helpers, health-state derivation (including `firstRun`), status-text + tooltip builders, click-URL composer. All rendering logic lives here so it is easy to unit-test.
- `src/welcomeView.ts` — WebView panel used during `firstRun` onboarding. Pure `renderHtml(stage, platform)` function; side-effectful terminal/panel plumbing is injectable.
- `src/installCommands.ts` — canonical platform-specific install commands (mirrors `siropkin/budi/README.md`).
- `src/onboardingCounters.ts` — writer for the local-only `~/.local/share/budi/cursor-onboarding.json` v1 counters file read by `budi doctor`.
- `src/sessionStore.ts` — `cursor-sessions.json` v1 writer (workspace signal).
- `src/*.test.ts` — Vitest unit tests.
- `assets/icon.png` — marketplace tile, green-dot brand mark sourced from getbudi.dev (`#22c55e`).

## Dev notes

- **No business logic.** If you catch yourself computing a cost, classifying a prompt, or rolling up tokens in this repo, stop and move it into `budi-core`. The extension must only render what the daemon returns.
- **No cross-provider blending.** The extension always sends `?provider=cursor`. Do not add summary surfaces that show blended multi-provider totals — ADR-0088 §7 is explicit that provider-scoped surfaces display their own provider only.
- **Never read user prompts or code.** Only `/analytics/statusline` and `/health` are in scope. Do not call session-detail or message-content endpoints.
- **Match the Claude Code statusline byte-for-byte where possible.** Number formatting, separator (` · `), slot labels (`1d` / `7d` / `30d`), and click-through URL shape are all mirrored from `crates/budi-cli/src/commands/statusline.rs` in the main repo. Drift is a bug.
- **Graceful degradation.** If the daemon is not running, show a quiet red-dot "offline" state with a tooltip that points to `budi doctor`. Do not spam modal errors.
- **API version skew.** The daemon's `api_version` is the contract. Bump `MIN_API_VERSION` in `budiClient.ts` when the extension starts depending on a new field shape, and warn users clearly when they are on an older daemon.
- **Lockfile.** Commit `package-lock.json`. The extension must build reproducibly for Marketplace releases.
- **VSIX bundling.** The main repo ships a pre-built `.vsix` with the CLI for integrations installs. When cutting a release here, refresh the bundled vsix in the main repo in lockstep.
- **Public-site sync.** Any visible change (status text, click-through URL, icon, marketplace copy) must be mirrored on getbudi.dev so screenshots and copy do not drift.
