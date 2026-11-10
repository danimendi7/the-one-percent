import { defineConfig } from "@playwright/test"

export const PORT = 3100
const baseURL = `http://localhost:${PORT}`

/**
 * E8 · The build under test has push configured, so the subscription flow can be tested. Only the
 * public key: its private key was discarded when it was generated, so nothing can ever be sent with
 * it, and the server has no private key, so «Enviar prueba» answers that sending is not configured.
 */
export const E2E_VAPID_PUBLIC_KEY = "BNKXOBbMRvebkozkWtIIzL-d1Ia949c24t5VUZliPGEUiCnczkJT-yTousqZ7zucLAfhJwhK0TUqgwnvCL1WuF4"

export default defineConfig({
  testDir: "./e2e",
  // Deployment smoke tests have their own config (playwright.smoke.config.ts).
  testIgnore: [/smoke.spec.ts$/],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Reports never carry git metadata (author and committer emails): CI artifacts hold no personal data (M3.4e).
  captureGitInfo: { commit: false, diff: false },
  // CI keeps a JSON report too: scripts/ci-gate.mjs applies the acceptance criterion to it (D48).
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { open: "never" }], ["json", { outputFile: "e2e-results/e2e.json" }]]
    : [["list"]],
  // First requests after a cold start (Next server + PostgREST schema cache) can take a few seconds.
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    colorScheme: "dark",
    // The service worker (M4f) is off for the regular suites, so they keep testing the app as before;
    // e2e/offline.spec.ts turns it on and tests it explicitly.
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "mobile",
      use: {
        browserName: "chromium",
        viewport: { width: 375, height: 812 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "desktop",
      use: { browserName: "chromium", viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    // Tests run against a production build, never the dev server.
    command: `npm run build && npx next start -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: { NEXT_PUBLIC_VAPID_PUBLIC_KEY: E2E_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: "", VAPID_SUBJECT: "" },
  },
})
