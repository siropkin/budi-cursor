import { describe, expect, it } from "vitest";

import {
  buildStatusText,
  buildTooltip,
  clickUrl,
  CURSOR_PROVIDER,
  deriveHealthState,
  formatCostLine,
  healthIndicator,
  MIN_API_VERSION,
  resolveCosts,
  type DaemonHealth,
  type StatuslineData,
} from "./budiClient";

describe("resolveCosts", () => {
  it("prefers the canonical rolling fields (cost_1d/7d/30d)", () => {
    const data: StatuslineData = {
      cost_1d: 1.23,
      cost_7d: 4.56,
      cost_30d: 7.89,
      today_cost: 99,
      week_cost: 99,
      month_cost: 99,
    };
    const resolved = resolveCosts(data);
    expect(resolved).toEqual({
      cost1d: 1.23,
      cost7d: 4.56,
      cost30d: 7.89,
      usedLegacyAliases: false,
    });
  });

  it("falls back to the 8.0 aliases when the daemon predates #224", () => {
    const data: StatuslineData = {
      today_cost: 2,
      week_cost: 10,
      month_cost: 40,
    };
    const resolved = resolveCosts(data);
    expect(resolved.cost1d).toBe(2);
    expect(resolved.cost7d).toBe(10);
    expect(resolved.cost30d).toBe(40);
    expect(resolved.usedLegacyAliases).toBe(true);
  });

  it("defaults missing fields to 0", () => {
    const resolved = resolveCosts({});
    expect(resolved).toEqual({
      cost1d: 0,
      cost7d: 0,
      cost30d: 0,
      usedLegacyAliases: true,
    });
  });
});

describe("formatCostLine", () => {
  it("renders the Claude Code statusline cost shape byte-for-byte", () => {
    const line = formatCostLine({
      cost1d: 2.34,
      cost7d: 12.5,
      cost30d: 48.1,
      usedLegacyAliases: false,
    });
    expect(line).toBe("$2.34 1d · $12.50 7d · $48.10 30d");
  });

  it("renders zero as $0.00", () => {
    const line = formatCostLine({
      cost1d: 0,
      cost7d: 0,
      cost30d: 0,
      usedLegacyAliases: false,
    });
    expect(line).toBe("$0.00 1d · $0.00 7d · $0.00 30d");
  });

  it("compacts large numbers like the CLI does", () => {
    const line = formatCostLine({
      cost1d: 100,
      cost7d: 999,
      cost30d: 1500,
      usedLegacyAliases: false,
    });
    expect(line).toBe("$100 1d · $999 7d · $1.5K 30d");
  });
});

describe("deriveHealthState", () => {
  const healthyDaemon: DaemonHealth = {
    ok: true,
    version: "8.1.0",
    api_version: MIN_API_VERSION,
  };

  it("returns red when the daemon is unreachable", () => {
    expect(deriveHealthState(null, null)).toBe("red");
  });

  it("returns red when the daemon api_version is too old", () => {
    const old: DaemonHealth = { ok: true, version: "8.0.0", api_version: MIN_API_VERSION - 1 };
    expect(deriveHealthState(old, { cost_1d: 5 })).toBe("red");
  });

  it("returns yellow when the daemon is healthy but no Cursor traffic is recorded", () => {
    expect(deriveHealthState(healthyDaemon, { cost_1d: 0, cost_7d: 0, cost_30d: 0 })).toBe(
      "yellow",
    );
  });

  it("returns green when the daemon reports Cursor traffic in any rolling window", () => {
    expect(deriveHealthState(healthyDaemon, { cost_30d: 1.5 })).toBe("green");
    expect(deriveHealthState(healthyDaemon, { cost_1d: 0.01 })).toBe("green");
  });

  it("returns yellow when the daemon is healthy but the statusline call failed", () => {
    expect(deriveHealthState(healthyDaemon, null)).toBe("yellow");
  });

  it("falls back to legacy aliases for health detection against a pre-#224 daemon", () => {
    expect(deriveHealthState(healthyDaemon, { today_cost: 2 })).toBe("green");
  });
});

describe("buildStatusText", () => {
  it("prefixes the Claude Code cost shape with a green dot when healthy with traffic", () => {
    const text = buildStatusText("green", {
      cost_1d: 1,
      cost_7d: 5,
      cost_30d: 20,
    });
    expect(text).toBe("\u{1F7E2} budi · $1.00 1d · $5.00 7d · $20.00 30d");
  });

  it("shows offline copy when the daemon is unreachable", () => {
    expect(buildStatusText("red", null)).toBe("\u{1F534} budi · offline");
  });

  it("shows a hollow dot during startup", () => {
    expect(buildStatusText("gray", null)).toBe("\u26AA budi");
  });

  it("uses yellow when the daemon is reachable but no Cursor traffic yet", () => {
    const text = buildStatusText("yellow", { cost_1d: 0, cost_7d: 0, cost_30d: 0 });
    expect(text.startsWith("\u{1F7E1} budi · ")).toBe(true);
    expect(text).toContain("$0.00 1d");
  });
});

describe("clickUrl (mirrors Claude Code click-through)", () => {
  it("opens the cloud sessions list when the active provider is cursor", () => {
    const url = clickUrl({
      cloudEndpoint: "https://app.getbudi.dev",
      statusline: { active_provider: CURSOR_PROVIDER, cost_1d: 0.1 },
    });
    expect(url).toBe("https://app.getbudi.dev/dashboard/sessions");
  });

  it("opens the dashboard root when no active cursor session is recorded", () => {
    const url = clickUrl({
      cloudEndpoint: "https://app.getbudi.dev",
      statusline: { active_provider: "claude_code", cost_1d: 0 },
    });
    expect(url).toBe("https://app.getbudi.dev/dashboard");
  });

  it("opens the dashboard root when statusline is unavailable", () => {
    const url = clickUrl({
      cloudEndpoint: "https://app.getbudi.dev",
      statusline: null,
    });
    expect(url).toBe("https://app.getbudi.dev/dashboard");
  });

  it("trims a trailing slash from the configured cloud endpoint", () => {
    const url = clickUrl({
      cloudEndpoint: "https://app.getbudi.dev/",
      statusline: null,
    });
    expect(url).toBe("https://app.getbudi.dev/dashboard");
  });
});

describe("healthIndicator", () => {
  it("maps each state to its brand dot", () => {
    expect(healthIndicator("green")).toBe("\u{1F7E2}");
    expect(healthIndicator("yellow")).toBe("\u{1F7E1}");
    expect(healthIndicator("red")).toBe("\u{1F534}");
    expect(healthIndicator("gray")).toBe("\u26AA");
  });
});

describe("buildTooltip", () => {
  it("reports all three rolling windows and names the provider scope", () => {
    const tip = buildTooltip(
      "green",
      { cost_1d: 1, cost_7d: 5, cost_30d: 20 },
      "https://app.getbudi.dev",
    );
    expect(tip).toContain("1d  $1.00");
    expect(tip).toContain("7d  $5.00");
    expect(tip).toContain("30d $20.00");
    expect(tip).toContain("Provider: cursor");
  });

  it("points the user at `budi doctor` when the daemon is offline", () => {
    const tip = buildTooltip("red", null, "https://app.getbudi.dev");
    expect(tip).toContain("Daemon not reachable");
    expect(tip).toContain("budi doctor");
  });

  it("nudges the user when the daemon is reachable but has no traffic", () => {
    const tip = buildTooltip(
      "yellow",
      { cost_1d: 0, cost_7d: 0, cost_30d: 0 },
      "https://app.getbudi.dev",
    );
    expect(tip).toContain("No recent Cursor traffic");
  });
});

describe("MIN_API_VERSION", () => {
  it("is at least 1", () => {
    expect(MIN_API_VERSION).toBeGreaterThanOrEqual(1);
  });
});
