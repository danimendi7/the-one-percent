import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "./fixtures"

const ROUTES = ["/login", "/", "/habits", "/analytics", "/knowledge/library", "/knowledge/discover", "/knowledge/brain", "/settings/notifications", "/more"]

test.describe("accessibility (axe, WCAG 2.1 AA)", () => {
  for (const route of ROUTES) {
    test(`${route} has no serious or critical violations`, async ({ page }) => {
      await page.goto(route)
      await expect(page.locator("h1").first()).toBeVisible()
      await page.waitForLoadState("networkidle")
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
      const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
      expect(
        blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`),
      ).toEqual([])
    })
  }
})
