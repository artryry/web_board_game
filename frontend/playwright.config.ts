import { defineConfig, devices } from "@playwright/test";

// The tests run against the real stack through nginx, like a user would.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Starts Vite when it isn't running yet. nginx and the API must already be up.
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
  },
});
