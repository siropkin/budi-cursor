import { MIN_API_VERSION, resolveCosts, type HealthState } from "../health/healthState";
import { CURSOR_PROVIDER, type DaemonHealth, type StatuslineData } from "../http/statuslineClient";
import { formatCost } from "./statusText";

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
