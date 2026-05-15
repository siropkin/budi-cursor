import { describe, expect, it } from "vitest";

import { buildStatusText, formatCostLine } from "./statusText";

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
    expect(buildStatusText("unreachable", null)).toBe("budi · offline");
  });

  it("shows 'update needed' copy when the daemon is reachable but version-stale (siropkin/budi-cursor#51)", () => {
    expect(buildStatusText("version-stale", null)).toBe("budi · update needed");
  });

  it("the version-stale copy is distinct from the offline copy — that's the whole point of the split", () => {
    expect(buildStatusText("unreachable", null)).not.toBe(buildStatusText("version-stale", null));
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
    const states = ["green", "yellow", "unreachable", "version-stale", "gray", "firstRun"] as const;
    for (const state of states) {
      expect(buildStatusText(state, null)).not.toMatch(/[\u{1F7E2}\u{1F7E1}\u{1F534}⚪]/u);
    }
  });
});
