import type { Page } from "@playwright/test"
import { expect, isMobile, test } from "./fixtures"

/**
 * F1 · The Command Center tells apart what can all look like «nothing done» (Plan §5.1): no data,
 * a planned rest, something left undone and a sync error. Demo mode, fixed clock: Wednesday
 * 21 Oct 2026, 18:30 Madrid, so «yesterday» is Tuesday 20. Sync errors and empty accounts are in
 * overview-account.spec.ts.
 */
const count = async (page: Page, id: string) => Number(await page.getByTestId(id).innerText())
const missedYesterday = async (page: Page) => {
  const link = page.getByTestId("overview-missed")
  if ((await link.count()) === 0) return 0
  return Number(/(\d+) hábito/.exec(await link.innerText())![1])
}
const matrix = (page: Page) => page.getByRole("region", { name: "Matriz semanal" })

async function openWeek(page: Page, mobile: boolean) {
  await page.goto("/habits")
  if (mobile) await page.getByRole("radio", { name: "Semana" }).click()
  await expect(matrix(page)).toBeVisible()
}

test.describe("Command Center states (demo)", () => {
  test("an active day tells done and pending apart, and a tap moves one from pending to done", async ({ page, consoleErrors }) => {
    await page.goto("/")
    const day = page.getByTestId("overview-day")
    await expect(day).toHaveAttribute("data-state", "active")
    const done = await count(page, "overview-done")
    const pending = await count(page, "overview-pending")
    expect(pending).toBeGreaterThan(0)
    expect(await count(page, "overview-rests")).toBe(0)
    // The same figures as the ring and the title.
    await expect(day.getByRole("img", { name: `Hoy: ${done} de ${done + pending} hábitos` })).toBeVisible()
    await expect(day.getByRole("heading", { level: 2 })).toHaveText(`${pending} ${pending === 1 ? "hábito pendiente" : "hábitos pendientes"} hoy`)

    await page.getByRole("region", { name: "Hoy" }).locator('button[aria-pressed="false"]').first().click()
    await expect(page.getByTestId("overview-done")).toHaveText(String(done + 1))
    await expect(page.getByTestId("overview-pending")).toHaveText(String(pending - 1))
    expect(consoleErrors).toEqual([])
  })

  test("yesterday's undone habits are counted apart, as in the weekly matrix, and recording one late takes it off", async ({ page }, info) => {
    await page.goto("/")
    await expect(page.getByTestId("overview-day")).toHaveAttribute("data-state", "active")
    const before = await missedYesterday(page)
    expect(before).toBeGreaterThan(0)

    await openWeek(page, isMobile(info.project.name))
    // Every kind of cell: a tap or a quantity (buttons) and a habit fed by Focus (a link).
    const name = /, martes, 20 de octubre: (no hecho|registrado, sin alcanzar el objetivo)/
    const undone = matrix(page).getByRole("button", { name }).or(matrix(page).getByRole("link", { name }))
    await expect(undone).toHaveCount(before)
    // Record one of them late (a binary one: a tap marks it done).
    await matrix(page).getByRole("button", { name: /, martes, 20 de octubre: no hecho$/ }).first().click()
    await expect(undone).toHaveCount(before - 1)

    await page.goto("/")
    await expect.poll(() => missedYesterday(page)).toBe(before - 1)
  })

  test("a planned rest day is rest: no pending, its habits resting, and it is not «nothing scheduled»", async ({ page }, info) => {
    await page.goto("/")
    await expect(page.getByTestId("overview-day")).toHaveAttribute("data-state", "active")
    const due = (await count(page, "overview-done")) + (await count(page, "overview-pending"))
    const missed = await missedYesterday(page)

    await openWeek(page, isMobile(info.project.name))
    await page.getByRole("button", { name: /miércoles, 21 de octubre, hoy\. Opciones del día/ }).click()
    await page.getByRole("menuitem", { name: "Marcar como descanso" }).click()

    await page.goto("/")
    const day = page.getByTestId("overview-day")
    await expect(day).toHaveAttribute("data-state", "rest")
    await expect(day.getByRole("heading", { level: 2 })).toHaveText("Hoy es día de descanso planificado")
    await expect(day).toContainText("no cuenta como incumplimiento")
    await expect(page.getByTestId("overview-pending")).toHaveText("0")
    await expect(page.getByTestId("overview-rests")).toHaveText(String(due))
    // Resting today does not erase what was left undone yesterday.
    expect(await missedYesterday(page)).toBe(missed)
  })

  test("shortcuts lead to real places, with no placeholder content", async ({ page }) => {
    await page.goto("/")
    const shortcuts = page.getByTestId("overview-shortcuts")
    await expect(shortcuts.getByRole("link")).toHaveText([/Hábitos/, /Repaso/, /Revisiones/, /Analytics/])
    await expect(page.getByText("Top 3 de hoy")).toHaveCount(0)
    await shortcuts.getByRole("link", { name: /Repaso/ }).click()
    await expect(page).toHaveURL(/\/knowledge\/brain\/repaso$/)
  })
})
