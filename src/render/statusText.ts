import type { HealthState, ResolvedCosts } from "../health/healthState";
import { resolveCosts } from "../health/healthState";
import type { StatuslineData } from "../http/statuslineClient";

export function formatCost(dollars: number): string {
  if (!Number.isFinite(dollars) || dollars < 0) return "$0.00";
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(1)}K`;
  if (dollars >= 100) return `$${Math.round(dollars)}`;
  if (dollars > 0) return `$${dollars.toFixed(2)}`;
  return "$0.00";
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
