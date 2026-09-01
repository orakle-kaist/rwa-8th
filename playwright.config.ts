import { defineConfig } from "@playwright/test";

const webPort = process.env.PLAYWRIGHT_WEB_PORT ?? "3000";
const apiPort = process.env.PLAYWRIGHT_API_PORT ?? "4000";
const mockPort = process.env.PLAYWRIGHT_MOCK_PORT ?? "4100";
const webUrl = `http://127.0.0.1:${webPort}`;
const apiUrl = `http://127.0.0.1:${apiPort}`;
const mockUrl = `http://127.0.0.1:${mockPort}`;

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: webUrl,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      command: `MOCK_INSTITUTIONS_PORT=${mockPort} PLATFORM_ADAPTER_CALLBACK_URL=${apiUrl}/api/v1/adapter-events PLATFORM_KEY_REGISTRATION_URL=${apiUrl}/internal/mock-adapter-keys pnpm exec tsx apps/mock-institutions/src/server.ts`,
      url: `${mockUrl}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `MOCK_INSTITUTIONS_URL=${mockUrl} pnpm --filter @rwa/database reset:test && MOCK_INSTITUTIONS_URL=${mockUrl} pnpm db:migrate && API_PORT=${apiPort} WEB_ORIGIN=${webUrl} MOCK_INSTITUTIONS_URL=${mockUrl} pnpm --filter @rwa/api test-server`,
      url: `${apiUrl}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `NEXT_PUBLIC_API_URL=${apiUrl}/api/v1 pnpm --dir apps/web exec next dev --port ${webPort}`,
      url: webUrl,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
