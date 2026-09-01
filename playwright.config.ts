import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      command:
        "pnpm --filter @rwa/database reset:test && pnpm db:migrate && pnpm --filter @rwa/api test-server",
      url: "http://127.0.0.1:4000/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm dev:web",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
