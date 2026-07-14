import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const externalOrigin = process.env.PLAYWRIGHT_ORIGIN;
const useFakeMicrophone = process.env.PLAYWRIGHT_FAKE_MIC === "true";

export default defineConfig({
  testDir: "./tests/e2e",
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    actionTimeout: 15_000,
    baseURL: externalBaseUrl ?? "http://127.0.0.1:3000",
    extraHTTPHeaders: externalOrigin ? { Origin: externalOrigin } : undefined,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...(useFakeMicrophone
      ? {
          permissions: ["microphone"],
          launchOptions: { args: ["--use-fake-device-for-media-stream"] }
        }
      : {})
  },
  projects: [
    {
      name: "desktop-chrome",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.CI ? undefined : "chrome"
      }
    }
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "pnpm exec next dev --webpack",
        url: "http://127.0.0.1:3000/api/health",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          GEMINI_MODE: "mock",
          ENABLE_GEMINI_LIVE: "false",
          ENABLE_FIRESTORE: "false",
          ENABLE_CLOUD_STORAGE: "false",
          SESSION_SIGNING_SECRET: "playwright-only-session-secret-at-least-32-chars"
        }
      }
});
