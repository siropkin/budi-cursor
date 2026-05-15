import { describe, expect, it } from "vitest";

import { CURSOR_PROVIDER } from "../http/statuslineClient";
import { clickUrl } from "./clickUrl";

describe("clickUrl (mirrors Claude Code click-through)", () => {
  it("opens the cloud sessions list when the active provider is cursor", () => {
    const url = clickUrl({
      cloudEndpoint: "https://app.getbudi.dev",
      statusline: { active_provider: CURSOR_PROVIDER, cost_1d: 0.1 },
    });
    expect(url).toBe("https://app.getbudi.dev/dashboard/sessions");
  });

  it("opens the dashboard root when no active cursor session is recorded", () => {
    const url = clickUrl({
      cloudEndpoint: "https://app.getbudi.dev",
      statusline: { active_provider: "claude_code", cost_1d: 0 },
    });
    expect(url).toBe("https://app.getbudi.dev/dashboard");
  });

  it("opens the dashboard root when statusline is unavailable", () => {
    const url = clickUrl({
      cloudEndpoint: "https://app.getbudi.dev",
      statusline: null,
    });
    expect(url).toBe("https://app.getbudi.dev/dashboard");
  });

  it("trims a trailing slash from the configured cloud endpoint", () => {
    const url = clickUrl({
      cloudEndpoint: "https://app.getbudi.dev/",
      statusline: null,
    });
    expect(url).toBe("https://app.getbudi.dev/dashboard");
  });
});
