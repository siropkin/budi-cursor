# budi — Cursor Extension

A quiet, provider-scoped status bar for budi. Shows **Cursor-only** spend over the last **1d / 7d / 30d** — byte-for-byte matching the Claude Code statusline, filtered to the Cursor provider.

The extension is intentionally statusline-only:

- **One status bar item.** No sidebar, no session list, no tips feed.
- **Provider-scoped to `cursor`.** Never blends Claude Code, Codex, or Copilot CLI usage into the Cursor surface.
- **Rolling 1d / 7d / 30d windows.** The same shape the Claude Code statusline uses, so the Cursor surface and the Claude Code surface read identically for their respective providers.
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
- Use Cursor normally. No Cursor settings changes are required — the daemon tails Cursor's local transcripts and pulls cost from the Cursor Usage API in the background.

## First-run (no daemon installed yet)

If you discovered budi via the marketplace and haven't installed the daemon yet, the extension is a first-class onboarding entry point:

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

1. Run `budi doctor` and confirm the daemon + tailer are healthy and Cursor transcripts are visible.
2. Send one prompt in Cursor chat.
3. The status bar item should turn 🟢 green within one poll cycle and show non-zero 1d spend. Cursor cost can lag the Usage API by up to ~10 minutes, so wait a cycle before worrying about a 🟡 yellow reading.
4. If it stays 🟡 yellow, run **Budi: Refresh Status** once.

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

1. **Transcript tailer (no proxy, no Cursor-settings changes).** The budi daemon tails Cursor's local transcript/session files as they are written and reconciles cost/token totals from the Cursor Usage API on a pull cadence. All business logic — cost, classification, attribution — lives in the Rust daemon. Nothing is routed through an HTTP proxy and no Cursor base-URL override is involved.
2. **Workspace signal.** The extension writes the active workspace path to `~/.local/share/budi/cursor-sessions.json` so the daemon can associate Cursor session activity with the workspace.
3. **Shared status contract.** The extension calls `GET /analytics/statusline?provider=cursor` and renders the response — the same rolling 1d / 7d / 30d shape the CLI statusline and the cloud dashboard use, so all three surfaces read identically.
4. **No re-implementation of cost logic.** If Claude Code's statusline shows `$X 1d · $Y 7d · $Z 30d`, this extension shows the same thing with `provider=cursor` scoping. If it doesn't, neither do we.

## Troubleshooting

**Status bar says `offline` / circle is red**

1. Run `budi doctor` to check daemon + tailer health and Cursor transcript visibility.
2. Run `budi init` if the daemon is not running.
3. If you changed `budi.daemonUrl`, run **Budi: Refresh Status** (or reload Cursor).

**Circle stays 🟡 yellow after sending prompts**

1. Confirm the daemon is tailing Cursor transcripts (`budi doctor` shows transcript visibility).
2. Cursor cost comes from the Cursor Usage API on a pull cadence and can lag the chat by up to ~10 minutes. Wait a cycle and send a second message if today's value still reads zero.

**API-version warning on startup**

You are running an older `budi` daemon than this extension requires. Run `budi update` or reinstall via the instructions at [getbudi.dev](https://getbudi.dev).

## Ecosystem

- **[budi](https://github.com/siropkin/budi)** — Rust daemon + CLI (required).
- **[budi-cloud](https://github.com/siropkin/budi-cloud)** — Cloud dashboard and ingest API.
- **[getbudi.dev](https://github.com/siropkin/getbudi.dev)** — Public marketing site.
