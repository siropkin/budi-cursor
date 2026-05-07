import { describe, expect, it } from "vitest";

import {
  buildProviderList,
  buildStatusText,
  buildStatuslineUrl,
  buildTooltip,
  buildTooltipHeader,
  clickUrl,
  CURSOR_PROVIDER,
  defaultProviderForHost,
  deriveHealthState,
  detectHost,
  formatCostLine,
  formatHostLabel,
  formatProviderName,
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
  });

  it("defaults missing fields to 0", () => {
    const resolved = resolveCosts({});
    expect(resolved).toEqual({
      cost1d: 0,
      cost7d: 0,
      cost30d: 0,
    });
  });
});

describe("formatCostLine", () => {
  it("renders the Claude Code statusline cost shape byte-for-byte", () => {
    const line = formatCostLine({
      cost1d: 2.34,
      cost7d: 12.5,
      cost30d: 48.1,
    });
    expect(line).toBe("$2.34 1d · $12.50 7d · $48.10 30d");
  });

  it("renders zero as $0.00", () => {
    const line = formatCostLine({
      cost1d: 0,
      cost7d: 0,
      cost30d: 0,
    });
    expect(line).toBe("$0.00 1d · $0.00 7d · $0.00 30d");
  });

  it("compacts large numbers like the CLI does", () => {
    const line = formatCostLine({
      cost1d: 100,
      cost7d: 999,
      cost30d: 1500,
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

  it("returns red when the daemon is unreachable and we've seen it healthy before", () => {
    expect(deriveHealthState(null, null, true)).toBe("red");
  });

  it("returns firstRun when the daemon is unreachable and we've never seen it before (#314)", () => {
    expect(deriveHealthState(null, null, false)).toBe("firstRun");
  });

  it("defaults everSawDaemon to true (preserves pre-#314 behavior for existing callers)", () => {
    expect(deriveHealthState(null, null)).toBe("red");
  });

  it("returns red when the daemon api_version is too old", () => {
    const old: DaemonHealth = { ok: true, version: "8.0.0", api_version: MIN_API_VERSION - 1 };
    expect(deriveHealthState(old, { cost_1d: 5 }, true)).toBe("red");
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

  it("drops firstRun the moment the daemon answers — regardless of everSawDaemon history", () => {
    // A healthy /health promotes us to the normal states; we never
    // linger in firstRun just because globalState is empty.
    expect(deriveHealthState(healthyDaemon, null, false)).toBe("yellow");
  });
});

describe("buildStatusText", () => {
  it("renders the Claude Code cost shape with no leading glyph when healthy with traffic", () => {
    const text = buildStatusText("green", {
      cost_1d: 1,
      cost_7d: 5,
      cost_30d: 20,
    });
    expect(text).toBe("budi · $1.00 1d · $5.00 7d · $20.00 30d");
  });

  it("shows offline copy when the daemon is unreachable", () => {
    expect(buildStatusText("red", null)).toBe("budi · offline");
  });

  it("shows the bare budi label during startup", () => {
    expect(buildStatusText("gray", null)).toBe("budi");
  });

  it("shows a distinctive 'setup' statusline in firstRun mode (#314)", () => {
    expect(buildStatusText("firstRun", null)).toBe("budi · setup");
  });

  it("uses the plain budi prefix when the daemon is reachable but no Cursor traffic yet", () => {
    const text = buildStatusText("yellow", { cost_1d: 0, cost_7d: 0, cost_30d: 0 });
    expect(text.startsWith("budi · ")).toBe(true);
    expect(text).toContain("$0.00 1d");
  });

  it("never emits a leading colored-circle glyph", () => {
    const states = ["green", "yellow", "red", "gray", "firstRun"] as const;
    for (const state of states) {
      expect(buildStatusText(state, null)).not.toMatch(/[\u{1F7E2}\u{1F7E1}\u{1F534}⚪]/u);
    }
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

  it("invites the user to finish setup in firstRun mode (#314)", () => {
    const tip = buildTooltip("firstRun", null, "https://app.getbudi.dev");
    expect(tip).toContain("budi is not installed on this machine yet");
    expect(tip).toContain("Click to set it up in one step");
    // Must not look like an error — first-run is not a failure state.
    expect(tip).not.toContain("Daemon not reachable");
    expect(tip).not.toContain("budi doctor");
  });
});

describe("MIN_API_VERSION", () => {
  it("matches the daemon's current API_VERSION (siropkin/budi-cursor#40)", () => {
    expect(MIN_API_VERSION).toBe(1);
  });
});

describe("detectHost (siropkin/budi-cursor#26)", () => {
  it("maps Cursor's appName to the cursor host", () => {
    expect(detectHost("Cursor")).toBe("cursor");
  });

  it("maps VS Code stable to the vscode host", () => {
    expect(detectHost("Visual Studio Code")).toBe("vscode");
  });

  it("maps VS Code Insiders to the vscode host", () => {
    expect(detectHost("Visual Studio Code - Insiders")).toBe("vscode");
  });

  it("maps VS Code Exploration builds to the vscode host", () => {
    expect(detectHost("Visual Studio Code - Exploration")).toBe("vscode");
  });

  it("maps VSCodium to the vscodium host", () => {
    expect(detectHost("VSCodium")).toBe("vscodium");
  });

  it("maps VSCodium Insiders to the vscodium host", () => {
    expect(detectHost("VSCodium - Insiders")).toBe("vscodium");
  });

  it("falls back to unknown for unrecognized appName values", () => {
    expect(detectHost("Some Future Fork")).toBe("unknown");
    expect(detectHost("")).toBe("unknown");
    expect(detectHost(undefined)).toBe("unknown");
    expect(detectHost(null)).toBe("unknown");
  });
});

describe("buildProviderList (siropkin/budi-cursor#28)", () => {
  it("always returns ['cursor'] on the cursor host, ignoring any probe results", () => {
    expect(buildProviderList("cursor", [])).toEqual(["cursor"]);
    expect(buildProviderList("cursor", ["copilot_chat"])).toEqual(["cursor"]);
    expect(buildProviderList("cursor", ["copilot_chat", "continue"])).toEqual(["cursor"]);
  });

  it("falls back to copilot_chat on a vscode host with no detected providers", () => {
    expect(buildProviderList("vscode", [])).toEqual(["copilot_chat"]);
  });

  it("falls back to copilot_chat on vscodium and unknown hosts when probe is empty", () => {
    expect(buildProviderList("vscodium", [])).toEqual(["copilot_chat"]);
    expect(buildProviderList("unknown", [])).toEqual(["copilot_chat"]);
  });

  it("returns probe results unchanged on a non-cursor host", () => {
    expect(buildProviderList("vscode", ["copilot_chat"])).toEqual(["copilot_chat"]);
    expect(buildProviderList("vscode", ["copilot_chat", "continue"])).toEqual([
      "copilot_chat",
      "continue",
    ]);
  });

  it("passes deferred provider names through (daemon returns zero per #650)", () => {
    expect(buildProviderList("vscode", ["continue", "cline", "roo_code"])).toEqual([
      "continue",
      "cline",
      "roo_code",
    ]);
  });
});

describe("formatProviderName", () => {
  it("renders canonical wire names with their human spellings", () => {
    expect(formatProviderName("cursor")).toBe("Cursor");
    expect(formatProviderName("copilot_chat")).toBe("Copilot Chat");
    expect(formatProviderName("copilot_cli")).toBe("Copilot CLI");
    expect(formatProviderName("claude_code")).toBe("Claude Code");
    expect(formatProviderName("codex")).toBe("Codex");
    expect(formatProviderName("continue")).toBe("Continue");
    expect(formatProviderName("cline")).toBe("Cline");
    expect(formatProviderName("roo_code")).toBe("Roo Code");
  });

  it("title-cases unknown names so deferred providers still render readably", () => {
    expect(formatProviderName("aider")).toBe("Aider");
    expect(formatProviderName("some_future_agent")).toBe("Some Future Agent");
  });
});

describe("buildStatuslineUrl (siropkin/budi-cursor#28)", () => {
  it("encodes a single provider as ?provider=<name> — byte-identical to v1.3.x on the cursor host", () => {
    expect(buildStatuslineUrl("http://127.0.0.1:7878", ["cursor"])).toBe(
      "http://127.0.0.1:7878/analytics/statusline?provider=cursor",
    );
  });

  it("uses the comma-list form for multi-provider requests (axum's Query takes the last value of a repeated key, so repeated form is unsupported)", () => {
    const url = buildStatuslineUrl("http://127.0.0.1:7878", ["copilot_chat", "continue"]);
    // URLSearchParams percent-encodes the comma; the daemon parses both forms
    // identically. Pin the encoded shape so a future URL library swap can't
    // silently switch us to the unsupported repeated form.
    expect(url).toBe("http://127.0.0.1:7878/analytics/statusline?provider=copilot_chat%2Ccontinue");
    expect(url).not.toContain("provider=copilot_chat&provider=continue");
  });

  it("appends project_dir when passed", () => {
    expect(buildStatuslineUrl("http://127.0.0.1:7878", ["cursor"], "/work/budi")).toBe(
      "http://127.0.0.1:7878/analytics/statusline?provider=cursor&project_dir=%2Fwork%2Fbudi",
    );
  });

  it("omits the provider query entirely when the list is empty (daemon defaults to all providers)", () => {
    expect(buildStatuslineUrl("http://127.0.0.1:7878", [])).toBe(
      "http://127.0.0.1:7878/analytics/statusline",
    );
  });
});

describe("buildTooltip with contributing_providers (siropkin/budi-cursor#28)", () => {
  it("renders 'Tracking: ...' when the daemon returns a multi-provider response", () => {
    const tip = buildTooltip(
      "green",
      {
        cost_1d: 1,
        cost_7d: 5,
        cost_30d: 20,
        contributing_providers: ["cursor", "copilot_chat"],
      },
      "https://app.getbudi.dev",
      "vscode",
    );
    expect(tip).toContain("Tracking: Cursor, Copilot Chat");
    expect(tip).not.toContain("Provider: cursor");
  });

  it("keeps the legacy 'Provider: cursor' line on a single-provider response", () => {
    const tip = buildTooltip(
      "green",
      { cost_1d: 1, cost_7d: 5, cost_30d: 20 },
      "https://app.getbudi.dev",
    );
    expect(tip).toContain("Provider: cursor");
    expect(tip).not.toContain("Tracking:");
  });

  it("treats a single-entry contributing_providers list as single-provider (daemon should omit the field, but tolerate it)", () => {
    const tip = buildTooltip(
      "green",
      { cost_1d: 1, cost_7d: 5, cost_30d: 20, contributing_providers: ["cursor"] },
      "https://app.getbudi.dev",
    );
    expect(tip).not.toContain("Tracking:");
  });
});

describe("formatHostLabel + defaultProviderForHost (siropkin/budi-cursor#29)", () => {
  it("renders human-facing host labels for marketplace copy", () => {
    expect(formatHostLabel("cursor")).toBe("Cursor");
    expect(formatHostLabel("vscode")).toBe("VS Code");
    expect(formatHostLabel("vscodium")).toBe("VSCodium");
    expect(formatHostLabel("unknown")).toBe("Editor");
  });

  it("exposes the first-class provider per host", () => {
    expect(defaultProviderForHost("cursor")).toBe("cursor");
    expect(defaultProviderForHost("vscode")).toBe("copilot_chat");
    expect(defaultProviderForHost("vscodium")).toBe("copilot_chat");
    expect(defaultProviderForHost("unknown")).toBe("copilot_chat");
  });
});

describe("buildTooltipHeader (siropkin/budi-cursor#29)", () => {
  it("keeps the v1.3.x literal on the cursor host regardless of providers", () => {
    expect(buildTooltipHeader("cursor", [])).toBe("budi — Cursor usage");
    expect(buildTooltipHeader("cursor", ["cursor"])).toBe("budi — Cursor usage");
    // Even a misconfigured Cursor host with extra providers in the list
    // must not change the header — the request shape is locked to
    // ["cursor"] anyway (#28).
    expect(buildTooltipHeader("cursor", ["cursor", "copilot_chat"])).toBe("budi — Cursor usage");
  });

  it("names the single contributing provider parenthetically on a vscode host", () => {
    expect(buildTooltipHeader("vscode", ["copilot_chat"])).toBe(
      "budi — VS Code usage (Copilot Chat)",
    );
  });

  it("falls back to host-only label when multiple providers are contributing (Tracking line carries the detail)", () => {
    expect(buildTooltipHeader("vscode", ["copilot_chat", "continue"])).toBe("budi — VS Code usage");
  });

  it("renders host-only label when no contributing providers were echoed", () => {
    expect(buildTooltipHeader("vscode", [])).toBe("budi — VS Code usage");
    expect(buildTooltipHeader("vscodium", [])).toBe("budi — VSCodium usage");
    expect(buildTooltipHeader("unknown", [])).toBe("budi — Editor usage");
  });
});

describe("buildTooltip on non-cursor hosts (siropkin/budi-cursor#29)", () => {
  it("renders the host-aware header with single contributing provider", () => {
    const tip = buildTooltip(
      "green",
      {
        cost_1d: 1,
        cost_7d: 5,
        cost_30d: 20,
        contributing_providers: ["copilot_chat"],
      },
      "https://app.getbudi.dev",
      "vscode",
    );
    expect(tip.startsWith("budi — VS Code usage (Copilot Chat)")).toBe(true);
  });

  it("formats the Provider: line with the human provider name on vscode (no orphan 'cursor')", () => {
    const tip = buildTooltip(
      "green",
      { cost_1d: 1, cost_7d: 5, cost_30d: 20, provider_scope: "copilot_chat" },
      "https://app.getbudi.dev",
      "vscode",
    );
    expect(tip).toContain("Provider: Copilot Chat");
    expect(tip).not.toContain("Provider: cursor");
  });

  it("falls back to the host's first-class provider when neither provider_scope nor active_provider is set", () => {
    const tip = buildTooltip(
      "green",
      { cost_1d: 1, cost_7d: 5, cost_30d: 20 },
      "https://app.getbudi.dev",
      "vscode",
    );
    expect(tip).toContain("Provider: Copilot Chat");
  });

  it("rewords the no-traffic nudge for non-cursor hosts", () => {
    const single = buildTooltip(
      "yellow",
      {
        cost_1d: 0,
        cost_7d: 0,
        cost_30d: 0,
        contributing_providers: ["copilot_chat"],
      },
      "https://app.getbudi.dev",
      "vscode",
    );
    expect(single).toContain("No recent Copilot Chat traffic in the last 24h.");
    expect(single).not.toContain("No recent Cursor traffic");

    const multi = buildTooltip(
      "yellow",
      {
        cost_1d: 0,
        cost_7d: 0,
        cost_30d: 0,
        contributing_providers: ["copilot_chat", "continue"],
      },
      "https://app.getbudi.dev",
      "vscode",
    );
    expect(multi).toContain("No recent VS Code AI traffic in the last 24h.");
  });
});

describe("host plumbing (regression: cursor host output is byte-for-byte unchanged)", () => {
  // Acceptance criterion from siropkin/budi-cursor#26: threading the
  // host enum through the builders must not change a single byte of
  // the output a Cursor user sees today. Host-aware copy variants
  // land in #29.
  it("buildStatusText('green', …, 'cursor') matches the no-host call", () => {
    const data = { cost_1d: 1, cost_7d: 5, cost_30d: 20 };
    expect(buildStatusText("green", data, "cursor")).toBe(buildStatusText("green", data));
    expect(buildStatusText("green", data, "cursor")).toBe(
      "budi · $1.00 1d · $5.00 7d · $20.00 30d",
    );
  });

  it("buildStatusText renders the same shape on a vscode host (no fake offline)", () => {
    // VS Code host + zero traffic must still render the cost shape, not
    // an "offline" string — that's what makes the v1.4 install useful
    // for VS Code users without Cursor data.
    const text = buildStatusText("yellow", { cost_1d: 0, cost_7d: 0, cost_30d: 0 }, "vscode");
    expect(text).toBe("budi · $0.00 1d · $0.00 7d · $0.00 30d");
  });

  it("buildStatusText('firstRun', …) shows setup on every host", () => {
    for (const h of ["cursor", "vscode", "vscodium", "unknown"] as const) {
      expect(buildStatusText("firstRun", null, h)).toBe("budi · setup");
    }
  });

  it("buildTooltip on cursor host matches the no-host call", () => {
    const data = { cost_1d: 1, cost_7d: 5, cost_30d: 20 };
    expect(buildTooltip("green", data, "https://app.getbudi.dev", "cursor")).toBe(
      buildTooltip("green", data, "https://app.getbudi.dev"),
    );
  });

  it("clickUrl on cursor host matches the no-host call", () => {
    const opts = {
      cloudEndpoint: "https://app.getbudi.dev",
      statusline: { active_provider: CURSOR_PROVIDER, cost_1d: 0.1 },
    };
    expect(clickUrl({ ...opts, host: "cursor" })).toBe(clickUrl(opts));
  });
});
