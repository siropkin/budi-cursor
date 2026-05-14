import * as http from "http";

/**
 * Status contract consumed by this extension.
 *
 * Authoritative spec: `docs/statusline-contract.md` in `siropkin/budi`
 * (shipped in 8.1 under siropkin/budi#224, host-scoped multi-provider
 * shape added in 8.4 under siropkin/budi#650, governed by ADR-0088 §4 +
 * §7 post-#648). v8.4.2 (siropkin/budi#702/#714) adds the `?surface=`
 * filter that this extension hardcodes to `cursor` on every request.
 */
export interface StatuslineData {
  /** Rolling last 24h, dollars. */
  cost_1d?: number;
  /** Rolling last 7 days, dollars. */
  cost_7d?: number;
  /** Rolling last 30 days, dollars. */
  cost_30d?: number;
  /** Most recent provider seen inside the 1d window, after the surface filter. */
  active_provider?: string;
  /**
   * Echoed back by the daemon for single-provider responses. With
   * `?surface=cursor` the daemon returns whatever providers Cursor's
   * parser-local attribution recorded — typically just `cursor`, but
   * Copilot-Chat-via-Cursor also lands here.
   */
  provider_scope?: string;
  /**
   * Present on multi-provider responses. Deduplicated, normalized, in
   * input order. Tooltip "Tracking: …" line is rendered from this list.
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
  /**
   * Canonical surface value space advertised by the daemon
   * (siropkin/budi#702, /health.surfaces). v8.4.2 returns
   * `["vscode","cursor","jetbrains","terminal","unknown"]`. Older
   * daemons omit the field; readers must tolerate `undefined`.
   *
   * Read this rather than hardcoding the array — the v1.6.x surface
   * picker UI will iterate it. v1.5.x exposes the field for forward
   * compat; the request itself always sends `?surface=cursor`.
   */
  surfaces?: readonly string[];
}

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

/** The Cursor provider name on the budi-core wire — ADR-0088 §7. */
export const CURSOR_PROVIDER = "cursor";

/**
 * Wire-level surface values this extension may send on analytics
 * requests (siropkin/budi#702). Matches the value space the daemon
 * advertises on `/health.surfaces` for v8.4.2+.
 *
 * The extension runs in both Cursor and VS Code (this VSIX is published
 * to both the VS Code Marketplace and Open VSX — SOUL.md §"Install").
 * The surface is derived at activation from `vscode.env.appName` via
 * `detectSurface` and threaded through every analytics request, so the
 * daemon scopes correctly per host (siropkin/budi-cursor#64).
 */
export type Surface = "cursor" | "vscode" | "unknown";

/**
 * Derive the wire surface from `vscode.env.appName`
 * (siropkin/budi-cursor#64).
 *
 * - `"Cursor"` → `cursor`
 * - `"Visual Studio Code"` / `"Visual Studio Code - Insiders"` /
 *   `"VSCodium"` → `vscode`
 * - anything else → `unknown` (the daemon tolerates unknown surfaces
 *   per siropkin/budi#702 acceptance — readings just bucket into the
 *   `unknown` slot rather than failing the request)
 *
 * Old daemons (pre-#702) silently drop the `?surface=` query param, so
 * sending any value is byte-safe against them.
 */
export function detectSurface(appName: string): Surface {
  if (appName === "Cursor") return "cursor";
  if (
    appName === "Visual Studio Code" ||
    appName === "Visual Studio Code - Insiders" ||
    appName === "VSCodium"
  ) {
    return "vscode";
  }
  return "unknown";
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
        .map((part) => (part.length > 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
        .join(" ");
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

interface ClickUrlOptions {
  cloudEndpoint: string;
  statusline: StatuslineData | null;
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
export function clickUrl({ cloudEndpoint, statusline }: ClickUrlOptions): string {
  const base = cloudEndpoint.replace(/\/+$/, "");
  if (statusline && statusline.active_provider === CURSOR_PROVIDER) {
    return `${base}/dashboard/sessions`;
  }
  return `${base}/dashboard`;
}

/**
 * First line of the tooltip — names the cursor surface and, when the
 * daemon attributes a single non-Cursor sub-provider (e.g.
 * Copilot-Chat-via-Cursor), parenthesizes it. Multiple contributing
 * providers fall through to a surface-only label so the dedicated
 * `Tracking: …` line below carries the detail.
 */
export function buildTooltipHeader(contributing: readonly string[]): string {
  const [only] = contributing;
  if (contributing.length === 1 && only !== undefined && only !== CURSOR_PROVIDER) {
    return `budi — Cursor usage (${formatProviderName(only)})`;
  }
  return "budi — Cursor usage";
}

/**
 * Build a status bar tooltip that names the rolling windows and points
 * the user at `budi doctor` on trouble. With `?surface=cursor` pinned
 * on every analytics request, the tooltip no longer needs a host
 * argument — the surface is, by construction, Cursor.
 */
export function buildTooltip(
  state: HealthState,
  statusline: StatuslineData | null,
  cloudEndpoint: string,
  health: DaemonHealth | null = null,
): string {
  const contributing = statusline?.contributing_providers ?? [];
  const lines: string[] = [buildTooltipHeader(contributing), ""];
  if (state === "firstRun") {
    lines.push("budi is not installed on this machine yet.");
    lines.push("Click to set it up in one step.");
    return lines.join("\n");
  }
  if (state === "unreachable") {
    lines.push("Daemon not reachable.");
    lines.push("Run `budi doctor` to verify.");
    lines.push("");
    lines.push("Click to open the dashboard.");
    return lines.join("\n");
  }
  if (state === "version-stale") {
    // The daemon answered /health but its api_version is older than the
    // wire shape this extension depends on. The tooltip names what is
    // installed, what is required, and the one-line upgrade command so
    // the user can act without grepping docs (siropkin/budi-cursor#51).
    const installedVersion = health?.version ?? "unknown";
    const installedApi = health?.api_version ?? 0;
    lines.push("budi update needed.");
    lines.push(`Installed: ${installedVersion} (api_version ${installedApi}).`);
    lines.push(`Required api_version: ${MIN_API_VERSION}.`);
    lines.push("");
    lines.push("Run `budi update` (or `brew upgrade budi`) and reload the window.");
    return lines.join("\n");
  }
  const costs = resolveCosts(statusline ?? {});
  lines.push(`1d  ${formatCost(costs.cost1d)}`);
  lines.push(`7d  ${formatCost(costs.cost7d)}`);
  lines.push(`30d ${formatCost(costs.cost30d)}`);
  lines.push("");
  if (contributing.length > 1) {
    lines.push(`Tracking: ${contributing.map(formatProviderName).join(", ")}`);
  } else {
    // Preserve the v1.3.x literal (lowercase wire name) on the Cursor surface.
    lines.push("Provider: cursor");
  }
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
 */
export function buildStatusText(state: HealthState, statusline: StatuslineData | null): string {
  if (state === "firstRun") return "budi · setup";
  if (state === "unreachable") return "budi · offline";
  if (state === "version-stale") return "budi · update needed";
  if (state === "gray") return "budi";
  const costs = resolveCosts(statusline ?? {});
  return `budi · ${formatCostLine(costs)}`;
}

/**
 * The default daemon URL — must stay in sync with `package.json`'s
 * `budi.daemonUrl` default and with `SOUL.md`'s "loopback only" pin.
 */
export const DEFAULT_DAEMON_URL = "http://127.0.0.1:7878";

/**
 * Loopback hosts the daemon is allowed to bind on. Anything else is
 * rejected at config-read time so a malicious workspace cannot redirect
 * the polling traffic (siropkin/budi-cursor#42). The IPv6 entry is
 * stored bracketed because that is the form `URL.hostname` returns for
 * IPv6 literals.
 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * True iff `url` is an `http(s)` URL whose hostname is a loopback alias
 * (`127.0.0.1`, `localhost`, or `::1`). The daemon is documented as
 * local-only on `127.0.0.1:7878` (SOUL.md §"Data contract"), so a
 * remote `daemonUrl` is never legitimate — accepting one would let a
 * `.vscode/settings.json` override redirect polling traffic to an
 * attacker (siropkin/budi-cursor#42).
 */
export function isLoopbackDaemonUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return LOOPBACK_HOSTS.has(parsed.hostname);
}

/**
 * The default cloud endpoint — must stay in sync with `package.json`'s
 * `budi.cloudEndpoint` default and with `SOUL.md`'s "cloud lives at
 * app.getbudi.dev" pin.
 */
export const DEFAULT_CLOUD_ENDPOINT = "https://app.getbudi.dev";

/**
 * Apex domain the cloud dashboard is served from. Workspace-scoped
 * `cloudEndpoint` overrides outside this suffix are rejected so a
 * malicious repo cannot redirect the status-bar click to a phishing
 * page (siropkin/budi-cursor#43).
 */
const CLOUD_HOST_ROOT = "getbudi.dev";

/**
 * True iff `url` is an `https` URL on `getbudi.dev` (or any subdomain
 * of it) with no userinfo. The status-bar click hands `${url}/dashboard`
 * to `vscode.env.openExternal`, so a remote/attacker host would be a
 * one-click phishing primitive — same threat model as
 * `isLoopbackDaemonUrl` for #42, but with the cloud allowlist instead
 * of loopback (siropkin/budi-cursor#43). Subdomains are allowed so
 * staging endpoints (e.g. `staging.app.getbudi.dev`) keep working
 * when set as a user-scope override.
 */
export function isAllowedCloudEndpoint(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  // Reject userinfo — `https://attacker@app.getbudi.dev` is harmless on
  // a spec-compliant client (the navigator strips the credential), but
  // some surfaces render the userinfo as a hostname-shaped prefix in
  // confirm dialogs, which is enough rope for a phishing screenshot.
  if (parsed.username !== "" || parsed.password !== "") return false;
  const host = parsed.hostname.toLowerCase();
  return host === CLOUD_HOST_ROOT || host.endsWith(`.${CLOUD_HOST_ROOT}`);
}

/**
 * Hard ceiling on bytes accepted from the daemon per request. The
 * legitimate `/health` and `/analytics/statusline` payloads are well
 * under 1 KB; 64 KB leaves room for forward-compat fields without
 * letting a hostile or buggy server flood the extension host's heap
 * inside the 3 s request window (siropkin/budi-cursor#44). When the
 * cap trips we destroy the socket and resolve `null` — the caller
 * already treats `null` as "daemon unhealthy".
 */
const MAX_RESPONSE_BYTES = 64 * 1024;

/**
 * GET `${daemonUrl}${path}` and parse the response as JSON, with
 * defense-in-depth limits: 3 s timeout, 64 KB body cap, 2xx-only,
 * `application/json` content-type only. Resolves `null` on any
 * failure — the caller folds that into `health = null` / "offline"
 * rendering. Centralizing this also keeps `fetchDaemonHealth` and
 * `fetchStatusline` from drifting (siropkin/budi-cursor#44).
 */
function fetchDaemonJson<T>(url: string): Promise<T | null> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      const status = res.statusCode ?? 0;
      const contentType = (res.headers["content-type"] ?? "").toString().toLowerCase();
      if (status < 200 || status >= 300 || !contentType.includes("application/json")) {
        // Drain quickly so the socket can be reused by keep-alive,
        // then bail. `req.destroy()` would also work but resume() is
        // gentler when the server is well-behaved but mis-typed.
        res.resume();
        resolve(null);
        return;
      }
      const chunks: Buffer[] = [];
      let len = 0;
      res.on("data", (chunk: Buffer) => {
        len += chunk.length;
        if (len > MAX_RESPONSE_BYTES) {
          req.destroy();
          resolve(null);
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
        } catch {
          resolve(null);
        }
      });
      res.on("error", () => resolve(null));
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Check daemon health and return version / api_version / surfaces info.
 * Returns null if the daemon is unreachable.
 */
export function fetchDaemonHealth(daemonUrl: string): Promise<DaemonHealth | null> {
  return fetchDaemonJson<DaemonHealth>(`${daemonUrl}/health`);
}

/**
 * Build the analytics request URL. The surface is derived from the
 * host (`detectSurface(vscode.env.appName)`) at activation and threaded
 * through here so the daemon scopes correctly per host — Cursor reads
 * cursor totals, VS Code reads vscode totals
 * (siropkin/budi-cursor#64). This replaces the v1.5.x hardcoded
 * `?surface=cursor` (siropkin/budi-cursor#55) which rendered cursor
 * totals even when the extension was installed in VS Code.
 *
 * The extension no longer sends the `?provider=cursor,copilot_chat`
 * heuristic that v1.4.x used to approximate IDE scoping on the client
 * side — surface-based scoping (siropkin/budi#702) is the daemon's
 * job, and the wire response is rendered as-is.
 *
 * `project_dir` is optional. When passed it gives the daemon the
 * repo-local context it needs for accurate branch attribution.
 */
export function buildStatuslineUrl(
  daemonUrl: string,
  surface: Surface,
  projectDir?: string,
): string {
  const url = new URL("/analytics/statusline", daemonUrl);
  url.searchParams.set("surface", surface);
  if (projectDir) {
    url.searchParams.set("project_dir", projectDir);
  }
  return url.toString();
}

export function fetchStatusline(
  daemonUrl: string,
  surface: Surface,
  projectDir?: string,
): Promise<StatuslineData | null> {
  return fetchDaemonJson<StatuslineData>(buildStatuslineUrl(daemonUrl, surface, projectDir));
}
