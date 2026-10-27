import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "./fixtures"

test.describe("analytics drilldown and filters (demo data, fixed clock)", () => {
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
