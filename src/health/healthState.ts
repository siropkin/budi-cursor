import type { DaemonHealth, StatuslineData } from "../http/statuslineClient";

export interface ResolvedCosts {
  cost1d: number;
  cost7d: number;
  cost30d: number;
}

/**
 * The minimum daemon `/health.api_version` this extension requires.
 *
 * v8.4.2 (siropkin/budi#714) is the first daemon release that bumps
 * `/health.api_version` to `3` alongside the `?surface=` filter
 * (siropkin/budi#702) this extension now consumes on every analytics
 * request. Against an 8.4.1-or-older daemon (`api_version=1`) the gate
 * trips and `deriveHealthState` returns `version-stale` so the status
 * bar reads `budi · update needed` instead of silently rendering zeros
 * — graceful degrade by way of the existing `version-stale` path
 * (siropkin/budi-cursor#51), not break-on-old-daemons.
 *
 * Cautionary tale (siropkin/budi-cursor#40): v1.4.0 over-bumped this to
 * `3` based on a comment that incorrectly cited siropkin/budi#665 as
 * the daemon-side bump. That PR was unrelated and the daemon was still
 * advertising `api_version=1`, so every released daemon failed the gate
 * and the bar showed `budi · offline`. v1.4.1 lowered it back to `1`.
 * The lift here is correct *because* siropkin/budi#714 is the bump —
 * verify the daemon CHANGELOG before changing this value again, and
 * lift to a higher number only when budi-core actually moves past `3`.
 */
export const MIN_API_VERSION = 3;

/**
 * Resolve the rolling cost fields from the canonical
 * `cost_1d` / `cost_7d` / `cost_30d` shape. Missing or non-finite values
 * default to `0`. Pre-#224 daemons emitted the deprecated 8.0 aliases
 * (`today_cost` / `week_cost` / `month_cost`); we no longer read them
 * because `MIN_API_VERSION = 3` gates out every daemon old enough to
 * lack the canonical fields.
 */
export function resolveCosts(data: StatuslineData): ResolvedCosts {
  const pick = (value: number | undefined): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  return {
    cost1d: pick(data.cost_1d),
    cost7d: pick(data.cost_7d),
    cost30d: pick(data.cost_30d),
  };
}

/**
 * Stable signature for a stale-daemon detection, derived from the
 * fields the toast surfaces to the user (`version` and `api_version`).
 * `extension.ts` records the last signature it warned about in
 * `globalState` so the upgrade toast fires once per install per unique
 * stale daemon — not once per reload window
 * (siropkin/budi-cursor#79). A user who upgrades from one stale daemon
 * to another (e.g. 8.4.0 → 8.4.1, both still `api_version=1`) gets a
 * fresh warning because the signature changes; a user who dismisses
 * and reloads against the same daemon does not.
 */
export function versionStaleSignature(health: DaemonHealth): string {
  return `${health.version}|${health.api_version}`;
}

/**
 * Pure decision for "should the version-stale toast fire now?" — the
 * regression-test seam for the once-per-install contract
 * (siropkin/budi-cursor#79). `lastWarnedSignature` is whatever the
 * extension previously persisted to `globalState`; `undefined` means
 * "never warned on this install."
 */
export function shouldShowVersionStaleToast(
  health: DaemonHealth,
  lastWarnedSignature: string | undefined,
): boolean {
  return versionStaleSignature(health) !== lastWarnedSignature;
}

export type HealthState =
  | "green"
  | "yellow"
  | "unreachable"
  | "version-stale"
  | "gray"
  | "firstRun";

/**
 * Decide which health state the status bar is in, per siropkin/budi#232,
 * #314, and siropkin/budi-cursor#51. The state drives the status-bar copy
 * (`budi`, `budi · offline`, `budi · update needed`, `budi · setup`,
 * `budi · $X 1d · …`) and the welcome-view lifecycle; no visible glyph
 * rides on top of it.
 *
 * - `gray`          — extension is still starting up (no reading yet).
 * - `firstRun`      — the daemon is unreachable **and** this extension install
 *                     has never seen a healthy daemon. The user discovered
 *                     budi via the marketplace and has not installed the
 *                     engine yet — we route them to the welcome view instead
 *                     of a "daemon offline" error (#314).
 * - `unreachable`   — the daemon is unreachable **and** this extension install
 *                     has seen a healthy daemon at some point. "offline" is
 *                     the accurate story (the daemon is installed but not
 *                     responding), not "not installed".
 * - `version-stale` — the daemon is reachable but reports an `api_version`
 *                     below `MIN_API_VERSION`. Distinct from `unreachable`
 *                     because the action is "upgrade the daemon", not "start
 *                     the daemon" (siropkin/budi-cursor#51).
 * - `yellow`        — daemon is healthy but this machine has no AI traffic in
 *                     the rolling window.
 * - `green`         — daemon is healthy and traffic is being recorded.
 */
export function deriveHealthState(
  health: DaemonHealth | null,
  statusline: StatuslineData | null,
  everSawDaemon = true,
): HealthState {
  if (!health) return everSawDaemon ? "unreachable" : "firstRun";
  if (health.api_version < MIN_API_VERSION) return "version-stale";
  if (!statusline) return "yellow";
  const costs = resolveCosts(statusline);
  const hasTraffic = costs.cost1d > 0 || costs.cost7d > 0 || costs.cost30d > 0;
  if (hasTraffic) return "green";
  return "yellow";
}
