import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["out/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json-summary", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "out/**"],
      reportsDirectory: "coverage",
      thresholds: {
        "src/budiClient.ts": {
          lines: 99,
          statements: 99,
          branches: 95,
          functions: 100,
        },
        "src/extension.ts": {
          lines: 0,
          statements: 0,
          branches: 0,
          functions: 0,
        },
        "src/welcomeView.ts": {
          lines: 31,
          statements: 31,
          branches: 100,
          functions: 40,
        },
        "src/installCommands.ts": {
          lines: 100,
          statements: 100,
          branches: 100,
          functions: 100,
        },
        "src/onboardingCounters.ts": {
          lines: 98,
          statements: 98,
          branches: 88,
          functions: 100,
        },
        "src/sessionStore.ts": {
          lines: 30,
          statements: 30,
          branches: 100,
          functions: 0,
        },
      },
    },
  },
});
