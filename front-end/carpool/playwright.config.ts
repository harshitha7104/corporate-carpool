import { defineConfig, devices } from "@playwright/test";

// Browser end-to-end tests. They build the app and run it the way production
// does: one backend that serves the built files, on a throwaway embedded
// database seeded with the fictional demo data, so they never touch your
// development data. (Testing against the Vite dev server was flaky: its
// first-visit dependency rebuild reloads the page mid-test.)
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
  webServer: [
    {
      command: "npx vite build && node ../../backend/src/server.js",
      url: "http://localhost:4100/ready",
      env: { PORT: "4100", DEV_DB_NAME: "e2e", DEV_DB_FRESH: "true", LOG_LEVEL: "warn", WORKER_ENABLED: "true" },
      timeout: 240_000,
      reuseExistingServer: false,
    },
  ],
});
