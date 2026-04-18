# budi — Cursor Extension

A quiet, provider-scoped status bar for budi. Shows **Cursor-only** spend over the last **1d / 7d / 30d** — byte-for-byte matching the Claude Code statusline, filtered to the Cursor provider.

Starting with `v1.1.0` the extension is intentionally statusline-only:

- **One status bar item.** No sidebar, no session list, no tips feed.
- **Provider-scoped to `cursor`.** Never blends Claude Code, Codex, or Copilot CLI usage into the Cursor surface (ADR-0088 §7).
- **Rolling 1d / 7d / 30d windows.** The same shape the Claude Code statusline uses — the rolling-window contract is pinned in [`docs/statusline-contract.md`](https://github.com/siropkin/budi/blob/main/docs/statusline-contract.md) in the main repo.
- **Green-circle brand.** Matches the green dot on [getbudi.dev](https://getbudi.dev).

## Status bar at a glance

```
🟢 budi · $2.34 1d · $12.50 7d · $48.10 30d
```

| Indicator | Meaning                                                                                    |
| --------- | ------------------------------------------------------------------------------------------ |
| 🟢 green  | Daemon reachable, Cursor traffic recorded in the rolling window.                           |
| 🟡 yellow | Daemon reachable, no Cursor traffic in the rolling window (not an error).                  |
| 🔴 red    | Daemon unreachable or `api_version` too old. Tooltip points to `budi doctor`.              |
| ⚪ gray   | Extension starting up, first reading not yet fetched.                                      |
| ⚪ setup  | First run — daemon hasn't been installed yet. Click for the install flow (`budi · setup`). |

Click the item to open the cloud dashboard. When there is an active Cursor session it opens `<cloud>/dashboard/sessions`; otherwise it opens `<cloud>/dashboard` — the same click-through behaviour as the Claude Code statusline.

## Prerequisites

- **budi** installed and initialised (`budi init`).
- **budi-daemon** running (starts automatically after `budi init`).
- Cursor's `Override OpenAI Base URL` set to `http://localhost:9878` (Cursor Settings → Models) so LLM traffic routes through the budi proxy.

## First-run (no daemon installed yet)

Starting with `v1.2.0` the extension is a first-class **onboarding entry point**. If you discovered budi via the marketplace and haven't installed the daemon yet:

1. The status bar shows a gray ⚪ `budi · setup` — this is not an error, just "not installed yet".
2. Click the status bar item. The extension opens a welcome view inside Cursor with the one-line install command for your platform.
3. Click **Open Terminal With This Command**. The command is pre-filled in Cursor's integrated terminal — you press enter yourself after reading it.
4. After install finishes, click **I already installed it** (or the status bar refreshes on its own within one poll cycle).
5. Click **Finish setup in terminal** to run `budi init && budi doctor`. Once Cursor traffic is recorded, the welcome view closes and the status bar turns 🟢 green.

You can re-open the welcome view at any time with **Cmd+Shift+P → Budi: Show Welcome / First-Run Setup**.

## Install

The extension can be installed during `budi init` and later with:

```bash
budi integrations install --with cursor-extension
```

Run `budi doctor` to verify.

### First-run smoke check

After install/reload, validate in under a minute:

1. Run `budi doctor` and confirm daemon + proxy are healthy.
2. Verify `Override OpenAI Base URL` is set to `http://localhost:9878` in Cursor Settings → Models.
3. Send one prompt in Cursor chat.
4. The status bar item should turn 🟢 green within one poll cycle and show non-zero 1d spend.
5. If it stays 🟡 yellow, run **Budi: Refresh Status** once.

### Manual install (build from source)

```bash
git clone https://github.com/siropkin/budi-cursor.git && cd budi-cursor
npm ci
npm run lint
npm run format:check
npm run test
npm run build
npx vsce package --no-dependencies -o cursor-budi.vsix
cursor --install-extension cursor-budi.vsix --force
```

Then reload Cursor: **Cmd+Shift+P** → **Developer: Reload Window**.

## Commands

| Command                                  | Description                                                           |
| ---------------------------------------- | --------------------------------------------------------------------- |
| **Budi: Open Dashboard**                 | Open the budi cloud dashboard (session list when a session is live).  |
| **Budi: Refresh Status**                 | Force-refresh the status bar immediately.                             |
| **Budi: Show Welcome / First-Run Setup** | Re-open the onboarding welcome view (install + `budi init` hand-off). |

## Configuration

| Setting                  | Default                   | Description                                                              |
| ------------------------ | ------------------------- | ------------------------------------------------------------------------ |
| `budi.pollingIntervalMs` | `15000`                   | How often to refresh the status bar (ms).                                |
| `budi.daemonUrl`         | `http://127.0.0.1:7878`   | Local daemon base URL.                                                   |
| `budi.cloudEndpoint`     | `https://app.getbudi.dev` | Cloud dashboard opened on click. Matches the Claude Code statusline URL. |

## How it works

1. **Proxy.** LLM traffic from Cursor routes through the budi proxy (port 9878); the daemon records every message locally, keyed by provider (`cursor` in this case). All business logic — cost, classification, attribution — lives in the Rust daemon.
2. **Workspace signal.** The extension writes the active workspace path to `~/.local/share/budi/cursor-sessions.json` (v1 contract, ADR-0086 §3.4) so the daemon can associate Cursor proxy events with the workspace.
3. **Shared status contract.** The extension calls `GET /analytics/statusline?provider=cursor` and renders the response. The contract is defined once in `docs/statusline-contract.md` and reused by the CLI statusline, this extension, and the cloud dashboard — so all three surfaces read identically.
4. **No re-implementation of cost logic.** If Claude Code's statusline shows `$X 1d · $Y 7d · $Z 30d`, this extension shows the same thing with `provider=cursor` scoping. If it doesn't, neither do we.

## Troubleshooting

**Status bar says `offline` / circle is red**

1. Run `budi doctor` to check daemon + proxy health.
2. Run `budi init` if the daemon is not running.
3. If you changed `budi.daemonUrl`, run **Budi: Refresh Status** (or reload Cursor).

**Circle stays 🟡 yellow after sending prompts**

1. Confirm the proxy is running and intercepting Cursor traffic (`budi doctor`).
2. Verify `Override OpenAI Base URL` is set to `http://localhost:9878` in Cursor Settings → Models.
3. Send a second message — the first 24h can read zero if the prompt was served from cache.

**API-version warning on startup**

You are running an older `budi` daemon than this extension requires. Run `budi update` or reinstall via the instructions at [getbudi.dev](https://getbudi.dev).

## What changed in 1.2.0

- **Added** first-class onboarding entry point (siropkin/budi#314). Users who discover the extension first (no daemon on disk) now see a gray ⚪ `budi · setup` status bar and a welcome view with a pre-filled install command and a `budi init && budi doctor` hand-off. The welcome view closes automatically after the first Cursor reading.
- **Added** a new `firstRun` health state distinct from `offline`. "Never installed" is not rendered as an error.
- **Added** `Budi: Show Welcome / First-Run Setup` command.
- **Added** local-only onboarding counters at `~/.local/share/budi/cursor-onboarding.json` so `budi doctor` can show install-funnel health without any remote telemetry.
- **Updated** marketplace description to explain that the extension can install budi for users who don't have it yet.

## What changed in 1.1.0

- **Removed** the side panel, session list, vitals grid, tips feed, and `Budi: Select Session` / `Budi: Toggle Health Panel` commands. 8.1 is decidedly statusline-only (ADR-0088 §7).
- **Added** provider-scoped contract consumption (`?provider=cursor`). Cursor and Claude Code spend are never blended.
- **Changed** the status bar format to match the Claude Code statusline: `budi · $X 1d · $Y 7d · $Z 30d`.
- **Changed** the click-through URL to point at `https://app.getbudi.dev/dashboard/sessions` (session active) or `/dashboard` (no session), mirroring the Claude Code statusline.
- **Added** the green-circle brand mark on the marketplace tile.

A sidebar may reappear in a future release if real usage demands it. 8.1 optimises for "leave it on all day, never think about it".

## Ecosystem

- **[budi](https://github.com/siropkin/budi)** — Rust daemon + CLI (required).
- **[budi-cloud](https://github.com/siropkin/budi-cloud)** — Cloud dashboard and ingest API.
- **[getbudi.dev](https://github.com/siropkin/getbudi.dev)** — Public marketing site.
