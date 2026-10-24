import { test as base, expect } from "@playwright/test"

/** Wednesday 21 Oct 2026, 18:30 Madrid. Demo data is generated relative to this date. */
export const FIXED_NOW = new Date("2026-10-21T18:30:00+02:00")

export const test = base.extend<{ consoleErrors: string[] }>({
  // auto: the fixed clock must apply to every test, before the first navigation.
  consoleErrors: [async ({ page }, use) => {
    const errors: string[] = []
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text())
    })
    page.on("pageerror", (e) => errors.push(e.message))
    await page.clock.setFixedTime(FIXED_NOW)
    await use(errors)
  }, { auto: true }],
})

export { expect }

export const isMobile = (projectName: string) => projectName === "mobile"
