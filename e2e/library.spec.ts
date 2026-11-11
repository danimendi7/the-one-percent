import type { Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { expect, isMobile, test } from "./fixtures"

/**
 * M4d · Library, Podcasts and Cerebro in the demo (the device copy in localStorage). Demo data is
 * relative to FIXED_NOW. Account mode, offline and conflicts are in library-account.spec.ts.
 */

const KEY = "the-one-percent:demo:library:v1"
const OUTLIVE = "/knowledge/library/item?id=demo-book-outlive"

async function savedInDemo(page: Page) {
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k) !== null, KEY)).toBe(true)
}

async function blocking(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)
}

/** Toggles one chip in Cerebro's «Filtros» sheet. */
async function brainFilter(page: Page, chip: string) {
  await page.getByTestId("filters-open").click()
  await page.getByTestId("filters").getByRole("button", { name: chip, exact: true }).click()
  await page.getByTestId("filters-done").click()
  await expect(page.getByTestId("filters")).toHaveCount(0)
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
    await expect(page).toHaveURL(/id=demo-book-outlive$/)
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
    await expect(page).toHaveURL(/\/knowledge\/library\/item\?id=[^&]+$/)
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

  test("a device that refuses a deletion says so and stays on the page; nothing was deleted when the app reopens (M4g.5)", async ({ page }) => {
    await page.goto(OUTLIVE)
    await expect(page.getByRole("heading", { level: 1, name: "Outlive" })).toBeVisible()
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("full", "QuotaExceededError")
      }
    })

    await page.getByTestId("delete").click()
    await page.getByTestId("delete-confirm").click()
    await expect(page.getByTestId("form-error")).toBeVisible()
    await expect(page).toHaveURL(/\/knowledge\/library\/item\?id=demo-book-outlive$/)
    await expect(page.getByRole("button", { name: "Deshacer" })).toHaveCount(0)

    await page.reload()
    await expect(page.getByRole("heading", { level: 1, name: "Outlive" })).toBeVisible()
    await expect(page.getByTestId("note")).toHaveCount(3)
  })

  for (const path of ["/dev/podcasts", "/dev/knowledge"])
    test(`${path} does not exist in a production build (M4g.5)`, async ({ page }) => {
      const res = await page.goto(path)
      expect(res?.status()).toBe(404)
    })

  test("leaving after a refused deletion leaves a notice that stays until it is really saved (M4g.5)", async ({ page }) => {
    await page.goto(OUTLIVE)
    await expect(page.getByRole("heading", { level: 1, name: "Outlive" })).toBeVisible()
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("full", "QuotaExceededError")
      }
    })
    await page.getByTestId("delete").click()
    await page.getByTestId("delete-confirm").click()
    await expect(page.getByTestId("form-error")).toBeVisible()

    await page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link").first().click()
    await expect(page).not.toHaveURL(/\/knowledge\/library\/item/)
    const notice = page.getByText(/Un cambio no se ha podido guardar en este dispositivo/)
    await expect(notice).toBeVisible()
    await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible()
  })

  test("after a refused deletion «Reintentar» stores it, leaves the page, and the book stays gone (M4g.5)", async ({ page }) => {
    await page.goto(OUTLIVE)
    await expect(page.getByRole("heading", { level: 1, name: "Outlive" })).toBeVisible()
    await page.evaluate(() => {
      const w = window as unknown as { realSetItem: typeof Storage.prototype.setItem }
      w.realSetItem = Storage.prototype.setItem
      Storage.prototype.setItem = () => {
        throw new DOMException("full", "QuotaExceededError")
      }
    })
    await page.getByTestId("delete").click()
    await page.getByTestId("delete-confirm").click()
    await expect(page.getByTestId("form-error")).toBeVisible()

    await page.evaluate(() => {
      Storage.prototype.setItem = (window as unknown as { realSetItem: typeof Storage.prototype.setItem }).realSetItem
    })
    await page.getByTestId("removal-retry").click()
    await expect(page).toHaveURL(/\/knowledge\/library\/books$/)
    await expect(page.getByTestId("item-tile").filter({ hasText: "Outlive" })).toHaveCount(0)

    await page.reload()
    await expect(page.getByTestId("item-tile").first()).toBeVisible()
    await expect(page.getByTestId("item-tile").filter({ hasText: "Outlive" })).toHaveCount(0)
  })

  test("podcasts: a new show with an episode, and an episode without a show", async ({ page, consoleErrors }) => {
    await page.goto("/knowledge/library/podcasts")
    await expect(page.getByRole("heading", { level: 1, name: "Podcasts" })).toBeVisible()
    await page.getByTestId("add-menu").click()
    await page.getByRole("menuitem", { name: "Programa de podcast" }).click()
    await page.getByTestId("form-title").fill("Programa E2E")
    await page.getByTestId("form-save").click()
    await expect(page).toHaveURL(/\/knowledge\/library\/show\?id=[^&]+$/)
    await expect(page.getByText("Aún no hay episodios de este programa.")).toBeVisible()
    await page.getByTestId("add-episode").click()
    await page.getByTestId("form-title").fill("Episodio con programa E2E")
    await page.getByTestId("form-save").click()
    await expect(page).toHaveURL(/\/knowledge\/library\/item\?id=[^&]+$/)
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
    await brainFilter(page, "Ideas sueltas")
    await expect(page.getByTestId("brain-count")).toHaveText("1 nota")
    await brainFilter(page, "Ideas sueltas")
    await brainFilter(page, "Destacadas")
    await expect(page.getByTestId("note")).toHaveCount(2)
    await page.getByRole("button", { name: "Quitar filtro Destacadas" }).click()
    // a note links to where it came from
    await expect(page.getByTestId("note").filter({ hasText: "La base aeróbica" }).getByRole("link", { name: "Outlive" })).toBeVisible()

    await page.getByTestId("capture-open").click()
    await page.getByTestId("capture-text").fill("Idea suelta desde Cerebro")
    await expect(page.getByTestId("capture-save")).toHaveText("Guardado en este navegador · demo")
    await expect(page.getByText("16 notas")).toBeVisible()
    await brainFilter(page, "Ideas sueltas")
    await expect(page.getByTestId("note").filter({ hasText: "Idea suelta desde Cerebro" })).toBeVisible()
    await savedInDemo(page)
    await noOverflow(page, info.project.use.viewport!.width)
    expect(consoleErrors).toEqual([])
  })

  test("Cerebro with many notes shows them in pages of 60", async ({ page, consoleErrors }) => {
    await page.goto("/knowledge/brain")
    await page.getByTestId("capture-open").click()
    await page.getByTestId("capture-text").fill("Primera")
    await expect(page.getByTestId("capture-save")).toHaveText("Guardado en este navegador · demo")
    await expect(page.getByText("16 notas")).toBeVisible()
    await page.getByTestId("capture-text").blur()
    await savedInDemo(page)
    await page.evaluate((k) => {
      const s = JSON.parse(localStorage.getItem(k)!)
      const base = Object.values(s.notes)[0] as Record<string, unknown>
      for (let i = 0; i < 120; i++) s.notes[`bulk-${i}`] = { ...base, id: `bulk-${i}`, itemId: null, body: `Nota en bloque ${i}` }
      localStorage.setItem(k, JSON.stringify(s))
    }, KEY)
    await page.reload()
    await expect(page.getByText("136 notas")).toBeVisible()
    await expect(page.getByTestId("note")).toHaveCount(60)
    await page.getByTestId("brain-more").click()
    await expect(page.getByTestId("note")).toHaveCount(120)
    await expect(page.getByTestId("brain-more")).toHaveText("Mostrar 16 más")
    await page.getByTestId("brain-more").click()
    await expect(page.getByTestId("note")).toHaveCount(136)
    await expect(page.getByTestId("brain-more")).toHaveCount(0)
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

  test("with no connection, links still open Libros, a book and Cerebro, and an idea is captured there", async ({ page, context, consoleErrors }) => {
    // Offline client navigation (the service worker is blocked here) relies on Next having prefetched,
    // while online, exactly what it will need. Wait for those prefetches themselves: «networkidle» can
    // come before they start on a slower machine (ci/m4), and «any /item request» is not enough:
    // - Libros: its route tree and its page segment.
    // - a book never prefetched by its own URL (`item?id=X`, reached from Libros): Next builds it from
    //   the tree of `/knowledge/library/item` WITHOUT search params (segment-cache/cache.js), which it
    //   asks for at background priority, last (scheduler.js); plus the page segment, shared by all ids.
    // «requestfinished»: the whole body arrived (a response event only means the headers did).
    const prefetched = (path: string, segment: string, anySearch = false) =>
      page.waitForEvent("requestfinished", (r) => {
        const url = new URL(r.url())
        if (url.pathname !== path || !url.searchParams.has("_rsc") || (!anySearch && [...url.searchParams.keys()].length !== 1)) return false
        return (r.headers()["next-router-segment-prefetch"] ?? "").endsWith(segment)
      })
    const ready = Promise.all([
      prefetched("/knowledge/library/books", "/_tree"),
      prefetched("/knowledge/library/books", "/knowledge/library/books/__PAGE__"),
      prefetched("/knowledge/library/item", "/_tree"),
      prefetched("/knowledge/library/item", "/knowledge/library/item/__PAGE__", true),
    ])
    await page.goto("/knowledge/library")
    await ready
    await page.waitForLoadState("networkidle")
    await context.setOffline(true)
    await page.getByTestId("door-Libros").click()
    await expect(page.getByRole("heading", { level: 1, name: "Libros" })).toBeVisible()
    await page.getByTestId("item-tile").filter({ hasText: "Hábitos atómicos" }).first().click()
    await expect(page.getByRole("heading", { level: 1, name: "Hábitos atómicos" })).toBeVisible()
    await page.getByTestId("capture-open").locator("visible=true").click()
    await page.getByTestId("capture-text").locator("visible=true").fill("Capturada sin conexión")
    await expect(page.getByTestId("capture-save").locator("visible=true")).toHaveText("Guardado en este navegador · demo")
    await page.getByRole("link", { name: /Libros/ }).first().click()
    await expect(page.getByRole("heading", { level: 1, name: "Libros" })).toBeVisible()
    await page.getByTestId("item-tile").filter({ hasText: "Outlive" }).first().click()
    await expect(page.getByRole("heading", { level: 1, name: "Outlive" })).toBeVisible()
    await context.setOffline(false)
    await page.goto("/knowledge/brain")
    await expect(page.getByTestId("note").filter({ hasText: "Capturada sin conexión" })).toBeVisible()
    expect(consoleErrors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|net::/.test(e))).toEqual([])
  })

  test("closing the form with something typed asks first; nothing is created if discarded", async ({ page, consoleErrors }) => {
    await page.goto("/knowledge/library/books")
    await page.getByTestId("add-book").click()
    await page.getByTestId("form-title").fill("Título a medio escribir")
    await page.keyboard.press("Escape")
    await expect(page.getByRole("alertdialog", { name: "¿Descartar lo escrito?" })).toBeVisible()
    await page.getByTestId("form-keep").click()
    await expect(page.getByTestId("form-title")).toHaveValue("Título a medio escribir")
    await page.keyboard.press("Escape")
    await page.getByTestId("form-discard").click()
    await expect(page.getByTestId("form-title")).toHaveCount(0)
    await expect(page.getByText("Título a medio escribir")).toHaveCount(0)
    // an untouched form closes at once
    await page.getByTestId("add-book").click()
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("form-title")).toHaveCount(0)
    await expect(page.getByRole("dialog")).toHaveCount(0)
    expect(consoleErrors).toEqual([])
  })

  test("an id that is not on this device says so instead of failing", async ({ page, consoleErrors }) => {
    await page.goto("/knowledge/library/item?id=constructor")
    await expect(page.getByText("No está en este dispositivo")).toBeVisible()
    await page.goto("/knowledge/library/show?id=no-existe")
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
    for (const url of [OUTLIVE, "/knowledge/library/show?id=demo-show-ritmo", "/knowledge/brain", "/knowledge/library/podcasts"]) {
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
