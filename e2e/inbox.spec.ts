import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"

/**
 * E7 · The in-app inbox, demo mode. The fixed clock is Wednesday 21 Oct 2026, 18:30 Madrid: by the
 * default settings the midday reminder is due (pending habits) and the weekly review too.
 */
const bell = (page: Page) => page.getByTestId("inbox-button").locator("visible=true")
const clearInbox = (page: Page) => page.evaluate(() => localStorage.removeItem("the-one-percent:inbox:demo"))

async function settings(page: Page, change: (page: Page) => Promise<void>) {
  await page.goto("/settings/notifications")
  await expect(page.getByTestId("motivation-sample")).toBeVisible()
  await change(page)
  await clearInbox(page)
  await page.goto("/")
  await expect(page.locator("h1").first()).toBeVisible()
}

test.describe("in-app inbox (demo)", () => {
  test("one reminder at a time by default, unread until opened, never repeated after reloading", async ({ page, consoleErrors }) => {
    await page.goto("/")
    await expect(bell(page)).toHaveAccessibleName("Avisos, 1 sin leer")
    await bell(page).click()
    const items = page.getByRole("dialog").getByTestId("inbox-item")
    await expect(items).toHaveCount(1)
    await expect(items.first()).toContainText("Hábitos de hoy")
    await page.keyboard.press("Escape")
    await expect(bell(page)).toHaveAccessibleName("Avisos")
    await page.reload()
    await expect(bell(page)).toHaveAccessibleName("Avisos")
    await bell(page).click()
    await expect(page.getByRole("dialog").getByTestId("inbox-item")).toHaveCount(1)
    expect(consoleErrors).toEqual([])
  })

  test("a dismissed reminder goes away and does not come back", async ({ page }) => {
    await page.goto("/")
    await bell(page).click()
    await page.getByRole("button", { name: /^Descartar: / }).click()
    await expect(page.getByRole("dialog").getByTestId("inbox-empty")).toBeVisible()
    await page.reload()
    await bell(page).click()
    await expect(page.getByRole("dialog").getByTestId("inbox-empty")).toBeVisible()
  })

  test("respects the daily cap: with no gap, everything due fits only up to the cap", async ({ page }) => {
    await settings(page, async (p) => {
      // No gap so both due reminders could arrive together; cap of 1 lets in only the first.
      await p.getByRole("slider", { name: "Minutos mínimos entre dos mensajes" }).press("Home")
      await p.getByRole("slider", { name: "Máximo de mensajes al día" }).press("Home")
      await expect(p.getByTestId("motivation-cap")).toHaveText("1 mensaje")
    })
    await expect(bell(page)).toHaveAccessibleName("Avisos, 1 sin leer")
    await settings(page, async (p) => {
      await p.getByRole("slider", { name: "Máximo de mensajes al día" }).press("End")
    })
    await expect(bell(page)).toHaveAccessibleName("Avisos, 2 sin leer")
  })

  test("respects quiet hours: nothing arrives inside them", async ({ page }) => {
    await settings(page, async (p) => {
      await p.getByLabel("Silencio desde").fill("18:00")
    })
    await expect(page.locator("h1").first()).toBeVisible()
    await expect(bell(page)).toHaveAccessibleName("Avisos")
    await bell(page).click()
    await expect(page.getByRole("dialog").getByTestId("inbox-empty")).toBeVisible()
  })
})
