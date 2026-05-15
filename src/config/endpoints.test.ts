import { describe, expect, it } from "vitest";

import {
  DEFAULT_CLOUD_ENDPOINT,
  DEFAULT_DAEMON_URL,
  isAllowedCloudEndpoint,
  isLoopbackDaemonUrl,
} from "./endpoints";

describe("isLoopbackDaemonUrl (siropkin/budi-cursor#42)", () => {
  it("accepts the documented default", () => {
    expect(isLoopbackDaemonUrl(DEFAULT_DAEMON_URL)).toBe(true);
  });

  it("accepts every loopback alias on http and https", () => {
    const accepted = [
      "http://127.0.0.1:7878",
      "http://127.0.0.1",
      "http://localhost:7878",
      "http://localhost",
      "http://[::1]:7878",
      "http://[::1]",
      "https://127.0.0.1:7878",
      "https://localhost:9000",
    ];
    for (const url of accepted) {
      expect(isLoopbackDaemonUrl(url), url).toBe(true);
    }
  });

  it("preserves an explicit path so future endpoints still parse", () => {
    expect(isLoopbackDaemonUrl("http://127.0.0.1:7878/budi/")).toBe(true);
  });

  it("rejects remote hosts that would exfiltrate the workspace path", () => {
    const rejected = [
      "http://attacker.example.com:7878",
      "http://attacker.example.com",
      "https://evil.test/health",
      "http://10.0.0.5:7878",
      "http://192.168.1.5:7878",
      "http://127.0.0.1.attacker.example.com:7878",
      "http://localhost.attacker.example.com:7878",
      // Userinfo trick: hostname is `attacker.example.com`, not `127.0.0.1`.
      "http://127.0.0.1@attacker.example.com:7878",
    ];
    for (const url of rejected) {
      expect(isLoopbackDaemonUrl(url), url).toBe(false);
    }
  });

  it("rejects non-http(s) schemes", () => {
    expect(isLoopbackDaemonUrl("file:///etc/passwd")).toBe(false);
    expect(isLoopbackDaemonUrl("ftp://127.0.0.1")).toBe(false);
    expect(isLoopbackDaemonUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects unparseable input", () => {
    expect(isLoopbackDaemonUrl("")).toBe(false);
    expect(isLoopbackDaemonUrl("not a url")).toBe(false);
    expect(isLoopbackDaemonUrl("127.0.0.1:7878")).toBe(false);
  });
});

describe("isAllowedCloudEndpoint (siropkin/budi-cursor#43)", () => {
  it("accepts the documented default", () => {
    expect(isAllowedCloudEndpoint(DEFAULT_CLOUD_ENDPOINT)).toBe(true);
  });

  it("accepts the apex and known subdomains", () => {
    const accepted = [
      "https://getbudi.dev",
      "https://app.getbudi.dev",
      "https://app.getbudi.dev/",
      "https://staging.app.getbudi.dev",
      "https://staging.getbudi.dev/dashboard",
      "https://APP.GETBUDI.DEV",
    ];
    for (const url of accepted) {
      expect(isAllowedCloudEndpoint(url), url).toBe(true);
    }
  });

  it("rejects look-alike phishing hosts", () => {
    const rejected = [
      // Suffix-extension trick from the issue's reproduction.
      "https://app.getbudi.dev.attacker.example",
      "https://app.getbudi.dev.attacker.example/dashboard",
      // Bare lookalike domains.
      "https://getbudi.dev.attacker.example",
      "https://getbudidev.example",
      // Wrong apex.
      "https://app.getbudi.com",
      "https://app.budi.dev",
      // Userinfo trick: hostname is `app.getbudi.dev`, but a render that
      // shows the full URL leaks `attacker.example` to the user.
      "https://attacker.example@app.getbudi.dev",
      // Substring match attempt.
      "https://notgetbudi.dev",
    ];
    for (const url of rejected) {
      expect(isAllowedCloudEndpoint(url), url).toBe(false);
    }
  });

  it("rejects non-https schemes", () => {
    expect(isAllowedCloudEndpoint("http://app.getbudi.dev")).toBe(false);
    expect(isAllowedCloudEndpoint("file:///etc/passwd")).toBe(false);
    expect(isAllowedCloudEndpoint("javascript:alert(1)")).toBe(false);
    expect(isAllowedCloudEndpoint("ftp://app.getbudi.dev")).toBe(false);
  });

  it("rejects unparseable input", () => {
    expect(isAllowedCloudEndpoint("")).toBe(false);
    expect(isAllowedCloudEndpoint("not a url")).toBe(false);
    expect(isAllowedCloudEndpoint("app.getbudi.dev")).toBe(false);
  });
});
