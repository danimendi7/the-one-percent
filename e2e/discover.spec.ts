import type { Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "./fixtures"

/** D4–D5 · Daily Discovery in demo mode (fixed clock: Wednesday 21 Oct 2026). Curated topics, no model. */
const URL = "/knowledge/discover"
const title = (page: Page) => page.locator("#topic-title")

async function blocking(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)
}

test.describe("daily discovery (demo)", () => {
  test("a topic labelled unverified, with no links; rating and bookmark are kept after reloading, and it stays today's", async ({ page, consoleErrors }) => {
    await page.goto(URL)
    await expect(title(page)).toBeVisible()
    const shown = await title(page).innerText()
    await expect(page.getByTestId("discover-verification")).toHaveText("Síntesis sin verificar")
    await expect(page.getByTestId("discover-topic").locator("a")).toHaveCount(0)

    await page.getByRole("radio", { name: "8 de 10" }).click()
    await expect(page.getByTestId("discover-rating")).toHaveText("8/10")
    await page.getByTestId("discover-save").click()
    await expect(page.getByTestId("discover-save")).toHaveAttribute("aria-pressed", "true")

    await page.reload()
    await expect(title(page)).toHaveText(shown)
    await expect(page.getByTestId("discover-rating")).toHaveText("8/10")
    await expect(page.getByRole("radio", { name: "8 de 10" })).toHaveAttribute("aria-checked", "true")
    await expect(page.getByTestId("discover-save")).toHaveAttribute("aria-pressed", "true")
    await expect(page.getByTestId("discover-saved")).toContainText("Guardados (1)")
    await expect(page.getByTestId("discover-history")).toContainText("Historial (1)")

    // Tapping the same rating removes it.
    await page.getByRole("radio", { name: "8 de 10" }).click()
    await expect(page.getByTestId("discover-rating")).toHaveText("")
    expect(consoleErrors).toEqual([])
  })

  test("«No me interesa» replaces the topic and can be undone; «Ya lo sé» too", async ({ page }) => {
    await page.goto(URL)
    await expect(title(page)).toBeVisible()
    const first = await title(page).innerText()
    await page.getByTestId("discover-dismiss").click()
    await expect(title(page)).not.toHaveText(first)
    await page.getByRole("button", { name: "Deshacer" }).click()
    await expect(title(page)).toHaveText(first)
    await page.getByTestId("discover-known").click()
    await expect(title(page)).not.toHaveText(first)
    await page.reload()
    await expect(title(page)).toBeVisible()
    await expect(title(page)).not.toHaveText(first)
  })

  test("a saved topic can be read again from the list and the page goes back to today's", async ({ page }) => {
    await page.goto(URL)
    await expect(title(page)).toBeVisible()
    const first = await title(page).innerText()
    await page.getByTestId("discover-save").click()
    await page.getByTestId("discover-dismiss").click()
    await expect(title(page)).not.toHaveText(first)
    const saved = page.getByTestId("discover-saved")
    await saved.locator("summary").click()
    await saved.getByRole("link", { name: new RegExp(first.slice(0, 20)) }).click()
    await expect(title(page)).toHaveText(first)
    await expect(page).toHaveURL(/tema=curated/)
    await page.getByRole("link", { name: "Volver al tema de hoy" }).click()
    await expect(title(page)).not.toHaveText(first)
  })

  test("your own topic says it is yours and shows only the source you gave; it can be deleted after confirming", async ({ page }) => {
    await page.goto(URL)
    await expect(title(page)).toBeVisible()
    await page.getByTestId("discover-add").click()
    const sheet = page.getByRole("dialog")
    await sheet.getByRole("button", { name: "Guardar tema" }).click()
    await expect(sheet.getByRole("alert")).toHaveText("Escribe el título.")
    await sheet.getByLabel("Título").fill("Mi tema de prueba")
    await sheet.getByLabel("Texto").fill("Lo que quiero recordar")
    await sheet.getByLabel(/Enlace/).fill("javascript:alert(1)")
    await sheet.getByRole("button", { name: "Guardar tema" }).click()
    await expect(sheet.getByRole("alert")).toContainText("debe empezar por http")
    await sheet.getByLabel(/Fuente/).fill("Un libro que leí")
    await sheet.getByLabel(/Enlace/).fill("https://ejemplo.org/articulo")
    await sheet.getByRole("button", { name: "Guardar tema" }).click()
    await expect(sheet).toBeHidden()

    const own = page.getByTestId("discover-own")
    await expect(own).toContainText("Tus temas (1)")
    await own.locator("summary").click()
    const id = await page.evaluate(() => {
      const raw = Object.keys(localStorage).map((k) => localStorage.getItem(k) ?? "").find((v) => v.includes("Mi tema de prueba"))!
      return Object.keys(JSON.parse(raw).discovery.topics)[0]
    })
    await page.goto(`${URL}?tema=${id}`)
    await expect(title(page)).toHaveText("Mi tema de prueba")
    await expect(page.getByTestId("discover-verification")).toHaveText("Escrito por ti")
    const refs = page.getByTestId("discover-references")
    await expect(refs).toContainText("Fuente indicada por ti, sin comprobar.")
    await expect(refs.getByRole("link", { name: "Un libro que leí" })).toHaveAttribute("href", "https://ejemplo.org/articulo")

    await page.goto(URL)
    await expect(title(page)).toBeVisible()
    await page.getByTestId("discover-own").locator("summary").click()
    await page.getByRole("button", { name: "Borrar: Mi tema de prueba" }).click()
    await page.getByTestId("discover-remove-confirm").click()
    await expect(page.getByTestId("discover-own")).toHaveCount(0)
  })

  test("Resumen shows today's topic; once every topic is decided it says so instead of inventing one", async ({ page }) => {
    await page.goto(URL)
    await expect(title(page)).toBeVisible()
    const shown = await title(page).innerText()
    await page.goto("/")
    await expect(page.getByTestId("overview-topic")).toContainText(shown)
    await page.goto(URL)
    await expect(title(page)).toBeVisible()
    for (let i = 0; i < 9; i++) await page.getByTestId("discover-known").click()
    await expect(page.getByTestId("discover-empty")).toContainText("Has visto todos los temas")
    await page.goto("/")
    await expect(page.getByTestId("overview-topic")).toContainText("Has visto todos los temas")
  })

  test("a11y: the topic, its actions and the new topic form", async ({ page }) => {
    await page.goto(URL)
    await expect(title(page)).toBeVisible()
    await page.waitForLoadState("networkidle")
    expect(await blocking(page)).toEqual([])
    await page.getByTestId("discover-add").click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.waitForTimeout(300) // dialog animation
    expect(await blocking(page)).toEqual([])
  })
})
