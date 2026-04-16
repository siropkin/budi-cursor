# SOUL.md

VS Code / Cursor extension for **budi** — shows session health and spend in the status bar and a side panel, by talking to a locally-running `budi-daemon` over HTTP and shelling out to the `budi` CLI for statusline rendering.

This repo is **presentation only**. It does not touch SQLite, does not compute cost, does not classify prompts. Business logic lives in [`siropkin/budi`](https://github.com/siropkin/budi). Keep it that way.

## Product boundaries

| Product | Repo | Role |
|---------|------|------|
| **budi-core** | [`siropkin/budi`](https://github.com/siropkin/budi) | Rust: daemon, CLI, proxy, all business logic. Owns SQLite. |
| **budi-cursor** | **this repo** (`siropkin/budi-cursor`) | VS Code/Cursor extension (TypeScript). Renders what the daemon returns. |
| **budi-cloud** | [`siropkin/budi-cloud`](https://github.com/siropkin/budi-cloud) | Next.js + Supabase cloud dashboard at `app.getbudi.dev`. Unrelated to this extension. |

Extraction was completed per [ADR-0086](https://github.com/siropkin/budi/blob/main/docs/adr/0086-extraction-boundaries.md) in the main repo. Read it before crossing boundaries.

## Build & test

```bash
npm install
npm run compile       # tsc to out/
npm run watch         # tsc in watch mode
npm test              # run unit tests (Vitest)
npm run package       # produce .vsix via vsce
npm run publish       # publish to VS Code Marketplace (vsce publish)
```

## Install (for users)

- VS Code Marketplace: search for "budi"
- From CLI: `budi integrations install --with cursor-extension` (main repo drives this)
- Manual: `code --install-extension budi-*.vsix`

Extension activates on `onStartupFinished`. No configuration required; it auto-discovers the daemon on `127.0.0.1:7878`.

## What the extension does

1. **Status bar item** — aggregated session health circles (green/yellow/red) and today's cost, refreshed on an interval
2. **Side panel** — session list, active-session vitals (context growth, cache reuse, cost acceleration, retry loops), and tips
3. **Workspace signal** — writes the active workspace folder to `~/.local/share/budi/cursor-sessions.json` so the daemon can resolve which workspace a Cursor session belongs to (v1 contract, ADR-0086 §3.4)

## Data contract with the daemon

- HTTP: `GET http://127.0.0.1:7878/analytics/session-health`, `GET /analytics/sessions`, `GET /health`
- CLI: `budi statusline --format json` (spawned as a subprocess) for the statusline rendering
- On startup, read `/health` and verify `api_version`. If the daemon is older than the extension's required `api_version`, show a warning in the panel and stop polling. Do not crash.

## Key files

- `src/extension.ts` — activation, status bar item, panel registration, daemon-availability probe
- `src/panel.ts` — the side panel (tree view or webview) showing session detail and tips
- `src/budiClient.ts` — thin fetch wrapper around the daemon HTTP API; handles timeouts, auth (none, loopback only), and api_version checks
- `src/sessionStore.ts` — local state for active session tracking and the workspace-signal file write
- `src/*.test.ts` — Vitest unit tests for the client and store

## Dev notes

- **No business logic**: if you catch yourself computing a cost, classifying a prompt, or rolling up tokens in this repo, stop and move it into `budi-core`. The extension must only render what the daemon returns.
- **Never read user prompts or code**: the extension reads analytics + health endpoints only. It does not need, and must not request, any endpoint that would expose prompt content.
- **Graceful degradation**: if the daemon is not running, show a quiet "daemon unavailable" state with a link to `brew install siropkin/budi/budi && budi init`. Do not spam errors.
- **API version skew**: the daemon's `api_version` is the contract. Bump the minimum required version in `package.json` (or a constant in `budiClient.ts`) when the extension starts depending on a new endpoint shape, and warn users clearly when they're on an older daemon.
- **Statusline**: rendering lives in the Rust CLI (`budi statusline`). Do not re-implement it here. Shell out and show the JSON result.
- **Lockfile**: commit `package-lock.json`. The extension must build reproducibly for Marketplace releases.
- **VSIX**: the main repo's `budi-cli/build.rs` bundles a pre-built `.vsix` into the CLI binary for integrations installs. When cutting a release here, update the bundled vsix in the main repo accordingly.
