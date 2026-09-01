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
        "PLATFORM_ADAPTER_CALLBACK_URL=http://127.0.0.1:4000/api/v1/adapter-events PLATFORM_KEY_REGISTRATION_URL=http://127.0.0.1:4000/internal/mock-adapter-keys pnpm exec tsx apps/mock-institutions/src/server.ts",
      url: "http://127.0.0.1:4100/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        "MOCK_INSTITUTIONS_URL=http://127.0.0.1:4100 pnpm --filter @rwa/database reset:test && MOCK_INSTITUTIONS_URL=http://127.0.0.1:4100 pnpm db:migrate && MOCK_INSTITUTIONS_URL=http://127.0.0.1:4100 pnpm --filter @rwa/api test-server",
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
