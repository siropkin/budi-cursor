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
