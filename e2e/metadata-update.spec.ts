import type { Browser, BrowserContext, Page, Route, TestInfo } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { expect, isMobile, test } from "./fixtures"
import { countRows, newAccount, removeAccount, signIn, type Account } from "./support/account"
import { setConnection, strictOffline } from "./support/offline"
import { db } from "../tests/integration/setup"

/**
 * M4g.5 · «Buscar datos» / «Actualizar datos» of something already saved, against the LOCAL stack.
 * /api/metadata and /api/covers are answered from the page with fixed data, so no test reaches a
 * provider; an unexpected metadata request fails the test instead of going out.
 */

const WORK = "OL20770492W"
const TITLE = "El infinito en un junco"
const SIRUELA = {
  provider: "openlibrary",
  workId: WORK,
  editionId: "OL28108908M",
  title: TITLE,
  workTitle: null,
  subtitle: null,
  creators: ["Irene Vallejo"],
  language: "es",
  year: 2020,
  firstPublishedYear: 2019,
  publisher: "Siruela",
  pageCount: null,
  isbn13: "9788417860790",
  isbn10: "8417860797",
  cover: "https://covers.openlibrary.org/b/id/9689877-L.jpg",
  description: null,
  topicSuggestions: ["Ruido"],
  editionCount: 19,
  sourceUrl: "https://openlibrary.org/books/OL28108908M",
  attribution: "Datos: Open Library",
}
const DESCRIPTION = "La historia de los libros en el mundo antiguo."
const DETAIL = { ...SIRUELA, creators: null, editionCount: null, firstPublishedYear: null, pageCount: 452, description: DESCRIPTION, topicSuggestions: ["Ruido"] }

const SHOW = { provider: "itunes", id: "1455818214", title: "Programa E2E", publisher: "Productora E2E", cover: null, sourceUrl: "https://podcasts.apple.com/es/podcast/x/id1455818214", episodeCount: 1, latestReleaseAt: null, topicSuggestions: [], attribution: "Datos: Apple Podcasts" }
const EPISODE = { provider: "itunes", id: "1000798560432", showId: SHOW.id, showTitle: SHOW.title, title: "Episodio E2E", description: "Descripción de Apple.", durationSeconds: 3600, publishedAt: "2026-10-28T23:30:00.000Z", cover: null, sourceUrl: "https://podcasts.apple.com/es/podcast/x/id1455818214?i=1000798560432", attribution: "Datos: Apple Podcasts" }

type Reply = { status?: number; body: unknown }
const ok = (data: unknown): Reply => ({ body: { ok: true, data } })
const fail = (status: number, code: string): Reply => ({ status, body: { ok: false, error: { code } } })

async function providers(page: Page, answer: (path: string, q: URLSearchParams) => Reply | undefined) {
  const calls: string[] = []
  await page.route("**/api/metadata/**", async (route: Route) => {
    const u = new URL(route.request().url())
    calls.push(u.pathname + u.search)
    const r = answer(u.pathname.replace("/api/metadata/", ""), u.searchParams) ?? { status: 599, body: { unexpected: u.pathname + u.search } }
    await route.fulfill({ status: r.status ?? 200, contentType: "application/json", body: JSON.stringify(r.body) })
  })
  await page.route("**/api/covers?**", (route) => route.fulfill({ status: 404, headers: { "cache-control": "no-store" }, body: "" }))
  return calls
}

const openLibrary = (path: string, q: URLSearchParams): Reply | undefined => {
  if (path === "books/search") return ok([SIRUELA])
  if (path === "books/detail" && q.get("work") === WORK) return ok(DETAIL)
  if (path === "books/editions") return ok([])
  return undefined
}

const apple = (path: string): Reply | undefined => {
  if (path === "podcasts/search") return ok([SHOW])
  if (path === "podcasts/episodes") return ok({ show: SHOW, episodes: [EPISODE], scope: "search", total: 1, complete: false })
  return undefined
}

async function synced(page: Page) {
  await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
}

async function itemSaved(page: Page) {
  await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 15_000 })
}

async function addManualBook(page: Page, title: string, extra: { authors?: string; pages?: string; currentPage?: string } = {}): Promise<string> {
  await page.goto("/knowledge/library/books")
  await synced(page)
  await page.getByTestId("add-book").click()
  await page.getByTestId("add-manual").click()
  await page.getByTestId("form-title").fill(title)
  if (extra.authors) await page.getByLabel("Autor o autores").fill(extra.authors)
  if (extra.pages) await page.getByLabel("Páginas", { exact: true }).fill(extra.pages)
  if (extra.currentPage) await page.getByLabel("Página actual").fill(extra.currentPage)
  await page.getByTestId("form-save").click()
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible()
  await itemSaved(page)
  return new URL(page.url()).searchParams.get("id")!
}

/** A book saved through the assistant, so it holds the reference to its work. */
async function addLinkedBook(page: Page): Promise<string> {
  await page.goto("/knowledge/library/books")
  await synced(page)
  await page.getByTestId("add-book").click()
  await page.getByTestId("book-search").fill("infinito")
  await page.getByTestId("book-result").first().click()
  await expect(page.getByTestId("confirm-pages")).toHaveValue("452")
  await page.getByTestId("confirm-save").click()
  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible()
  await itemSaved(page)
  return new URL(page.url()).searchParams.get("id")!
}

async function compareFromSearch(page: Page) {
  await page.getByTestId("update-data").click()
  await expect(page.getByTestId("update-result").first()).toBeVisible()
  await page.getByTestId("update-result").first().click()
  await expect(page.getByTestId("update-apply")).toBeVisible()
}

const rowOf = (page: Page, field: string) => page.getByTestId(`update-row-${field}`)
const box = (page: Page, field: string) => rowOf(page, field).getByRole("checkbox")
const sheet = (page: Page) => page.getByTestId("metadata-update-sheet")
const notCovers = (errors: string[]) => errors.filter((e) => !/^Failed to load resource: the server responded with a status of 404/.test(e))

async function secondDevice(browser: Browser, info: TestInfo, who: Account): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL })
  const page = await ctx.newPage()
  await signIn(page, who)
  return { ctx, page }
}

test.describe("update saved data (account)", () => {
  test.use({ mode: "account" })
  let account: Account
  test.beforeEach(async () => {
    account = await newAccount("metadata-update")
  })
  test.afterEach(async () => {
    await removeAccount(account)
  })

  const row = async (id: string) => (await db((c) => c.query("select title, creators, publisher, page_count, current_page, isbn13, description, language, status, rating, topics, cover_ref, source_url, external_provider, external_id, duration_seconds, published_on::text, platform from public.library_items where user_id = $1 and id = $2", [account.id, id]))).rows[0] as Record<string, unknown>
  const showRow = async (id: string) => (await db((c) => c.query("select title, publisher, source_url, external_id from public.podcast_shows where user_id = $1 and id = $2", [account.id, id]))).rows[0] as Record<string, unknown>
  const ops = (type: string) => countRows("select count(*)::int n from public.sync_operations where user_id = $1 and operation_type = $2", [account.id, type])

  test("Buscar datos fills only what is empty, in one update, and leaves everything of the user alone", async ({ page, consoleErrors }) => {
    await signIn(page, account)
    await providers(page, openLibrary)
    const id = await addManualBook(page, TITLE, { authors: "Autora Propia", pages: "100" })
    await page.getByRole("radiogroup", { name: "Estado" }).getByRole("radio", { name: "Leyendo" }).click()
    await page.getByRole("radiogroup", { name: "Valoración de 1 a 10" }).getByRole("radio", { name: "8 de 10" }).click()
    await expect.poll(async () => (await row(id)).rating, { timeout: 15_000 }).toBe(8)
    await itemSaved(page)
    const before = await ops("library.item.update")

    await expect(page.getByTestId("update-data")).toHaveText("Buscar datos")
    await compareFromSearch(page)
    // Same title: nothing to ask. What the user wrote: offered, not marked. What is empty: marked.
    await expect(rowOf(page, "title")).toHaveCount(0)
    await expect(rowOf(page, "creators")).toHaveAttribute("data-kind", "replace")
    await expect(box(page, "creators")).not.toBeChecked()
    await expect(box(page, "pageCount")).not.toBeChecked()
    for (const f of ["publisher", "isbn", "description", "language", "publishedYear", "cover", "external"]) await expect(box(page, f)).toBeChecked()
    await expect(page.getByTestId("update-apply")).toHaveText("Aplicar 8 cambios")

    // A double click applies once.
    await page.getByTestId("update-apply").dblclick()
    await expect(sheet(page)).toHaveCount(0)
    await itemSaved(page)

    expect(await row(id)).toMatchObject({
      creators: ["Autora Propia"],
      page_count: 100,
      publisher: "Siruela",
      isbn13: "9788417860790",
      description: DESCRIPTION,
      language: "es",
      external_provider: "openlibrary",
      external_id: WORK,
      status: "active",
      rating: 8,
      // Suggested topics are never saved on their own.
      topics: [],
    })
    expect(await ops("library.item.update")).toBe(before + 1)

    await page.reload()
    await synced(page)
    await expect(page.getByText("Autora Propia").first()).toBeVisible()
    await expect(page.getByTestId("update-data")).toHaveText("Actualizar datos")
    expect(notCovers(consoleErrors)).toEqual([])
  })

  test("nothing changes without applying, and nothing can be applied with nothing marked", async ({ page }) => {
    await signIn(page, account)
    await providers(page, openLibrary)
    const id = await addManualBook(page, TITLE)
    const before = await ops("library.item.update")
    const stored = await row(id)

    await compareFromSearch(page)
    for (const f of ["creators", "publisher", "isbn", "description", "language", "publishedYear", "cover", "pageCount", "sourceUrl", "external"]) await box(page, f).uncheck()
    await expect(page.getByTestId("update-apply")).toHaveText("Aplicar 0 cambios")
    await expect(page.getByTestId("update-apply")).toBeDisabled()

    await page.keyboard.press("Escape")
    await expect(sheet(page)).toHaveCount(0)
    await itemSaved(page)
    expect(await ops("library.item.update")).toBe(before)
    expect(await row(id)).toEqual(stored)
  })

  test("Actualizar datos goes straight to the saved work and changes a value only when it is marked", async ({ page, consoleErrors }) => {
    await signIn(page, account)
    let detail: Record<string, unknown> = DETAIL
    const calls = await providers(page, (path, q) => (path === "books/detail" && q.get("work") === WORK ? ok(detail) : openLibrary(path, q)))
    const id = await addLinkedBook(page)
    const before = await ops("library.item.update")
    const searches = calls.filter((c) => c.includes("books/search")).length
    detail = { ...DETAIL, title: "El infinito en un junco, edición revisada", pageCount: 500 }

    await expect(page.getByTestId("update-data")).toHaveText("Actualizar datos")
    await page.getByTestId("update-data").click()
    await expect(page.getByTestId("update-apply")).toBeVisible()
    await expect(page.getByTestId("update-search")).toHaveCount(0)
    expect(calls.filter((c) => c.includes("books/search")).length).toBe(searches)
    expect(calls.at(-1)).toBe(`/api/metadata/books/detail?work=${WORK}&edition=OL28108908M`)

    await expect(box(page, "title")).not.toBeChecked()
    await expect(box(page, "pageCount")).not.toBeChecked()
    await box(page, "title").check()
    await expect(page.getByTestId("update-apply")).toHaveText("Aplicar 1 cambio")
    await page.getByTestId("update-apply").click()
    await expect(sheet(page)).toHaveCount(0)
    await itemSaved(page)

    expect(await row(id)).toMatchObject({ title: "El infinito en un junco, edición revisada", page_count: 452 })
    expect(await ops("library.item.update")).toBe(before + 1)
    expect(notCovers(consoleErrors)).toEqual([])
  })

  test("a value that cannot hold is shown with its reason and cannot be marked", async ({ page }) => {
    await signIn(page, account)
    await providers(page, openLibrary)
    await addManualBook(page, TITLE, { currentPage: "500" })
    await compareFromSearch(page)
    await expect(box(page, "pageCount")).toBeDisabled()
    await expect(box(page, "pageCount")).not.toBeChecked()
    await expect(rowOf(page, "pageCount").getByTestId("update-blocked")).toContainText("500")
  })

  test("a device that refuses the update says so, and closing leaves a notice instead of losing it silently", async ({ page }) => {
    await signIn(page, account)
    await providers(page, openLibrary)
    await addManualBook(page, TITLE)
    await compareFromSearch(page)
    await page.evaluate(() => {
      IDBObjectStore.prototype.put = function () {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError")
      }
    })
    await page.getByTestId("update-apply").click()
    await expect(page.getByTestId("form-error")).toContainText("No se ha podido guardar en este dispositivo")
    await expect(page.getByTestId("update-apply")).toHaveText("Reintentar")

    await page.keyboard.press("Escape")
    await expect(sheet(page)).toHaveCount(0)
    await expect(page.getByText(/Un cambio no se ha podido guardar en este dispositivo/)).toBeVisible()
  })

  test("a provider that does not answer is said, can be retried, and the search stays one tap away", async ({ page }) => {
    await signIn(page, account)
    let down = false
    await providers(page, (path, q) => (path === "books/detail" && down ? fail(502, "provider_unavailable") : openLibrary(path, q)))
    await addLinkedBook(page)
    down = true
    await page.getByTestId("update-data").click()
    await expect(page.getByTestId("update-lookup-error")).toContainText("Open Library no responde ahora.")
    await expect(page.getByTestId("update-lookup-search")).toBeVisible()
    down = false
    await page.getByTestId("update-lookup-retry").click()
    await expect(page.getByTestId("update-none")).toBeVisible()
  })

  test("without connection it says so instead of failing", async ({ page, context, consoleErrors }) => {
    await signIn(page, account)
    await providers(page, openLibrary)
    await addManualBook(page, TITLE)
    await context.setOffline(true)
    await page.getByTestId("update-data").click()
    await expect(page.getByTestId("update-search-status")).toContainText("Sin conexión")
    expect(notCovers(consoleErrors).filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|ERR_FAILED|net::/.test(e))).toEqual([])
  })

  test("a show and its episode are updated like a book", async ({ page, consoleErrors }) => {
    await signIn(page, account)
    await providers(page, apple)
    await page.goto("/knowledge/library/podcasts")
    await synced(page)
    await page.getByTestId("add-menu").click()
    await page.getByRole("menuitem", { name: "Programa de podcast" }).click()
    await page.getByTestId("add-manual-show").click()
    await page.getByTestId("form-title").fill(SHOW.title)
    await page.getByTestId("form-save").click()
    await expect(page).toHaveURL(/\/knowledge\/library\/show\?id=[^&]+$/)
    const showId = new URL(page.url()).searchParams.get("id")!
    await page.getByTestId("add-episode").click()
    await page.getByTestId("form-title").fill(EPISODE.title)
    await page.getByTestId("form-save").click()
    await expect(page.getByRole("heading", { level: 1, name: EPISODE.title })).toBeVisible()
    await itemSaved(page)
    const episodeId = new URL(page.url()).searchParams.get("id")!
    await page.getByRole("radiogroup", { name: "Estado" }).getByRole("radio", { name: "En curso" }).click()
    await expect.poll(async () => (await row(episodeId)).status, { timeout: 15_000 }).toBe("active")
    await itemSaved(page)

    await page.goto(`/knowledge/library/show?id=${showId}`)
    await synced(page)
    await compareFromSearch(page)
    await expect(box(page, "publisher")).toBeChecked()
    await expect(rowOf(page, "description")).toHaveCount(0)
    await page.getByTestId("update-apply").click()
    await expect(sheet(page)).toHaveCount(0)
    await expect.poll(async () => (await showRow(showId)).external_id, { timeout: 15_000 }).toBe(SHOW.id)
    expect(await showRow(showId)).toMatchObject({ publisher: SHOW.publisher, source_url: SHOW.sourceUrl })
    expect(await ops("library.show.update")).toBe(1)

    // The show is linked now: its episode starts at that show's episodes, without searching shows.
    await page.goto(`/knowledge/library/item?id=${episodeId}`)
    await synced(page)
    await compareFromSearch(page)
    for (const f of ["durationSeconds", "publishedOn", "platform", "description", "sourceUrl", "external"]) await expect(box(page, f)).toBeChecked()
    await page.getByTestId("update-apply").click()
    await expect(sheet(page)).toHaveCount(0)
    await itemSaved(page)
    expect(await row(episodeId)).toMatchObject({ title: EPISODE.title, duration_seconds: 3600, published_on: "2026-10-29", platform: "apple", external_id: EPISODE.id, status: "active" })
    expect(notCovers(consoleErrors)).toEqual([])
  })

  test("the comparison passes the accessibility check", async ({ page }) => {
    await signIn(page, account)
    await providers(page, openLibrary)
    await addManualBook(page, TITLE, { pages: "100" })
    await compareFromSearch(page)
    const results = await new AxeBuilder({ page }).include('[data-testid="metadata-update-sheet"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([])
  })

  test("two devices: a description written elsewhere while this one filled it is kept to decide, and the other fields still arrive", async ({ browser, page, context }, info) => {
    test.skip(isMobile(info.project.name), "covered once")
    test.slow()
    await strictOffline(context)
    await signIn(page, account)
    await providers(page, openLibrary)
    const id = await addManualBook(page, TITLE)
    const b = await secondDevice(browser, info, account)
    await b.page.goto(`/knowledge/library/item?id=${id}`)
    await synced(b.page)

    await compareFromSearch(page)
    await setConnection(page, false)
    await page.getByTestId("update-apply").click()
    await expect(sheet(page)).toHaveCount(0)
    await expect(page.getByTestId("item-save")).toContainText("se enviará al recuperar la conexión")

    await b.page.getByTestId("edit").click()
    await expect(b.page.getByTestId("form-title")).toBeVisible()
    const more = b.page.getByRole("button", { name: "Más detalles" })
    if (await more.count()) await more.click()
    await b.page.getByLabel("Sinopsis").fill("Escrita en el otro dispositivo.")
    await b.page.getByTestId("form-save").click()
    await expect.poll(async () => (await row(id)).description, { timeout: 15_000 }).toBe("Escrita en el otro dispositivo.")

    await setConnection(page, true)
    const conflict = page.getByTestId("library-conflict").locator("visible=true")
    await expect(conflict).toBeVisible({ timeout: 20_000 })
    await expect(conflict).toHaveAttribute("data-code", "field_conflict")
    await expect(conflict).toContainText(DESCRIPTION)
    await expect(conflict).toContainText("Escrita en el otro dispositivo.")
    expect((await row(id)).description).toBe("Escrita en el otro dispositivo.")
    await expect.poll(async () => (await row(id)).publisher, { timeout: 15_000 }).toBe("Siruela")
    await b.ctx.close()
  })

  test("a marked field changed elsewhere while the comparison was open is not overwritten", async ({ browser, page }, info) => {
    test.skip(isMobile(info.project.name), "covered once")
    test.slow()
    await signIn(page, account)
    await providers(page, openLibrary)
    const id = await addManualBook(page, TITLE)
    const b = await secondDevice(browser, info, account)
    await b.page.goto(`/knowledge/library/item?id=${id}`)
    await synced(b.page)

    await compareFromSearch(page)
    await expect(box(page, "creators")).toBeChecked()

    await b.page.getByTestId("edit").click()
    await b.page.getByLabel("Autor o autores").fill("Autora del otro dispositivo")
    await b.page.getByTestId("form-save").click()
    await expect.poll(async () => (await row(id)).creators, { timeout: 15_000 }).toEqual(["Autora del otro dispositivo"])
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
    await expect(page.getByText("Autora del otro dispositivo").first()).toBeAttached({ timeout: 15_000 })
    const before = await ops("library.item.update")

    await page.getByTestId("update-apply").click()
    await expect(page.getByTestId("update-stale")).toBeVisible()
    await expect(rowOf(page, "creators")).toHaveAttribute("data-kind", "replace")
    await expect(box(page, "creators")).not.toBeChecked()
    expect(await ops("library.item.update")).toBe(before)
    expect((await row(id)).creators).toEqual(["Autora del otro dispositivo"])
    await b.ctx.close()
  })
})

test.describe("update saved data (demo)", () => {
  test("the demo has no provider to ask, so it does not offer it", async ({ page }) => {
    await page.goto("/knowledge/library/item?id=demo-book-outlive")
    await expect(page.getByTestId("edit")).toBeVisible()
    await expect(page.getByTestId("update-data")).toHaveCount(0)
  })
})
