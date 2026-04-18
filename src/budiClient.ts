import * as http from "http";

/**
 * Provider-scoped status contract consumed by this extension.
 *
 * Authoritative spec: `docs/statusline-contract.md` in `siropkin/budi`
 * (shipped in 8.1 under siropkin/budi#224, governed by ADR-0088 §4).
 *
 * The extension always queries with `provider=cursor` so every numeric
 * field reflects Cursor usage only — never blended multi-provider totals
 * (ADR-0088 §7, siropkin/budi#232).
 */
export interface StatuslineData {
  /** Rolling last 24h, dollars. */
  cost_1d?: number;
  /** Rolling last 7 days, dollars. */
  cost_7d?: number;
  /** Rolling last 30 days, dollars. */
  cost_30d?: number;
  /** Echoes the `provider` filter applied by the daemon. */
  provider_scope?: string;
  /** Most recent provider seen inside the 1d window, after the provider filter. */
  active_provider?: string;
  // Deprecated 8.0 aliases. The daemon still populates these with the same
  // rolling values for one release; removed in 9.0. Kept here so this
  // extension still renders something useful against a pre-#224 daemon.
  today_cost?: number;
  week_cost?: number;
  month_cost?: number;
}

export interface DaemonHealth {
  ok: boolean;
  version: string;
  api_version: number;
}

export interface ResolvedCosts {
  cost1d: number;
  cost7d: number;
  cost30d: number;
  /**
   * True when the daemon only returned the deprecated 8.0 aliases
   * (`today_cost` / `week_cost` / `month_cost`) and not the canonical
   * rolling fields. Lets the extension log a one-time warning about
   * talking to a pre-#224 daemon.
   */
  usedLegacyAliases: boolean;
}

/** The minimum daemon api_version this extension requires. */
export const MIN_API_VERSION = 1;

/** The provider filter this extension always sends — ADR-0088 §7. */
export const CURSOR_PROVIDER = "cursor";

function formatCost(dollars: number): string {
  if (!Number.isFinite(dollars) || dollars < 0) return "$0.00";
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(1)}K`;
  if (dollars >= 100) return `$${Math.round(dollars)}`;
  if (dollars > 0) return `$${dollars.toFixed(2)}`;
  return "$0.00";
}

/**
 * Resolve the rolling cost fields, preferring the canonical
 * `cost_1d` / `cost_7d` / `cost_30d` shape and falling back to the
 * deprecated 8.0 aliases when talking to an older daemon.
 *
 * This mirrors `build_slot_values` in `budi-cli` so the two surfaces
 * stay byte-for-byte aligned during the 8.0 → 8.1 cutover.
 */
export function resolveCosts(data: StatuslineData): ResolvedCosts {
  const hasNew =
    typeof data.cost_1d === "number" ||
    typeof data.cost_7d === "number" ||
    typeof data.cost_30d === "number";
  const pick = (primary: number | undefined, legacy: number | undefined): number => {
    if (typeof primary === "number" && Number.isFinite(primary)) return primary;
    if (typeof legacy === "number" && Number.isFinite(legacy)) return legacy;
    return 0;
  };
  return {
    cost1d: pick(data.cost_1d, data.today_cost),
    cost7d: pick(data.cost_7d, data.week_cost),
    cost30d: pick(data.cost_30d, data.month_cost),
    usedLegacyAliases: !hasNew,
  };
}

/**
 * Render the numeric portion of the statusline, byte-for-byte matching
 * the default Claude Code cost line (`$X 1d · $Y 7d · $Z 30d`) from
 * `crates/budi-cli/src/commands/statusline.rs`. The extension adds its
 * own leading health indicator on top of this string.
 */
export function formatCostLine(costs: ResolvedCosts): string {
  const parts = [
    `${formatCost(costs.cost1d)} 1d`,
    `${formatCost(costs.cost7d)} 7d`,
    `${formatCost(costs.cost30d)} 30d`,
  ];
  return parts.join(" · ");
}

export type HealthState = "green" | "yellow" | "red" | "gray";

/**
 * Decide which indicator to show, per siropkin/budi#232:
 *
 * - `gray`  — extension is still starting up (no reading yet).
 * - `red`   — daemon is unreachable or reports an incompatible `api_version`.
 * - `yellow` — daemon is healthy but this machine has no Cursor usage in the window.
 * - `green` — daemon is healthy and Cursor traffic is being recorded.
 */
export function deriveHealthState(
  health: DaemonHealth | null,
  statusline: StatuslineData | null,
): HealthState {
  if (!health) return "red";
  if (health.api_version < MIN_API_VERSION) return "red";
  if (!statusline) return "yellow";
  const costs = resolveCosts(statusline);
  const hasTraffic = costs.cost1d > 0 || costs.cost7d > 0 || costs.cost30d > 0;
  if (hasTraffic) return "green";
  return "yellow";
}

/**
 * Render the health indicator as a unicode dot. These glyphs are
 * pixel-consistent across VS Code status bar themes and do not require
 * `ThemeColor` plumbing. The green dot matches the getbudi.dev brand
 * mark (`#22c55e`).
 */
export function healthIndicator(state: HealthState): string {
  switch (state) {
    case "green":
      return "\u{1F7E2}";
    case "yellow":
      return "\u{1F7E1}";
    case "red":
      return "\u{1F534}";
    case "gray":
    default:
      return "\u26AA";
  }
}

export interface ClickUrlOptions {
  cloudEndpoint: string;
  statusline: StatuslineData | null;
}

/**
 * Click-through URL for the statusline item. Mirrors
 * `crates/budi-cli/src/commands/statusline.rs::cmd_statusline`:
 * when there is an active session (here: active Cursor traffic in the
 * rolling 1d window), open the cloud session list; otherwise open the
 * dashboard root. The cloud endpoint defaults to `https://app.getbudi.dev`.
 */
export function clickUrl({ cloudEndpoint, statusline }: ClickUrlOptions): string {
  const base = cloudEndpoint.replace(/\/+$/, "");
  if (statusline && statusline.active_provider === CURSOR_PROVIDER) {
    return `${base}/dashboard/sessions`;
  }
  return `${base}/dashboard`;
}

/**
 * Build a status bar tooltip that names the provider scope, names the
 * rolling windows, and points the user at `budi doctor` on trouble.
 */
export function buildTooltip(
  state: HealthState,
  statusline: StatuslineData | null,
  cloudEndpoint: string,
): string {
  const lines: string[] = ["budi — Cursor usage", ""];
  if (state === "red") {
    lines.push("Daemon not reachable.");
    lines.push("Run `budi doctor` to verify.");
    lines.push("");
    lines.push("Click to open the dashboard.");
    return lines.join("\n");
  }
  const costs = resolveCosts(statusline ?? {});
  lines.push(`1d  ${formatCost(costs.cost1d)}`);
  lines.push(`7d  ${formatCost(costs.cost7d)}`);
  lines.push(`30d ${formatCost(costs.cost30d)}`);
  lines.push("");
  lines.push("Provider: cursor");
  if (state === "yellow") {
    lines.push("No recent Cursor traffic in the last 24h.");
  }
  lines.push("");
  const base = cloudEndpoint.replace(/\/+$/, "");
  lines.push(`Click to open ${base}`);
  return lines.join("\n");
}

export function buildStatusText(state: HealthState, statusline: StatuslineData | null): string {
  const dot = healthIndicator(state);
  if (state === "red") return `${dot} budi · offline`;
  if (state === "gray") return `${dot} budi`;
  const costs = resolveCosts(statusline ?? {});
  return `${dot} budi · ${formatCostLine(costs)}`;
}

/**
 * Check daemon health and return version / api_version info.
 * Returns null if the daemon is unreachable.
 */
export function fetchDaemonHealth(daemonUrl: string): Promise<DaemonHealth | null> {
  return new Promise((resolve) => {
    const req = http.get(`${daemonUrl}/health`, { timeout: 3000 }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Fetch provider-scoped statusline data from the daemon. The extension
 * always scopes to `provider=cursor` — see ADR-0088 §7.
 *
 * `project_dir` is optional. When passed it unlocks `project_cost`
 * (unused on the statusline surface today) and gives the daemon the
 * repo-local context it needs for accurate branch attribution.
 */
export function fetchStatusline(
  daemonUrl: string,
  projectDir?: string,
): Promise<StatuslineData | null> {
  return new Promise((resolve) => {
    const url = new URL("/analytics/statusline", daemonUrl);
    url.searchParams.set("provider", CURSOR_PROVIDER);
    if (projectDir) {
      url.searchParams.set("project_dir", projectDir);
    }
    const req = http.get(url.toString(), { timeout: 3000 }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}
