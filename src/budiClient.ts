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
}

/** The minimum daemon api_version this extension requires. */
export const MIN_API_VERSION = 1;

/** The provider filter this extension always sends — ADR-0088 §7. */
export const CURSOR_PROVIDER = "cursor";

/**
 * Editor host this extension is running inside, derived from
 * `vscode.env.appName` at activation. Used to pick the default provider
 * scope and to drive host-aware copy in `buildStatusText` /
 * `buildTooltip` (siropkin/budi-cursor#26 — lockstep with budi-core
 * 8.4.0).
 *
 * - `cursor`   — Cursor (the original target host).
 * - `vscode`   — VS Code stable or Insiders.
 * - `vscodium` — VSCodium (open-source VS Code build).
 * - `unknown`  — appName matched none of the above; treat like `vscode`
 *                for default-provider purposes but keep the label honest
 *                so the welcome view / tooltip can flag it.
 */
export type Host = "cursor" | "vscode" | "vscodium" | "unknown";

/**
 * Map `vscode.env.appName` to a `Host` enum. Mappings are pinned to the
 * exact strings VS Code, VS Code Insiders, Cursor, and VSCodium ship in
 * `product.json`; anything else (forks, future Microsoft channels) falls
 * through to `unknown` so the caller can decide.
 */
export function detectHost(appName: string | undefined | null): Host {
  switch (appName) {
    case "Cursor":
      return "cursor";
    case "Visual Studio Code":
    case "Visual Studio Code - Insiders":
    case "Visual Studio Code - Exploration":
      return "vscode";
    case "VSCodium":
    case "VSCodium - Insiders":
      return "vscodium";
    default:
      return "unknown";
  }
}

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
  const pick = (primary: number | undefined, legacy: number | undefined): number => {
    if (typeof primary === "number" && Number.isFinite(primary)) return primary;
    if (typeof legacy === "number" && Number.isFinite(legacy)) return legacy;
    return 0;
  };
  return {
    cost1d: pick(data.cost_1d, data.today_cost),
    cost7d: pick(data.cost_7d, data.week_cost),
    cost30d: pick(data.cost_30d, data.month_cost),
  };
}

/**
 * Render the numeric portion of the statusline, byte-for-byte matching
 * the default Claude Code cost line (`$X 1d · $Y 7d · $Z 30d`) from
 * `crates/budi-cli/src/commands/statusline.rs`.
 */
export function formatCostLine(costs: ResolvedCosts): string {
  const parts = [
    `${formatCost(costs.cost1d)} 1d`,
    `${formatCost(costs.cost7d)} 7d`,
    `${formatCost(costs.cost30d)} 30d`,
  ];
  return parts.join(" · ");
}

export type HealthState = "green" | "yellow" | "red" | "gray" | "firstRun";

/**
 * Decide which health state the status bar is in, per siropkin/budi#232
 * and #314. The state drives the status-bar copy (`budi`,
 * `budi · offline`, `budi · setup`, `budi · $X 1d · …`) and the
 * welcome-view lifecycle; no visible glyph rides on top of it.
 *
 * - `gray`     — extension is still starting up (no reading yet).
 * - `firstRun` — the daemon is unreachable **and** this extension install has
 *                never seen a healthy daemon. The user discovered budi via the
 *                marketplace and has not installed the engine yet — we route
 *                them to the welcome view instead of a "daemon offline" error
 *                (#314).
 * - `red`      — the daemon is unreachable or reports an incompatible
 *                `api_version`, **and** this extension install has seen a
 *                healthy daemon at some point (so "offline" is the accurate
 *                story, not "not installed").
 * - `yellow`   — daemon is healthy but this machine has no Cursor usage in the
 *                rolling window.
 * - `green`    — daemon is healthy and Cursor traffic is being recorded.
 */
export function deriveHealthState(
  health: DaemonHealth | null,
  statusline: StatuslineData | null,
  everSawDaemon = true,
): HealthState {
  if (!health) return everSawDaemon ? "red" : "firstRun";
  if (health.api_version < MIN_API_VERSION) return "red";
  if (!statusline) return "yellow";
  const costs = resolveCosts(statusline);
  const hasTraffic = costs.cost1d > 0 || costs.cost7d > 0 || costs.cost30d > 0;
  if (hasTraffic) return "green";
  return "yellow";
}

interface ClickUrlOptions {
  cloudEndpoint: string;
  statusline: StatuslineData | null;
  /**
   * Editor host this extension is rendering inside. Threaded through for
   * future host-aware click destinations (siropkin/budi-cursor#29); today
   * every host opens the same Claude Code-shaped URL.
   */
  host?: Host;
}

/**
 * Click-through URL for the statusline item. Mirrors
 * `crates/budi-cli/src/commands/statusline.rs::cmd_statusline`:
 * when there is an active session (here: active Cursor traffic in the
 * rolling 1d window), open the cloud session list; otherwise open the
 * dashboard root. The cloud endpoint defaults to `https://app.getbudi.dev`.
 *
 * First-run (`firstRun` health state, #314) is handled upstream — the
 * status bar command switches to the in-editor welcome view instead of
 * calling this helper.
 */
export function clickUrl({ cloudEndpoint, statusline, host = "cursor" }: ClickUrlOptions): string {
  void host;
  const base = cloudEndpoint.replace(/\/+$/, "");
  if (statusline && statusline.active_provider === CURSOR_PROVIDER) {
    return `${base}/dashboard/sessions`;
  }
  return `${base}/dashboard`;
}

/**
 * Build a status bar tooltip that names the provider scope, names the
 * rolling windows, and points the user at `budi doctor` on trouble.
 *
 * `host` is accepted but not yet branched on; host-aware tooltip copy
 * lands in siropkin/budi-cursor#29.
 */
export function buildTooltip(
  state: HealthState,
  statusline: StatuslineData | null,
  cloudEndpoint: string,
  host: Host = "cursor",
): string {
  void host;
  const lines: string[] = ["budi — Cursor usage", ""];
  if (state === "firstRun") {
    lines.push("budi is not installed on this machine yet.");
    lines.push("Click to set it up in one step.");
    return lines.join("\n");
  }
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

/**
 * Build the status bar text. Mirrors Claude Code's CLI statusline
 * shape (`$X 1d · $Y 7d · $Z 30d`) with a `budi ·` prefix and no
 * leading health glyph — the `HealthState` drives the copy variants
 * (`budi`, `budi · setup`, `budi · offline`) and the welcome-view
 * lifecycle, not a visual indicator.
 *
 * `host` is accepted but not yet branched on; host-aware status copy
 * lands in siropkin/budi-cursor#29.
 */
export function buildStatusText(
  state: HealthState,
  statusline: StatuslineData | null,
  host: Host = "cursor",
): string {
  void host;
  if (state === "firstRun") return "budi · setup";
  if (state === "red") return "budi · offline";
  if (state === "gray") return "budi";
  const costs = resolveCosts(statusline ?? {});
  return `budi · ${formatCostLine(costs)}`;
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
