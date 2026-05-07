import * as http from "http";

/**
 * Status contract consumed by this extension.
 *
 * Authoritative spec: `docs/statusline-contract.md` in `siropkin/budi`
 * (shipped in 8.1 under siropkin/budi#224, host-scoped multi-provider
 * shape added in 8.4 under siropkin/budi#650, governed by ADR-0088 §4 +
 * §7 post-#648).
 *
 * The extension queries either provider-scoped (one provider) or
 * host-scoped (comma-list of providers detected in the current editor
 * host). Single-provider behavior on the Cursor host is byte-identical
 * to v1.3.x (siropkin/budi-cursor#28).
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
  /**
   * Echoed back by the daemon only when exactly one provider was passed.
   * Multi-provider responses omit this field — `contributing_providers`
   * advertises the active scope instead.
   */
  provider_scope?: string;
  /**
   * Present only on multi-provider responses (the comma-list form).
   * Deduplicated, normalized, in input order. Tooltip + click-through
   * routing source for host-scoped surfaces.
   */
  contributing_providers?: string[];
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

/**
 * The minimum daemon `/health.api_version` this extension requires.
 *
 * The wire shape this extension actually depends on — host-scoped
 * `?provider=a,b,c` requests + `contributing_providers` responses
 * (siropkin/budi#650) — landed in budi-core 8.4.0 *without* a bump to
 * the daemon's `API_VERSION` constant (`crates/budi-daemon/src/routes/
 * hooks.rs`), which is still `1`. v1.4.0 of this extension shipped with
 * `MIN_API_VERSION = 3` based on a comment that incorrectly cited
 * siropkin/budi#665 as the bump (that PR is a Copilot Chat parser fix,
 * unrelated). Net effect: every released daemon failed the gate and
 * the status bar showed `budi · offline`. Lowered back to `1` here per
 * siropkin/budi-cursor#40.
 *
 * Bump this only when budi-core actually bumps `API_VERSION` for a
 * breaking wire change — and update both sides in the same release.
 */
export const MIN_API_VERSION = 1;

/** The Cursor provider name on the budi-core wire — ADR-0088 §7. */
export const CURSOR_PROVIDER = "cursor";

/**
 * First-class provider for each editor host. Used as the fallback when
 * the installed-extensions probe finds nothing on a non-Cursor host —
 * a fresh VS Code install with no AI extension yet still gets a
 * sensible statusline scope. `copilot_chat` is the only non-Cursor
 * provider with a parser in budi-core 8.4.0; later releases may pick a
 * different default per host (siropkin/budi#295).
 */
const DEFAULT_PROVIDER_BY_HOST: Readonly<Record<Host, string>> = {
  cursor: "cursor",
  vscode: "copilot_chat",
  vscodium: "copilot_chat",
  unknown: "copilot_chat",
};

/** Wire name of the first-class provider for a host (siropkin/budi-cursor#29). */
export function defaultProviderForHost(host: Host): string {
  return DEFAULT_PROVIDER_BY_HOST[host];
}

/**
 * Human-facing host label used in marketplace-visible copy
 * (status bar tooltip header, welcome view) — siropkin/budi-cursor#29.
 *
 * `unknown` hosts fall back to "Editor" so the tooltip does not pretend
 * to recognize a fork it has not been taught.
 */
const HOST_LABELS: Readonly<Record<Host, string>> = {
  cursor: "Cursor",
  vscode: "VS Code",
  vscodium: "VSCodium",
  unknown: "Editor",
};

export function formatHostLabel(host: Host): string {
  return HOST_LABELS[host];
}

/**
 * Compose the provider list this extension sends to the daemon.
 *
 * - Cursor host: always `["cursor"]`. The probe is intentionally
 *   ignored so a stray `github.copilot-chat` install on Cursor cannot
 *   change the request shape — the v1.3.x byte-for-byte contract holds.
 * - Non-Cursor host with detected providers: returns the probe results
 *   as-is. Unknown providers (deferred ones from #295) survive — the
 *   daemon returns zero for them per #650 so over-reporting is safe.
 * - Non-Cursor host with empty probe: falls back to that host's first-
 *   class provider so the statusline has a definite scope rather than
 *   collapsing to the daemon's "all providers" default.
 */
export function buildProviderList(
  host: Host,
  detectedProviders: readonly string[],
): readonly string[] {
  if (host === "cursor") return ["cursor"];
  if (detectedProviders.length === 0) return [DEFAULT_PROVIDER_BY_HOST[host]];
  return detectedProviders;
}

/**
 * Pretty-print a provider name for tooltip rendering. Matches the
 * canonical wire names from the statusline contract (`cursor`,
 * `copilot_chat`, `claude_code`, `codex`, `copilot_cli`, `continue`,
 * `cline`, `roo_code`); unknown names round-trip through a generic
 * underscore-to-space title-case so deferred providers (#295) still
 * render readably.
 */
export function formatProviderName(provider: string): string {
  switch (provider) {
    case "cursor":
      return "Cursor";
    case "copilot_chat":
      return "Copilot Chat";
    case "copilot_cli":
      return "Copilot CLI";
    case "claude_code":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "continue":
      return "Continue";
    case "cline":
      return "Cline";
    case "roo_code":
      return "Roo Code";
    default:
      return provider
        .split("_")
        .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
        .join(" ");
  }
}

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
 * First line of the tooltip — names the host and, on non-Cursor hosts,
 * the single contributing provider when one is known. Multiple
 * contributing providers fall through to a host-only label so the
 * dedicated `Tracking: ...` line below carries the detail.
 */
export function buildTooltipHeader(host: Host, contributing: readonly string[]): string {
  const hostLabel = formatHostLabel(host);
  if (host === "cursor") return `budi — ${hostLabel} usage`;
  if (contributing.length === 1) {
    return `budi — ${hostLabel} usage (${formatProviderName(contributing[0])})`;
  }
  return `budi — ${hostLabel} usage`;
}

/**
 * Build a status bar tooltip that names the provider scope, names the
 * rolling windows, and points the user at `budi doctor` on trouble.
 */
export function buildTooltip(
  state: HealthState,
  statusline: StatuslineData | null,
  cloudEndpoint: string,
  host: Host = "cursor",
): string {
  const contributing = statusline?.contributing_providers ?? [];
  const lines: string[] = [buildTooltipHeader(host, contributing), ""];
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
  if (contributing.length > 1) {
    lines.push(`Tracking: ${contributing.map(formatProviderName).join(", ")}`);
  } else if (host === "cursor") {
    // Preserve the v1.3.x literal (lowercase wire name) on the Cursor host.
    lines.push("Provider: cursor");
  } else {
    const single =
      statusline?.provider_scope ?? statusline?.active_provider ?? defaultProviderForHost(host);
    lines.push(`Provider: ${formatProviderName(single)}`);
  }
  if (state === "yellow") {
    if (host === "cursor") {
      lines.push("No recent Cursor traffic in the last 24h.");
    } else {
      const scope =
        contributing.length === 1
          ? formatProviderName(contributing[0])
          : `${formatHostLabel(host)} AI`;
      lines.push(`No recent ${scope} traffic in the last 24h.`);
    }
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
 * `host` is accepted but does not change the cost-line shape: the
 * shared status contract guarantees the daemon already filters costs to
 * the requested provider scope, so the on-bar copy stays byte-identical
 * across hosts. Host-aware copy in #29 lives in `buildTooltip`, which
 * has room for the longer label.
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
 * Fetch statusline data from the daemon. `providers` is the list built
 * by `buildProviderList`; a single entry is encoded as plain
 * `?provider=<name>` (byte-identical to v1.3.x for the Cursor host),
 * and multiple entries are joined with `,` per the contract — the
 * repeated `?provider=a&provider=b` form is **not** supported by the
 * daemon (axum's `Query` extractor takes the last value only).
 *
 * `project_dir` is optional. When passed it unlocks `project_cost`
 * (unused on the statusline surface today) and gives the daemon the
 * repo-local context it needs for accurate branch attribution.
 */
export function buildStatuslineUrl(
  daemonUrl: string,
  providers: readonly string[],
  projectDir?: string,
): string {
  const url = new URL("/analytics/statusline", daemonUrl);
  if (providers.length > 0) {
    url.searchParams.set("provider", providers.join(","));
  }
  if (projectDir) {
    url.searchParams.set("project_dir", projectDir);
  }
  return url.toString();
}

export function fetchStatusline(
  daemonUrl: string,
  providers: readonly string[],
  projectDir?: string,
): Promise<StatuslineData | null> {
  return new Promise((resolve) => {
    const req = http.get(
      buildStatuslineUrl(daemonUrl, providers, projectDir),
      { timeout: 3000 },
      (res) => {
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
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}
