import { expect, FIXED_NOW, test } from "./fixtures"

/** Visual record for milestone reviews. Run with: npm run screenshots */
const ROUTES = ["/", "/habits", "/analytics", "/focus", "/mind", "/knowledge/library", "/knowledge/discover", "/knowledge/brain", "/goals", "/settings/notifications", "/reviews", "/intelligence", "/knowledge/brain/repaso", "/settings", "/more"]

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

  // F4: the inbox open over the Resumen (E7).
  test("capture inbox", async ({ page }, info) => {
    await page.goto("/")
    await expect(page.getByTestId("overview-day")).toBeVisible()
    await page.getByTestId("inbox-button").locator("visible=true").click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.waitForTimeout(400) // sheet animation
    await page.screenshot({ path: `docs/screenshots/${info.project.name}-inbox.png` })
  })

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

  // M3.3: Mind & Energy — check-in sheets, the three data states, Analytics and the paused-block prompt.
  test("capture mind check-in sheets", async ({ page }, info) => {
    await page.goto("/mind?checkin=pm")
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("radiogroup", { name: "Energía" }).getByRole("radio", { name: "3, Normal" }).click()
    await dialog.getByRole("radiogroup", { name: "Ánimo" }).getByRole("radio", { name: "4, Bueno" }).click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `docs/screenshots/${info.project.name}-mind-checkin-pm.png` })
    await dialog.getByRole("button", { name: "Listo" }).click()
    await page.clock.setFixedTime(new Date("2026-10-22T07:45:00+02:00"))
    await page.goto("/mind?checkin=am")
    await expect(page.getByRole("dialog").getByRole("button", { name: "Listo" })).toBeVisible()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `docs/screenshots/${info.project.name}-mind-checkin-am.png` })
  })

  test("capture mind data states", async ({ page }, info) => {
    const keep = async (days: string[]) => {
      await expect.poll(() => page.evaluate(() => localStorage.getItem("the-one-percent:demo:habits:v1") !== null)).toBe(true)
      await page.evaluate((days) => {
        const k = "the-one-percent:demo:habits:v1"
        const st = JSON.parse(localStorage.getItem(k)!)
        st.checkins = Object.fromEntries(Object.entries(st.checkins).filter(([key]) => days.includes(key.slice(0, 10))))
        localStorage.setItem(k, JSON.stringify(st))
      }, days)
      await page.reload()
    }
    await page.goto("/mind")
    await keep(["2026-10-19", "2026-10-20", "2026-10-21"])
    await expect(page.getByTestId("mind-state-few")).toBeVisible()
    await page.screenshot({ path: `docs/screenshots/${info.project.name}-mind-few.png`, fullPage: info.project.name === "desktop" })
    await keep([])
    await expect(page.getByTestId("mind-state-none")).toBeVisible()
    await page.screenshot({ path: `docs/screenshots/${info.project.name}-mind-none.png`, fullPage: info.project.name === "desktop" })
  })

  test("capture mind analytics", async ({ page }, info) => {
    await page.goto("/analytics?periodo=90#mente")
    const region = page.getByRole("region", { name: /^Mente y energía/ })
    await expect(region.getByText("Descriptivo, no causal")).toBeVisible()
    await page.waitForLoadState("networkidle")
    await region.screenshot({ path: `docs/screenshots/${info.project.name}-mind-analytics.png` })
  })

  test("capture focus paused prompt", async ({ page }, info) => {
    await page.goto("/focus")
    await page.getByRole("button", { name: /^Empezar/ }).click()
    await page.clock.setFixedTime(new Date(FIXED_NOW.getTime() + 20 * 60_000))
    await page.getByRole("button", { name: "Pausar" }).click()
    await page.clock.setFixedTime(new Date(FIXED_NOW.getTime() + 60 * 60_000))
    await page.goto("/")
    await expect(page.getByRole("dialog", { name: "¿Sigue en curso?" })).toBeVisible()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `docs/screenshots/${info.project.name}-focus-paused-prompt.png` })
  })
})
