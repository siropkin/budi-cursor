import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * cursor-sessions.json v1 contract (ADR-0086 §3.4, §6).
 *
 * This file is written by the Cursor extension to signal which workspace is
 * currently active. The daemon may read it to correlate tailed Cursor
 * transcript activity with the active Cursor workspace.
 *
 * Format (v1):
 * ```json
 * {
 *   "version": 1,
 *   "active_workspace": "/absolute/path/to/project",
 *   "updated_at": "2026-04-11T20:00:00.000Z"
 * }
 * ```
 *
 * Breaking format changes require bumping `version`.
 */

export const CONTRACT_VERSION = 1;

interface CursorSessionsV1 {
  version: number;
  active_workspace: string;
  updated_at: string;
}

export const DEFAULT_STATE_DIR = path.join(os.homedir(), ".local", "share", "budi");
export const DEFAULT_SESSION_FILE = path.join(DEFAULT_STATE_DIR, "cursor-sessions.json");

/**
 * Write the cursor-sessions.json v1 contract file to signal the active
 * workspace. Called by the extension on activate and when workspace changes.
 *
 * No-op when `workspacePath` is falsy (non-workspace activations).
 * Writes are atomic: a temp file is written then renamed over the target so
 * a crash mid-write can never leave a half-written JSON behind.
 */
export function writeActiveWorkspace(
  workspacePath: string,
  sessionFile: string = DEFAULT_SESSION_FILE,
): void {
  if (!workspacePath) return;

  const data: CursorSessionsV1 = {
    version: CONTRACT_VERSION,
    active_workspace: path.resolve(workspacePath),
    updated_at: new Date().toISOString(),
  };

  const dir = path.dirname(sessionFile);
  const tmpFile = `${sessionFile}.${process.pid}.tmp`;

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2) + "\n");
    fs.renameSync(tmpFile, sessionFile);
  } catch {
    // Best-effort — don't crash the extension if the file can't be written.
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // Temp file may not exist; ignore.
    }
  }
}

/**
 * Clear the active workspace signal (e.g., on deactivate).
 */
export function clearActiveWorkspace(sessionFile: string = DEFAULT_SESSION_FILE): void {
  try {
    if (fs.existsSync(sessionFile)) {
      fs.unlinkSync(sessionFile);
    }
  } catch {
    // Best-effort cleanup.
  }
}
