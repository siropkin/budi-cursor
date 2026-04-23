# budi — Cursor Extension

A quiet, provider-scoped status bar for budi. Shows **Cursor-only** spend over the last **1d / 7d / 30d** — byte-for-byte matching the Claude Code statusline, filtered to the Cursor provider.

The extension is intentionally statusline-only:

- **One status bar item.** No sidebar, no session list, no tips feed.
- **Provider-scoped to `cursor`.** Never blends Claude Code, Codex, or Copilot CLI usage into the Cursor surface.
- **Rolling 1d / 7d / 30d windows.** The same shape the Claude Code statusline uses, so the Cursor surface and the Claude Code surface read identically for their respective providers.

## Status bar at a glance

```
budi · $2.34 1d · $12.50 7d · $48.10 30d
```

| State   | Status bar text                          | Meaning                                                                       |
| ------- | ---------------------------------------- | ----------------------------------------------------------------------------- |
| healthy | `budi · $X 1d · $Y 7d · $Z 30d`          | Daemon reachable, Cursor traffic recorded in the rolling window.              |
| idle    | `budi · $0.00 1d · $0.00 7d · $0.00 30d` | Daemon reachable, no Cursor traffic in the rolling window (not an error).     |
| offline | `budi · offline`                         | Daemon unreachable or `api_version` too old. Tooltip points to `budi doctor`. |
| loading | `budi`                                   | Extension starting up, first reading not yet fetched.                         |
| setup   | `budi · setup`                           | First run — daemon hasn't been installed yet. Click for the install flow.     |

Click the item to open the cloud dashboard. When there is an active Cursor session it opens `<cloud>/dashboard/sessions`; otherwise it opens `<cloud>/dashboard` — the same click-through behaviour as the Claude Code statusline.

## Prerequisites

- **budi** installed and initialised (`budi init`).
- **budi-daemon** running (starts automatically after `budi init`).
- Use Cursor normally. No Cursor settings changes are required — the daemon tails Cursor's local transcripts and pulls cost from the Cursor Usage API in the background.

## First-run (no daemon installed yet)

If you discovered budi via the marketplace and haven't installed the daemon yet, the status bar shows `budi · setup`. Click it to open an in-editor welcome view that:

1. Pre-fills the one-line install command for your platform in Cursor's integrated terminal (you press enter yourself after reading it).
2. Offers a **Finish setup in terminal** button that pre-fills `budi init && budi doctor` once the daemon is detected.
3. Closes itself automatically on the first successful Cursor reading; the status bar starts reporting spend.

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
3. The status bar item should show a non-zero 1d spend within one poll cycle. Cursor cost can lag the Usage API by up to ~10 minutes, so seeing `$0.00 1d` in the first few minutes is normal.
4. If 1d spend stays at `$0.00`, run **Budi: Refresh Status** once.

### Manual install (build from source)

```bash
git clone https://github.com/siropkin/budi-cursor.git && cd budi-cursor
npm ci
npm test
npm run package
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

**Status bar says `budi · offline`**

1. Run `budi doctor` to check daemon + tailer health and Cursor transcript visibility.
2. Run `budi init` if the daemon is not running.
3. If you changed `budi.daemonUrl`, run **Budi: Refresh Status** (or reload Cursor).

**1d spend stays at `$0.00` after sending prompts**

1. Confirm the daemon is tailing Cursor transcripts (`budi doctor` shows transcript visibility).
2. Cursor cost comes from the Cursor Usage API on a pull cadence and can lag the chat by up to ~10 minutes. Wait a cycle and send a second message if today's value still reads zero.

**API-version warning on startup**

You are running an older `budi` daemon than this extension requires. Run `budi update` or reinstall via the instructions at [getbudi.dev](https://getbudi.dev).

## Ecosystem

- **[budi](https://github.com/siropkin/budi)** — Rust daemon + CLI (required).
- **[budi-cloud](https://github.com/siropkin/budi-cloud)** — Cloud dashboard and ingest API.
- **[getbudi.dev](https://github.com/siropkin/getbudi.dev)** — Public marketing site.
