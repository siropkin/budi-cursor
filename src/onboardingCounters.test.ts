import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  COUNTERS_VERSION,
  DEFAULT_COUNTERS_FILE,
  readCounters,
  recordCounterEvent,
} from "./onboardingCounters";

let tmpDir: string;
let tmpFile: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "budi-onboarding-test-"));
  tmpFile = path.join(tmpDir, "cursor-onboarding.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("onboardingCounters contract", () => {
  it("pins counter-file version to 1 (v1 contract, siropkin/budi#314)", () => {
    expect(COUNTERS_VERSION).toBe(1);
  });

  it("writes to ~/.local/share/budi/cursor-onboarding.json by default", () => {
    expect(DEFAULT_COUNTERS_FILE).toBe(
      path.join(os.homedir(), ".local", "share", "budi", "cursor-onboarding.json"),
    );
  });
});

describe("readCounters", () => {
  it("returns empty zeros when the file does not exist (no crash)", () => {
    const counters = readCounters(tmpFile);
    expect(counters).toEqual({
      version: 1,
      welcome_view_impressions: 0,
      open_terminal_clicks: 0,
      handoffs_completed: 0,
      first_impression_at: null,
      last_impression_at: null,
      last_handoff_at: null,
    });
  });

  it("ignores malformed JSON and returns zeros", () => {
    fs.writeFileSync(tmpFile, "{not json");
    expect(readCounters(tmpFile).welcome_view_impressions).toBe(0);
  });

  it("sanitises negative and non-numeric counter values to 0", () => {
    fs.writeFileSync(
      tmpFile,
      JSON.stringify({
        version: 1,
        welcome_view_impressions: -5,
        open_terminal_clicks: "bogus",
        handoffs_completed: 3.7,
      }),
    );
    const counters = readCounters(tmpFile);
    expect(counters.welcome_view_impressions).toBe(0);
    expect(counters.open_terminal_clicks).toBe(0);
    expect(counters.handoffs_completed).toBe(3);
  });
});

describe("recordCounterEvent", () => {
  it("increments welcome_view_impressions and stamps first/last impression ISO", () => {
    const first = new Date("2026-04-17T10:00:00.000Z");
    const second = new Date("2026-04-17T10:05:00.000Z");

    const after1 = recordCounterEvent("welcome_view_impression", tmpFile, first);
    expect(after1.welcome_view_impressions).toBe(1);
    expect(after1.first_impression_at).toBe(first.toISOString());
    expect(after1.last_impression_at).toBe(first.toISOString());

    const after2 = recordCounterEvent("welcome_view_impression", tmpFile, second);
    expect(after2.welcome_view_impressions).toBe(2);
    // first_impression_at must NOT shift once it's been recorded.
    expect(after2.first_impression_at).toBe(first.toISOString());
    expect(after2.last_impression_at).toBe(second.toISOString());
  });

  it("increments open_terminal_clicks without touching impression timestamps", () => {
    recordCounterEvent("welcome_view_impression", tmpFile, new Date("2026-04-17T10:00:00.000Z"));
    const after = recordCounterEvent(
      "open_terminal_click",
      tmpFile,
      new Date("2026-04-17T10:05:00.000Z"),
    );
    expect(after.open_terminal_clicks).toBe(1);
    expect(after.last_impression_at).toBe("2026-04-17T10:00:00.000Z");
    expect(after.last_handoff_at).toBe(null);
  });

  it("increments handoffs_completed and stamps last_handoff_at", () => {
    const when = new Date("2026-04-17T10:10:00.000Z");
    const after = recordCounterEvent("handoff_completed", tmpFile, when);
    expect(after.handoffs_completed).toBe(1);
    expect(after.last_handoff_at).toBe(when.toISOString());
  });

  it("persists counters to disk so `budi doctor` can read them", () => {
    recordCounterEvent("welcome_view_impression", tmpFile, new Date("2026-04-17T10:00:00Z"));
    recordCounterEvent("open_terminal_click", tmpFile, new Date("2026-04-17T10:01:00Z"));
    recordCounterEvent("handoff_completed", tmpFile, new Date("2026-04-17T10:02:00Z"));
    const raw = JSON.parse(fs.readFileSync(tmpFile, "utf-8"));
    expect(raw.version).toBe(1);
    expect(raw.welcome_view_impressions).toBe(1);
    expect(raw.open_terminal_clicks).toBe(1);
    expect(raw.handoffs_completed).toBe(1);
  });
});
