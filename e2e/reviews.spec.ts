import type { Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { expect, isMobile, test } from "./fixtures"

/**
 * M3.4d · Life Review in demo mode (fixed clock: Wednesday 21 Oct 2026). The week due is 12–18
 * October, with two decisions of the previous week to evaluate; September is the month due.
 */
const WEEK = "/reviews/week/2026-10-12"
const DAY = "/reviews/day/2026-10-21"

async function blocking(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)
}

/** Mobile walks the steps; desktop shows every section at once. */
async function goToStep(page: Page, mobile: boolean, step: RegExp) {
  if (mobile) await page.getByRole("navigation", { name: "Pasos de la revisión" }).getByRole("button", { name: step }).click()
}

test.describe("life review (demo)", () => {
  test("home: the week due now, the history with frozen figures, and the monthly switch in the URL", async ({ page, consoleErrors }) => {
    await page.goto("/reviews")
    const now = page.getByTestId("review-now")
    await expect(now).toContainText("Tu revisión semanal está lista")
    await expect(now).toContainText("Semana del 12 oct al 18 oct")
    await expect(now).toContainText("2 por evaluar")
    await expect(page.getByTestId("review-row")).toHaveCount(2)
    await expect(page.getByTestId("review-row").first()).toContainText("Cerrada")
    await page.getByRole("radio", { name: "Mensual" }).click()
    await expect(page).toHaveURL(/tipo=mensual/)
    await expect(now).toContainText("Septiembre de 2026")
    expect(consoleErrors).toEqual([])
  })

  test("the weekly walk: figures, reflection saved without a button, evaluations, a decision; kept after reloading; closed and frozen", async ({ page, consoleErrors }, info) => {
    const mobile = isMobile(info.project.name)
    await page.goto("/reviews")
    await page.getByTestId("review-now-open").click()
    await expect(page).toHaveURL(WEEK)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Semana del 12 oct al 18 oct")
    // Figures with their denominators and the comparison.
    const habits = page.getByTestId("figures-habits")
    await expect(habits).toContainText(/\d+ de \d+ cumplidas/)
    await expect(habits).toContainText(/pts vs semana anterior/)
    await expect(page.getByTestId("figures-mind")).toContainText("tus reflexiones privadas nunca aparecen")

    if (mobile) {
      await expect(page.getByText("Paso 1 de 5", { exact: false })).toBeVisible()
      await page.getByTestId("review-next").click()
      await expect(page.getByRole("heading", { name: "Reflexión" })).toBeFocused()
    }
    await page.getByTestId("review-wins").fill("Tres mañanas de foco")
    await expect(page.getByTestId("review-save")).toContainText("Guardado en este navegador · demo")

    await goToStep(page, mobile, /Decisiones anteriores/)
    const evaluation = page.getByTestId("review-evaluation").first()
    await evaluation.getByRole("radio", { name: "Cumplida", exact: true }).click()
    await expect(evaluation.getByRole("radio", { name: "Cumplida", exact: true })).toHaveAttribute("aria-checked", "true")

    await goToStep(page, mobile, /Próximo periodo/)
    await page.getByTestId("review-add-decision").click()
    await page.getByLabel("Decisión 1", { exact: true }).fill("4 bloques de foco de 90 min")
    await page.getByRole("radiogroup", { name: "Tipo de la decisión 1" }).getByRole("radio", { name: "Mantener" }).click()
    await page.getByLabel("Decisión 1", { exact: true }).blur()

    // Reloading keeps everything (and the step on mobile).
    await page.reload()
    await expect(page.getByLabel("Decisión 1", { exact: true })).toHaveValue("4 bloques de foco de 90 min")
    await goToStep(page, mobile, /Reflexión/)
    await expect(page.getByTestId("review-wins")).toHaveValue("Tres mañanas de foco")
    await goToStep(page, mobile, /Decisiones anteriores/)
    await expect(page.getByTestId("review-evaluation").first().getByRole("radio", { name: "Cumplida", exact: true })).toHaveAttribute("aria-checked", "true")

    // Close with an explicit confirmation that explains the freeze.
    await goToStep(page, mobile, /Cerrar/)
    await page.getByTestId("review-close").click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toContainText("Las cifras quedarán congeladas")
    await expect(dialog).toContainText("1 de 3 preguntas respondidas")
    await dialog.getByTestId("review-close-confirm").click()

    // A read-only historical document.
    await expect(page.getByTestId("review-closed-stamp")).toContainText("cifras congeladas")
    await expect(page.locator("textarea")).toHaveCount(0)
    await expect(page.getByText("Tres mañanas de foco")).toBeVisible()
    await expect(page.getByTestId("review-closed-decision")).toContainText("sin evaluar todavía")
    await page.goto("/reviews")
    await expect(page.getByTestId("review-now")).toContainText("Estás al día")
    // The decision log sees the new decision and the evaluation.
    await page.goto("/reviews/decisions")
    await expect(page.getByTestId("decision-row").filter({ hasText: "4 bloques de foco de 90 min" })).toContainText("Sin evaluar")
    await expect(page.getByTestId("decision-summary")).toContainText("Cumplidas 2 de 3 evaluadas")
    expect(consoleErrors).toEqual([])
  })

  test("the daily review: today's figures, two questions saved without a button, closed and frozen, and the week untouched", async ({ page, consoleErrors }, info) => {
    const mobile = isMobile(info.project.name)
    await page.goto("/reviews")
    await page.getByRole("radio", { name: "Diaria" }).click()
    await expect(page).toHaveURL(/tipo=diaria/)
    const now = page.getByTestId("review-now")
    await expect(now).toContainText("Tu revisión diaria está lista")
    await expect(now).toContainText("Miércoles, 21 de octubre")
    await expect(now).toContainText("0 de 2 preguntas")
    await expect(now).not.toContainText("decisiones")

    await page.getByTestId("review-now-open").click()
    await expect(page).toHaveURL(DAY)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Miércoles, 21 de octubre")
    await expect(page.getByTestId("figures-habits")).toBeVisible()
    await expect(page.getByTestId("figures-goals")).toHaveCount(0)

    if (mobile) {
      await expect(page.getByText("Paso 1 de 3", { exact: false })).toBeVisible()
      await page.getByTestId("review-next").click()
      await expect(page.getByRole("heading", { name: "Reflexión" })).toBeFocused()
    }
    await page.getByTestId("review-observations").fill("Dormí poco y lo noté a mediodía")
    await page.getByTestId("review-adjustments").fill("Acostarme antes de las once")
    await expect(page.getByTestId("review-save")).toContainText("Guardado en este navegador · demo")
    await expect(page.getByRole("button", { name: "Añadir una nota libre" })).toHaveCount(0)
    await expect(page.getByTestId("review-add-decision")).toHaveCount(0)

    await page.reload()
    await goToStep(page, mobile, /Reflexión/)
    await expect(page.getByTestId("review-observations")).toHaveValue("Dormí poco y lo noté a mediodía")
    await expect(page.getByTestId("review-adjustments")).toHaveValue("Acostarme antes de las once")

    await goToStep(page, mobile, /Cerrar/)
    await page.getByTestId("review-close").click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toContainText("Las cifras quedarán congeladas")
    await expect(dialog).toContainText("2 de 2 preguntas respondidas")
    await expect(dialog).not.toContainText("para el próximo periodo")
    await dialog.getByTestId("review-close-confirm").click()

    await expect(page.getByTestId("review-closed-stamp")).toContainText("cifras congeladas")
    await expect(page.locator("textarea")).toHaveCount(0)
    await expect(page.getByText("Acostarme antes de las once")).toBeVisible()
    await expect(page.getByText("Decisiones para mañana")).toHaveCount(0)

    await page.goto("/reviews?tipo=diaria")
    await expect(now).toContainText("La revisión de hoy está cerrada")
    await expect(page.getByTestId("review-row")).toHaveCount(1)
    await expect(page.getByTestId("review-row").first()).toContainText("Cerrada")

    // Earlier reviews stay as they were.
    await page.goto("/reviews")
    await expect(now).toContainText("Tu revisión semanal está lista")
    await expect(now).toContainText("2 por evaluar")
    await expect(page.getByTestId("review-row")).toHaveCount(2)
    await page.goto("/reviews/week/2026-10-05")
    await expect(page.getByTestId("review-closed-stamp")).toContainText("Cerrada · cifras congeladas")
    expect(consoleErrors).toEqual([])
  })

  test("a past day can be reviewed; tomorrow and a date that does not exist are explained", async ({ page }) => {
    await page.goto("/reviews/day/2026-10-20")
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Martes, 20 de octubre")
    await expect(page.getByTestId("figures-habits")).toBeVisible()
    await page.goto("/reviews/day/2026-10-22")
    await expect(page.getByTestId("review-invalid")).toContainText("Esta revisión no existe")
    await page.goto("/reviews/day/2026-02-30")
    await expect(page.getByTestId("review-invalid")).toBeVisible()
  })

  test("keyboard: the options are radiogroups with arrow keys", async ({ page }, info) => {
    test.skip(isMobile(info.project.name), "keyboard on desktop")
    await page.goto(WEEK)
    const group = page.getByRole("radiogroup", { name: /Resultado de «Acostarme/ })
    await group.getByRole("radio", { name: "Cumplida", exact: true }).focus()
    await page.keyboard.press("ArrowRight")
    await expect(group.getByRole("radio", { name: "Parcial" })).toHaveAttribute("aria-checked", "true")
    await expect(group.getByRole("radio", { name: "Parcial" })).toBeFocused()
  })

  test("monthly: strategic questions, consistency by weekday and the accessible weeks table", async ({ page }) => {
    await page.goto("/reviews/month/2026-09-01")
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Septiembre de 2026")
    await expect(page.getByTestId("figures-habits")).toContainText("Cumplimiento por día de la semana")
    const table = page.getByRole("table", { name: /cada semana del mes/ })
    await expect(table.getByRole("row")).toHaveCount(6) // header + 5 weeks touching September 2026
  })

  test("a closed review is read-only; a period that is not a period start, or not over, is explained", async ({ page }) => {
    await page.goto("/reviews/week/2026-10-05")
    await expect(page.getByTestId("review-closed-stamp")).toContainText("Cerrada · cifras congeladas")
    await expect(page.locator("textarea, input")).toHaveCount(0)
    await page.goto("/reviews/week/2026-10-13")
    await expect(page.getByTestId("review-invalid")).toContainText("Esta revisión no existe")
    await page.goto("/reviews/week/2026-10-19")
    await expect(page.getByTestId("review-invalid")).toBeVisible()
  })

  test("Resumen: a card for each review due, which can wait until tomorrow", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId("overview-review-week")).toContainText("Tu revisión semanal está lista")
    await page.getByRole("button", { name: /Posponer hasta mañana: Semana/ }).click()
    await expect(page.getByTestId("overview-review-week")).toHaveCount(0)
    await expect(page.getByTestId("overview-review-month")).toBeVisible()
  })

  test("exceptional delete needs the typed confirmation", async ({ page }) => {
    await page.goto("/reviews/week/2026-10-05")
    await page.getByRole("button", { name: "Borrar esta revisión" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByTestId("review-delete-confirm")).toBeDisabled()
    await dialog.getByLabel(/para confirmar/).fill("borrar")
    await dialog.getByTestId("review-delete-confirm").click()
    await expect(page).toHaveURL("/reviews")
    await expect(page.getByTestId("review-row")).toHaveCount(1)
  })

  // One test per page: seven full axe scans in one test came too close to its 30 s budget (run 42740714349).
  for (const route of ["/reviews", "/reviews?tipo=diaria", DAY, WEEK, "/reviews/week/2026-10-05", "/reviews/month/2026-09-01", "/reviews/decisions"]) {
    test(`a11y: ${route}`, async ({ page }) => {
      await page.goto(route)
      await expect(page.locator("h1").first()).toBeVisible()
      await page.waitForLoadState("networkidle")
      expect(await blocking(page), route).toEqual([])
    })
  }

  test("a11y: the close dialog", async ({ page }, info) => {
    await page.goto(WEEK)
    const mobile = isMobile(info.project.name)
    await goToStep(page, mobile, /Cerrar/)
    await page.getByTestId(mobile ? "review-close" : "review-close-header").click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.waitForTimeout(300) // dialog animation
    expect(await blocking(page)).toEqual([])
  })
})
