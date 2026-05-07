import { describe, expect, it, vi } from "vitest";

// The welcomeView module imports `vscode`, which is not available outside
// the extension host. Stub it with the minimal surface the module's
// pure renderers touch — renderHtml calls nothing from vscode, so we
// only need the import to resolve.
vi.mock("vscode", () => ({
  default: {},
  window: {},
  ViewColumn: { Active: 1 },
}));

import { renderHtml } from "./welcomeView";
import {
  INIT_HANDOFF_COMMAND,
  LINUX_COMMAND,
  MACOS_COMMAND,
  WINDOWS_COMMAND,
} from "./installCommands";

describe("renderHtml (needs-install stage)", () => {
  it("embeds the canonical macOS brew install command verbatim", () => {
    const html = renderHtml("needs-install", "darwin");
    expect(html).toContain(MACOS_COMMAND.command);
    // It must label the platform the user is on, not the other one.
    expect(html).toContain("macOS");
    expect(html).not.toContain(LINUX_COMMAND.command);
  });

  it("embeds the canonical Linux curl install command on linux", () => {
    const html = renderHtml("needs-install", "linux");
    expect(html).toContain(LINUX_COMMAND.command);
    expect(html).toContain("Linux");
    expect(html).not.toContain(MACOS_COMMAND.command);
  });

  it("embeds the canonical Windows install command when we're on win32", () => {
    const html = renderHtml("needs-install", "win32");
    expect(html).toContain(WINDOWS_COMMAND.command);
    expect(html).toContain("Windows");
  });

  it("offers the primary 'Open Terminal With This Command' action", () => {
    const html = renderHtml("needs-install", "linux");
    expect(html).toContain("Open Terminal With This Command");
    expect(html).toContain("openInstallTerminal");
  });

  it("offers the secondary 'I already installed it' re-check", () => {
    const html = renderHtml("needs-install", "linux");
    expect(html).toContain("I already installed it");
    expect(html).toContain("recheck");
  });

  it("frames the flow as welcoming, not as an error (ticket acceptance)", () => {
    const html = renderHtml("needs-install", "linux");
    expect(html).toContain("Welcome to budi");
    expect(html).not.toContain("error");
    expect(html).not.toContain("failure");
  });

  it("names local privacy up front so the user trusts the install", () => {
    const html = renderHtml("needs-install", "linux");
    expect(html).toContain("your prompts and code never leave your machine");
  });

  it("defaults to Cursor copy when host is omitted (v1.3.x parity)", () => {
    const html = renderHtml("needs-install", "linux");
    expect(html).toContain("Shows your Cursor spend");
  });

  it("renders Cursor-spend copy on the cursor host (siropkin/budi-cursor#29)", () => {
    const html = renderHtml("needs-install", "linux", "cursor");
    expect(html).toContain("Shows your Cursor spend");
    expect(html).not.toContain("Shows your Copilot Chat spend");
  });

  it("renders Copilot Chat copy on a vscode host (siropkin/budi-cursor#29)", () => {
    const html = renderHtml("needs-install", "linux", "vscode");
    expect(html).toContain("Shows your Copilot Chat spend");
    expect(html).not.toContain("Shows your Cursor spend");
  });

  it("renders Copilot Chat copy on vscodium and unknown hosts as well", () => {
    expect(renderHtml("needs-install", "linux", "vscodium")).toContain(
      "Shows your Copilot Chat spend",
    );
    expect(renderHtml("needs-install", "linux", "unknown")).toContain(
      "Shows your Copilot Chat spend",
    );
  });

  it("drops the Cursor-specific terminal reference in the footnote (siropkin/budi-cursor#29)", () => {
    // The footnote is host-independent — whoever the user is, they're
    // pre-filling a command in their editor's integrated terminal.
    for (const host of ["cursor", "vscode", "vscodium", "unknown"] as const) {
      const html = renderHtml("needs-install", "linux", host);
      expect(html).toContain("pre-filled in the integrated terminal");
      expect(html).not.toContain("Cursor's integrated terminal");
    }
  });
});

describe("renderHtml (needs-init stage)", () => {
  it("offers the `budi init && budi doctor` hand-off on POSIX (HTML-escaped)", () => {
    const html = renderHtml("needs-init", "darwin");
    // `&&` is escaped to `&amp;&amp;` in the rendered HTML; the
    // runtime Terminal.sendText call still uses the raw command
    // from INIT_HANDOFF_COMMAND (asserted separately).
    expect(INIT_HANDOFF_COMMAND).toBe("budi init && budi doctor");
    expect(html).toContain("budi init &amp;&amp; budi doctor");
    expect(html).toContain("Finish setup in terminal");
    expect(html).toContain("runInit");
  });

  it("uses the PowerShell-safe `;` hand-off on Windows", () => {
    const html = renderHtml("needs-init", "win32");
    expect(html).toContain("budi init; budi doctor");
  });

  it("tells the user the view closes automatically once traffic is recorded", () => {
    const html = renderHtml("needs-init", "linux");
    expect(html).toContain("this view closes automatically");
  });

  it("phrases the closes-automatically line host-neutrally (siropkin/budi-cursor#29)", () => {
    // The init stage is shown after the daemon is detected — at this
    // point the host doesn't change the wording, but the line must no
    // longer pretend the user is on Cursor.
    for (const host of ["cursor", "vscode", "vscodium", "unknown"] as const) {
      const html = renderHtml("needs-init", "linux", host);
      expect(html).toContain("tailing your editor's transcripts");
      expect(html).not.toContain("tailing Cursor's transcripts");
    }
  });
});
