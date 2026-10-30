import type { Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { expect, isMobile, test } from "./fixtures"

/**
 * M4d · Library, Podcasts and Cerebro in the demo (the device copy in localStorage). Demo data is
 * relative to FIXED_NOW. Account mode, offline and conflicts are in library-account.spec.ts.
 */

const KEY = "the-one-percent:demo:library:v1"
const OUTLIVE = "/knowledge/library/items/demo-book-outlive"

async function savedInDemo(page: Page) {
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k) !== null, KEY)).toBe(true)
}

async function blocking(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)
}

async function noOverflow(page: Page, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
}

test.describe("library (demo)", () => {
  test("home: three doors with real counts, what is in progress, and the way into Libros and Cerebro", async ({ page, consoleErrors }, info) => {
    await page.goto("/knowledge/library")
    await expect(page.getByRole("heading", { level: 1, name: "Biblioteca" })).toBeVisible()
    await expect(page.getByText("Demo · datos de ejemplo").first()).toBeVisible()
    await expect(page.getByTestId("door-Libros")).toContainText("7 libros · 1 leyendo")
    await expect(page.getByTestId("door-Podcasts")).toContainText("4 episodios · 2 programas")
    await expect(page.getByTestId("door-Cerebro")).toContainText("15 notas · 1 sueltas")
    await noOverflow(page, info.project.use.viewport!.width)
    await page.getByTestId("door-Libros").click()
    await expect(page).toHaveURL(/\/knowledge\/library\/books$/)
    await expect(page.getByTestId("item-tile").filter({ hasText: "Outlive" }).first()).toBeVisible()
    await page.getByTestId("item-tile").filter({ hasText: "Outlive" }).first().click()
    await expect(page).toHaveURL(/demo-book-outlive$/)
    await expect(page.getByRole("heading", { level: 1, name: "Outlive" })).toBeVisible()
    await expect(page.getByTestId("note").locator("visible=true")).toHaveCount(3)
    await noOverflow(page, info.project.use.viewport!.width)
    expect(consoleErrors).toEqual([])
  })

  test("a book with only its title opens its page; a quick idea saves itself while typing and survives a reload", async ({ page, consoleErrors }) => {
    await page.goto("/knowledge/library/books")
    await page.getByTestId("add-book").click()
    await page.getByTestId("form-title").fill("Libro de prueba E2E")
    await page.getByTestId("form-save").click()
    await expect(page).toHaveURL(/\/knowledge\/library\/items\/[^/]+$/)
    await expect(page.getByRole("heading", { level: 1, name: "Libro de prueba E2E" })).toBeVisible()
    await expect(page.getByText("Todavía no hay ideas")).toBeVisible()
    // no invented metadata: no author, no cover image, no rating
    await expect(page.locator("img")).toHaveCount(0)
    await expect(page.getByRole("radio", { checked: true, name: /de 10/ })).toHaveCount(0)

    await page.getByTestId("capture-open").click()
    await expect(page.getByTestId("capture-text")).toBeFocused()
    await page.getByTestId("capture-locator").fill("12")
    await page.getByTestId("capture-text").fill("Una idea escrita sin pulsar guardar")
    // autosave after the pause, honest in the demo: never «Sincronizado»
    await expect(page.getByTestId("capture-save")).toHaveText("Guardado en este navegador · demo")
    await expect(page.getByTestId("note")).toHaveCount(1)
    await expect(page.getByTestId("note")).toContainText("p. 12")
    await page.getByTestId("capture-text").pressSequentially(" y ampliada")
    await page.getByTestId("capture-text").press("Control+Enter")
    await expect(page.getByTestId("capture-text")).toHaveValue("")
    await expect(page.getByTestId("note")).toHaveCount(1)

    await page.reload()
    await expect(page.getByTestId("note")).toHaveCount(1)
    await expect(page.getByTestId("note")).toContainText("Una idea escrita sin pulsar guardar y ampliada")
    expect(consoleErrors).toEqual([])
  })

  test("edit a note in place (autosaved), then delete it and bring it back with «Deshacer»", async ({ page, consoleErrors }) => {
    await page.goto(OUTLIVE)
    await page.getByRole("button", { name: /^Editar nota: La base aeróbica/ }).click()
    await page.getByTestId("note-edit").fill("La base aeróbica se entrena para dentro de veinte años (editada)")
    await expect(page.getByTestId("note").first().getByRole("status")).toHaveText("Guardado en este navegador · demo")
    await page.reload()
    const edited = page.getByTestId("note").filter({ hasText: "(editada)" })
    await expect(edited).toBeVisible()

    await edited.getByRole("button", { name: "Más acciones de la nota" }).click()
    await page.getByRole("menuitem", { name: "Eliminar" }).click()
    await expect(page.getByTestId("note").filter({ hasText: "(editada)" })).toHaveCount(0)
    await page.getByRole("button", { name: "Deshacer" }).click()
    await expect(page.getByTestId("note").filter({ hasText: "(editada)" })).toBeVisible()
    await page.reload()
    await expect(page.getByTestId("note")).toHaveCount(3)
    expect(consoleErrors).toEqual([])
  })

  test("deleting a book with notes asks first, says what goes with it, and «Deshacer» restores the book and its notes", async ({ page, consoleErrors }) => {
    await page.goto(OUTLIVE)
    await page.getByTestId("delete").click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toContainText("Se eliminarán también sus 3 notas")
    await dialog.getByRole("button", { name: "Cancelar" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Outlive" })).toBeVisible()

    await page.getByTestId("delete").click()
    await page.getByTestId("delete-confirm").click()
    await expect(page).toHaveURL(/\/knowledge\/library\/books$/)
    await expect(page.getByTestId("item-tile").filter({ hasText: "Outlive" })).toHaveCount(0)
    await page.getByRole("button", { name: "Deshacer" }).click()
    await expect(page.getByTestId("item-tile").filter({ hasText: "Outlive" })).toBeVisible()
    await page.goto(OUTLIVE)
    await expect(page.getByTestId("note")).toHaveCount(3)
    expect(consoleErrors).toEqual([])
  })

  test("podcasts: a new show with an episode, and an episode without a show", async ({ page, consoleErrors }) => {
    await page.goto("/knowledge/library/podcasts")
    await expect(page.getByRole("heading", { level: 1, name: "Podcasts" })).toBeVisible()
    await page.getByTestId("add-menu").click()
    await page.getByRole("menuitem", { name: "Programa de podcast" }).click()
    await page.getByTestId("form-title").fill("Programa E2E")
    await page.getByTestId("form-save").click()
    await expect(page).toHaveURL(/\/knowledge\/library\/shows\/[^/]+$/)
    await expect(page.getByText("Aún no hay episodios de este programa.")).toBeVisible()
    await page.getByTestId("add-episode").click()
    await page.getByTestId("form-title").fill("Episodio con programa E2E")
    await page.getByTestId("form-save").click()
    await expect(page).toHaveURL(/\/knowledge\/library\/items\/[^/]+$/)
    await expect(page.getByRole("link", { name: "Programa E2E" }).last()).toBeVisible()

    await page.goto("/knowledge/library/podcasts")
    await page.getByTestId("add-menu").click()
    await page.getByRole("menuitem", { name: "Episodio" }).click()
    await page.getByTestId("form-title").fill("Episodio suelto E2E")
    await page.getByTestId("form-save").click()
    await expect(page.getByRole("heading", { level: 1, name: "Episodio suelto E2E" })).toBeVisible()
    await expect(page.getByRole("link", { name: /Podcasts/ }).first()).toBeVisible()
    await page.getByTestId("capture-open").click()
    await page.getByTestId("capture-locator").fill("12:34")
    await page.getByTestId("capture-text").fill("Minuto marcado")
    await expect(page.getByTestId("note")).toContainText("min. 12:34")
    expect(consoleErrors).toEqual([])
  })

  test("Cerebro: every note, simple filters, and a free idea without a book", async ({ page, consoleErrors }, info) => {
    await page.goto("/knowledge/brain")
    await expect(page.getByRole("heading", { level: 1, name: "Cerebro" })).toBeVisible()
    await expect(page.getByText("15 notas")).toBeVisible()
    const filters = page.getByRole("radiogroup", { name: "Mostrar" })
    await filters.getByRole("radio", { name: "Sueltas" }).click()
    await expect(page.getByText("1 nota", { exact: true })).toBeVisible()
    await filters.getByRole("radio", { name: "Destacadas" }).click()
    await expect(page.getByTestId("note")).toHaveCount(2)
    await filters.getByRole("radio", { name: "Todas" }).click()
    // a note links to where it came from
    await expect(page.getByTestId("note").filter({ hasText: "La base aeróbica" }).getByRole("link", { name: "Outlive" })).toBeVisible()

    await page.getByTestId("capture-open").click()
    await page.getByTestId("capture-text").fill("Idea suelta desde Cerebro")
    await expect(page.getByTestId("capture-save")).toHaveText("Guardado en este navegador · demo")
    await expect(page.getByText("16 notas")).toBeVisible()
    await filters.getByRole("radio", { name: "Sueltas" }).click()
    await expect(page.getByTestId("note").filter({ hasText: "Idea suelta desde Cerebro" })).toBeVisible()
    await savedInDemo(page)
    await noOverflow(page, info.project.use.viewport!.width)
    expect(consoleErrors).toEqual([])
  })

  test("rating with the keyboard: arrows move and choose, and it is kept", async ({ page }) => {
    await page.goto(OUTLIVE)
    const group = page.getByRole("radiogroup", { name: "Valoración de 1 a 10" })
    await group.getByRole("radio", { name: "1 de 10" }).focus()
    await page.keyboard.press("ArrowRight")
    await page.keyboard.press("ArrowRight")
    await expect(group.getByRole("radio", { name: "2 de 10" })).toHaveAttribute("aria-checked", "true")
    await expect(group.getByRole("radio", { name: "2 de 10" })).toBeFocused()
    await page.reload()
    await expect(page.getByRole("radiogroup", { name: "Valoración de 1 a 10" }).getByRole("radio", { name: "2 de 10" })).toHaveAttribute("aria-checked", "true")
  })

  test("an id that is not on this device says so instead of failing", async ({ page, consoleErrors }) => {
    await page.goto("/knowledge/library/items/no-existe")
    await expect(page.getByText("No está en este dispositivo")).toBeVisible()
    await page.goto("/knowledge/library/shows/no-existe")
    await expect(page.getByText("No está en este dispositivo")).toBeVisible()
    expect(consoleErrors).toEqual([])
  })

  test("Resumen links to what you are reading, not to an invented number", async ({ page }) => {
    await page.goto("/")
    const card = page.getByTestId("overview-library")
    await expect(card).toContainText("Outlive")
    await card.click()
    await expect(page).toHaveURL(/\/knowledge\/library/)
  })

  test("item, show and Cerebro pages: no serious accessibility violations; touch targets ≥ 44 px on mobile", async ({ page }, info) => {
    for (const url of [OUTLIVE, "/knowledge/library/shows/demo-show-ritmo", "/knowledge/brain", "/knowledge/library/podcasts"]) {
      await page.goto(url)
      await expect(page.locator("h1").first()).toBeVisible()
      expect(await blocking(page), url).toEqual([])
    }
    if (!isMobile(info.project.name)) return
    await page.goto(OUTLIVE)
    const targets = [
      page.getByTestId("note").first().getByRole("button", { name: "Más acciones de la nota" }),
      page.getByTestId("note").first().getByRole("button", { name: /Destacar|Quitar de destacadas/ }),
      page.getByRole("radiogroup", { name: "Estado" }).getByRole("radio").first(),
      page.getByRole("radiogroup", { name: "Valoración de 1 a 10" }).getByRole("radio").first(),
      page.getByTestId("capture-open"),
    ]
    for (const t of targets) expect((await t.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  })
})
