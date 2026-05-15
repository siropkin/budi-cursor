import { describe, expect, it } from "vitest";

import { MIN_API_VERSION } from "../health/healthState";
import { buildTooltip, buildTooltipHeader, formatProviderName } from "./tooltip";

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

  it("points the user at `budi doctor` when the daemon is unreachable", () => {
    const tip = buildTooltip("unreachable", null, "https://app.getbudi.dev");
    expect(tip).toContain("Daemon not reachable");
    expect(tip).toContain("budi doctor");
  });

  it("names the installed daemon, the required api_version, and the upgrade command when version-stale (siropkin/budi-cursor#51)", () => {
    const tip = buildTooltip("version-stale", null, "https://app.getbudi.dev", {
      ok: true,
      version: "8.4.1",
      api_version: 1,
    });
    expect(tip).toContain("budi update needed");
    expect(tip).toContain("8.4.1");
    expect(tip).toContain("api_version 1");
    expect(tip).toContain(`Required api_version: ${MIN_API_VERSION}`);
    expect(tip).toContain("budi update");
    // Must not look like the unreachable copy — the action is different.
    expect(tip).not.toContain("Daemon not reachable");
  });

  it("renders a sensible version-stale tooltip even if no DaemonHealth was passed", () => {
    // Defensive path — callers in older test fixtures may omit the health
    // arg. The tooltip should still render copy, just without the version
    // detail.
    const tip = buildTooltip("version-stale", null, "https://app.getbudi.dev");
    expect(tip).toContain("budi update needed");
    expect(tip).toContain(`Required api_version: ${MIN_API_VERSION}`);
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

describe("buildTooltipHeader", () => {
  it("uses the canonical Cursor-usage header when no contributing providers are echoed", () => {
    expect(buildTooltipHeader([])).toBe("budi — Cursor usage");
  });

  it("keeps the canonical header when the daemon echoes only `cursor`", () => {
    expect(buildTooltipHeader(["cursor"])).toBe("budi — Cursor usage");
  });

  it("parenthesizes a single non-cursor sub-attribution (e.g. Copilot-Chat-via-Cursor)", () => {
    expect(buildTooltipHeader(["copilot_chat"])).toBe("budi — Cursor usage (Copilot Chat)");
  });

  it("falls back to the surface-only header when multiple providers are contributing — Tracking line carries the detail", () => {
    expect(buildTooltipHeader(["cursor", "copilot_chat"])).toBe("budi — Cursor usage");
  });
});

describe("buildTooltip with contributing_providers", () => {
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
    );
    expect(tip).toContain("Tracking: Cursor, Copilot Chat");
    expect(tip).not.toContain("Provider: cursor");
  });

  it("keeps the 'Provider: cursor' line on a single-provider response", () => {
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
