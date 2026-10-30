import { defineConfig, devices } from "@playwright/test"

/**
 * Engine-level browser tests (M4c): real Chromium, real IndexedDB, LOCAL Supabase. The page is served
 * from memory by each test, so there is no web server and no app build.
 */
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  // Precise heap figures for the volume benchmark (a measurement flag only).
  use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--enable-precise-memory-info"] } },
})
