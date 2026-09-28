import { defineConfig, devices } from "@playwright/test";

/**
 * Hub E2E + a11y harness (ADR-029 tranche 4.13).
 *
 * Runs against the PRODUCTION standalone build in mock mode
 * (HUB_DATA_MODE=mock, the bundled 4CH1 pilot corpus) — the same artifact
 * CI's build job produces, so the tests exercise the real prerendered pages,
 * not a dev server. Deterministic by design: no core dependency, no auth,
 * the rating trail is the browser-local overlay (lib/progress.ts) which the
 * specs seed and time-travel directly.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // one browser, one project — the deck flow is keyboard/axe surface, not a
  // rendering-matrix exercise; mobile layout is covered by the responsive
  // checks elsewhere, not duplicated here
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun run start",
    url: "http://localhost:3000",
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: { HUB_DATA_MODE: "mock", PORT: "3000" },
  },
});
