import { expect, test } from "./fixtures"

/** Visual record for milestone reviews. Run with: npm run screenshots */
const ROUTES = ["/", "/habits", "/analytics", "/knowledge/library", "/knowledge/discover", "/knowledge/brain", "/goals", "/settings/notifications"]

test.describe("@screens", () => {
  for (const route of ROUTES) {
    test(`capture ${route}`, async ({ page }, info) => {
      await page.goto(route)
      await expect(page.locator("h1").first()).toBeVisible()
      await page.waitForLoadState("networkidle")
      const name = route === "/" ? "overview" : route.slice(1).replaceAll("/", "-")
      await page.screenshot({ path: `docs/screenshots/${info.project.name}-${name}.png`, fullPage: info.project.name === "desktop" })
    })
  }
})
