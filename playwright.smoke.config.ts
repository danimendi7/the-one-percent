import { defineConfig } from "@playwright/test"
import base from "./playwright.config"

/**
 * Deployment smoke tests.
 *   npm run smoke                         → local production build (http://localhost:3100)
 *   BASE_URL=https://<app> npm run smoke  → a real deployment (read-only checks)
 */
const remote = process.env.BASE_URL

export default defineConfig({
  ...base,
  testMatch: /smoke.spec.ts$/,
  testIgnore: [],
  // Own report files in CI, so the E2E reports of the same job are kept.
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { open: "never", outputFolder: "playwright-report-smoke" }], ["json", { outputFile: "e2e-results/smoke.json" }]]
    : base.reporter,
  use: { ...base.use, baseURL: remote ?? base.use?.baseURL },
  webServer: remote ? undefined : base.webServer,
})
