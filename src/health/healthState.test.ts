import { describe, expect, it } from "vitest";

import type { DaemonHealth, StatuslineData } from "../http/statuslineClient";
import {
  deriveHealthState,
  MIN_API_VERSION,
  resolveCosts,
  shouldShowVersionStaleToast,
  versionStaleSignature,
} from "./healthState";

describe("resolveCosts", () => {
  it("reads the canonical rolling fields (cost_1d/7d/30d)", () => {
    const data: StatuslineData = {
      cost_1d: 1.23,
      cost_7d: 4.56,
      cost_30d: 7.89,
    };
    const resolved = resolveCosts(data);
    expect(resolved).toEqual({
      cost1d: 1.23,
      cost7d: 4.56,
      cost30d: 7.89,
    });
  });

  it("defaults missing fields to 0", () => {
    const resolved = resolveCosts({});
    expect(resolved).toEqual({
      cost1d: 0,
      cost7d: 0,
      cost30d: 0,
    });
  });

  it("defaults non-finite values to 0", () => {
    const resolved = resolveCosts({
      cost_1d: Number.NaN,
      cost_7d: Number.POSITIVE_INFINITY,
      cost_30d: 5,
    });
    expect(resolved).toEqual({
      cost1d: 0,
      cost7d: 0,
      cost30d: 5,
    });
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

  it("drops firstRun the moment the daemon answers — regardless of everSawDaemon history", () => {
    // A healthy /health promotes us to the normal states; we never
    // linger in firstRun just because globalState is empty.
    expect(deriveHealthState(healthyDaemon, null, false)).toBe("yellow");
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
