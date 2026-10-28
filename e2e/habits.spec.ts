import type { Page } from "@playwright/test"
import { expect, isMobile, test } from "./fixtures"

const todayMetric = (page: Page) => page.getByRole("img", { name: /de \d+ hábitos de hoy/ })

/** Today checklist cell for a habit (the checklist is the always-visible "Hoy" list). */
const todayCell = (page: Page, habit: string) =>
  page.getByRole("region", { name: "Hoy" }).getByRole("button", { name: new RegExp(`^${habit}, miércoles, 21 de octubre`) })

test.describe("habit tracker (local demo)", () => {
  test("one tap marks a habit, metrics update, state persists and undo works", async ({ page }) => {
    await page.goto("/habits")
    await expect(todayMetric(page)).toHaveAccessibleName("2 de 8 hábitos de hoy")

    const cell = todayCell(page, "Bloque de trabajo profundo")
    await expect(cell).toHaveAttribute("aria-pressed", "false")
    await cell.click()
    await expect(cell).toHaveAttribute("aria-pressed", "true")
    await expect(todayMetric(page)).toHaveAccessibleName("3 de 8 hábitos de hoy")

    await page.reload()
    await expect(todayCell(page, "Bloque de trabajo profundo")).toHaveAttribute("aria-pressed", "true")
    await expect(todayMetric(page)).toHaveAccessibleName("3 de 8 hábitos de hoy")

    // Unmark, then undo the unmark from the toast
    await todayCell(page, "Bloque de trabajo profundo").click()
    await expect(todayMetric(page)).toHaveAccessibleName("2 de 8 hábitos de hoy")
    await page.getByRole("button", { name: "Deshacer" }).click()
    await expect(todayMetric(page)).toHaveAccessibleName("3 de 8 hábitos de hoy")
  })

  test("numeric quick entry stores the exact amount and completes the target", async ({ page }) => {
    await page.goto("/habits")
    await todayCell(page, "Pasos").click()
    const input = page.getByLabel("Valor en pasos")
    await input.fill("7400")
    await expect(page.getByText(/Por debajo del objetivo/)).toBeVisible()
    await input.fill("9120")
    await expect(page.getByText("Objetivo cumplido")).toBeVisible()
    await page.getByRole("button", { name: "Guardar" }).click()
    await expect(todayCell(page, "Pasos")).toHaveAccessibleName(/hecho, 9120 pasos/)
    await expect(todayMetric(page)).toHaveAccessibleName("3 de 8 hábitos de hoy")
  })

  test("a quick value saves in one tap", async ({ page }, info) => {
    await page.goto("/habits")
    await todayCell(page, "Lectura").click()
    if (isMobile(info.project.name)) await expect(page.getByRole("dialog")).toBeVisible() // bottom sheet on phones
    await page.getByRole("button", { name: "Registrar 30 min" }).click()
    await expect(todayCell(page, "Lectura")).toHaveAccessibleName(/hecho, 30 min/)
    await expect(todayMetric(page)).toHaveAccessibleName("3 de 8 hábitos de hoy")
  })

  test("metric explanations open with a tap on mobile", async ({ page }, info) => {
    test.skip(!isMobile(info.project.name), "mobile only")
    await page.goto("/habits")
    await page.getByRole("button", { name: "Detalle de métricas y cómo se calculan" }).click()
    const sheet = page.getByRole("dialog", { name: "Cómo se calcula" })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText(/Oportunidades cumplidas \/ aplicables/)).toBeVisible()
  })

  test("a new Mon/Wed habit appears only on scheduled days (acceptance #1)", async ({ page }, info) => {
    await page.goto("/habits")
    await page.getByRole("button", { name: "Nuevo hábito" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Nombre").fill("Idiomas")
    await dialog.getByRole("radio", { name: "Días concretos" }).click()
    // default selection is Mon-Fri: keep Monday and Wednesday only
    for (const day of ["martes", "jueves", "viernes"]) await dialog.getByRole("button", { name: day }).click()
    await dialog.getByRole("button", { name: "Crear hábito" }).click()
    await expect(dialog).toBeHidden()

    if (isMobile(info.project.name)) await page.getByRole("radio", { name: "Semana" }).click()
    const grid = page.getByRole("region", { name: "Matriz semanal" })
    await expect(grid.getByRole("button", { name: "Editar Idiomas" })).toBeVisible()
    // Wednesday (today, start date) is tappable; Tuesday and Thursday are not scheduled.
    await expect(grid.getByRole("button", { name: /^Idiomas, miércoles, 21 de octubre: pendiente hoy/ })).toBeVisible()
    await expect(grid.getByRole("img", { name: /^Idiomas, martes, 20 de octubre: no programado/ })).toBeVisible()
    await expect(grid.getByRole("img", { name: /^Idiomas, jueves, 22 de octubre: no programado/ })).toBeVisible()
    // Today's denominator grew by exactly one.
    await expect(todayMetric(page)).toHaveAccessibleName("2 de 9 hábitos de hoy")
  })

  test("validation blocks an empty habit name", async ({ page }) => {
    await page.goto("/habits")
    await page.getByRole("button", { name: "Nuevo hábito" }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Crear hábito" }).click()
    await expect(page.getByRole("alert")).toHaveText("Ponle un nombre.")
  })

  test("marking a rest day removes the day from today's checklist", async ({ page }, info) => {
    await page.goto("/habits")
    if (isMobile(info.project.name)) await page.getByRole("radio", { name: "Semana" }).click()
    await page.getByRole("button", { name: /miércoles, 21 de octubre, hoy\. Opciones del día/ }).click()
    await page.getByRole("menuitem", { name: "Marcar como descanso" }).click()
    if (isMobile(info.project.name)) await page.getByRole("radio", { name: "Hoy" }).click()
    await expect(page.getByText("Hoy es día de descanso")).toBeVisible()
    await expect(todayMetric(page)).toHaveAccessibleName("0 de 0 hábitos de hoy")
  })

  test("future days cannot be recorded", async ({ page }, info) => {
    await page.goto("/habits")
    if (isMobile(info.project.name)) await page.getByRole("radio", { name: "Semana" }).click()
    const future = page.getByRole("region", { name: "Matriz semanal" }).getByRole("img", { name: /^Meditación, jueves, 22 de octubre: pendiente \(futuro\)/ })
    await expect(future).toBeVisible()
  })
})
