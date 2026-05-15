import * as http from "http";
import type { AddressInfo } from "net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  deriveHealthState,
  MIN_API_VERSION,
  shouldShowVersionStaleToast,
  versionStaleSignature,
} from "../health/healthState";
import { buildStatusText } from "../render/statusText";
import { buildTooltip } from "../render/tooltip";
import {
  buildStatuslineUrl,
  detectSurface,
  fetchDaemonHealth,
  fetchStatusline,
} from "./statuslineClient";

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
