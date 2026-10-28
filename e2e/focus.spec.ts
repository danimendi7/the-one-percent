import type { Page } from "@playwright/test"
import { expect, FIXED_NOW, test } from "./fixtures"

/** M3.2 · Deep Work in the demo: the timer is computed from timestamps, so the test moves the clock. */

const at = (minutes: number) => new Date(FIXED_NOW.getTime() + minutes * 60_000)

async function startBlock(page: Page, minutes: "25 min" | "50 min" | "90 min", project?: string) {
  await page.goto("/focus")
  await page.getByRole("radiogroup", { name: "Duración" }).getByRole("radio", { name: minutes }).click()
  if (project) await page.getByRole("textbox", { name: /^Proyecto/ }).fill(project)
  await page.getByRole("button", { name: /^Empezar/ }).click()
  await expect(page.getByRole("region", { name: "Bloque en curso" })).toBeVisible()
}

test.describe("focus (demo)", () => {
  test("start, pause, close the app, reopen, resume and finish: minutes come from timestamps and feed the habit once", async ({ page, context, consoleErrors }) => {
    await startBlock(page, "50 min", "Tesis")
    await expect(page.getByTestId("focus-clock")).toHaveText("50:00")

    await page.clock.setFixedTime(at(20))
    await expect(page.getByTestId("focus-clock")).toHaveText("30:00")
    await page.getByRole("button", { name: "Pausar" }).click()
    await expect(page.getByRole("button", { name: "Reanudar" })).toBeVisible()

    // Close the app during the pause and reopen it 10 minutes later: still paused, still 20 min done.
    await page.close()
    const p = await context.newPage()
    await p.clock.setFixedTime(at(30))
    await p.goto("/focus")
    await expect(p.getByTestId("focus-clock")).toHaveText("30:00")
    await expect(p.getByText("Pausa 10:00")).toBeVisible()

    // The pill leads back to the block from anywhere.
    await p.goto("/habits")
    await p.getByRole("link", { name: /En pausa.*Volver al bloque/ }).first().click()
    await expect(p).toHaveURL(/\/focus$/)

    await p.getByRole("button", { name: "Reanudar" }).click()
    await p.clock.setFixedTime(at(60))
    await expect(p.getByTestId("focus-clock")).toHaveText("+00:00")
    await p.clock.setFixedTime(at(62))
    await expect(p.getByTestId("focus-clock")).toHaveText("+02:00")

    await p.getByRole("button", { name: "Terminar" }).click()
    const sheet = p.getByRole("dialog")
    await expect(sheet.getByLabel("Minutos efectivos")).toHaveValue("52")
    await sheet.getByLabel(/Resultado real/).fill("Capítulo 2 revisado")
    await sheet.getByRole("radio", { name: "4 de 5" }).click()
    await sheet.getByRole("button", { name: "Guardar" }).click()
    await expect(p.getByText("Bloque guardado · 52 min")).toBeVisible()
    await expect(p.getByTestId("focus-today-minutes")).toHaveText("52 min")
    await expect(p.getByRole("region", { name: "Preparar bloque" })).toBeVisible()

    // The fed habit shows the derived minutes and offers no manual control.
    await p.goto("/habits")
    const row = p.getByRole("region", { name: "Hoy" }).getByRole("listitem").filter({ hasText: "Deep Work 90 min" })
    await expect(row.getByText("Se alimenta de Enfoque · 52 de 90 min")).toBeVisible()
    await expect(row.getByRole("link", { name: /Se alimenta de Enfoque: ir a Enfoque/ })).toBeVisible()
    await expect(row.getByRole("button")).toHaveCount(0)
    expect(consoleErrors).toEqual([])
  })

  test("«¿Sigue en curso?» never closes a forgotten block silently and can finish it at the planned end", async ({ page }) => {
    await startBlock(page, "25 min")
    await page.clock.setFixedTime(at(90))
    await page.goto("/")
    const dialog = page.getByRole("dialog", { name: "¿Sigue en curso?" })
    await expect(dialog).toBeVisible()
    await dialog.getByRole("button", { name: /^Terminar a las 18:55$/ }).click()
    await expect(page.getByText("Bloque guardado · 25 min")).toBeVisible()
    await page.goto("/focus")
    await expect(page.getByTestId("focus-today-minutes")).toHaveText("25 min")
  })

  test("Continuar keeps the block running; Descartar counts nothing", async ({ page }) => {
    await startBlock(page, "25 min")
    await page.clock.setFixedTime(at(60))
    await page.goto("/")
    await page.getByRole("dialog", { name: "¿Sigue en curso?" }).getByRole("button", { name: "Continuar" }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await page.goto("/focus")
    await expect(page.getByTestId("focus-clock")).toHaveText("+35:00")
    await page.getByRole("button", { name: "Terminar" }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Descartar sesión" }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Descartar", exact: true }).click()
    await expect(page.getByTestId("focus-today-minutes")).toHaveText("0 min")
  })

  test("a session can be edited and discarded afterwards; the habit follows", async ({ page }) => {
    await startBlock(page, "50 min", "Producto")
    await page.clock.setFixedTime(at(45))
    await page.getByRole("button", { name: "Terminar" }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Guardar" }).click()
    await expect(page.getByTestId("focus-today-minutes")).toHaveText("45 min")

    await page.getByRole("region", { name: "Hoy" }).getByRole("button", { name: /Producto/ }).click()
    const sheet = page.getByRole("dialog", { name: "Editar sesión" })
    await sheet.getByLabel("Minutos efectivos").fill("30")
    await sheet.getByRole("button", { name: "Guardar cambios" }).click()
    await expect(page.getByTestId("focus-today-minutes")).toHaveText("30 min")

    await page.getByRole("region", { name: "Hoy" }).getByRole("button", { name: /Producto/ }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Descartar" }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Descartar" }).last().click()
    await expect(page.getByTestId("focus-today-minutes")).toHaveText("0 min")
  })

  test("only one active block: the start button is replaced while one runs", async ({ page }) => {
    await startBlock(page, "25 min")
    await expect(page.getByRole("button", { name: /^Empezar/ })).toHaveCount(0)
    await page.goto("/")
    await expect(page.getByRole("link", { name: /Volver al bloque/ }).first()).toBeVisible()
  })
})

test.describe("focus in Analytics (demo)", () => {
  test("figures open their exact sessions; a project with two sessions shows «Pocos datos»", async ({ page }) => {
    await page.goto("/analytics?periodo=30")
    const section = page.getByRole("region", { name: /^Enfoque/ })
    await expect(section).toBeVisible()
    const minutes = await section.getByRole("button", { name: /^Minutos de foco/ }).locator("p").nth(1).innerText()
    await section.getByRole("button", { name: /^Minutos de foco/ }).click()
    await expect(page.getByTestId("focus-drill-summary")).toContainText(minutes)
    await page.keyboard.press("Escape")

    await section.getByRole("combobox", { name: "Proyecto" }).click()
    await page.getByRole("option", { name: "Escritura" }).click()
    await expect(page).toHaveURL(/proyecto=Escritura/)
    await expect(section.getByText("Pocos datos", { exact: true })).toBeVisible()
    await expect(section.getByRole("button", { name: /^Sesiones/ })).toContainText("2")
  })
})
