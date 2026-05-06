import { describe, expect, it } from "vitest";

import {
  INIT_HANDOFF_COMMAND,
  INIT_HANDOFF_COMMAND_WINDOWS,
  LINUX_COMMAND,
  MACOS_COMMAND,
  WINDOWS_COMMAND,
  initHandoffCommandFor,
  installCommandForPlatform,
} from "./installCommands";

describe("installCommandForPlatform", () => {
  it("uses the curl-based standalone installer on linux", () => {
    const cmd = installCommandForPlatform("linux");
    expect(cmd).toEqual(LINUX_COMMAND);
    expect(cmd.shell).toBe("bash");
  });

  it("uses Homebrew on darwin to mirror the canonical macOS path on getbudi.dev", () => {
    const cmd = installCommandForPlatform("darwin");
    expect(cmd).toEqual(MACOS_COMMAND);
    expect(cmd.shell).toBe("bash");
    expect(cmd.platform).toBe("macos");
  });

  it("uses the PowerShell installer on Windows", () => {
    const cmd = installCommandForPlatform("win32");
    expect(cmd).toEqual(WINDOWS_COMMAND);
    expect(cmd.shell).toBe("powershell");
  });
});

describe("canonical install commands", () => {
  it("mirror the commands published on getbudi.dev verbatim", () => {
    // If any of these strings change, getbudi.dev and the main-repo
    // README must be updated in the same release. The point of pinning
    // them here is to make drift loud.
    expect(MACOS_COMMAND.command).toBe("brew install siropkin/budi/budi");
    expect(LINUX_COMMAND.command).toBe(
      "curl -fsSL https://raw.githubusercontent.com/siropkin/budi/main/scripts/install-standalone.sh | bash",
    );
    expect(WINDOWS_COMMAND.command).toBe(
      "irm https://raw.githubusercontent.com/siropkin/budi/main/scripts/install-standalone.ps1 | iex",
    );
  });
});

describe("initHandoffCommandFor", () => {
  it("uses `&&` on POSIX shells", () => {
    expect(initHandoffCommandFor("darwin")).toBe(INIT_HANDOFF_COMMAND);
    expect(initHandoffCommandFor("linux")).toBe(INIT_HANDOFF_COMMAND);
  });

  it("uses `;` on PowerShell so the command chains reliably on older hosts", () => {
    expect(initHandoffCommandFor("win32")).toBe(INIT_HANDOFF_COMMAND_WINDOWS);
  });

  it("runs `budi init` before `budi doctor`", () => {
    // The ticket explicitly asks for init → doctor. Both forms must
    // preserve that order.
    expect(INIT_HANDOFF_COMMAND.startsWith("budi init")).toBe(true);
    expect(INIT_HANDOFF_COMMAND.endsWith("budi doctor")).toBe(true);
    expect(INIT_HANDOFF_COMMAND_WINDOWS.startsWith("budi init")).toBe(true);
    expect(INIT_HANDOFF_COMMAND_WINDOWS.endsWith("budi doctor")).toBe(true);
  });
});
