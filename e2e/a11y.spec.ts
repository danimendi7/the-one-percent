import type { Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { expect, FIXED_NOW, test } from "./fixtures"

const ROUTES = ["/login", "/", "/habits", "/analytics", "/focus", "/knowledge/library", "/knowledge/discover", "/knowledge/brain", "/settings/notifications", "/more"]

async function blocking(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)
}

test.describe("accessibility (axe, WCAG 2.1 AA)", () => {
  for (const route of ROUTES) {
    test(`${route} has no serious or critical violations`, async ({ page }) => {
      await page.goto(route)
      await expect(page.locator("h1").first()).toBeVisible()
      await page.waitForLoadState("networkidle")
      expect(await blocking(page)).toEqual([])
    })
  }

  // M3.2: the timer states and the close sheet, not only the idle screen.
  test("/focus running, paused and closing have no serious or critical violations", async ({ page }) => {
    await page.goto("/focus")
    await page.getByRole("button", { name: /^Empezar/ }).click()
    await expect(page.getByRole("region", { name: "Bloque en curso" })).toBeVisible()
    expect(await blocking(page)).toEqual([])
    await page.clock.setFixedTime(new Date(FIXED_NOW.getTime() + 30 * 60_000))
    await page.getByRole("button", { name: "Terminar" }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.waitForTimeout(400) // sheet animation
    expect(await blocking(page)).toEqual([])
  })
})
