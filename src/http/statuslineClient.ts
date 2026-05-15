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
