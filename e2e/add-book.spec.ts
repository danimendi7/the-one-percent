import type { Page, Route } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { expect, isMobile, test } from "./fixtures"
import { countRows, newAccount, removeAccount, signIn, type Account } from "./support/account"
import { db } from "../tests/integration/setup"

/**
 * M4g.3 · «Añadir libro» with search, edition and confirmation, against the LOCAL stack. The app's
 * own /api/metadata and /api/covers are answered from the page with fixed data, so no test reaches
 * Open Library; an unexpected metadata request fails the test instead of going out.
 */

type Book = Record<string, unknown>
const book = (over: Book): Book => ({
  provider: "openlibrary",
  workId: null,
  editionId: null,
  title: "",
  workTitle: null,
  subtitle: null,
  creators: [],
  language: null,
  year: null,
  firstPublishedYear: null,
  publisher: null,
  pageCount: null,
  isbn13: null,
  isbn10: null,
  cover: null,
  description: null,
  topicSuggestions: [],
  editionCount: null,
  sourceUrl: "https://openlibrary.org/works/OL1W",
  attribution: "Datos: Open Library",
  ...over,
})

const WORK = "OL20770492W"
const SIRUELA = book({ workId: WORK, editionId: "OL28108908M", title: "El infinito en un junco", creators: ["Irene Vallejo"], language: "es", year: 2020, firstPublishedYear: 2019, publisher: "Siruela", isbn13: "9788417860790", isbn10: "8417860797", cover: "https://covers.openlibrary.org/b/id/9689877-L.jpg", editionCount: 19, sourceUrl: "https://openlibrary.org/books/OL28108908M" })
/** A real-looking result with nothing but title and author: no cover, publisher or year. */
const GRAPHIC = book({ workId: "OL36753580W", editionId: "OL49640355M", title: "El infinito en un junco. Adaptación gráfica", creators: ["Tyto Alba"], sourceUrl: "https://openlibrary.org/books/OL49640355M" })
/** Open Library's duplicate record of the same book: same title and author, another work id. */
const TWIN = book({ workId: "OL99999999W", editionId: null, title: "El infinito en un junco", creators: ["Irene Vallejo"], firstPublishedYear: 2019, sourceUrl: "https://openlibrary.org/works/OL99999999W" })
const DETAIL = { ...SIRUELA, creators: null, editionCount: null, firstPublishedYear: null, pageCount: 452, description: "La historia de los libros en el mundo antiguo.", topicSuggestions: ["Historia", "Libros"] }
const EDITIONS = [
  { ...SIRUELA, pageCount: 452, firstPublishedYear: null, editionCount: null },
  book({ workId: WORK, editionId: "OL51103235M", title: "El infinito en un junco", language: "es", year: 2024, publisher: "Debate", isbn13: "9788419399151", isbn10: "8419399159", pageCount: 464, cover: "https://covers.openlibrary.org/b/id/15138954-L.jpg", sourceUrl: "https://openlibrary.org/books/OL51103235M" }),
  book({ workId: WORK, editionId: "OL50000001M", title: "Papyrus", language: "en", year: 2022, publisher: "Knopf", isbn13: "9780593318898", sourceUrl: "https://openlibrary.org/books/OL50000001M" }),
]

type Reply = { status?: number; body: unknown }
const ok = (data: unknown): Reply => ({ body: { ok: true, data } })
const fail = (status: number, code: string, retryAfter?: number): Reply => ({ status, body: { ok: false, error: { code, ...(retryAfter && { retryAfter }) } } })

/** Answers /api/metadata/* from the page; anything not foreseen fails loudly. Covers: no image. */
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

/** The usual Open Library answers of these tests. */
const library = (path: string, q: URLSearchParams): Reply | undefined => {
  if (path === "books/search") {
    const text = (q.get("q") ?? "").toLowerCase()
    const isbn = text.replace(/[s-]/g, "")
    if (q.get("by") === "author" && text.includes("vallejo")) return ok([SIRUELA, TWIN])
    if (isbn === "9788417860790") return ok([SIRUELA])
    if (text.includes("infinito")) return ok([SIRUELA, GRAPHIC])
    if (text.includes("nada")) return ok([])
    return undefined
  }
  if (path === "books/detail" && q.get("work") === WORK) return ok(DETAIL)
  if (path === "books/detail") return ok({ ...GRAPHIC, creators: null })
  if (path === "books/editions") return ok(q.get("work") === WORK ? EDITIONS : [])
  return undefined
}

const row = async (accountId: string, title: string) =>
  (await db((c) => c.query("select title, creators, publisher, page_count, isbn13, isbn10, published_year, language, status, rating, favorite, description, topics, cover_source, cover_ref, external_provider, external_id, external_attribution from public.library_items where user_id = $1 and title = $2 and deleted_at is null order by created_at", [accountId, title]))).rows

async function openAssistant(page: Page) {
  await page.goto("/knowledge/library/books")
  await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
  await page.getByTestId("add-book").click()
  await expect(page.getByTestId("book-search")).toBeFocused()
}

/** Opens the assistant when a draft is waiting: it asks before showing anything. */
async function openWithDraft(page: Page) {
  await page.goto("/knowledge/library/books")
  await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
  await page.getByTestId("add-book").click()
  await expect(page.getByTestId("draft-offer")).toBeVisible()
}

const draftKeys = (page: Page) => page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("top:draft:")))

async function blocking(page: Page) {
  const results = await new AxeBuilder({ page }).include('[data-testid="add-book-sheet"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)
}

test.describe("add a book with search (account)", () => {
  test.use({ mode: "account" })
  let account: Account
  test.beforeEach(async ({ page }, info) => {
    account = await newAccount(`addbook-${info.project.name}`)
    await signIn(page, account)
  })
  test.afterEach(async () => {
    await removeAccount(account)
  })

  test("title → work → another edition → edited fields kept → saved once, synced, with every field", async ({ page, consoleErrors }) => {
    const calls = await providers(page, library)
    // The only failed loads allowed are the covers this test answers with 404 (no image).
    const failed: string[] = []
    page.on("response", (r) => {
      if (r.status() >= 400 && !new URL(r.url()).pathname.startsWith("/api/covers")) failed.push(`${r.status()} ${r.url()}`)
    })
    await openAssistant(page)
    await page.getByTestId("book-search").fill("infinito junco")
    await expect(page.getByTestId("book-result")).toHaveCount(2)
    // Clear results: cover (or typographic), author, year, publisher; and one with none of those.
    await expect(page.getByTestId("book-result").first()).toContainText("Irene Vallejo")
    await expect(page.getByTestId("book-result").first()).toContainText("2020 · Siruela · Español")
    await expect(page.getByTestId("book-result").nth(1)).toContainText("Tyto Alba")
    expect(calls.filter((c) => c.startsWith("/api/metadata/books/search"))).toEqual(["/api/metadata/books/search?q=infinito+junco&by=any&lang=es"])

    await page.getByTestId("book-result").first().click()
    await expect(page.getByTestId("book-confirm")).toBeVisible()
    await expect(page.getByLabel("Descripción", { exact: true })).toHaveValue("La historia de los libros en el mundo antiguo.")
    await expect(page.getByTestId("confirm-pages")).toHaveValue("452")
    // The user's own number of pages is kept when the edition changes; the rest follows the edition.
    await page.getByTestId("confirm-pages").fill("460")
    await page.getByTestId("change-edition").click()
    await page.getByTestId("edition-option").filter({ hasText: "Debate" }).click()
    await expect(page.getByTestId("confirm-publisher")).toHaveValue("Debate")
    await expect(page.getByTestId("confirm-isbn")).toHaveValue("9788419399151")
    await expect(page.getByTestId("confirm-pages")).toHaveValue("460")
    await page.getByRole("button", { name: "+ Historia" }).click()
    await page.getByTestId("confirm-status").selectOption("active")
    await page.getByRole("radio", { name: "8 de 10" }).click()
    await page.getByTestId("confirm-favorite").check()

    // A double click saves once.
    await page.getByTestId("confirm-save").dblclick()
    await expect(page.getByRole("heading", { level: 1, name: "El infinito en un junco" })).toBeVisible()
    await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 15_000 })
    const rows = await row(account.id, "El infinito en un junco")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      creators: ["Irene Vallejo"],
      publisher: "Debate",
      page_count: 460,
      isbn13: "9788419399151",
      isbn10: "8419399159",
      published_year: 2024,
      language: "es",
      status: "active",
      rating: 8,
      favorite: true,
      description: "La historia de los libros en el mundo antiguo.",
      topics: ["Historia"],
      cover_source: "external",
      cover_ref: "https://covers.openlibrary.org/b/id/15138954-L.jpg",
      external_provider: "openlibrary",
      external_id: WORK,
      external_attribution: "Datos: Open Library",
    })
    expect(failed).toEqual([])
    expect(consoleErrors.filter((e) => !/^Failed to load resource: the server responded with a status of 404/.test(e))).toEqual([])
  })

  test("by author and by ISBN; an invalid ISBN is said, never searched; no results is clear", async ({ page }) => {
    const calls = await providers(page, library)
    await openAssistant(page)
    await page.getByRole("radiogroup", { name: "Buscar en" }).getByRole("radio", { name: "Autor" }).click()
    await page.getByTestId("book-search").fill("Irene Vallejo")
    await expect(page.getByTestId("book-result")).toHaveCount(2)
    expect(calls.at(-1)).toBe("/api/metadata/books/search?q=Irene+Vallejo&by=author&lang=es")
    await page.getByTestId("book-search").fill("978-84-17860-79-1")
    await expect(page.getByTestId("book-search-status")).toHaveText("Ese ISBN no es válido: revisa las cifras.")
    await expect(page.getByTestId("book-result")).toHaveCount(0)
    expect(calls.some((c) => c.includes("17860-79-1") || c.includes("9788417860791"))).toBe(false)
    await page.getByTestId("book-search").fill("978-84-17860-79-0")
    await expect(page.getByTestId("book-result")).toHaveCount(1)
    expect(calls.at(-1)).toContain("q=978-84-17860-79-0")
    await page.getByTestId("book-search").fill("nada de nada")
    await expect(page.getByTestId("book-search-status")).toHaveText("Sin resultados para «nada de nada».")
  })

  test("duplicates: same work is blocked as such and can be another edition; same ISBN and probable ones only warn", async ({ page }) => {
    await providers(page, library)
    await openAssistant(page)
    await page.getByTestId("book-search").fill("infinito")
    await page.getByTestId("book-result").first().click()
    await page.getByTestId("confirm-save").click()
    await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 15_000 })

    // Same work: marked in the results; saving the same reference is not offered.
    await openAssistant(page)
    await page.getByTestId("book-search").fill("infinito")
    await expect(page.getByTestId("book-result").first().getByTestId("result-owned")).toHaveText("En tu Biblioteca")
    await page.getByTestId("book-result").first().click()
    await expect(page.getByTestId("duplicate")).toHaveAttribute("data-level", "exact")
    await expect(page.getByTestId("confirm-save")).toBeDisabled()
    await page.getByTestId("add-edition").click()
    await expect(page.getByTestId("duplicate")).toHaveAttribute("data-level", "separate")
    await expect(page.getByTestId("confirm-save")).toHaveText("Añadir como otra edición")
    await page.getByTestId("confirm-save").click()
    await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 15_000 })
    // D101: the separate edition has no reference, and its page still says where its data came from.
    await expect(page.getByTestId("data-attribution")).toHaveText("Datos: Open Library")
    const both = await row(account.id, "El infinito en un junco")
    expect(both.map((r) => r.external_id)).toEqual([WORK, null])

    // A probable match (Open Library's twin record): a warning that opens the existing one.
    await openAssistant(page)
    await page.getByRole("radiogroup", { name: "Buscar en" }).getByRole("radio", { name: "Autor" }).click()
    await page.getByTestId("book-search").fill("Irene Vallejo")
    await page.getByTestId("book-result").nth(1).click()
    await expect(page.getByTestId("duplicate")).toHaveAttribute("data-level", "possible")
    await expect(page.getByTestId("confirm-save")).toBeEnabled()
    await page.getByTestId("open-existing").click()
    await expect(page.getByRole("heading", { level: 1, name: "El infinito en un junco" })).toBeVisible()
    expect(await countRows("select count(*)::int n from public.library_items where user_id = $1 and deleted_at is null", [account.id])).toBe(2)
  })

  test("provider limit, provider down and expired session: clear, the text stays, manual entry keeps it", async ({ page }) => {
    let next: Reply = fail(429, "rate_limited", 12)
    await providers(page, (path) => (path === "books/search" ? next : undefined))
    await openAssistant(page)
    await page.getByTestId("book-search").fill("Sapiens")
    await expect(page.getByTestId("book-search-status")).toHaveText("Demasiadas búsquedas seguidas; espera unos segundos. Vuelve a intentarlo en 12 s.")
    next = fail(502, "provider_unavailable")
    await page.getByTestId("book-search-retry").click()
    await expect(page.getByTestId("book-search-status")).toHaveText("Open Library no responde ahora.")
    next = fail(401, "unauthorized")
    await page.getByTestId("book-search-retry").click()
    await expect(page.getByTestId("book-search-status")).toContainText("Tu sesión ha caducado")
    await expect(page.getByTestId("book-search")).toHaveValue("Sapiens")
    await page.getByTestId("add-manual").click()
    await expect(page.getByTestId("form-title")).toHaveValue("Sapiens")
    await page.getByTestId("form-save").click()
    await expect(page.getByRole("heading", { level: 1, name: "Sapiens" })).toBeVisible()
    await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 15_000 })
  })

  test("details that fail after choosing a result never block saving", async ({ page }) => {
    await providers(page, (path, q) => (path === "books/search" ? library(path, q) : fail(401, "unauthorized")))
    await openAssistant(page)
    await page.getByTestId("book-search").fill("infinito")
    await page.getByTestId("book-result").first().click()
    await expect(page.getByTestId("detail-error")).toContainText("Tu sesión ha caducado")
    await expect(page.getByTestId("confirm-title")).toHaveValue("El infinito en un junco")
    await page.getByTestId("confirm-save").click()
    await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 15_000 })
  })

  // Navigating to a new page without a connection is the service worker's job (offline.spec.ts);
  // here: what the assistant itself does offline, and the switch to manual entry keeping the text.
  test("offline: says so, sends no request, manual entry keeps what was typed; saved and synced once back", async ({ page, context }) => {
    const calls = await providers(page, library)
    await openAssistant(page)
    await context.setOffline(true)
    await page.getByTestId("book-search").fill("Libro sin red")
    await expect(page.getByTestId("book-search-status")).toContainText("Sin conexión")
    await expect(page.getByTestId("add-manual")).toBeVisible()
    expect(calls).toEqual([])
    await page.getByTestId("add-manual").click()
    await expect(page.getByTestId("form-title")).toHaveValue("Libro sin red")
    await context.setOffline(false)
    await page.getByTestId("form-save").click()
    await expect(page.getByRole("heading", { level: 1, name: "Libro sin red" })).toBeVisible()
    await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 20_000 })
    expect(await row(account.id, "Libro sin red")).toHaveLength(1)
    expect(calls).toEqual([])
  })

  test("keyboard and accessibility: arrows and Enter choose; no serious axe issues; no horizontal scroll", async ({ page }, info) => {
    await providers(page, library)
    await openAssistant(page)
    expect(await blocking(page)).toEqual([])
    await page.getByTestId("book-search").fill("infinito")
    await expect(page.getByTestId("book-result")).toHaveCount(2)
    expect(await blocking(page)).toEqual([])
    await page.getByTestId("book-search").press("ArrowDown")
    await expect(page.getByTestId("book-search")).toHaveAttribute("aria-activedescendant", /r0$/)
    await page.getByTestId("book-search").press("Enter")
    await expect(page.getByTestId("book-confirm")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Revisa y añade" })).toBeFocused()
    expect(await blocking(page)).toEqual([])
    const width = info.project.name === "mobile" ? 375 : 1440
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    // Back keeps the search and its results.
    await page.getByTestId("confirm-back").click()
    await expect(page.getByTestId("book-search")).toHaveValue("infinito")
    await expect(page.getByTestId("book-result")).toHaveCount(2)
    if (!isMobile(info.project.name)) {
      await page.keyboard.press("Escape")
      await expect(page.getByRole("alertdialog")).toContainText("¿Descartar lo escrito?")
    }
  })

  test("a reload half-way offers to recover it: chosen edition and typed fields come back, and saving clears the draft (D102)", async ({ page }) => {
    await providers(page, library)
    await openAssistant(page)
    await page.getByTestId("book-search").fill("infinito")
    await page.getByTestId("book-result").first().click()
    await expect(page.getByTestId("confirm-pages")).toHaveValue("452")
    await page.getByTestId("confirm-pages").fill("460")
    await page.getByTestId("change-edition").click()
    await page.getByTestId("edition-option").filter({ hasText: "Debate" }).click()
    await expect(page.getByTestId("confirm-publisher")).toHaveValue("Debate")

    await openWithDraft(page)
    await expect(page.getByTestId("draft-offer")).toContainText("El infinito en un junco")
    await page.getByTestId("draft-recover").click()
    await expect(page.getByTestId("book-confirm")).toBeVisible()
    await expect(page.getByTestId("confirm-publisher")).toHaveValue("Debate")
    await expect(page.getByTestId("confirm-pages")).toHaveValue("460")

    await page.getByTestId("confirm-save").click()
    await expect(page.getByRole("heading", { level: 1, name: "El infinito en un junco" })).toBeVisible()
    await expect.poll(() => draftKeys(page)).toEqual([])
    await openAssistant(page)
    await expect(page.getByTestId("draft-offer")).toHaveCount(0)
    expect(await countRows("select count(*)::int n from public.library_items where user_id = $1 and deleted_at is null", [account.id])).toBe(1)
  })

  test("what was typed in the search comes back after a reload, with its results (D102)", async ({ page }) => {
    await providers(page, library)
    await openAssistant(page)
    await page.getByTestId("book-search").fill("infinito")
    await expect(page.getByTestId("book-result")).toHaveCount(2)

    await openWithDraft(page)
    await page.getByTestId("draft-recover").click()
    await expect(page.getByTestId("book-search")).toHaveValue("infinito")
    await expect(page.getByTestId("book-result")).toHaveCount(2)
  })

  test("«Empezar de cero» and an explicit discard leave nothing to recover (D102)", async ({ page }) => {
    await providers(page, library)
    await openAssistant(page)
    await page.getByTestId("book-search").fill("infinito")
    await expect(page.getByTestId("book-result")).toHaveCount(2)

    await openWithDraft(page)
    await page.getByTestId("draft-start-over").click()
    await expect(page.getByTestId("book-search")).toHaveValue("")
    await expect.poll(() => draftKeys(page)).toEqual([])

    await page.getByTestId("book-search").fill("infinito")
    await expect.poll(() => draftKeys(page)).toHaveLength(1)
    await page.getByTestId("add-book-sheet").getByRole("button", { name: "Cerrar" }).click()
    await page.getByTestId("form-discard").click()
    await expect(page.getByTestId("add-book-sheet")).toHaveCount(0)
    await expect.poll(() => draftKeys(page)).toEqual([])
  })

  test("a draft expires at 24 hours (D102)", async ({ page }) => {
    await providers(page, library)
    await openAssistant(page)
    await page.getByTestId("book-search").fill("infinito")
    await expect.poll(() => draftKeys(page)).toHaveLength(1)
    await page.evaluate((key) => {
      const stored = JSON.parse(sessionStorage.getItem(key)!) as { savedAt: number }
      sessionStorage.setItem(key, JSON.stringify({ ...stored, savedAt: stored.savedAt - 25 * 60 * 60 * 1000 }))
    }, `top:draft:book:${account.id}`)

    await openAssistant(page)
    await expect(page.getByTestId("draft-offer")).toHaveCount(0)
    await expect.poll(() => draftKeys(page)).toEqual([])
  })

  test("another account in the same tab never sees the draft (D102)", async ({ page }, info) => {
    await providers(page, library)
    await openAssistant(page)
    await page.getByTestId("book-search").fill("infinito")
    await expect.poll(() => draftKeys(page)).toHaveLength(1)

    const other = await newAccount(`addbook2-${info.project.name}`)
    try {
      await signIn(page, other)
      await openAssistant(page)
      await expect(page.getByTestId("draft-offer")).toHaveCount(0)
      await expect.poll(() => draftKeys(page)).toEqual([])
    } finally {
      await removeAccount(other)
    }
  })
})

test.describe("add a book in the demo", () => {
  test("manual entry as before, and never a request to the metadata providers", async ({ page }) => {
    const calls: string[] = []
    await page.route("**/api/metadata/**", (route) => (calls.push(route.request().url()), route.abort()))
    await page.goto("/knowledge/library/books")
    await page.getByTestId("add-book").click()
    await expect(page.getByTestId("add-book-sheet")).toHaveCount(0)
    await page.getByTestId("form-title").fill("Libro de la demo")
    await page.getByTestId("form-save").click()
    await expect(page.getByRole("heading", { level: 1, name: "Libro de la demo" })).toBeVisible()
    expect(calls).toEqual([])
  })
})

/** Visual review (M4g.3): `npx playwright test e2e/add-book.spec.ts --grep @screens`. Synthetic account and data. */
test.describe("@screens add a book", () => {
  test.use({ mode: "account" })
  test("capture the assistant's states", async ({ page }, info) => {
    const account = await newAccount(`addbook-screens-${info.project.name}`)
    try {
      await signIn(page, account)
      let failing = false
      await providers(page, (path, q) => (failing && path === "books/search" ? fail(502, "provider_unavailable") : library(path, q)))
      const shot = (name: string) => page.screenshot({ path: `docs/screenshots/${info.project.name}-m4g3-${name}.png` })
      await openAssistant(page)
      await shot("search-empty")
      await page.getByTestId("book-search").fill("infinito junco")
      await expect(page.getByTestId("book-result")).toHaveCount(2)
      await shot("results")
      await page.getByTestId("book-result").first().click()
      await expect(page.getByLabel("Descripción", { exact: true })).toHaveValue(/historia/)
      await shot("confirm")
      await page.getByTestId("change-edition").click()
      await expect(page.getByTestId("editions")).toBeVisible()
      await page.getByTestId("editions").scrollIntoViewIfNeeded()
      await shot("editions")
      await page.getByTestId("confirm-back").click()
      failing = true
      await page.getByTestId("book-search").fill("sapiens")
      await expect(page.getByTestId("book-search-status")).toHaveText("Open Library no responde ahora.")
      await shot("provider-error")
      await page.getByTestId("add-manual").click()
      await expect(page.getByTestId("form-title")).toHaveValue("sapiens")
      // Screenshots only: let the sheet finish its opening animation.
      await page.waitForTimeout(600)
      await shot("manual")
    } finally {
      await removeAccount(account)
    }
  })
})
