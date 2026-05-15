import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearActiveWorkspace,
  CONTRACT_VERSION,
  DEFAULT_SESSION_FILE,
  writeActiveWorkspace,
} from "./sessionStore";

let tmpDir: string;
let sessionFile: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "budi-session-test-"));
  sessionFile = path.join(tmpDir, "cursor-sessions.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("sessionStore contract", () => {
  it("pins contract version to 1 (v1, ADR-0086 §3.4)", () => {
    expect(CONTRACT_VERSION).toBe(1);
  });

  it("defaults to ~/.local/share/budi/cursor-sessions.json", () => {
    expect(DEFAULT_SESSION_FILE).toBe(
      path.join(os.homedir(), ".local", "share", "budi", "cursor-sessions.json"),
    );
  });
});

describe("writeActiveWorkspace", () => {
  it("writes a v1-shaped file with the resolved workspace", () => {
    writeActiveWorkspace("/some/workspace", sessionFile);

    const parsed = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
    expect(parsed.version).toBe(1);
    expect(parsed.active_workspace).toBe(path.resolve("/some/workspace"));
    expect(typeof parsed.updated_at).toBe("string");
    expect(() => new Date(parsed.updated_at).toISOString()).not.toThrow();
  });

  it("creates a missing parent directory", () => {
    const nested = path.join(tmpDir, "a", "b", "c", "cursor-sessions.json");
    writeActiveWorkspace("/ws", nested);

    expect(fs.existsSync(nested)).toBe(true);
  });

  it("is idempotent — repeated writes leave one file with the latest workspace", () => {
    writeActiveWorkspace("/first", sessionFile);
    writeActiveWorkspace("/second", sessionFile);
    writeActiveWorkspace("/third", sessionFile);

    const parsed = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
    expect(parsed.active_workspace).toBe(path.resolve("/third"));
    expect(fs.readdirSync(tmpDir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("write is atomic — no half-written JSON if the rename target is in place", () => {
    writeActiveWorkspace("/ws-1", sessionFile);
    // Simulate a follow-up write; the file on disk must always parse as JSON.
    for (let i = 0; i < 5; i++) {
      writeActiveWorkspace(`/ws-${i}`, sessionFile);
      const contents = fs.readFileSync(sessionFile, "utf8");
      expect(() => JSON.parse(contents)).not.toThrow();
    }
  });

  it("does not leak a temp file when the write succeeds", () => {
    writeActiveWorkspace("/ws", sessionFile);
    const leftovers = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("is a no-op for non-workspace activations (empty path)", () => {
    writeActiveWorkspace("", sessionFile);
    expect(fs.existsSync(sessionFile)).toBe(false);
  });

  it("does not throw when the target path is unwritable", () => {
    // A path under a non-directory (regular file) cannot be created.
    const blocker = path.join(tmpDir, "blocker");
    fs.writeFileSync(blocker, "not a dir");
    const unwritable = path.join(blocker, "child", "cursor-sessions.json");

    expect(() => writeActiveWorkspace("/ws", unwritable)).not.toThrow();
    expect(fs.existsSync(unwritable)).toBe(false);
  });
});

describe("clearActiveWorkspace", () => {
  it("removes an existing session file", () => {
    writeActiveWorkspace("/ws", sessionFile);
    expect(fs.existsSync(sessionFile)).toBe(true);

    clearActiveWorkspace(sessionFile);
    expect(fs.existsSync(sessionFile)).toBe(false);
  });

  it("is a no-op when no session file exists", () => {
    expect(() => clearActiveWorkspace(sessionFile)).not.toThrow();
    expect(fs.existsSync(sessionFile)).toBe(false);
  });
});
