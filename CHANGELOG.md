# Changelog

All notable changes to the `budi` Cursor extension are tracked here. The
Cursor extension follows the main `siropkin/budi` release rhythm.

## 1.3.3 — welcome-view copy alignment with getbudi.dev

_Two small welcome-view fixes that landed after 1.3.2 (`siropkin/budi-cursor#20`, `siropkin/budi-cursor#21`). Both close gaps where the in-editor onboarding copy had drifted from the canonical install/contract story on getbudi.dev and the README._

### Fixed

- **macOS install command now uses Homebrew.** Split the previous combined `MACOS_LINUX_COMMAND` into a `brew install siropkin/budi/budi` command for `darwin` (labelled "macOS") and the curl-based standalone installer for Linux (labelled "Linux"). Restores the public-site mirror invariant that broke when getbudi.dev switched the macOS recommendation to Homebrew. Windows is unchanged.
- **Welcome-view footnote no longer says budi "routes Cursor traffic."** Reworded the lone proxy-era straggler at `src/welcomeView.ts:250` to "tailing Cursor's transcripts" so it matches the README and the paragraph directly above it. Closes the last reference missed in the 1.3.0 proxy-era sweep (#9 → ADR-0089/0090).

### Notes

- No behaviour change beyond copy/install-command rendering; the daemon contract, statusline shape, and click-through URL composition are unchanged.
- Tests in `installCommands.test.ts` and `welcomeView.test.ts` were extended to assert each platform gets its own canonical command and label, with cross-checks that the macOS panel never leaks the Linux command and vice versa.

## 1.3.2 — drop leading health-dot glyph from the status bar

_Tracked in `siropkin/budi-cursor#18`. The colored circle prefix (🟢 / 🟡 / 🔴 / ⚪) was redundant — the tooltip and the copy already distinguish the three non-healthy states, and the glyph did not carry information the text lacked. Claude Code's CLI statusline does not show one either, so dropping it brings the Cursor surface in line with the reference surface._

### Changed

- **Removed** the leading health-dot glyph from `buildStatusText`. Health collapses into the copy itself: `budi` (loading), `budi · setup` (first run), `budi · offline` (daemon unreachable), `budi · $X 1d · $Y 7d · $Z 30d` (healthy).
- **Deleted** the now-unused `healthIndicator` helper from `src/budiClient.ts` and its test block.
- **Rewrote** the README "Status bar at a glance" table — replaced the indicator-emoji column with a state → status-bar-text column. Updated the first-run, smoke-check, and troubleshooting paragraphs that were written around circle colors.
- **Refreshed** the three SOUL.md lines that described the leading glyph / "red-dot" state so agent-facing docs match shipped behavior (ADR-0088 §6/§7 narrative intact).

### Notes

- Tooltip copy, click-through URL, provider scoping, polling cadence, and the `/analytics/statusline?provider=cursor` + `/health` data contract are all unchanged.
- No marketplace re-screenshot required beyond a single fresh status-bar shot; public-site sync on getbudi.dev picks up the shape change in the usual way.

## 1.3.1 — user-visible extension copy cleanup

_Tracked in `siropkin/budi-cursor#10` and `siropkin/budi-cursor#11`. Budi has no existing users, so cross-version narrative ("Starting with v1.1.0…", three stacked "What changed in 1.x" sections) and ADR/main-repo doc links on the marketplace README and welcome view were teaching a history the fresh installer never lived through and creating future broken-link liability._

### Changed

- **Rewrote** the marketplace-visible README in present tense. Dropped the "Starting with v1.1.0…" and "Starting with v1.2.0…" lead-ins; removed the three "What changed in 1.3.0 / 1.2.0 / 1.1.0" sections entirely. `CHANGELOG.md` remains the version history of record.
- **Stripped** ADR-XXXX parentheticals, `siropkin/budi#NNN` PR references, and pointers to `docs/statusline-contract.md` from `README.md`. Behaviour is described directly (rolling 1d / 7d / 30d shape, `?provider=cursor` scoping) without forcing fresh users to chase cross-repo doc paths.
- **Replaced** the in-editor welcome-view footnote that linked out to `scripts/install-standalone.sh` in the main repo with a neutral "read it before pressing enter" line.

### Scope

- ADR/PR references remain load-bearing in `SOUL.md`, `AGENTS.md`, source doc-comments, and CI grep guards — intentionally untouched. The milestone is user-visible surfaces only.

## 1.3.0 — 8.2 tailer alignment (drops proxy-era copy)

_Tracked in `siropkin/budi#437`. Budi 8.2 retired the on-machine HTTP proxy (ADR-0089): live cost capture for every supported provider is now the local transcript tailer. The extension's marketplace listing, bundled README, and welcome view still described the dead 8.0/8.1 install flow and were misdirecting fresh users on the recommended install path._

### Changed

- **Removed** every reference to the 8.0/8.1 proxy from user-visible surfaces:
  - README Prerequisites no longer asks users to override Cursor's model base URL. Cursor is used normally; the daemon tails transcripts and pulls cost from the Cursor Usage API.
  - README How-it-works explains the tailer + Usage API reconciliation (ADR-0089) instead of the old routing story.
  - README Troubleshooting drops the proxy-status checks; `budi doctor` now reports transcript visibility instead.
  - Welcome view's init hand-off step no longer tells users `budi init` "starts the proxy"; it describes the daemon + transcript tailer.
  - `sessionStore.ts` comment updated — the workspace-signal file correlates tailed transcript activity, not proxy events.
- **Added** a Cursor cost-lag caveat to the Troubleshooting section: cost from the Cursor Usage API can trail live chat by up to ~10 minutes, which is expected and not a yellow-circle bug.

### CI

- Added a build-artifact grep guard to `ci.yml` and `release.yml` that fails the job if the dead proxy-setup strings reappear in `out/` or the README. Prevents regression of the fresh-user trust bug this release fixes.

### Notes

- No functional change: the daemon already stopped listening on the proxy port in the 8.2 release that shipped in `siropkin/budi` weeks ago. This ticket closes the documentation gap that was sending fresh Cursor-marketplace users down a dead path.
- Cross-repo PR body references `siropkin/budi#437` for two-way navigability. Marketplace republish at `1.3.0` is part of closing that ticket.

## 1.2.0 — 8.1 onboarding entry point

_Tracked in `siropkin/budi#314`, governed by ADR-0088 §6 (onboarding scope is strictly local)._

### Added

- **Welcome view for first-run users.** When the daemon is unreachable
  AND this extension install has never seen the daemon healthy, the
  status bar shows `⚪ budi · setup` (not `offline`) and clicking it
  opens an in-editor welcome view. The view explains budi in one
  sentence, shows the canonical install command for the user's
  platform, and offers two actions:
  - _Open Terminal With This Command_ — opens Cursor's integrated
    terminal with the install command pre-filled (not executed).
  - _I already installed it_ — force-rechecks `/health` and, on
    success, swaps to a single `budi init && budi doctor` hand-off
    action.
  The view retires itself automatically on the first successful
  Cursor-provider reading.
- **New `firstRun` health state** distinct from `red`. Persisted via
  `context.globalState`; once the daemon has been seen healthy on
  this machine, the extension never returns to `firstRun` even if the
  daemon later goes down.
- **`Budi: Show Welcome / First-Run Setup` command** so users can
  re-open the welcome view from the Command Palette at any time.
- **Per-platform install commands** in `src/installCommands.ts`
  mirror the main-repo README one-to-one — macOS/Linux uses
  `curl -fsSL …/install-standalone.sh | bash`, Windows uses
  `irm …/install-standalone.ps1 | iex`.
- **Local-only onboarding counters** at
  `~/.local/share/budi/cursor-onboarding.json` (v1 contract):
  `welcome_view_impressions`, `open_terminal_clicks`,
  `handoffs_completed`, plus coarse first/last ISO timestamps.
  `budi doctor` reads this file so we can see how many
  extension-first users reach a running daemon without any remote
  telemetry.
- **Marketplace description** now states explicitly that the
  extension can guide users through the budi install if they don't
  have it yet (acquisition-funnel polish).

### Changed

- **Status bar command** is now `budi.statusBarClick` (dispatches to
  the welcome view in `firstRun` mode, to the cloud click-through
  otherwise). `budi.openDashboard` is still registered for users who
  bind the command manually.

### Notes

- Privacy: the counters file is local-only and contains integer counts plus coarse first/last ISO timestamps — no prompts, no code, no outside-of-repo data. ADR-0083 limits are preserved.
- The cursor-sessions.json v1 contract (ADR-0086 §3.4) is untouched.
- Public-site sync for the new extension-first acquisition tile is threaded into `siropkin/budi#296`.

## 1.1.0 — 8.1 statusline-only surface

_Tracked in `siropkin/budi#232`, governed by ADR-0088 §7._

### Changed

- **Statusline-only surface.** The side panel, session list, vitals grid, and
  tips feed are retired. 8.1 ships with exactly one status bar item and no
  additional UI. A sidebar may reappear in a future release if real usage
  demands it — 8.1 optimises for a quiet, always-on surface.
- **Provider-scoped to `cursor`.** Every status bar reading comes from
  `GET /analytics/statusline?provider=cursor`, so Cursor spend is never
  blended with Claude Code, Codex, or Copilot CLI usage (ADR-0088 §7).
- **Rolling 1d / 7d / 30d windows.** Numbers now match the Claude Code
  statusline byte-for-byte: `budi · $X 1d · $Y 7d · $Z 30d`. The windows are
  rolling (last 24h, last 7d, last 30d), not calendar — same shift as
  `budi statusline --format claude`. The contract is pinned in
  [`docs/statusline-contract.md`](https://github.com/siropkin/budi/blob/main/docs/statusline-contract.md).
- **Click-through mirrors Claude Code.** Clicking the status bar item opens
  `<cloud>/dashboard/sessions` when there is an active Cursor session and
  `<cloud>/dashboard` otherwise, matching the Claude Code statusline URL
  composition in `crates/budi-cli/src/commands/statusline.rs`.
- **Green-circle brand on the marketplace tile.** The extension now carries
  the same green-dot icon used on getbudi.dev (`#22c55e`).

### Added

- `budi.cloudEndpoint` setting (default `https://app.getbudi.dev`) so the
  click-through URL can be pointed at self-hosted or staging cloud
  deployments.
- Graceful legacy fallback. When talking to a pre-#224 daemon that has not
  yet shipped `cost_1d` / `cost_7d` / `cost_30d`, the extension reads the
  deprecated `today_cost` / `week_cost` / `month_cost` aliases (which the
  daemon still populates with the same rolling values for one release).

### Removed

- `Budi: Select Session` command. Session pinning was a side-panel feature;
  the statusline is always the aggregated view.
- `Budi: Toggle Health Panel` command and `budi.healthPanel` view.
- `Budi: Open Session Health` command.
- `fetchSessionHealth`, `fetchRecentSessions`, `aggregateHealth`, and
  `splitSessionsByDay` client helpers (unused without the side panel).

### Notes

- The `cursor-sessions.json` workspace-signal contract (v1, ADR-0086 §3.4)
  is unchanged — the extension still writes the active workspace path so
  the daemon can correlate proxy events.
- The minimum supported daemon `api_version` is `1`; the extension shows a
  one-time warning on startup if the local daemon is older and directs the
  user to `budi update` / reinstall.
- Public-site sync for screenshots and copy is tracked in
  `siropkin/budi#296`.

## 1.0.1 — Release hygiene

- Treat "already published" as a successful outcome in the release workflow
  to keep re-runs idempotent (`siropkin/budi-cursor#2`, `siropkin/budi-cursor#3`).

## 1.0.0 — First Marketplace release

- Initial publish from the `siropkin/budi` monorepo after extraction
  completed under ADR-0086.
- Status bar item with aggregated session health (green / yellow / red
  circles) and today's cost, session-detail side panel, and workspace-signal
  file write.
