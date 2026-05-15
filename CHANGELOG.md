# Changelog

All notable changes to the `budi` Cursor extension are tracked here. The
Cursor extension follows the main `siropkin/budi` release rhythm. Header
style follows [Keep a Changelog](https://keepachangelog.com/):
`## [x.y.z] - YYYY-MM-DD`, newest first. Compare URLs are listed at the
bottom of the file.

## [1.5.4] - 2026-05-15

_Hygiene & cleanup release. No user-visible runtime change since v1.5.3 — the status-bar copy, daemon contract, settings shape, and click-through URL are unchanged. Internal-only: stricter compile-time checks, a `src/budiClient.ts` split into focused modules, expanded test coverage with CI gates, a persisted version-stale toast, and a small docs/cross-version cleanup._

### Fixed

- **Persisted the version-stale upgrade toast across reloads** (`siropkin/budi-cursor#79` / PR #87). The version-stale toast (`budi · update needed`) now fires at most once per install per unique stale-daemon signature instead of once per reload — the previous module-level `apiVersionWarningShown` flag was lost on every editor restart, so dismissing the toast didn't stick. Signature is `${version}|${api_version}` persisted under `budi.lastWarnedStaleSignature` in `globalState`; a user who later bumps to a different stale daemon (e.g. 8.4.0 → 8.4.1, both `api_version=1`) gets a fresh warning, while dismissing against the same daemon survives reloads. The polling loop continues running uninterrupted on the stale path — `refreshData` always re-arms — and a regression test pins the end-to-end "daemon too old" flow: fetch `/health` → classify `version-stale` → render `budi · update needed` → tooltip names `budi update` → `shouldShowVersionStaleToast` flips once and stays off.

### Maintenance

- **Split `src/budiClient.ts` into focused modules** (`siropkin/budi-cursor#70` / PR #91). The 547-LOC client is gone; HTTP, health, render, and config now each live in their own files (`src/http/statuslineClient.ts`, `src/health/healthState.ts`, `src/render/{statusText,tooltip,clickUrl}.ts`, `src/config/endpoints.ts`) with per-module unit tests. `extension.ts` imports from the new paths directly — no compat shim, since the extension has no production users yet. Byte-identical statusline / tooltip behaviour; coverage thresholds re-targeted to the new layout.
- **Fleshed out `sessionStore` tests and hardened v1 contract writes** (`siropkin/budi-cursor#72` / PR #92). `writeActiveWorkspace` now writes atomically (temp file + `rename`) so a crash mid-write can never leave half-written JSON, and no-ops on a falsy workspace path. Test suite grew from a single contract-version assertion to a real suite covering the cursor-sessions.json v1 contract (ADR-0086 §3.4): v1 shape, parent-dir creation, idempotent repeated writes, atomic-write semantics, no-op for non-workspace activations, no temp-file leak on success, safe behavior on unwritable target paths. Coverage threshold for `src/sessionStore.ts` lifted from `30/30/100/0` to `97/97/85/100`.
- **Dropped the legacy `today_cost` / `week_cost` / `month_cost` fallback in `resolveCosts`** (`siropkin/budi-cursor#68` / PR #90). Pre-#224 daemons emitted the deprecated 8.0 aliases as a one-release backward-compat shim; the canonical `cost_1d` / `cost_7d` / `cost_30d` fields have been the wire shape since `siropkin/budi#224` and are guaranteed by every daemon advertising `api_version >= 3`. Because `MIN_API_VERSION = 3` already gates out every daemon old enough to lack the canonical fields (they fall into the `version-stale` path and render `budi · update needed`), the alias fallback inside `resolveCosts` was already unreachable. Stripped the alias fields from `StatuslineData`, simplified `resolveCosts` to read the canonical shape only, and removed the two alias-fallback regression tests. `MIN_API_VERSION` unchanged (the canonical contract long predates the `api_version=3` floor).
- **Dropped a cross-version line from the README troubleshooting section** (`siropkin/budi-cursor#73` / PR #89). README §"`budi · update needed`" no longer hardcodes "v1.5.x requires a v8.4.2-or-newer daemon" — exactly the cross-version narrative the user-visible copy scope rule says to keep out of marketplace-visible files. The runtime tooltip already names the installed daemon version and the required `api_version`.
- **End-to-end code review of `src/` against SOUL.md** (`siropkin/budi-cursor#67` / PR #83). Audit-only, no behaviour change.
- **Tightened TypeScript strict flags and ESLint rule set** (`siropkin/budi-cursor#82` / PR #84). Tighter compile-time checks; no shipped JS difference.
- **Dead-code sweep** (`siropkin/budi-cursor#81` / PR #85). Dropped unused `eslint-config-prettier` dependency and the unused `InstallPlatform` export.
- **Vitest coverage thresholds + CI gate** (`siropkin/budi-cursor#71` / PR #88). `npm run test:coverage` runs the v8 provider against `src/**` with per-file floor thresholds; CI fails when coverage drops on any tracked file. Workflow surfaces a per-file coverage table in the PR check summary and uploads the full HTML report as an artifact. Thresholds start at today's floor — ratchet up in follow-ups as test coverage grows.
- **CHANGELOG hygiene pass** (`siropkin/budi-cursor#80` / PR #86). Aligned headers to Keep a Changelog format and moved compare URLs to the bottom of the file.
- **Confirmed `MIN_API_VERSION = 3` still matches v8.4.2's `/health.api_version`** (`siropkin/budi-cursor#79`). No bump required for this release.

## [1.5.3] - 2026-05-12

_Detected host surface from `vscode.env.appName`. Closes `siropkin/budi-cursor#64`. The same VSIX has been published to both the VS Code Marketplace and Open VSX since v1.x, but v1.5.x pinned `?surface=cursor` on every analytics request — so a VS Code install rendered Cursor totals (typically zero) instead of the user's actual VS Code activity. The daemon already advertises `vscode` on `/health.surfaces` and returns clean per-surface data; the gap was entirely on the extension side._

### Changed

- **Wire surface derived from `vscode.env.appName` at activation** (`siropkin/budi-cursor#64`). `"Cursor"` → `surface=cursor`, `"Visual Studio Code"` / `"Visual Studio Code - Insiders"` / `"VSCodium"` → `surface=vscode`, anything else → `surface=unknown` (the daemon tolerates the value per `siropkin/budi#702` acceptance). VS Code installs now hit `/analytics/statusline?surface=vscode` and render their own host's totals; Cursor keeps `surface=cursor` (no regression).
- **`buildStatuslineUrl` / `fetchStatusline` take an explicit `surface` argument.** Replaces the `CURSOR_SURFACE` module-level constant — the host is read once at activation and threaded through the refresh / poll chain. New `detectSurface(appName)` and `Surface` type are exported for tests and any future surface-picker UI to share. The resolved value is logged to the `budi` output channel (`[budi] host appName=… → surface=…`) so a user reporting "wrong totals" can confirm detection without grepping `vscode.env`.

### Notes

- Unit tests cover all three surface branches (`cursor` / `vscode` / `unknown`) plus the wire-level forwarding so a VS Code install can no longer regress to `surface=cursor` silently.
- The `cursor-sessions.json` / `cursor-onboarding.json` filenames stay as-is for this release. Renaming them per-surface depends on how the daemon's workspace resolver keys per-surface signal files, owned by a companion ticket in `siropkin/budi`.
- No data-contract change with the daemon — `?surface=vscode` was already in the v8.4.2 contract; this release just stops the extension from hardcoding the cursor value over it.

## [1.5.2] - 2026-05-11

_Simpler marketplace description. Tightened the `package.json` `description` field so the marketplace summary fits on one short line and points at the budi website. Pure copy change — no runtime behavior, daemon contract, or settings shape touched._

### Changed

- **`package.json` `description` shortened** to one sentence and includes `https://getbudi.dev` so the marketplace listing has a discoverable link to the project home. Drops the secondary "guide you through the install" sentence — the first-run flow is already documented in the README and rendered by the welcome view, so the marketplace summary doesn't need to repeat it.

## [1.5.1] - 2026-05-08

_Consumed the v8.4.2 daemon contract. Closes `siropkin/budi-cursor#55`. Cut the 1.5.x line of the host extension over to the surface dimension that v8.4.2 (`siropkin/budi#714`) shipped: hardcoded `?surface=cursor` on every analytics request, dropped the v1.4.x host-side workaround that filtered the wire response by `provider IN (cursor, copilot_chat)` heuristically, and lifted compiled `MIN_API_VERSION` to `3` (the value the daemon now advertises on `/health`). Promise was graceful degrade, not break-on-old-daemons: a 1.5.1 extension hitting an 8.4.1 daemon printed the existing `version-stale` warning (`budi · update needed`) instead of silently rendering zeros._

### Changed

- **`buildStatuslineUrl` hardcodes `?surface=cursor`** (`siropkin/budi-cursor#55`). The Cursor extension is, by construction, cursor-bound — there is no host detection that would pick anything else. Stops sending `?provider=…` entirely; the daemon's surface filter is the correct scoping primitive (`siropkin/budi#702`) and the wire response is rendered as-is. Old daemons silently drop unknown query params, so the request shape is byte-safe against a pre-#702 daemon.
- **`MIN_API_VERSION` lifted from `1` to `3`** (`siropkin/budi-cursor#55`). v8.4.2 is the first daemon release that bumps `/health.api_version` past `1`; older daemons trip the gate and fall through `deriveHealthState` → `version-stale` → `budi · update needed`. Inline policy comment rewritten to mirror the cautionary tale of the v1.4.0 over-bump (`siropkin/budi-cursor#40`) without repeating it.
- **`DaemonHealth.surfaces` exposed** for forward-compat. v8.4.2 advertises `["vscode","cursor","jetbrains","terminal","unknown"]` on `/health.surfaces`; v1.5.1 reads but does not use the array — the v1.6.x surface picker UI will iterate it. Older daemons omit the field; readers tolerate `undefined`.

### Removed

- **Sub-IDE / Code-fork detection** (`Host` enum, `detectHost`, `surfaceFilterForHost`, `SURFACE_BY_HOST`, `buildProviderList`, `DEFAULT_PROVIDER_BY_HOST`, `formatHostLabel`, `defaultProviderForHost`). All of it picked between `vscode` and `cursor` for the surface field; with `?surface=cursor` pinned, every branch except `cursor` is unreachable. Audit-and-remove parity with the JetBrains-side decision in `siropkin/budi-jetbrains#6`.
- **`src/extensionsProbe.ts`** and its test. The probe enumerated `vscode.extensions.all` for non-Cursor AI extensions (Copilot Chat, Continue, Cline, Roo Code) so v1.4.x could ask the daemon for `?provider=copilot_chat,continue,…` on a VS Code host. With v1.5.1's hardcoded `?surface=cursor`, the daemon's parser-local attribution returns whatever sub-providers Cursor itself routed; no client-side enumeration is needed.
- **`budi.includeOtherSurfaces` setting**. Was the v1.4.x opt-out for the cross-IDE aggregation. Superseded by the hardcoded `?surface=cursor` — v1.5.1 has no opt-out. The toggle pattern that `siropkin/budi-jetbrains#6` introduces (`Include other surfaces`) is the v1.6.x ask once both sides have shipped one round.

### Notes

- New URL builder + `MIN_API_VERSION` gate test in `src/budiClient.test.ts` pin the v8.4.2 wire shape: `?surface=cursor` always present, `?provider=` never sent, `MIN_API_VERSION === 3`, `version-stale` against `api_version: 1`, `green/yellow` against `api_version: 3`. Parity with `siropkin/budi-jetbrains#6` v0.1 acceptance.
- Welcome-view copy is now Cursor-only (matches `SOUL.md` framing). `renderHtml` no longer takes a `host` argument; the v1.4.0 host-aware variants (`Shows your Copilot Chat spend`, etc.) are gone with the rest of the multi-host plumbing.
- No surface picker UI yet (that is the v1.6.x ask); no surface-aware status-bar copy (the user is by-construction host-bound, so the host-scoping is invisible). Multi-provider Copilot-Chat-via-Cursor sub-attribution is consumed unchanged from the daemon.

## [1.5.0] - 2026-05-08

_Surface filter, actionable upgrade prompt, and security hardening. Bundled the post-1.4.1 work tracked in `siropkin/budi-cursor#42`–`#45`, `#50`, and `#51`. Two user-visible improvements (per-host surface filtering, actionable copy when the daemon api_version is stale) rode alongside four security fixes that closed drive-by primitives a malicious repo could abuse via `.vscode/settings.json`. No data-contract change with the daemon — `?surface=<host>` and the existing `?provider=…` shape coexisted, and the extension still ran against any 8.4.x daemon without modification._

### Added

- **Per-host `?surface=<host>` filter on every analytics request** (`siropkin/budi-cursor#50` / PR #52). The extension now tells the daemon which IDE it is rendering for — `cursor` from Cursor, `vscode` from VS Code, `vscode` from VSCodium (re-uses VS Code paths in core's path-based inference). Stops the cross-IDE leak where a user with both editors installed saw the same blended dollar number on both status bars. New `surfaceFilterForHost` helper in `src/budiClient.ts`; `unknown` host returns `[]` as a failsafe so we never accidentally hide the user's data. Pairs with `siropkin/budi#701` (data layer) and `siropkin/budi#702` (HTTP + CLI filter).
- **`budi.includeOtherSurfaces` setting** (default `false`) for the holistic-view crowd that wants the pre-#50 cross-IDE aggregation back. Documented in `package.json` configuration contributions; re-read on `onDidChangeConfiguration` and `onDidGrantWorkspaceTrust`.
- **Actionable upgrade prompt when the daemon `api_version` is stale** (`siropkin/budi-cursor#51` / PR #53). The previous `red` `HealthState` collapsed both "daemon unreachable" and "daemon too old" into a single `budi · offline` copy plus a vague toast. Split into two states so the bar copy and toast tell the user what to actually do:
  - `unreachable` → `budi · offline` (unchanged for the truly-down case).
  - `version-stale` → `budi · update needed`, with a tooltip that names the installed daemon version, the required `api_version`, and the platform-appropriate one-line upgrade command (`budi update` / `brew upgrade siropkin/budi/budi` / standalone installer).
  - Toast offers a **Show update command** action that opens a `budi: Update` output channel pre-populated with the right command, plus **Dismiss** to silence it for the session. The extension never runs the upgrade itself — daemon installs span Homebrew, manual binaries, and corp-managed paths.

### Changed

- **`budi.daemonUrl` is now loopback-only** (`siropkin/budi-cursor#42` / PR #46). `getConfiguration("budi").get` returns the merged user/workspace value, so a malicious repo's `.vscode/settings.json` could pivot the extension's 15-second `GET /health` + `GET /analytics/statusline?project_dir=<abs path>` polling to an attacker URL the moment the workspace was trusted, leaking the absolute workspace path, the detected AI-extension list on non-Cursor hosts, and a presence beacon. Only `http(s)://127.0.0.1`, `localhost`, and `::1` are honored now; everything else is logged and falls back to `http://127.0.0.1:7878`. Schema-level `pattern` makes the editor's settings UI flag non-loopback values too. SOUL.md already pins the daemon as local-only, so a remote override has no legitimate use case.
- **`budi.cloudEndpoint` is now restricted to `getbudi.dev` hosts** (`siropkin/budi-cursor#43` / PR #47). Same primitive as `daemonUrl` but on the click-through side: a workspace override could redirect `vscode.env.openExternal` to an attacker URL and turn a status-bar click into a drive-by phishing landing. Only https URLs whose hostname is `getbudi.dev` or ends in `.getbudi.dev` are honored; everything else falls back to the default. Subdomains stay allowed so a user-scope `staging.app.getbudi.dev` override keeps working. Schema gains a getbudi.dev-suffix `pattern`.
- **HTTP responses from the daemon are capped at 64 KB and content-type-checked** (`siropkin/budi-cursor#44` / PR #48). Both `fetchDaemonHealth` and `fetchStatusline` now route through a single `fetchDaemonJson` wrapper that rejects non-2xx responses, rejects non-`application/json` content-types, and aborts streams over 64 KB — a fast loopback peer could previously flood hundreds of MB inside the 3 s timeout window and OOM the extension host. Real `/health` and `/analytics/statusline` payloads are well under 1 KB, so 64 KB still leaves slack for forward-compat fields. Defense in depth alongside the loopback allowlist from #42 — even with a benign daemon, this protects against the daemon misbehaving.
- **Untrusted-workspace capability declared and security-sensitive settings gated** (`siropkin/budi-cursor#45` / PR #49). `package.json` now declares `capabilities.untrustedWorkspaces: { supported: "limited" }` with a description listing the keys that get ignored in untrusted folders. `extension.ts` runs `budi.daemonUrl`, `budi.cloudEndpoint`, and `budi.pollingIntervalMs` through a `readSecuritySensitive` helper that falls back to the user-scoped (or default) value when `vscode.workspace.isTrusted` is `false`. Workspace overrides become effective without an editor reload once the user trusts the folder via `onDidGrantWorkspaceTrust`. Platform-level companion to the per-setting allow-lists in #42/#43 — the trust gate is enforced in code rather than relying on the user-overridable VS Code declaration alone.

### Notes

- No daemon contract change. `?surface=<host>` is additive; an old daemon ignores it and returns the same shape it always did. Single-host v1.4.x calls remain byte-identical when `includeOtherSurfaces=false` (the default) and the extension already filters to a single surface.
- Status-bar copy gains exactly one new state — `budi · update needed` for stale daemons. The other four states (`budi`, `budi · setup`, `budi · offline`, `budi · $X 1d · $Y 7d · $Z 30d`) are unchanged.
- The four security fixes are no-ops in the trusted single-developer-workspace flow that has been the default to date; they exist to make the "I just opened an unfamiliar repo" path safe rather than to change shipped behavior for existing installs.

## [1.4.1] - 2026-05-07

_Fixed `budi · offline` against released daemons. Hotfix on top of 1.4.0 (`siropkin/budi-cursor#40`). The 1.4.0 release bumped `MIN_API_VERSION` to `3` based on a comment that incorrectly claimed lockstep with budi-core 8.4.0 / `siropkin/budi#665`. The daemon's `API_VERSION` constant (`crates/budi-daemon/src/routes/hooks.rs`) was never bumped past `1` — and `siropkin/budi#665` is a Copilot Chat parser fix, unrelated to the wire version. Net effect: every released daemon (8.4.0, 8.4.1, …) failed the gate, so the status bar showed `budi · offline` even when the daemon was perfectly healthy._

### Fixed

- **`MIN_API_VERSION` lowered from `3` back to `1`** in `src/budiClient.ts` to match what every released daemon actually advertises. The wire shape this extension depends on (`?provider=a,b,c` requests + `contributing_providers` responses from `siropkin/budi#650`) lands correctly under `api_version: 1`, so the gate was effectively a permanent false-alarm. Comment block above the constant rewritten to remove the bogus `#665` / "v3 Copilot Chat parser envelopes" claims.
- The api-version warning toast (`src/extension.ts`) and the `red` health-state branch in `deriveHealthState` are unchanged — the tripwire is preserved for real wire breaks, just not pre-tripped.

### Notes

- After installing 1.4.1, reload the editor window. With a running 8.4.x daemon the status bar should flip from `budi · offline` to `budi · $X 1d · $Y 7d · $Z 30d`.
- Follow-up worth filing separately: split the `red` health state into `unreachable` vs `version-stale` so the on-bar copy stops saying "offline" when the real story is a future version mismatch.

## [1.4.0] - 2026-05-07

_VS Code host support alongside Cursor. Closed the milestone tracked in `siropkin/budi-cursor#25` and landed in lockstep with budi-core 8.4.0 (`siropkin/budi#647`). Before this release the extension ran in VS Code but always asked budi-core for `?provider=cursor`, so a pure-VS Code user saw zero forever. v1.4.0 made the extension genuinely multi-host: it detected the editor it was running in, enumerated installed AI extensions, and asked budi-core for a contributing-providers list rather than a hardcoded single provider._

### Added

- **Host detection** via `vscode.env.appName` (`siropkin/budi-cursor#26` / PR #33). The extension now distinguishes Cursor from VS Code at activation and uses that to pick the default provider when no AI extensions are installed.
- **Installed-extensions probe** that enumerates `vscode.extensions.all` for `github.copilot-chat`, `Continue.continue`, `saoudrizwan.claude-dev`, etc. (`siropkin/budi-cursor#27` / PR #34). Discovered extensions are emitted in the request to budi-core so future provider rollouts on the daemon side need no extension change.
- **Multi-provider request shape** replacing the hardcoded `?provider=cursor` query string (`siropkin/budi-cursor#28` / PR #35). `MIN_API_VERSION` bumped to `3` so older daemons surface the existing version-mismatch warning instead of silently returning zeros.
- **Open VSX publish target** (`siropkin/budi-cursor#30` / PR #37). The extension is now reachable from inside Cursor's native extension panel via the Open VSX registry, not only the manual `.vsix` install path. README install section documents the Open VSX route for Cursor / VSCodium users.

### Changed

- **Host-aware status bar text and tooltip** (`siropkin/budi-cursor#29` / PR #36). The label reads "Cursor usage" or "VS Code usage" based on detected host, and the tooltip lists the contributing providers (Cursor, Copilot Chat, …) so users can see which AI tools are folded into the dollar number.
- **Welcome-view copy** dropped Cursor-only language ("Cursor's integrated terminal" → "the integrated terminal", and so on) so the in-editor onboarding reads naturally for both editors (`siropkin/budi-cursor#29`).
- **README + `package.json` description** reframed for both editors (`siropkin/budi-cursor#31` / PR #38). Marketplace listing now reads "VS Code & Cursor extension" with both providers in the description; keywords gained `vscode`, `copilot`, `copilot chat`.
- **GitHub repo metadata** refreshed post-release (`siropkin/budi-cursor#32`): description, homepage (`https://app.getbudi.dev`), and topics (`copilot`, `ai`, `developer-tools` added) now reflect post-1.4.0 reality.

### Notes

- Cursor behaviour is unchanged: a Cursor-only install with no other AI extensions still resolves to `provider=cursor` via the host-default fallback.
- Copilot Chat numbers depend on budi-core 8.4.0 (`siropkin/budi#651`); on older daemons the API-version warning fires and the statusline degrades gracefully rather than misreporting.
- JetBrains support, Continue / Cline / Roo Code provider data, and the `budi-cursor` → `budi-vscode` repo rename are explicitly out of scope and tracked separately.

## [1.3.3] - 2026-05-05

_Welcome-view copy alignment with getbudi.dev. Two small welcome-view fixes that landed after 1.3.2 (`siropkin/budi-cursor#20`, `siropkin/budi-cursor#21`). Both closed gaps where the in-editor onboarding copy had drifted from the canonical install/contract story on getbudi.dev and the README._

### Fixed

- **macOS install command now uses Homebrew.** Split the previous combined `MACOS_LINUX_COMMAND` into a `brew install siropkin/budi/budi` command for `darwin` (labelled "macOS") and the curl-based standalone installer for Linux (labelled "Linux"). Restores the public-site mirror invariant that broke when getbudi.dev switched the macOS recommendation to Homebrew. Windows is unchanged.
- **Welcome-view footnote no longer says budi "routes Cursor traffic."** Reworded the lone proxy-era straggler at `src/welcomeView.ts:250` to "tailing Cursor's transcripts" so it matches the README and the paragraph directly above it. Closes the last reference missed in the 1.3.0 proxy-era sweep (#9 → ADR-0089/0090).

### Notes

- No behaviour change beyond copy/install-command rendering; the daemon contract, statusline shape, and click-through URL composition are unchanged.
- Tests in `installCommands.test.ts` and `welcomeView.test.ts` were extended to assert each platform gets its own canonical command and label, with cross-checks that the macOS panel never leaks the Linux command and vice versa.

## [1.3.2] - 2026-04-23

_Dropped the leading health-dot glyph from the status bar. Tracked in `siropkin/budi-cursor#18`. The colored circle prefix (🟢 / 🟡 / 🔴 / ⚪) was redundant — the tooltip and the copy already distinguished the three non-healthy states, and the glyph did not carry information the text lacked. Claude Code's CLI statusline does not show one either, so dropping it brought the Cursor surface in line with the reference surface._

### Changed

- **Removed** the leading health-dot glyph from `buildStatusText`. Health collapses into the copy itself: `budi` (loading), `budi · setup` (first run), `budi · offline` (daemon unreachable), `budi · $X 1d · $Y 7d · $Z 30d` (healthy).
- **Deleted** the now-unused `healthIndicator` helper from `src/budiClient.ts` and its test block.
- **Rewrote** the README "Status bar at a glance" table — replaced the indicator-emoji column with a state → status-bar-text column. Updated the first-run, smoke-check, and troubleshooting paragraphs that were written around circle colors.
- **Refreshed** the three SOUL.md lines that described the leading glyph / "red-dot" state so agent-facing docs match shipped behavior (ADR-0088 §6/§7 narrative intact).

### Notes

- Tooltip copy, click-through URL, provider scoping, polling cadence, and the `/analytics/statusline?provider=cursor` + `/health` data contract are all unchanged.
- No marketplace re-screenshot required beyond a single fresh status-bar shot; public-site sync on getbudi.dev picks up the shape change in the usual way.

## [1.3.1] - 2026-04-21

_User-visible extension copy cleanup. Tracked in `siropkin/budi-cursor#10` and `siropkin/budi-cursor#11`. Budi had no existing users, so cross-version narrative ("Starting with v1.1.0…", three stacked "What changed in 1.x" sections) and ADR/main-repo doc links on the marketplace README and welcome view were teaching a history the fresh installer never lived through and creating future broken-link liability._

### Changed

- **Rewrote** the marketplace-visible README in present tense. Dropped the "Starting with v1.1.0…" and "Starting with v1.2.0…" lead-ins; removed the three "What changed in 1.3.0 / 1.2.0 / 1.1.0" sections entirely. `CHANGELOG.md` remains the version history of record.
- **Stripped** ADR-XXXX parentheticals, `siropkin/budi#NNN` PR references, and pointers to `docs/statusline-contract.md` from `README.md`. Behaviour is described directly (rolling 1d / 7d / 30d shape, `?provider=cursor` scoping) without forcing fresh users to chase cross-repo doc paths.
- **Replaced** the in-editor welcome-view footnote that linked out to `scripts/install-standalone.sh` in the main repo with a neutral "read it before pressing enter" line.

### Scope

- ADR/PR references remain load-bearing in `SOUL.md`, `AGENTS.md`, source doc-comments, and CI grep guards — intentionally untouched. The milestone is user-visible surfaces only.

## [1.3.0] - 2026-04-20

_8.2 tailer alignment — dropped proxy-era copy. Tracked in `siropkin/budi#437`. Budi 8.2 retired the on-machine HTTP proxy (ADR-0089): live cost capture for every supported provider is now the local transcript tailer. The extension's marketplace listing, bundled README, and welcome view still described the dead 8.0/8.1 install flow and were misdirecting fresh users on the recommended install path. This release also folded in the statusline-only surface, first-run welcome view, and onboarding entry-point work previously drafted as 1.1.0 / 1.2.0 in earlier drafts but never tagged from this repo._

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

## [1.0.1] - 2026-04-16

_Release hygiene._

### Fixed

- Treated "already published" as a successful outcome in the release workflow to keep re-runs idempotent (`siropkin/budi-cursor#2`, `siropkin/budi-cursor#3`).

## [1.0.0] - 2026-04-16

_First Marketplace release._

### Added

- Initial publish from the `siropkin/budi` monorepo after extraction completed under ADR-0086.
- Status bar item with aggregated session health (green / yellow / red circles) and today's cost, session-detail side panel, and workspace-signal file write.

[Unreleased]: https://github.com/siropkin/budi-cursor/compare/v1.5.4...HEAD
[1.5.4]: https://github.com/siropkin/budi-cursor/compare/v1.5.3...v1.5.4
[1.5.3]: https://github.com/siropkin/budi-cursor/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/siropkin/budi-cursor/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/siropkin/budi-cursor/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/siropkin/budi-cursor/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/siropkin/budi-cursor/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/siropkin/budi-cursor/compare/v1.3.3...v1.4.0
[1.3.3]: https://github.com/siropkin/budi-cursor/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/siropkin/budi-cursor/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/siropkin/budi-cursor/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/siropkin/budi-cursor/compare/v1.0.1...v1.3.0
[1.0.1]: https://github.com/siropkin/budi-cursor/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/siropkin/budi-cursor/releases/tag/v1.0.0
