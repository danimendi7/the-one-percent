import { expect, FIXED_NOW, test } from "./fixtures"

/** Visual record for milestone reviews. Run with: npm run screenshots */
const ROUTES = ["/", "/habits", "/analytics", "/focus", "/knowledge/library", "/knowledge/discover", "/knowledge/brain", "/goals", "/settings/notifications"]

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

  // M3.2: running block, close sheet, recovery prompt and the focus section of Analytics.
  test("capture focus running and close sheet", async ({ page }, info) => {
    await page.goto("/focus")
    await page.getByRole("textbox", { name: /^Proyecto/ }).fill("Tesis")
    await page.getByRole("button", { name: /^Empezar/ }).click()
    await page.clock.setFixedTime(new Date(FIXED_NOW.getTime() + 18 * 60_000 + 25_000))
    await expect(page.getByTestId("focus-clock")).toHaveText("31:35")
    await page.screenshot({ path: `docs/screenshots/${info.project.name}-focus-running.png`, fullPage: info.project.name === "desktop" })
    await page.goto("/habits")
    await page.screenshot({ path: `docs/screenshots/${info.project.name}-focus-pill.png` })
    await page.goto("/focus")
    await page.getByRole("button", { name: "Terminar" }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: `docs/screenshots/${info.project.name}-focus-close.png` })
  })

  test("capture focus recovery", async ({ page }, info) => {
    await page.goto("/focus")
    await page.getByRole("button", { name: /^Empezar/ }).click()
    await page.clock.setFixedTime(new Date(FIXED_NOW.getTime() + 140 * 60_000))
    await page.goto("/")
    await expect(page.getByRole("dialog", { name: "¿Sigue en curso?" })).toBeVisible()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `docs/screenshots/${info.project.name}-focus-recovery.png` })
  })

  test("capture focus analytics", async ({ page }, info) => {
    await page.goto("/analytics#enfoque")
    await expect(page.getByRole("region", { name: /^Enfoque/ })).toBeVisible()
    await page.waitForLoadState("networkidle")
    await page.getByRole("region", { name: /^Enfoque/ }).screenshot({ path: `docs/screenshots/${info.project.name}-focus-analytics.png` })
    await page.goto("/analytics?proyecto=Escritura#enfoque")
    await expect(page.getByRole("region", { name: /^Enfoque/ }).getByText("Pocos datos", { exact: true })).toBeVisible()
    await page.getByRole("region", { name: /^Enfoque/ }).screenshot({ path: `docs/screenshots/${info.project.name}-focus-analytics-few.png` })
  })
})
