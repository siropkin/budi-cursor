import * as http from "http";
import type { AddressInfo } from "net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildStatusText,
  buildStatuslineUrl,
  buildTooltip,
  buildTooltipHeader,
  clickUrl,
  CURSOR_PROVIDER,
  DEFAULT_CLOUD_ENDPOINT,
  DEFAULT_DAEMON_URL,
  deriveHealthState,
  detectSurface,
  fetchDaemonHealth,
  fetchStatusline,
  formatCostLine,
  formatProviderName,
  isAllowedCloudEndpoint,
  isLoopbackDaemonUrl,
  MIN_API_VERSION,
  resolveCosts,
  shouldShowVersionStaleToast,
  versionStaleSignature,
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
    version: "8.4.2",
    api_version: MIN_API_VERSION,
  };

  it("returns unreachable when the daemon is unreachable and we've seen it healthy before (siropkin/budi-cursor#51)", () => {
    expect(deriveHealthState(null, null, true)).toBe("unreachable");
  });

  it("returns firstRun when the daemon is unreachable and we've never seen it before (#314)", () => {
    expect(deriveHealthState(null, null, false)).toBe("firstRun");
  });

  it("defaults everSawDaemon to true (preserves pre-#314 behavior for existing callers)", () => {
    expect(deriveHealthState(null, null)).toBe("unreachable");
  });

  it("returns version-stale when the daemon api_version is too old (siropkin/budi-cursor#51)", () => {
    const old: DaemonHealth = { ok: true, version: "8.4.1", api_version: MIN_API_VERSION - 1 };
    expect(deriveHealthState(old, { cost_1d: 5 }, true)).toBe("version-stale");
  });

  it("returns version-stale against an 8.4.1 daemon (api_version=1) — graceful-degrade contract for siropkin/budi-cursor#55", () => {
    const eightFourOne: DaemonHealth = { ok: true, version: "8.4.1", api_version: 1 };
    expect(deriveHealthState(eightFourOne, { cost_1d: 5 }, true)).toBe("version-stale");
  });

  it("continues past the gate against an 8.4.2 daemon (api_version=3) — siropkin/budi-cursor#55", () => {
    const eightFourTwo: DaemonHealth = { ok: true, version: "8.4.2", api_version: 3 };
    expect(deriveHealthState(eightFourTwo, { cost_1d: 5 }, true)).toBe("green");
    expect(deriveHealthState(eightFourTwo, { cost_1d: 0, cost_7d: 0, cost_30d: 0 }, true)).toBe(
      "yellow",
    );
  });

  it("distinguishes version-stale from unreachable — they are different actions for the user", () => {
    // unreachable = "start the daemon"; version-stale = "upgrade the daemon".
    // The split is the whole reason siropkin/budi-cursor#51 exists.
    const stale: DaemonHealth = {
      ok: true,
      version: "8.4.1",
      api_version: MIN_API_VERSION - 1,
    };
    expect(deriveHealthState(null, null, true)).not.toBe(deriveHealthState(stale, null, true));
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

describe("MIN_API_VERSION", () => {
  it("matches the daemon's API_VERSION advertised by 8.4.2 (siropkin/budi#714, siropkin/budi-cursor#55)", () => {
    expect(MIN_API_VERSION).toBe(3);
  });
});

describe("versionStaleSignature / shouldShowVersionStaleToast (siropkin/budi-cursor#79)", () => {
  const stale: DaemonHealth = { ok: true, version: "8.4.1", api_version: 1 };

  it("encodes both version and api_version so different stale daemons get distinct signatures", () => {
    expect(versionStaleSignature({ ok: true, version: "8.4.0", api_version: 1 })).toBe("8.4.0|1");
    expect(versionStaleSignature(stale)).toBe("8.4.1|1");
    expect(versionStaleSignature({ ok: true, version: "8.4.1", api_version: 2 })).toBe("8.4.1|2");
  });

  it("fires the toast the first time we see a stale daemon on this install", () => {
    expect(shouldShowVersionStaleToast(stale, undefined)).toBe(true);
  });

  it("suppresses the toast on the next reload when the same stale daemon is re-detected — the once-per-install contract", () => {
    const signature = versionStaleSignature(stale);
    expect(shouldShowVersionStaleToast(stale, signature)).toBe(false);
  });

  it("re-fires the toast when the user upgrades from one stale daemon to another (e.g. 8.4.0 → 8.4.1, both api_version=1)", () => {
    const previous = versionStaleSignature({ ok: true, version: "8.4.0", api_version: 1 });
    expect(shouldShowVersionStaleToast(stale, previous)).toBe(true);
  });

  it("re-fires the toast when the daemon's api_version moves but is still below MIN_API_VERSION", () => {
    const previous = versionStaleSignature({ ok: true, version: "8.4.1", api_version: 1 });
    const stillStale: DaemonHealth = { ok: true, version: "8.4.1", api_version: 2 };
    expect(shouldShowVersionStaleToast(stillStale, previous)).toBe(true);
  });
});

describe("daemon-too-old regression (siropkin/budi-cursor#79) — end-to-end version-stale path", () => {
  let server: http.Server;
  let baseUrl: string;
  let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

  beforeEach(async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    };
    server = http.createServer((req, res) => handler(req, res));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("an 8.4.1 daemon (api_version=1) is fetched, classified version-stale, rendered as 'budi · update needed', and tooltip + toast-decision all point at `budi update`", async () => {
    handler = (req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url === "/health") {
        res.end(JSON.stringify({ ok: true, version: "8.4.1", api_version: 1 }));
        return;
      }
      // The polling loop keeps calling /analytics/statusline even when
      // the daemon is too old (siropkin/budi-cursor#79 acceptance #3 —
      // "don't crash, don't go silent"). The daemon answers normally;
      // the extension's gate is the only thing that suppresses the
      // render.
      res.end(JSON.stringify({ cost_1d: 1.23, cost_7d: 4.56, cost_30d: 7.89 }));
    };

    const health = await fetchDaemonHealth(baseUrl);
    expect(health).toEqual({ ok: true, version: "8.4.1", api_version: 1 });

    const statusline = await fetchStatusline(baseUrl, "cursor");
    expect(statusline).not.toBeNull();

    const state = deriveHealthState(health, statusline, true);
    expect(state).toBe("version-stale");

    expect(buildStatusText(state, statusline)).toBe("budi · update needed");

    const tip = buildTooltip(state, statusline, "https://app.getbudi.dev", health);
    expect(tip).toContain("budi update needed");
    expect(tip).toContain("8.4.1");
    expect(tip).toContain("api_version 1");
    expect(tip).toContain(`Required api_version: ${MIN_API_VERSION}`);
    expect(tip).toContain("budi update");

    expect(shouldShowVersionStaleToast(health!, undefined)).toBe(true);
    expect(shouldShowVersionStaleToast(health!, versionStaleSignature(health!))).toBe(false);
  });

  it("a stale daemon never trips the unreachable path — the extension can tell 'too old' apart from 'down', and the polling loop keeps fetching the (ignored) statusline", async () => {
    let statuslineCalls = 0;
    handler = (req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url === "/health") {
        res.end(JSON.stringify({ ok: true, version: "8.4.0", api_version: 1 }));
        return;
      }
      statuslineCalls += 1;
      res.end(JSON.stringify({ cost_1d: 0, cost_7d: 0, cost_30d: 0 }));
    };

    for (let i = 0; i < 3; i++) {
      const health = await fetchDaemonHealth(baseUrl);
      const statusline = await fetchStatusline(baseUrl, "cursor");
      const state = deriveHealthState(health, statusline, true);
      expect(state).toBe("version-stale");
      expect(state).not.toBe("unreachable");
    }
    expect(statuslineCalls).toBe(3);
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

describe("detectSurface (siropkin/budi-cursor#64)", () => {
  it("maps the Cursor host appName to surface=cursor", () => {
    expect(detectSurface("Cursor")).toBe("cursor");
  });

  it("maps every VS Code host variant to surface=vscode", () => {
    expect(detectSurface("Visual Studio Code")).toBe("vscode");
    expect(detectSurface("Visual Studio Code - Insiders")).toBe("vscode");
    expect(detectSurface("VSCodium")).toBe("vscode");
  });

  it("falls back to surface=unknown for unrecognized hosts — the daemon's /health.surfaces includes `unknown` so the request stays well-formed", () => {
    expect(detectSurface("")).toBe("unknown");
    expect(detectSurface("Windsurf")).toBe("unknown");
    expect(detectSurface("Some Future Fork")).toBe("unknown");
  });

  it("is case-sensitive — matches the exact appName values VS Code/Cursor advertise", () => {
    // `vscode.env.appName` is a fixed byte-stable string per host, not a
    // user-localized label, so we match exactly. A lowercase miss should
    // bucket to `unknown` rather than silently aliasing.
    expect(detectSurface("cursor")).toBe("unknown");
    expect(detectSurface("visual studio code")).toBe("unknown");
  });
});

describe("buildStatuslineUrl (siropkin/budi-cursor#64)", () => {
  it("sends ?surface=cursor when called with the cursor surface", () => {
    expect(buildStatuslineUrl("http://127.0.0.1:7878", "cursor")).toBe(
      "http://127.0.0.1:7878/analytics/statusline?surface=cursor",
    );
  });

  it("sends ?surface=vscode when called with the vscode surface — fixes the v1.5.x cursor-only bug (#64)", () => {
    expect(buildStatuslineUrl("http://127.0.0.1:7878", "vscode")).toBe(
      "http://127.0.0.1:7878/analytics/statusline?surface=vscode",
    );
  });

  it("sends ?surface=unknown when the host cannot be classified — daemon tolerates the value per siropkin/budi#702 acceptance", () => {
    expect(buildStatuslineUrl("http://127.0.0.1:7878", "unknown")).toBe(
      "http://127.0.0.1:7878/analytics/statusline?surface=unknown",
    );
  });

  it("appends project_dir after the surface filter when passed", () => {
    expect(buildStatuslineUrl("http://127.0.0.1:7878", "cursor", "/work/budi")).toBe(
      "http://127.0.0.1:7878/analytics/statusline?surface=cursor&project_dir=%2Fwork%2Fbudi",
    );
    expect(buildStatuslineUrl("http://127.0.0.1:7878", "vscode", "/work/budi")).toBe(
      "http://127.0.0.1:7878/analytics/statusline?surface=vscode&project_dir=%2Fwork%2Fbudi",
    );
  });

  it("does NOT send ?provider= — the v1.4.x host-side workaround that filtered on `provider IN (cursor, copilot_chat)` is removed (siropkin/budi-cursor#55)", () => {
    const url = buildStatuslineUrl("http://127.0.0.1:7878", "cursor", "/work/budi");
    expect(url).not.toContain("provider=");
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

describe("isLoopbackDaemonUrl (siropkin/budi-cursor#42)", () => {
  it("accepts the documented default", () => {
    expect(isLoopbackDaemonUrl(DEFAULT_DAEMON_URL)).toBe(true);
  });

  it("accepts every loopback alias on http and https", () => {
    const accepted = [
      "http://127.0.0.1:7878",
      "http://127.0.0.1",
      "http://localhost:7878",
      "http://localhost",
      "http://[::1]:7878",
      "http://[::1]",
      "https://127.0.0.1:7878",
      "https://localhost:9000",
    ];
    for (const url of accepted) {
      expect(isLoopbackDaemonUrl(url), url).toBe(true);
    }
  });

  it("preserves an explicit path so future endpoints still parse", () => {
    expect(isLoopbackDaemonUrl("http://127.0.0.1:7878/budi/")).toBe(true);
  });

  it("rejects remote hosts that would exfiltrate the workspace path", () => {
    const rejected = [
      "http://attacker.example.com:7878",
      "http://attacker.example.com",
      "https://evil.test/health",
      "http://10.0.0.5:7878",
      "http://192.168.1.5:7878",
      "http://127.0.0.1.attacker.example.com:7878",
      "http://localhost.attacker.example.com:7878",
      // Userinfo trick: hostname is `attacker.example.com`, not `127.0.0.1`.
      "http://127.0.0.1@attacker.example.com:7878",
    ];
    for (const url of rejected) {
      expect(isLoopbackDaemonUrl(url), url).toBe(false);
    }
  });

  it("rejects non-http(s) schemes", () => {
    expect(isLoopbackDaemonUrl("file:///etc/passwd")).toBe(false);
    expect(isLoopbackDaemonUrl("ftp://127.0.0.1")).toBe(false);
    expect(isLoopbackDaemonUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects unparseable input", () => {
    expect(isLoopbackDaemonUrl("")).toBe(false);
    expect(isLoopbackDaemonUrl("not a url")).toBe(false);
    expect(isLoopbackDaemonUrl("127.0.0.1:7878")).toBe(false);
  });
});

describe("isAllowedCloudEndpoint (siropkin/budi-cursor#43)", () => {
  it("accepts the documented default", () => {
    expect(isAllowedCloudEndpoint(DEFAULT_CLOUD_ENDPOINT)).toBe(true);
  });

  it("accepts the apex and known subdomains", () => {
    const accepted = [
      "https://getbudi.dev",
      "https://app.getbudi.dev",
      "https://app.getbudi.dev/",
      "https://staging.app.getbudi.dev",
      "https://staging.getbudi.dev/dashboard",
      "https://APP.GETBUDI.DEV",
    ];
    for (const url of accepted) {
      expect(isAllowedCloudEndpoint(url), url).toBe(true);
    }
  });

  it("rejects look-alike phishing hosts", () => {
    const rejected = [
      // Suffix-extension trick from the issue's reproduction.
      "https://app.getbudi.dev.attacker.example",
      "https://app.getbudi.dev.attacker.example/dashboard",
      // Bare lookalike domains.
      "https://getbudi.dev.attacker.example",
      "https://getbudidev.example",
      // Wrong apex.
      "https://app.getbudi.com",
      "https://app.budi.dev",
      // Userinfo trick: hostname is `app.getbudi.dev`, but a render that
      // shows the full URL leaks `attacker.example` to the user.
      "https://attacker.example@app.getbudi.dev",
      // Substring match attempt.
      "https://notgetbudi.dev",
    ];
    for (const url of rejected) {
      expect(isAllowedCloudEndpoint(url), url).toBe(false);
    }
  });

  it("rejects non-https schemes", () => {
    expect(isAllowedCloudEndpoint("http://app.getbudi.dev")).toBe(false);
    expect(isAllowedCloudEndpoint("file:///etc/passwd")).toBe(false);
    expect(isAllowedCloudEndpoint("javascript:alert(1)")).toBe(false);
    expect(isAllowedCloudEndpoint("ftp://app.getbudi.dev")).toBe(false);
  });

  it("rejects unparseable input", () => {
    expect(isAllowedCloudEndpoint("")).toBe(false);
    expect(isAllowedCloudEndpoint("not a url")).toBe(false);
    expect(isAllowedCloudEndpoint("app.getbudi.dev")).toBe(false);
  });
});

describe("fetchDaemonJson defenses (#44)", () => {
  let server: http.Server;
  let baseUrl: string;
  let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

  beforeEach(async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    };
    server = http.createServer((req, res) => handler(req, res));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("parses a small valid JSON health payload, including the v8.4.2 surfaces array", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          version: "8.4.2",
          api_version: 3,
          surfaces: ["vscode", "cursor", "jetbrains", "terminal", "unknown"],
        }),
      );
    };
    const health = await fetchDaemonHealth(baseUrl);
    expect(health).toEqual({
      ok: true,
      version: "8.4.2",
      api_version: 3,
      surfaces: ["vscode", "cursor", "jetbrains", "terminal", "unknown"],
    });
  });

  it("tolerates pre-8.4.2 daemons that omit /health.surfaces", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, version: "8.4.1", api_version: 1 }));
    };
    const health = await fetchDaemonHealth(baseUrl);
    expect(health).toEqual({ ok: true, version: "8.4.1", api_version: 1 });
    expect(health?.surfaces).toBeUndefined();
  });

  it("returns null when the response exceeds the 64 KB cap", async () => {
    // Stream past the cap, then never end inside the timeout window.
    // The cap fires on the first chunk that pushes len over MAX, so we
    // send 96 KB in a single write.
    handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.write(`{"x":"${"A".repeat(96 * 1024)}`);
      // Intentionally do not call res.end() — let the client close.
    };
    const result = await fetchDaemonHealth(baseUrl);
    expect(result).toBeNull();
  });

  it("returns null on non-2xx responses even when the body is JSON", async () => {
    handler = (_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
    };
    const result = await fetchDaemonHealth(baseUrl);
    expect(result).toBeNull();
  });

  it("returns null when content-type is not application/json", async () => {
    handler = (_req, res) => {
      // Valid JSON bytes but mistyped — refuse to parse so a misconfigured
      // proxy or attacker-controlled HTML page can't be JSON-coerced.
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(JSON.stringify({ ok: true, version: "x", api_version: 1 }));
    };
    const result = await fetchDaemonHealth(baseUrl);
    expect(result).toBeNull();
  });

  it("returns null on malformed JSON inside an otherwise-valid response", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{ not json");
    };
    const result = await fetchDaemonHealth(baseUrl);
    expect(result).toBeNull();
  });

  it("applies the same defenses to fetchStatusline", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.write(`{"cost_1d":1,"x":"${"B".repeat(96 * 1024)}`);
    };
    const result = await fetchStatusline(baseUrl, "cursor");
    expect(result).toBeNull();
  });

  it("fetchStatusline forwards the cursor surface on the wire", async () => {
    let receivedUrl: string | undefined;
    handler = (req, res) => {
      receivedUrl = req.url;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ cost_1d: 0, cost_7d: 0, cost_30d: 0 }));
    };
    await fetchStatusline(baseUrl, "cursor");
    expect(receivedUrl).toBe("/analytics/statusline?surface=cursor");
  });

  it("fetchStatusline forwards the vscode surface on the wire — VS Code host reads vscode totals, not cursor totals (#64)", async () => {
    let receivedUrl: string | undefined;
    handler = (req, res) => {
      receivedUrl = req.url;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ cost_1d: 0, cost_7d: 0, cost_30d: 0 }));
    };
    await fetchStatusline(baseUrl, "vscode");
    expect(receivedUrl).toBe("/analytics/statusline?surface=vscode");
  });
});
