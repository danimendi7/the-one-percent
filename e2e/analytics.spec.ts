import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "./fixtures"

test.describe("analytics drilldown and filters (demo data, fixed clock)", () => {
  test("«Comparativas» sets the last closed week and month against the one before", async ({ page, consoleErrors }) => {
    await page.goto("/analytics")
    const panel = page.getByRole("region", { name: "Comparativas" })
    // The fixed clock is Wednesday 21 Oct 2026: the open week is left out.
    await expect(panel.getByTestId("comparison-after")).toHaveText("12 oct – 18 oct")
    await expect(panel.getByTestId("comparison-before")).toHaveText("5 oct – 11 oct")
    await expect(panel.getByTestId("comparison-completion")).toContainText(/\d+%.*\d+%.*pts|—/)

    await panel.getByRole("radio", { name: "Mes" }).click()
    await expect(panel.getByTestId("comparison-after")).toHaveText("septiembre de 2026")
    await expect(panel.getByTestId("comparison-before")).toHaveText("agosto de 2026")
    expect(consoleErrors).toEqual([])
  })

  test("«Relaciones» names period, variables and sample size, and never speaks of causes", async ({ page, consoleErrors }) => {
    await page.goto("/analytics?periodo=90")
    const panel = page.getByRole("region", { name: "Relaciones" })
    await expect(panel.getByText("Descriptivo, no causal")).toBeVisible()
    const row = panel.getByTestId("relation-row").first()
    await expect(row.getByRole("heading")).toHaveText(/ y /)
    await expect(row).toContainText(/\d+ días con ambos datos/)
    await expect(row).toContainText(/\d{1,2} \w+.*–/)

    await panel.getByText(/^Ver (el otro cruce|los otros \d+ cruces)$/).click()
    const text = (await panel.getByTestId("relation-row").allInnerTexts()).join(" ")
    expect(text).not.toMatch(/\b(causa|causan|provocan|hace que|debido a|gracias a|porque)\b/i)
    expect(consoleErrors).toEqual([])

    const axe = await new AxeBuilder({ page }).include('[data-testid="relations"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([])
  })

  test("«Relaciones» gives no figure with a short period, and says why", async ({ page }) => {
    await page.goto("/analytics?periodo=7")
    const panel = page.getByRole("region", { name: "Relaciones" })
    await expect(panel.getByTestId("relations-empty")).toContainText("al menos 14 días")
    await panel.getByText(/^Ver los otros \d+ cruces$/).click()
    await expect(panel.getByTestId("relation-row").first()).toContainText("Hacen falta al menos 14 días")
    await expect(panel.getByText(/[+−]\d,\d\d/)).toHaveCount(0)
  })

  test("filters live in the URL and survive a reload", async ({ page, consoleErrors }) => {
    await page.goto("/analytics")
    await page.getByRole("radio", { name: "90 días" }).click()
    await page.getByRole("combobox", { name: "Dimensión" }).click()
    await page.getByRole("option", { name: "Mente" }).click()
    await expect(page).toHaveURL(/\/analytics\?periodo=90&dimension=mind$/)

    await page.reload()
    await expect(page.getByRole("radio", { name: "90 días" })).toHaveAttribute("aria-checked", "true")
    await expect(page.getByRole("combobox", { name: "Dimensión" })).toHaveText("Mente")

    await page.goto("/analytics?periodo=12&dimension=hack")
    await expect(page.getByRole("radio", { name: "30 días" })).toHaveAttribute("aria-checked", "true")
    expect(consoleErrors).toEqual([])
  })

  test("the completion figure opens exactly the records behind it", async ({ page, consoleErrors }) => {
    await page.goto("/analytics")
    const stat = page.getByRole("button", { name: /^Cumplimiento.*Ver detalle$/ })
    const [, fulfilled, applicable] = /(\d+) de (\d+) oportunidades/.exec(await stat.innerText())!
    await stat.click()

    const sheet = page.getByRole("dialog", { name: /Cumplimiento en los últimos 30 días/ })
    await expect(sheet.getByTestId("drill-summary")).toContainText(`${fulfilled} cumplidas de ${applicable} aplicables`)
    const group = (name: string) => sheet.getByRole("region", { name, exact: true }).getByRole("listitem")
    await expect(group("Cumplido")).toHaveCount(Number(fulfilled))
    const missed = await group("No cumplido").count()
    const pending = await group("Pendiente hoy").count()
    expect(Number(fulfilled) + missed + pending).toBe(Number(applicable))

    const axe = await new AxeBuilder({ page }).include("[role=dialog]").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([])
    expect(consoleErrors).toEqual([])
  })

  test("a week in the trend table opens that week's records (touch-friendly path)", async ({ page }) => {
    await page.goto("/analytics")
    const trend = page.getByRole("region", { name: "Tendencia semanal" })
    await trend.getByRole("button", { name: "Tabla" }).click()
    const lastWeek = trend.getByRole("button", { name: /ver detalle/ }).last()
    const box = await lastWeek.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    await lastWeek.click()
    await expect(page.getByRole("dialog", { name: /^Semana del / })).toBeVisible()
  })

  test("a habit row filters the whole page and the filter is in the URL", async ({ page }) => {
    await page.goto("/analytics")
    await page.getByRole("region", { name: "Por hábito" }).getByRole("button").first().click()
    await expect(page).toHaveURL(/habito=/)
    await expect(page.getByText(/Filtrado por/)).toBeVisible()
    await page.getByRole("button", { name: "Quitar filtro" }).click()
    await expect(page).toHaveURL(/\/analytics$/)
  })
})
