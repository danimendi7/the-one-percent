import type { Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "./fixtures"

/** D3 · Active Recall in demo mode (fixed clock: Wednesday 21 Oct 2026): two reviews due and one new card. */
const URL = "/knowledge/brain/repaso"

async function blocking(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)
}

const question = (page: Page) => page.getByTestId("recall-question")
const count = (page: Page) => page.getByTestId("recall-count")
async function grade(page: Page, g: "again" | "hard" | "good" | "easy") {
  await page.getByTestId("recall-reveal").click()
  await page.getByTestId(`recall-grade-${g}`).click()
}

test.describe("active recall (demo)", () => {
  test("from Cerebro: question, reveal, grade; a failed card comes back last; kept after reloading; then the days ahead", async ({ page, consoleErrors }) => {
    await page.goto("/knowledge/brain")
    await expect(page.getByTestId("recall-tab-count")).toHaveText("3")
    await page.getByTestId("recall-tab").click()
    await expect(page).toHaveURL(URL)
    await expect(page.getByRole("heading", { level: 1, name: "Repaso" })).toBeVisible()
    await expect(count(page)).toHaveText("3 tarjetas por repasar · 1 nueva")

    // The most overdue first, and the answer stays hidden until asked for.
    await expect(question(page)).toHaveText("¿Por qué conviene construir una base aeróbica?")
    await expect(page.getByTestId("recall-answer")).toHaveCount(0)
    await page.getByTestId("recall-reveal").click()
    await expect(page.getByTestId("recall-answer")).toContainText("sostiene la salud")
    await expect(page.getByTestId("recall-grade-again")).toContainText("hoy")
    await expect(page.getByTestId("recall-grade-hard")).toContainText("en 7 días")
    await expect(page.getByTestId("recall-grade-good")).toContainText("en 15 días")
    await expect(page.getByTestId("recall-grade-easy")).toContainText("en 20 días")
    await page.getByTestId("recall-grade-good").click()

    await expect(question(page)).toHaveText("¿Qué hace que un hábito sea fácil de repetir?")
    await expect(count(page)).toHaveText("2 tarjetas por repasar · 1 nueva")
    await page.reload()
    await expect(question(page)).toHaveText("¿Qué hace que un hábito sea fácil de repetir?")

    // Failing it leaves it for the end of the session.
    await grade(page, "again")
    await expect(question(page)).toHaveText("¿Qué pierde valor cuando no eliges en qué concentrarte?")
    await grade(page, "easy")
    await expect(question(page)).toHaveText("¿Qué hace que un hábito sea fácil de repetir?")
    await expect(count(page)).toHaveText("1 tarjeta por repasar")
    await grade(page, "good")

    const done = page.getByTestId("recall-done")
    await expect(done).toContainText("Hoy no te queda nada por repasar")
    await expect(page.getByTestId("recall-forecast").getByRole("listitem")).toHaveCount(3)
    await expect(page.getByTestId("recall-forecast")).toContainText("1 tarjeta")
    await page.reload()
    await expect(page.getByTestId("recall-done")).toBeVisible()
    expect(consoleErrors).toEqual([])
  })

  test("a card from an idea starts with the idea as its answer and needs a question", async ({ page, consoleErrors }) => {
    await page.goto("/knowledge/brain")
    await page.getByRole("button", { name: "Más acciones de la nota" }).first().click()
    await page.getByRole("menuitem", { name: "Crear tarjeta de repaso" }).click()
    const sheet = page.getByRole("dialog")
    await expect(sheet.getByLabel("Respuesta")).not.toHaveValue("")
    await sheet.getByRole("button", { name: "Crear tarjeta" }).click()
    await expect(sheet.getByRole("alert")).toHaveText("Escribe la pregunta.")
    await sheet.getByLabel("Pregunta").fill("¿Qué decía esta idea?")
    await sheet.getByRole("button", { name: "Crear tarjeta" }).click()
    await expect(sheet).toBeHidden()

    await page.goto(URL)
    await expect(count(page)).toHaveText("4 tarjetas por repasar · 2 nuevas")
    for (const g of ["good", "good", "good"] as const) await grade(page, g)
    await expect(question(page)).toHaveText("¿Qué decía esta idea?")
    await page.getByTestId("recall-reveal").click()
    await expect(page.getByRole("link", { name: "Ver la idea de origen" })).toBeVisible()
    expect(consoleErrors).toEqual([])
  })

  test("suspending takes a card out without losing it; deleting asks first and lasts", async ({ page }) => {
    await page.goto(URL)
    await expect(question(page)).toBeVisible()
    await page.getByTestId("recall-new").click()
    const sheet = page.getByRole("dialog")
    await sheet.getByLabel("Pregunta").fill("¿Se escribe a mano?")
    await sheet.getByLabel("Respuesta").fill("Sí")
    await sheet.getByRole("button", { name: "Crear tarjeta" }).click()
    await expect(count(page)).toHaveText("4 tarjetas por repasar · 2 nuevas")

    await page.getByTestId("recall-suspend").click()
    await expect(count(page)).toHaveText("3 tarjetas por repasar · 2 nuevas")
    const suspended = page.getByTestId("recall-suspended")
    await expect(suspended).toContainText("Suspendidas (1)")
    await suspended.locator("summary").click()
    await suspended.getByRole("button", { name: /^Reanudar/ }).click()
    await expect(count(page)).toHaveText("4 tarjetas por repasar · 2 nuevas")
    await expect(page.getByTestId("recall-suspended")).toHaveCount(0)

    await page.getByTestId("recall-delete").click()
    await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click()
    await expect(count(page)).toHaveText("4 tarjetas por repasar · 2 nuevas")
    await page.getByTestId("recall-delete").click()
    await page.getByTestId("recall-delete-confirm").click()
    await expect(count(page)).toHaveText("3 tarjetas por repasar · 2 nuevas")
    await page.reload()
    await expect(count(page)).toHaveText("3 tarjetas por repasar · 2 nuevas")
  })

  test("Cerebro and Analytics follow the review: the idea says when it returns, and the answer counts", async ({ page, consoleErrors }) => {
    // Demo card 1 comes from idea 1 and is overdue.
    await page.goto("/knowledge/brain?nota=demo-note-1")
    const chip = page.locator("#note-demo-note-1").getByTestId("note-recall")
    await expect(chip).toHaveText("Repaso pendiente hoy")
    await page.goto("/analytics")
    const panel = page.getByRole("region", { name: "Aprendizaje" })
    await expect(panel.getByTestId("learning-recall")).toContainText("Sin repasos en este periodo")
    await expect(panel.getByTestId("learning-recall-due")).toContainText("3")

    await page.goto(URL)
    await expect(question(page)).toBeVisible()
    await grade(page, "good")
    await grade(page, "again")
    await expect(count(page)).toHaveText("2 tarjetas por repasar · 1 nueva")

    await page.goto("/analytics")
    await expect(panel.getByTestId("learning-recall").locator("dd").first()).toHaveText("2")
    await expect(panel.getByTestId("learning-recall")).toContainText("50 % recordadas (1 de 2)")
    await expect(panel.getByTestId("learning-recall-due").locator("dd").first()).toHaveText("2")
    await page.goto("/knowledge/brain?nota=demo-note-1")
    await expect(chip).toHaveText("Repaso en 15 días")
    await chip.click()
    await expect(page).toHaveURL(URL)
    expect(consoleErrors).toEqual([])
  })

  test("with no connection the review goes on", async ({ page, context }) => {
    await page.goto(URL)
    await expect(question(page)).toBeVisible()
    await context.setOffline(true)
    await grade(page, "good")
    await expect(count(page)).toHaveText("2 tarjetas por repasar · 1 nueva")
    await context.setOffline(false)
  })

  test("a11y: the question, the answer with its options, and the new card", async ({ page }) => {
    await page.goto(URL)
    await expect(question(page)).toBeVisible()
    await page.waitForLoadState("networkidle")
    expect(await blocking(page)).toEqual([])
    await page.getByTestId("recall-reveal").click()
    await expect(page.getByTestId("recall-grade-good")).toHaveAccessibleName("Bien en 15 días")
    expect(await blocking(page)).toEqual([])
    await page.getByTestId("recall-new").click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.waitForTimeout(300) // dialog animation
    expect(await blocking(page)).toEqual([])
  })
})
