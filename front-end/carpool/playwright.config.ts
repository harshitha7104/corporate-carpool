import { defineConfig, devices } from "@playwright/test";

// Browser end-to-end tests. They start their own backend on a throwaway
// embedded database (seeded with the fictional demo data) and their own Vite
// server, so they never touch your development data.
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5175",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
  webServer: [
    {
      command: "node ../../backend/src/server.js",
      url: "http://localhost:4100/ready",
      env: { PORT: "4100", DEV_DB_NAME: "e2e", DEV_DB_FRESH: "true", LOG_LEVEL: "warn", WORKER_ENABLED: "true" },
      timeout: 180_000,
      reuseExistingServer: false,
    },
    {
      command: "npx vite --port 5175 --strictPort",
      url: "http://localhost:5175",
      env: { API_URL: "http://localhost:4100" },
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
});
