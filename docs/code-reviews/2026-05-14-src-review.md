# End-to-end review of `src/` against SOUL.md boundaries

- **Date:** 2026-05-14
- **Branch reviewed:** `main` @ v1.5.3
- **Closes:** siropkin/budi-cursor#67
- **Scope:** every non-test file under `src/`, measured against the
  presentation-only boundary in `SOUL.md` and the daemon data contract.

## TL;DR

The codebase respects every boundary pinned in `SOUL.md`:

- No cost computation, no prompt classification, no token rollup, no SQLite
  access, no Cursor-transcript reads. Business logic stays in `budi-core`.
- Only `/analytics/statusline` and `/health` are called. There is no
  session-detail or message-content endpoint anywhere in `src/`.
- `?surface=` is the only filter sent on analytics requests; no
  `?provider=` query is ever attached.
- Status text, separator (` · `), slot labels (`1d` / `7d` / `30d`), and
  click-through URL composition match `crates/budi-cli/src/commands/statusline.rs`
  byte-for-byte (validated via `buildStatusText` + `buildTooltip`).
- Daemon-offline path is quiet: `budi · offline` + a one-shot debug log,
  no modal spam.

The remaining notes are quality cleanups, not boundary violations. Most are
already tracked by sibling tickets in the **1.6.0 — Hygiene & Cleanup**
milestone; this review names them per-file so future passes know where to
look.

## Per-file review

### `src/extension.ts` (464 LOC)

**Boundary**
- ✅ Only two daemon endpoints are reached: `fetchDaemonHealth` and
  `fetchStatusline` (extension.ts:359-362). Surface threads through from
  `detectSurface(vscode.env.appName)` (extension.ts:61).
- ✅ Workspace-trust gate in `readSecuritySensitive` (extension.ts:166-174)
  is the platform-level companion to the per-setting allow-lists; an
  untrusted workspace's overrides never reach the daemon poll or the
  click-through URL.
- ✅ Loopback-only `daemonUrl` (extension.ts:181) and getbudi.dev-only
  `cloudEndpoint` (extension.ts:197) are enforced at config-read time.
- ✅ `budi.statusBarClick` (extension.ts:91-99) branches on
  `lastState === "firstRun"` so the welcome view is the entry point for
  first-run users; everyone else hits `clickUrl(...)`. No hardcoded
  dashboard URL.

**Could be deleted**
- Nothing obvious. Module-level mutable state (`statusBarItem`,
  `cachedStatusline`, `everSawDaemon`, `apiVersionWarningShown`,
  `daemonOfflineWarningLogged`, `lastState`, `suppressUpdatePrompt`) is
  load-bearing for the refresh loop and command handlers.

**Follow-ups**
- `extension.ts` is the second-largest file in the repo and concentrates
  four concerns: activation glue, command registration, refresh-loop
  machinery, upgrade-toast plumbing. It would benefit from the same split
  treatment `budiClient.ts` is getting under #70 — call out a follow-up
  ticket once #70 lands so the split styles match.
- No direct unit tests on `extension.ts` (the activation surface is hard
  to mock with `vscode` as an external). Coverage gating in #71 should
  ratchet this floor up explicitly.

### `src/budiClient.ts` (547 LOC)

**Boundary**
- ✅ Only `/health` and `/analytics/statusline` are fetched
  (budiClient.ts:507-547). No session-detail, no message-content endpoint.
- ✅ `?surface=` is the only filter (`buildStatuslineUrl`,
  budiClient.ts:528-539). No `?provider=`.
- ✅ Status text + tooltip composition matches Claude Code's CLI
  (`buildStatusText`, budiClient.ts:358-365; `buildCostLine`,
  budiClient.ts:197-204). Separator is ` · ` everywhere.
- ✅ Click-through composition (`clickUrl`, budiClient.ts:269-275) mirrors
  `crates/budi-cli/src/commands/statusline.rs::cmd_statusline`: sessions
  list when Cursor is active, dashboard otherwise.
- ✅ Defense-in-depth on the HTTP path: 3s timeout, 64 KB body cap,
  2xx-only, `application/json`-only (budiClient.ts:462-501). Loopback
  allowlist (`isLoopbackDaemonUrl`, budiClient.ts:390-399) and getbudi.dev
  allowlist (`isAllowedCloudEndpoint`, budiClient.ts:426-441) are airtight.
- ✅ `MIN_API_VERSION = 3` (budiClient.ts:85) carries the cautionary tale
  about the v1.4.0 misbump inline — this is exactly the kind of context a
  future reviewer needs.

**Could be deleted**
- The `today_cost` / `week_cost` / `month_cost` fallback inside
  `resolveCosts` (budiClient.ts:186-188) is already on the chopping block
  via siropkin/budi-cursor#68 (blocked on main repo confirming the alias
  has been dropped for at least one shipped release).

**Follow-ups**
- File is the biggest non-test source file at 547 LOC and mixes four
  concerns. Already tracked by siropkin/budi-cursor#70.

### `src/welcomeView.ts` (258 LOC)

**Boundary**
- ✅ No daemon calls, no business logic. Pure render + side-effectful
  terminal plumbing (the two `*InTerminal` helpers).
- ✅ Webview CSP restricts `default-src 'none'`; inline scripts and styles
  are constrained to the panel's own document, no remote loads
  (welcomeView.ts:177, :224).
- ✅ Install command is rendered through `esc()` (welcomeView.ts:162-169)
  before being written into the HTML. The string is a hard-coded constant
  from `installCommands.ts`, but the escaping is correct defense-in-depth.
- ✅ `sendText(cmd.command, false)` pre-fills the integrated terminal
  without auto-executing (welcomeView.ts:137, :144) — the user must press
  enter, matching the boundary that the extension never runs commands on
  the user's behalf.

**Could be deleted**
- `renderInstallStage` and `renderInitStage` (welcomeView.ts:171-217 and
  :219-258) duplicate ~80% of the HTML scaffolding (head, CSS, JS bridge).
  Not blocking — both stages are stable copy — but a small follow-up to
  extract a shared `renderShell(bodyHtml)` helper would shrink the file by
  ~60 LOC and remove a future drift surface (e.g. updating the brand dot
  color in both places).

**Follow-ups**
- New ticket suggestion: extract shared HTML/CSS shell between welcome-view
  stages. Low-priority; only worth doing if the file picks up a third
  stage.

### `src/onboardingCounters.ts` (130 LOC)

**Boundary**
- ✅ Local-only file under `~/.local/share/budi/` with integer counters
  and ISO timestamps. No prompts, no code, no outside-of-repo paths. Stays
  inside ADR-0083 privacy limits.
- ✅ All three event types (`welcome_view_impression`,
  `open_terminal_click`, `handoff_completed`) are wired up in
  `welcomeView.ts` and consumed by `budi doctor` as documented.
- ✅ Best-effort disk I/O (try/catch swallow) so the extension never
  crashes on a local counter file. Sanitizer (`sanitize`,
  onboardingCounters.ts:63-80) defends against malformed JSON.

**Could be deleted**
- Nothing currently. Every export is referenced.

**Follow-ups**
- Synchronous `fs.writeFileSync` runs on the extension host's main thread.
  The payload is < 1 KB so this is fine, but worth a note if counters
  ever pick up additional fields.

### `src/installCommands.ts` (118 LOC)

**Boundary**
- ✅ Pure data + helpers. Mirrors `siropkin/budi/README.md` and getbudi.dev
  one-to-one. Hard-coded to avoid a cold-start network dependency.
- ✅ macOS routes to the Homebrew tap, giving users `brew upgrade` as the
  update channel. Linux/Windows use the curl/irm standalone installers
  which double as the upgrade path (the script overwrites the existing
  binary).

**Could be deleted**
- `LINUX_COMMAND.command === LINUX_UPGRADE_COMMAND.command` and likewise
  for Windows (installCommands.ts:42-45 vs :92-94; :51-53 vs :100-102).
  The constants are kept distinct for naming clarity, but the duplicate
  string is a drift surface — bumping the install URL requires editing
  two places. Either reuse the install constants in the upgrade map, or
  collapse to a single `commandForPlatform({install,upgrade})` accessor.

**Follow-ups**
- Small ticket suggestion: dedupe Linux/Windows install ↔ upgrade
  constants so a future install-URL change only touches one line.

### `src/sessionStore.ts` (65 LOC)

**Boundary**
- ✅ Writes only `version`, `active_workspace`, `updated_at`. No business
  logic, no daemon calls. Workspace path is absolutized via
  `path.resolve` (sessionStore.ts:42).
- ✅ Format matches ADR-0086 §3.4 v1 contract exactly.

**Could be deleted**
- Nothing. The two exports (`writeActiveWorkspace`, `clearActiveWorkspace`)
  are both reachable from `extension.ts`.

**Follow-ups**
- `fs.writeFileSync` is not atomic — a crash between `open()` and the
  final flush can leave a half-written file. The daemon's workspace
  resolution depends on this file (ADR-0086 §3.4) so atomic-write
  (tmp + rename) is the right pattern. Already implied by
  siropkin/budi-cursor#72 acceptance ("Atomic-write semantics (no
  half-written JSON on crash)"), but the **fix** belongs alongside the
  expanded test suite, not just the test for it. Tag #72 to track both.

## Cross-cutting notes

- Every public symbol in `src/` carries a comment that names the issue or
  ADR it implements. This makes future cleanup easy: when an ADR
  supersedes another, `grep -r "ADR-008" src/` is enough to find the
  affected sites. Keep the convention.
- Module-level mutable state lives in `extension.ts` only. `budiClient.ts`,
  `welcomeView.ts`, `onboardingCounters.ts`, `installCommands.ts`, and
  `sessionStore.ts` are otherwise pure or per-call. This is the right
  split — keep new state out of the leaf modules.
- No test file imports `vscode` at module top-level (only `extension.ts`
  does). The leaf modules are therefore Vitest-friendly today; whatever
  split #70 lands on should preserve that.
