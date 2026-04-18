/**
 * Canonical budi install commands (siropkin/budi#314).
 *
 * These mirror the commands published on https://getbudi.dev and in the
 * main-repo README (`siropkin/budi/README.md`). They are intentionally
 * hard-coded here — resolving the "install command of the day" over the
 * network at onboarding time would introduce a cold-start dependency on
 * the public site that could fail in exactly the environments the
 * welcome view is meant to help (corporate machines behind strict
 * firewalls).
 *
 * If the canonical install command changes in the main repo, bump this
 * file in lockstep and thread a visual update into siropkin/budi#296 so
 * the public site does not drift.
 */

export type InstallPlatform = "macos" | "linux" | "windows";

export interface InstallCommand {
  platform: InstallPlatform;
  /** Short display label ("macOS / Linux", "Windows (PowerShell)"). */
  label: string;
  /** The shell in which the command must run. */
  shell: "bash" | "powershell";
  /**
   * The exact command to pre-fill in the user's integrated terminal.
   * Matches the commands in `siropkin/budi/README.md` one-to-one.
   */
  command: string;
}

export const MACOS_LINUX_COMMAND: InstallCommand = {
  platform: "linux",
  label: "macOS / Linux",
  shell: "bash",
  command:
    "curl -fsSL https://raw.githubusercontent.com/siropkin/budi/main/scripts/install-standalone.sh | bash",
};

export const WINDOWS_COMMAND: InstallCommand = {
  platform: "windows",
  label: "Windows (PowerShell)",
  shell: "powershell",
  command:
    "irm https://raw.githubusercontent.com/siropkin/budi/main/scripts/install-standalone.ps1 | iex",
};

/**
 * Resolve the install command for the current host.
 *
 * The ticket explicitly asks for platform-specific copy; we fall back
 * to the macOS/Linux command on anything non-Windows because the Budi
 * Linux tarball supports the same path.
 */
export function installCommandForPlatform(platform: NodeJS.Platform): InstallCommand {
  if (platform === "win32") return WINDOWS_COMMAND;
  if (platform === "darwin") return { ...MACOS_LINUX_COMMAND, platform: "macos" };
  return MACOS_LINUX_COMMAND;
}

/** Command the welcome view offers after the daemon is detected — `budi init && budi doctor`. */
export const INIT_HANDOFF_COMMAND = "budi init && budi doctor";

/** Windows fallback for the init hand-off (bash `&&` also works in PowerShell 7+, but `;` is safest). */
export const INIT_HANDOFF_COMMAND_WINDOWS = "budi init; budi doctor";

export function initHandoffCommandFor(platform: NodeJS.Platform): string {
  return platform === "win32" ? INIT_HANDOFF_COMMAND_WINDOWS : INIT_HANDOFF_COMMAND;
}
