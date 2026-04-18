# Changelog

All notable changes to the `budi` Cursor extension are tracked here. The
Cursor extension follows the main `siropkin/budi` release rhythm.

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
