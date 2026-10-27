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

  test("capture analytics drilldown", async ({ page }, info) => {
    await page.goto("/analytics")
    await page.getByRole("button", { name: /^Cumplimiento.*Ver detalle$/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.waitForTimeout(400) // sheet animation
    await page.screenshot({ path: `docs/screenshots/${info.project.name}-analytics-drilldown.png` })
  })

  // M3.1: one goal per data state (enough history, few points, none) and the creation sheet.
  for (const [name, id] of [["goal-detail", "demo-goal-10k"], ["goal-few", "demo-goal-weight"], ["goal-empty", "demo-goal-savings"], ["goal-milestones", "demo-goal-v1"]]) {
    test(`capture ${name}`, async ({ page }, info) => {
      await page.goto(`/goals/${id}`)
      await expect(page.locator("h1").first()).toBeVisible()
      await page.waitForLoadState("networkidle")
      await page.screenshot({ path: `docs/screenshots/${info.project.name}-${name}.png`, fullPage: true })
    })
  }

  test("capture goal form", async ({ page }, info) => {
    await page.goto("/goals")
    await page.getByRole("button", { name: "Nuevo objetivo" }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.waitForTimeout(400) // sheet animation
    await page.screenshot({ path: `docs/screenshots/${info.project.name}-goal-form.png` })
  })
})
