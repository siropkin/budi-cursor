import { describe, expect, it, vi } from "vitest";

// `extensionsProbe` imports `vscode` for its side-effectful helpers.
// The pure mapper under test never touches it, so a minimal stub is
// enough to satisfy module resolution.
vi.mock("vscode", () => ({
  default: {},
  extensions: { all: [], onDidChange: () => ({ dispose() {} }) },
}));

import { EXTENSION_PROVIDER_MAP, probeProvidersFromExtensions } from "./extensionsProbe";

describe("probeProvidersFromExtensions", () => {
  it("returns [] on the cursor host even with AI extensions installed", () => {
    expect(probeProvidersFromExtensions(["github.copilot-chat"], "cursor")).toEqual([]);
  });

  it("maps github.copilot-chat to copilot_chat on the vscode host", () => {
    expect(probeProvidersFromExtensions(["github.copilot-chat"], "vscode")).toEqual([
      "copilot_chat",
    ]);
  });

  it("dedupes when both copilot and copilot-chat are installed", () => {
    expect(
      probeProvidersFromExtensions(["github.copilot", "github.copilot-chat"], "vscode"),
    ).toEqual(["copilot_chat"]);
  });

  it("returns multiple recognized providers in first-seen order", () => {
    expect(
      probeProvidersFromExtensions(
        ["github.copilot-chat", "Continue.continue", "saoudrizwan.claude-dev"],
        "vscode",
      ),
    ).toEqual(["copilot_chat", "continue", "cline"]);
  });

  it("ignores extensions that are not in the provider map", () => {
    expect(
      probeProvidersFromExtensions(
        ["someother.extension", "vscodevim.vim", "esbenp.prettier-vscode"],
        "vscode",
      ),
    ).toEqual([]);
  });

  it("matches case-insensitively (vscode treats extension IDs that way)", () => {
    expect(probeProvidersFromExtensions(["GITHUB.COPILOT-CHAT"], "vscode")).toEqual([
      "copilot_chat",
    ]);
    expect(probeProvidersFromExtensions(["Continue.Continue"], "vscode")).toEqual(["continue"]);
  });

  it("treats vscodium and unknown like vscode (probe still runs)", () => {
    expect(probeProvidersFromExtensions(["github.copilot-chat"], "vscodium")).toEqual([
      "copilot_chat",
    ]);
    expect(probeProvidersFromExtensions(["github.copilot-chat"], "unknown")).toEqual([
      "copilot_chat",
    ]);
  });

  it("returns [] when the input is empty regardless of host", () => {
    expect(probeProvidersFromExtensions([], "vscode")).toEqual([]);
    expect(probeProvidersFromExtensions([], "cursor")).toEqual([]);
  });
});

describe("EXTENSION_PROVIDER_MAP", () => {
  it("covers every known AI editor extension from siropkin/budi-cursor#27", () => {
    expect(EXTENSION_PROVIDER_MAP).toMatchObject({
      "github.copilot": "copilot_chat",
      "github.copilot-chat": "copilot_chat",
      "continue.continue": "continue",
      "saoudrizwan.claude-dev": "cline",
      "rooveterinaryinc.roo-cline": "roo_code",
    });
  });

  it("uses lowercase keys so case-insensitive lookup works without a second normalization step", () => {
    for (const key of Object.keys(EXTENSION_PROVIDER_MAP)) {
      expect(key).toBe(key.toLowerCase());
    }
  });
});
