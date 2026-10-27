import AxeBuilder from "@axe-core/playwright"
import { expect, isMobile, test } from "./fixtures"

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]
const serious = (r: { violations: { impact?: string | null; id: string }[] }) =>
  r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)

test.describe("goals (demo data, fixed clock)", () => {
  test("list: primary and secondary sections, horizon filter in the URL, accessible", async ({ page, consoleErrors }) => {
    await page.goto("/goals")
    await expect(page.getByRole("region", { name: "Principales" }).getByRole("article")).toHaveCount(3)
    await expect(page.getByRole("region", { name: "Secundarios" }).getByRole("article")).toHaveCount(3)

    await page.getByRole("radio", { name: "Largo" }).click()
    await expect(page).toHaveURL(/\/goals\?plazo=long$/)
    await page.reload()
    await expect(page.getByRole("radio", { name: "Largo" })).toHaveAttribute("aria-checked", "true")
    await expect(page.getByRole("article")).toHaveCount(2)

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    expect(serious(await new AxeBuilder({ page }).withTags(WCAG).analyze())).toEqual([])
    expect(consoleErrors).toEqual([])
  })

  test("the three data states are explicit: enough history, few points, none (N/D, never 0 %)", async ({ page }) => {
    await page.goto("/goals/demo-goal-10k")
    await expect(page.getByText(/A este ritmo llegarías a la meta/)).toBeVisible()

    await page.goto("/goals/demo-goal-weight")
    await expect(page.getByText("Pocos datos", { exact: true })).toBeVisible()
    await expect(page.getByText(/Hacen falta al menos 3 mediciones/).first()).toBeVisible()

    await page.goto("/goals/demo-goal-savings")
    await expect(page.getByRole("region", { name: "Resultado" }).getByText("Sin datos", { exact: true })).toBeVisible()
    await expect(page.getByRole("region", { name: "Resultado" }).getByText("N/D", { exact: true })).toBeVisible()
    await expect(page.getByText("Sin registros todavía")).toBeVisible()
  })

  test("create a numeric goal in 3 steps, then measure it in two taps", async ({ page, consoleErrors }) => {
    await page.goto("/goals")
    await page.getByRole("button", { name: "Nuevo objetivo" }).click()
    const sheet = page.getByRole("dialog")
    await sheet.getByLabel("Objetivo", { exact: true }).fill("Correr 500 km este año")
    await sheet.getByRole("button", { name: "Siguiente" }).click()

    await sheet.getByRole("radio", { name: "Acumulado" }).click()
    await sheet.getByLabel("Meta").fill("500")
    await sheet.getByLabel("Unidad").fill("km")
    await expect(sheet.getByText(/Ritmo necesario desde hoy/)).toBeVisible()
    await sheet.getByRole("button", { name: "Siguiente" }).click()
    await sheet.getByRole("switch", { name: "Vincular Entrenamiento de fuerza" }).click()
    await sheet.getByRole("button", { name: "Crear objetivo" }).click()

    const card = page.getByRole("article", { name: "Correr 500 km este año" })
    await expect(card.getByText("Sin datos", { exact: true })).toBeVisible()
    await card.getByRole("button", { name: /Registrar/ }).click()
    const measure = page.getByRole("dialog", { name: "Registrar medición" })
    await measure.getByLabel("Valor (km)").fill("12,5")
    await measure.getByRole("button", { name: "Guardar" }).click()
    await expect(card.getByText("0 km → 12,5 km · meta 500 km")).toBeVisible()
    await expect(card.getByText("3%")).toBeVisible()
    expect(consoleErrors).toEqual([])
  })

  test("validation keeps you on the step with the problem", async ({ page }) => {
    await page.goto("/goals")
    await page.getByRole("button", { name: "Nuevo objetivo" }).click()
    const sheet = page.getByRole("dialog")
    await sheet.getByRole("button", { name: "Siguiente" }).click()
    await expect(sheet.getByRole("alert")).toHaveText("Escribe el objetivo.")
    await expect(sheet.getByText("Paso 1 de 3")).toBeVisible()
  })

  test("a habit-fed goal takes no manual measurements (no duplicate logging)", async ({ page }) => {
    await page.goto("/goals/demo-goal-meditation")
    await expect(page.getByText(/Se alimenta de los registros de/)).toBeVisible()
    await expect(page.getByRole("button", { name: "Registrar medición" })).toHaveCount(0)
  })

  test("the effort figure opens exactly the records behind it", async ({ page }) => {
    await page.goto("/goals/demo-goal-10k")
    const effort = page.getByRole("button", { name: /oportunidades cumplidas/ })
    const [, fulfilled, applicable] = /(\d+) de (\d+) oportunidades/.exec(await effort.innerText())!
    await effort.click()
    const sheet = page.getByRole("dialog", { name: /Esfuerzo · Correr 10 km/ })
    await expect(sheet.getByTestId("drill-summary")).toContainText(`${fulfilled} cumplidas de ${applicable} aplicables`)
    expect(serious(await new AxeBuilder({ page }).include("[role=dialog]").withTags(WCAG).analyze())).toEqual([])
  })

  test("ticking a milestone moves a milestone goal; data-driven milestones are not clickable", async ({ page }) => {
    await page.goto("/goals/demo-goal-v1")
    await expect(page.getByText("3 de 7 hitos")).toBeVisible()
    await page.getByRole("button", { name: /M3 · Analítica y objetivos/ }).click()
    await expect(page.getByText("4 de 7 hitos")).toBeVisible()

    await page.goto("/goals/demo-goal-10k")
    await expect(page.getByText("Bajar de 55 min")).toBeVisible()
    await expect(page.getByRole("button", { name: /Bajar de 55 min/ })).toHaveCount(0)
  })

  test("detail page: accessible, touch targets ≥ 44 px on mobile, no horizontal overflow", async ({ page, consoleErrors }, info) => {
    await page.goto("/goals/demo-goal-10k")
    const register = page.getByRole("button", { name: "Registrar medición" })
    // Design system: 44 px on touch, 40 px with a pointer (md+).
    if (isMobile(info.project.name)) expect((await register.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    expect(serious(await new AxeBuilder({ page }).withTags(WCAG).analyze())).toEqual([])
    expect(consoleErrors).toEqual([])
  })

  test("an unknown goal id shows a clear message", async ({ page }) => {
    await page.goto("/goals/no-such-goal")
    await expect(page.getByText("Este objetivo no existe")).toBeVisible()
  })

  test("Overview shows only primary goals; Analytics filters by a goal's habits", async ({ page }) => {
    await page.goto("/")
    const goals = page.getByRole("region", { name: "Objetivos activos" })
    await expect(goals.getByRole("link", { name: /Correr 10 km/ })).toBeVisible()
    await expect(goals.getByText("Bajar a 78 kg")).toHaveCount(0)

    await page.goto("/goals/demo-goal-10k")
    await page.getByRole("link", { name: "Ver estos hábitos en Análisis" }).click()
    await expect(page).toHaveURL(/\/analytics\?objetivo=demo-goal-10k$/)
    await expect(page.getByText(/Hábitos del objetivo/)).toBeVisible()
    await page.getByRole("button", { name: "Quitar filtro" }).click()
    await expect(page).toHaveURL(/\/analytics$/)
  })

  test("a habit shows the goals it contributes to", async ({ page }, info) => {
    test.skip(isMobile(info.project.name), "covered once")
    await page.goto("/habits")
    await page.getByRole("button", { name: /Editar Entrenamiento de fuerza/ }).first().click()
    await expect(page.getByRole("dialog").getByRole("link", { name: "Correr 10 km en menos de 50 minutos" })).toBeVisible()
  })
})
