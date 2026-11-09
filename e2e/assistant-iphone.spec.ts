import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { newAccount, removeAccount, signIn, type Account } from "./support/account"

/**
 * M4g.5 §23-3 · the two search assistants on an iPhone-sized screen with the keyboard open: the
 * sheet stays above the keyboard, the list keeps room to be read and everything to tap measures
 * 44 px. The keyboard is simulated the way Safari reports it (the visual viewport shrinks, the
 * window does not); the real iPhone is `docs/guia-dispositivo.md`. Synthetic provider data.
 */

const KEYBOARD = 336

const show = {
  provider: "itunes",
  id: "1455818214",
  title: "Un programa con un título larguísimo que no cabe en una sola línea del iPhone",
  publisher: "Una productora con un nombre igual de largo para ver el recorte",
  cover: null,
  sourceUrl: "https://podcasts.apple.com/es/podcast/x/id1455818214",
  episodeCount: 356,
  latestReleaseAt: "2026-10-28T23:30:00.000Z",
  topicSuggestions: ["Comedia"],
  attribution: "Datos: Apple Podcasts",
}
const episodes = Array.from({ length: 30 }, (_, i) => ({
  provider: "itunes",
  id: String(1000798560432 - i),
  showId: show.id,
  showTitle: show.title,
  title: `${331 - i}. Episodio sintético`,
  description: "Descripción sintética.",
  durationSeconds: 4596 - i * 7,
  publishedAt: new Date(Date.parse("2026-10-28T23:30:00.000Z") - i * 3.5 * 86400_000).toISOString(),
  cover: null,
  sourceUrl: "https://podcasts.apple.com/es/podcast/x/id1455818214",
  attribution: "Datos: Apple Podcasts",
}))
const book = {
  provider: "openlibrary",
  workId: "OL20770492W",
  editionId: "OL28108908M",
  title: "El infinito en un junco",
  workTitle: null,
  subtitle: null,
  creators: ["Irene Vallejo"],
  language: "es",
  year: 2020,
  firstPublishedYear: 2019,
  publisher: "Siruela",
  pageCount: 452,
  isbn13: "9788417860790",
  isbn10: "8417860797",
  cover: null,
  description: "Descripción sintética.",
  topicSuggestions: ["Historia"],
  editionCount: 19,
  sourceUrl: "https://openlibrary.org/books/OL28108908M",
  attribution: "Datos: Open Library",
}

async function providers(page: Page) {
  const answers: Record<string, unknown> = {
    "podcasts/search": [show],
    "podcasts/episodes": { show, episodes, scope: "recent", total: 356, complete: false },
    // Enough results to fill the sheet: it is as tall as its content, so one row would not measure the room.
    "books/search": Array.from({ length: 6 }, (_, i) => ({ ...book, workId: `OL2077049${i}W`, editionId: `OL2810890${i}M`, title: `${book.title} ${i + 1}` })),
    "books/detail": book,
    "books/editions": [book],
  }
  await page.route("**/api/metadata/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/metadata/", "")
    const data = answers[path]
    await route.fulfill({ status: data ? 200 : 599, contentType: "application/json", body: JSON.stringify(data ? { ok: true, data } : { unexpected: path }) })
  })
  await page.route("**/api/covers?**", (route) => route.fulfill({ status: 404, headers: { "cache-control": "no-store" }, body: "" }))
}

/** Safari with the keyboard up: `innerHeight` stays, the visual viewport loses its height. */
async function openKeyboard(page: Page) {
  await page.addInitScript((keyboard) => {
    const events = new EventTarget()
    const viewport = {
      get height() {
        return window.innerHeight - keyboard
      },
      get width() {
        return window.innerWidth
      },
      offsetTop: 0,
      offsetLeft: 0,
      pageTop: 0,
      pageLeft: 0,
      scale: 1,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    }
    Object.defineProperty(window, "visualViewport", { get: () => viewport })
  }, KEYBOARD)
}

async function openLibrary(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
}

/** The sheet's geometry once its opening animation is over. */
async function layout(page: Page, testId: string) {
  const sheet = page.getByTestId(testId)
  await expect(async () => {
    const before = await sheet.boundingBox()
    await page.waitForTimeout(100)
    expect(await sheet.boundingBox()).toEqual(before)
  }).toPass()
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`)!
    const header = el.querySelector('[data-slot="sheet-header"]')!.getBoundingClientRect()
    const footer = el.querySelector('[data-slot="sheet-footer"]')!.getBoundingClientRect()
    const small = [...el.querySelectorAll("button, a, input, select")].flatMap((e) => {
      const r = e.getBoundingClientRect()
      if (r.width === 0 || e.closest("[inert]") || (e as HTMLInputElement).type === "checkbox" || r.height >= 44) return []
      return [`${(e as HTMLElement).innerText || e.getAttribute("placeholder") || e.tagName}: ${Math.round(r.height)} px`]
    })
    const box = el.getBoundingClientRect()
    return { top: box.top, bottom: box.bottom, keyboardTop: window.visualViewport!.height, body: footer.top - header.bottom, overflow: el.scrollWidth > el.clientWidth, small }
  }, testId)
}

function expectFits(l: Awaited<ReturnType<typeof layout>>, minBody: number) {
  expect(l.top).toBeGreaterThanOrEqual(0)
  expect(l.bottom).toBeLessThanOrEqual(l.keyboardTop)
  expect(l.body).toBeGreaterThanOrEqual(minBody)
  expect(l.overflow).toBe(false)
  expect(l.small).toEqual([])
}

test.describe("search assistants with the iPhone keyboard open (account)", () => {
  test.use({ mode: "account", viewport: { width: 375, height: 812 } })
  let account: Account
  test.beforeEach(async ({ page }, info) => {
    account = await newAccount(`iphone-${info.project.name}`)
    await signIn(page, account)
    await providers(page)
    await openKeyboard(page)
  })
  test.afterEach(async () => {
    await removeAccount(account)
  })

  test("podcast: each step fits above the keyboard, with room for the list and 44 px to tap", async ({ page }) => {
    await openLibrary(page, "/knowledge/library/podcasts")
    await page.getByTestId("add-menu").click()
    await page.getByRole("menuitem", { name: "Episodio" }).click()
    await page.getByTestId("show-search").fill("programa")
    await page.getByTestId("show-result").first().click()
    await expect(page.getByTestId("episode-row").first()).toBeVisible()

    expectFits(await layout(page, "add-podcast-sheet"), 190)
    const follow = (await page.getByTestId("save-show").boundingBox())!
    const close = (await page.getByRole("button", { name: "Cerrar" }).boundingBox())!
    expect(follow.x + follow.width).toBeLessThanOrEqual(close.x)
    await expect(page.getByTestId("episode-filter")).toBeInViewport()

    await page.getByTestId("episode-row").first().click()
    await expect(page.getByTestId("episode-confirm")).toBeVisible()
    expectFits(await layout(page, "add-podcast-sheet"), 190)
  })

  test("book: results and review fit above the keyboard, with 44 px to tap", async ({ page }) => {
    await openLibrary(page, "/knowledge/library/books")
    await page.getByTestId("add-book").click()
    await page.getByTestId("book-search").fill("infinito")
    await expect(page.getByTestId("book-result").first()).toBeVisible()
    expectFits(await layout(page, "add-book-sheet"), 170)

    await page.getByTestId("book-result").first().click()
    await expect(page.getByTestId("confirm-back")).toBeVisible()
    expectFits(await layout(page, "add-book-sheet"), 190)
  })
})
