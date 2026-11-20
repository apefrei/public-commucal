import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against a running stack (Compose profile local); see docs/development.md, "End-to-end tests".
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "https://localhost:8443",
    // Caddy's local certificate authority in staging and CI.
    ignoreHTTPSErrors: true,
    locale: "de-CH",
    timezoneId: "Europe/Zurich",
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
