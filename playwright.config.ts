import { defineConfig } from "@playwright/test"

export const PORT = 3100
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: "./e2e",
  // Deployment smoke tests have their own config (playwright.smoke.config.ts).
  testIgnore: [/smoke.spec.ts$/],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  // First requests after a cold start (Next server + PostgREST schema cache) can take a few seconds.
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    colorScheme: "dark",
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
  },
})
