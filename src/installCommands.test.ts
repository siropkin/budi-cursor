import { describe, expect, it } from "vitest";

import {
  INIT_HANDOFF_COMMAND,
  INIT_HANDOFF_COMMAND_WINDOWS,
  MACOS_LINUX_COMMAND,
  WINDOWS_COMMAND,
  initHandoffCommandFor,
  installCommandForPlatform,
} from "./installCommands";

describe("installCommandForPlatform", () => {
  it("uses the macOS/Linux shell install on linux", () => {
    const cmd = installCommandForPlatform("linux");
    expect(cmd.shell).toBe("bash");
    expect(cmd.command).toBe(MACOS_LINUX_COMMAND.command);
  });

  it("uses the same shell install on darwin, tagged as macos", () => {
    const cmd = installCommandForPlatform("darwin");
    expect(cmd.shell).toBe("bash");
    expect(cmd.platform).toBe("macos");
    expect(cmd.command).toBe(MACOS_LINUX_COMMAND.command);
  });

  it("uses the PowerShell installer on Windows", () => {
    const cmd = installCommandForPlatform("win32");
    expect(cmd).toEqual(WINDOWS_COMMAND);
    expect(cmd.shell).toBe("powershell");
  });
});

describe("canonical install commands", () => {
  it("mirror the commands in the main-repo README verbatim (siropkin/budi#314)", () => {
    // If any of these strings change, the main-repo README and
    // getbudi.dev must be updated in the same release. The point of
    // pinning them here is to make drift loud.
    expect(MACOS_LINUX_COMMAND.command).toBe(
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
