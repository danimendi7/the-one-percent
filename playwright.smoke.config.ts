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
  use: { ...base.use, baseURL: remote ?? base.use?.baseURL },
  webServer: remote ? undefined : base.webServer,
})
