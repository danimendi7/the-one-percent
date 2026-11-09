import type { Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "./fixtures"

/**
 * M4e · Cerebro in the demo: search over the device copy (accents, case, several words, where it
 * matched), filters and grouping in the URL, connections, moving notes, the «Aplicaciones» view and
 * search with no connection. Account mode and live sync are in knowledge-live.spec.ts.
 */

const visibleNotes = (page: Page) => page.getByTestId("note").locator("visible=true")
const note = (page: Page, text: string) => visibleNotes(page).filter({ hasText: text })

async function searchFor(page: Page, q: string) {
  await page.getByTestId("brain-search").fill(q)
  // the URL follows the box after a short pause
  if (q.trim()) await expect(page).toHaveURL(new RegExp(`[?&]q=${encodeURIComponent(q).replace(/%20/g, "\\+")}`))
}

async function blocking(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)
}

async function menu(page: Page, text: string, item: string) {
  await note(page, text).getByRole("button", { name: "Más acciones de la nota" }).click()
  await page.getByRole("menuitem", { name: item }).click()
}

test.describe("Cerebro · search and filters (demo)", () => {
  test("several words across a note and its source, ignoring case and accents; explained and highlighted; kept in the URL", async ({ page, consoleErrors }) => {
    await page.goto("/knowledge/brain")
    await searchFor(page, "ATTIA zona")
    await expect(page.getByTestId("brain-count")).toHaveText("2 notas")
    const hit = note(page, "Dos sesiones de zona 2")
    await expect(hit.locator("mark").first()).toHaveText("zona")
    await expect(hit.getByTestId("note-match")).toHaveText("Coincide en el texto y su origen")
    await expect(note(page, "¿Cómo medir la zona 2")).toBeVisible()

    // no accent typed: finds the accented title as a content and its notes
    await searchFor(page, "habitos atomicos")
    await expect(page.getByTestId("content-hits")).toContainText("Hábitos atómicos")
    await expect(page.getByTestId("content-hits").locator("mark").first()).toHaveText("Hábitos")

    // survives a reload and opens the source
    await page.reload()
    await expect(page.getByTestId("brain-search")).toHaveValue("habitos atomicos")
    await page.getByTestId("content-hits").getByRole("link", { name: /Hábitos atómicos/ }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Hábitos atómicos" })).toBeVisible()
    await page.goBack()
    await expect(page.getByTestId("brain-search")).toHaveValue("habitos atomicos")
    expect(consoleErrors).toEqual([])
  })

  test("empty, unmatched and special input: honest messages, no errors", async ({ page, consoleErrors }) => {
    await page.goto("/knowledge/brain")
    await searchFor(page, "xqzw")
    await expect(page.getByTestId("brain-empty")).toHaveText("Ninguna nota coincide con «xqzw».")
    for (const q of ["«»¿?", ")(*", "a"]) {
      await page.getByTestId("brain-search").fill(q)
      await expect(page.getByTestId("brain-count")).toHaveText("15 notas")
    }
    await page.getByRole("button", { name: "Borrar la búsqueda" }).click()
    await expect(page.getByTestId("brain-search")).toHaveValue("")
    await expect(page.getByTestId("brain-count")).toHaveText("15 notas")
    expect(consoleErrors).toEqual([])
  })

  test("filters combine, show as removable chips, live in the URL and survive reload and back; grouping by source", async ({ page, consoleErrors }) => {
    await page.goto("/knowledge/brain")
    await page.getByTestId("filters-open").click()
    const sheet = page.getByTestId("filters")
    await sheet.getByRole("button", { name: "Podcasts", exact: true }).click()
    await sheet.getByRole("button", { name: "Pendiente", exact: true }).first().click()
    await page.getByTestId("filters-done").click()
    await expect(page).toHaveURL(/origen=podcasts/)
    await expect(page.getByTestId("filters-open")).toContainText("2")
    // planned podcast episodes have no notes in the demo
    await expect(page.getByTestId("brain-empty")).toHaveText("Ninguna nota cumple estos filtros.")
    await page.getByRole("button", { name: "Quitar filtro Pendiente" }).click()
    await page.getByRole("group", { name: "Tipo de nota" }).getByRole("button", { name: "Citas" }).click()
    await expect(page).toHaveURL(/tipo=quote/)
    await expect(visibleNotes(page)).toHaveCount(1)
    await expect(visibleNotes(page)).toContainText("huecos a propósito")

    await page.reload()
    await expect(visibleNotes(page)).toHaveCount(1)
    await expect(page.getByRole("button", { name: "Quitar filtro Podcasts" })).toBeVisible()

    await page.goto("/knowledge/brain?tema=Productividad&agrupar=contenido")
    const groups = page.getByTestId("brain-group").locator("visible=true")
    await expect(groups.first().getByRole("heading")).toBeVisible()
    await expect(page.getByRole("button", { name: "Quitar filtro Tema: Productividad" })).toBeVisible()
    for (const title of await groups.getByRole("heading").allInnerTexts()) expect(title).toMatch(/Enfócate|Planificar una semana|Hábitos atómicos/)
    await page.getByTestId("group-by").selectOption("tema")
    await expect(page).toHaveURL(/agrupar=tema/)
    await expect(groups.getByRole("heading").filter({ hasText: "Productividad" })).toHaveCount(1)
    expect(consoleErrors).toEqual([])
  })

  test("two filters tapped one right after the other are both kept", async ({ page }) => {
    await page.goto("/knowledge/brain")
    await page.getByTestId("filters-open").click()
    await page.getByTestId("filters").evaluate((sheet) => {
      const tap = (name: string) => [...sheet.querySelectorAll("button")].find((b) => b.textContent?.trim() === name)!.click()
      tap("Podcasts")
      tap("Pendiente")
    })
    await expect(page).toHaveURL(/origen=podcasts/)
    await expect(page).toHaveURL(/estado=planned/)
  })

  test("search works with no connection, over the device copy", async ({ page, context, consoleErrors }) => {
    await page.goto("/knowledge/brain")
    await expect(page.getByTestId("brain-count")).toHaveText("15 notas")
    await context.setOffline(true)
    await page.getByTestId("brain-search").fill("regularidad")
    await expect(page.getByTestId("brain-count")).toHaveText("1 nota")
    await expect(note(page, "La regularidad del horario")).toBeVisible()
    await context.setOffline(false)
    expect(consoleErrors.filter((e) => !/ERR_INTERNET_DISCONNECTED|net::/.test(e))).toEqual([])
  })
})

test.describe("Cerebro · connections, moving and applications (demo)", () => {
  test("connect two ideas from the note menu; no self or duplicate links; shown and removable with «Deshacer»", async ({ page, consoleErrors }) => {
    await page.goto("/knowledge/brain")
    await menu(page, "La base aeróbica", "Conectar con…")
    const picker = page.getByTestId("picker")
    await picker.getByTestId("picker-search").fill("aerobica")
    // the note itself is never offered
    await expect(picker.getByTestId("picker-row")).toHaveCount(0)
    await picker.getByTestId("picker-search").fill("domingo")
    const row = picker.getByTestId("picker-row").filter({ hasText: "repasar las ideas de la semana" })
    await row.click()
    await expect(row).toHaveAttribute("aria-pressed", "true")
    await expect(row).toContainText("Conectada")
    // a second tap disconnects (never a duplicate), a third connects again
    await row.click()
    await expect(row).toHaveAttribute("aria-pressed", "false")
    await row.click()
    await page.keyboard.press("Escape")

    const card = note(page, "La base aeróbica")
    await expect(card.getByTestId("note-connections")).toHaveText("1 conexión")
    await card.getByTestId("note-connections").click()
    await expect(page).toHaveURL(/nota=demo-note-1/)
    const conns = page.getByTestId("connections")
    await expect(conns).toContainText("El domingo, repasar las ideas")
    await page.reload()
    await expect(page.getByTestId("connections")).toContainText("El domingo, repasar las ideas")
    await page.getByRole("button", { name: /^Quitar conexión con El domingo/ }).click()
    await expect(page.getByTestId("connections")).toHaveCount(0)
    await page.getByRole("button", { name: "Deshacer" }).click()
    await expect(page.getByTestId("connections")).toContainText("El domingo, repasar las ideas")
    expect(consoleErrors).toEqual([])
  })

  test("a content's page lists and adds connections; existing demo links show both ways", async ({ page, consoleErrors }) => {
    await page.goto("/knowledge/library/item?id=demo-ep-entorno")
    await expect(page.getByTestId("connections")).toContainText("Diseñar el entorno antes")
    await page.getByTestId("item-connect").click()
    await page.getByTestId("picker-search").fill("outlive")
    await page.getByTestId("picker").getByTestId("picker-row").filter({ hasText: "Outlive" }).filter({ hasText: "Libro" }).click()
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("connections")).toContainText("Outlive")
    await page.goto("/knowledge/library/item?id=demo-book-outlive")
    await expect(page.getByTestId("connections")).toContainText("El entorno decide antes que tú")
    expect(consoleErrors).toEqual([])
  })

  test("move a note to another book, then make it a free idea: text and connections kept", async ({ page, consoleErrors }) => {
    await page.goto("/knowledge/brain?nota=demo-note-4")
    await expect(page.getByTestId("connections")).toContainText("El entorno decide antes que tú")
    await menu(page, "Diseñar el entorno", "Mover a…")
    await page.getByTestId("picker-search").fill("outlive")
    await page.getByTestId("picker").getByTestId("picker-row").filter({ hasText: "Outlive" }).click()
    await expect(page.getByText("Nota movida a «Outlive»")).toBeVisible()
    await expect(note(page, "Diseñar el entorno").getByRole("link", { name: "Outlive" })).toBeVisible()
    await expect(page.getByTestId("connections")).toContainText("El entorno decide antes que tú")

    await menu(page, "Diseñar el entorno", "Mover a…")
    await page.getByTestId("picker-free").click()
    await expect(page.getByText("Ahora es una idea suelta")).toBeVisible()
    await expect(note(page, "Diseñar el entorno").getByRole("link", { name: "Outlive" })).toHaveCount(0)
    await expect(page.getByTestId("connections")).toContainText("El entorno decide antes que tú")
    await page.goto("/knowledge/brain?origen=sueltas")
    await expect(note(page, "Diseñar el entorno antes que confiar en la fuerza de voluntad.")).toBeVisible()
    expect(consoleErrors).toEqual([])
  })

  test("Aplicaciones: by state, with their source; changing the state moves it; the filter is in the URL", async ({ page, consoleErrors }) => {
    await page.goto("/knowledge/brain")
    await page.getByTestId("tab-applications").click()
    await expect(page).toHaveURL(/vista=aplicaciones/)
    await expect(page.getByTestId("apps-open").locator("visible=true")).toContainText("Bloque de escritura de 90 min")
    await expect(page.getByTestId("apps-doing").locator("visible=true")).toContainText("Dos sesiones de zona 2")
    await expect(page.getByTestId("apps-done").locator("visible=true")).toContainText("Dejar el libro de la noche")
    await expect(note(page, "Bloque de escritura").getByRole("link", { name: "Enfócate (Deep Work)" })).toBeVisible()
    await note(page, "Bloque de escritura").getByRole("radiogroup", { name: "Estado de la aplicación" }).getByRole("radio", { name: "Hecha" }).click()
    await expect(page.getByTestId("apps-done").locator("visible=true")).toContainText("Bloque de escritura de 90 min")
    await page.getByTestId("app-filter-open").click()
    await expect(page).toHaveURL(/app=open/)
    await expect(visibleNotes(page)).toHaveCount(1)
    await expect(visibleNotes(page)).toContainText("Dejar libre la tarde del viernes")
    expect(consoleErrors).toEqual([])
  })

  test("accessibility: search with results, the filters sheet, the picker and a note with its connections", async ({ page }) => {
    await page.goto("/knowledge/brain?q=zona&agrupar=contenido")
    await expect(page.getByTestId("brain-count")).toHaveText(/notas?/)
    expect(await blocking(page)).toEqual([])
    await page.getByTestId("filters-open").click()
    await expect(page.getByTestId("filters")).toBeVisible()
    expect(await blocking(page)).toEqual([])
    await page.getByTestId("filters-done").click()
    await page.goto("/knowledge/brain?nota=demo-note-4")
    await expect(page.getByTestId("connections")).toBeVisible()
    expect(await blocking(page)).toEqual([])
    await page.getByTestId("connect").click()
    await expect(page.getByTestId("picker")).toBeVisible()
    expect(await blocking(page)).toEqual([])
    await page.goto("/knowledge/brain?vista=aplicaciones")
    expect(await blocking(page)).toEqual([])
  })
})
