import type { Page, Route } from "@playwright/test"
import { expect, test } from "./fixtures"
import { countRows, newAccount, removeAccount, signIn, type Account } from "./support/account"
import { setConnection, strictOffline } from "./support/offline"
import { db } from "../tests/integration/setup"

/**
 * M4-H1 · something created WITHOUT connection is on the device before the app opens its page.
 * Offline, opening the page reloads the app (the service worker serves the shell); a write of the
 * device copy still in progress then dies with the page and the new content was lost for good
 * (run 41296762714). The barrier is the same Web Lock the engine writes the device copy under: held
 * by the test, the write cannot finish until it is released, whatever the speed of the machine.
 *
 * In M4g a new book, show or episode opens the search assistants (Open Library, Apple): the manual
 * form is reached from them, and they wait for the device copy the same way. Their providers are
 * answered from the page with fixed data, chosen online (searching needs the network); the save is
 * made offline, as on a phone that loses coverage on the confirmation screen.
 */
test.use({ mode: "account", serviceWorkers: "allow" })
test.setTimeout(150_000)

const SHELL_PAGES = 19

/** The shell installed and complete, as on a phone that already opened the app (offline.spec.ts). */
async function prepared(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state), { timeout: 15_000 }).toBe("activated")
  await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.postMessage({ type: "top:warm" }))
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const names = (await caches.keys()).filter((n) => n.startsWith("top-shell-"))
          if (names.length !== 1) return -1
          const keys = await (await caches.open(names[0])).keys()
          return keys.filter((k) => !new URL(k.url).pathname.includes(".") && !new URL(k.url).pathname.startsWith("/_next/")).length
        }),
      { timeout: 60_000 }
    )
    .toBe(SHELL_PAGES)
}

/** Holds the lock of the device copy: no write of it can finish until `release`. */
async function holdDeviceWrites(page: Page, a: Account) {
  await page.evaluate(
    (name) =>
      new Promise<void>((held) => {
        void navigator.locks.request(name, () => new Promise<void>((release) => ((window as unknown as { releaseWrites: () => void }).releaseWrites = release, held())))
      }),
    `the-one-percent:sync:${a.id}`
  )
}
const releaseDeviceWrites = (page: Page) => page.evaluate(() => (window as unknown as { releaseWrites: () => void }).releaseWrites())

/** The operation queue as stored in IndexedDB right now (type and title of each write, in order). */
function storedQueue(page: Page, a: Account) {
  return page.evaluate(
    (key) =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open("the-one-percent")
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const d = open.result
          const get = d.transaction("sync").objectStore("sync").get(key)
          get.onerror = () => reject(get.error)
          get.onsuccess = () => {
            d.close()
            const queue = (get.result?.queue ?? []) as { op: { type: string; fields?: { title?: string; body?: string } } }[]
            resolve(queue.map((q) => `${q.op.type} ${q.op.fields?.title ?? q.op.fields?.body ?? ""}`.trim()))
          }
        }
      }),
    `v1:${a.id}`
  )
}

/** Storage refuses every write, as a full disk does; returns a function that undoes it. */
async function failStorage(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { realPut?: typeof IDBObjectStore.prototype.put }
    w.realPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError")
    }
  })
  return () => page.evaluate(() => (IDBObjectStore.prototype.put = (window as unknown as { realPut: typeof IDBObjectStore.prototype.put }).realPut))
}

// ---------- providers (fixed data; anything not foreseen fails loudly instead of going out) ----------

type Reply = { status?: number; body: unknown }
const ok = (data: unknown): Reply => ({ body: { ok: true, data } })

const BOOK = {
  provider: "openlibrary",
  workId: "OL17930368W",
  editionId: "OL27918581M",
  title: "Hábitos atómicos",
  workTitle: null,
  subtitle: null,
  creators: ["James Clear"],
  language: "es",
  year: 2020,
  firstPublishedYear: 2018,
  publisher: "Diana",
  pageCount: null,
  isbn13: "9786070757020",
  isbn10: null,
  cover: null,
  description: null,
  topicSuggestions: [],
  editionCount: 3,
  sourceUrl: "https://openlibrary.org/books/OL27918581M",
  attribution: "Datos: Open Library",
}
const SHOW = {
  provider: "itunes",
  id: "1455818214",
  title: "Programa de Apple",
  publisher: "Productora de prueba",
  cover: null,
  sourceUrl: "https://podcasts.apple.com/es/podcast/x/id1455818214",
  episodeCount: 2,
  latestReleaseAt: "2026-10-28T08:00:00.000Z",
  topicSuggestions: [],
  attribution: "Datos: Apple Podcasts",
}
const EPISODE = (n: number) => ({
  provider: "itunes",
  id: String(1000700000000 + n),
  showId: SHOW.id,
  showTitle: SHOW.title,
  title: `Episodio ${n} de Apple`,
  description: `Episodio sintético ${n}.`,
  durationSeconds: 1800 + n,
  publishedAt: `2026-10-${20 + n}T08:00:00.000Z`,
  cover: null,
  sourceUrl: `https://podcasts.apple.com/es/podcast/x/id${SHOW.id}?i=${1000700000000 + n}`,
  attribution: "Datos: Apple Podcasts",
})

function answer(path: string, q: URLSearchParams): Reply | undefined {
  if (path === "books/search" && (q.get("q") ?? "").toLowerCase().includes("atómicos")) return ok([BOOK])
  if (path === "books/detail" && q.get("work") === BOOK.workId) return ok({ ...BOOK, pageCount: 328, description: "Pequeños cambios, resultados extraordinarios." })
  if (path === "books/editions") return ok([])
  if (path === "podcasts/search" && (q.get("q") ?? "").toLowerCase().includes("apple")) return ok([SHOW])
  if (path === "podcasts/episodes" && q.get("show") === SHOW.id && !q.get("q")) return ok({ show: SHOW, episodes: [EPISODE(2), EPISODE(1)], scope: "recent", total: 2, complete: true })
  return undefined
}

async function providers(page: Page) {
  const unexpected: string[] = []
  await page.route("**/api/metadata/**", async (route: Route) => {
    const u = new URL(route.request().url())
    const r = answer(u.pathname.replace("/api/metadata/", ""), u.searchParams)
    if (!r) unexpected.push(u.pathname + u.search)
    await route.fulfill({ status: r?.status ?? (r ? 200 : 599), contentType: "application/json", body: JSON.stringify(r?.body ?? { unexpected: true }) })
  })
  await page.route("**/api/covers?**", (route) => route.fulfill({ status: 404, headers: { "cache-control": "no-store" }, body: "" }))
  return unexpected
}

/** «Añadir libro» opens the assistant (M4g.3); its manual entry is the form of M4-H1. */
async function manualBook(page: Page) {
  await page.getByTestId("add-book").click()
  await page.getByTestId("add-manual").click()
}

/** Online: the book chosen in the assistant, its confirmation shown with the work's details. */
async function chooseBook(page: Page) {
  await page.getByTestId("add-book").click()
  await page.getByTestId("book-search").fill("hábitos atómicos")
  await page.getByTestId("book-result").first().click()
  await expect(page.getByTestId("confirm-pages")).toHaveValue("328")
}

/** Online: the podcast assistant at the episodes of the Apple show. */
async function chooseShow(page: Page, entry: "Episodio" | "Programa de podcast") {
  await page.getByTestId("add-menu").click()
  await page.getByRole("menuitem", { name: entry }).click()
  await page.getByTestId("show-search").fill("programa de apple")
  await page.getByTestId("show-result").first().click()
  await expect(page.getByTestId("episode-row")).toHaveCount(2)
}

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name })
const ops = (a: Account, type: string) => countRows("select count(*)::int n from public.sync_operations where user_id = $1 and operation_type = $2", [a.id, type])
const SAVED_HERE = "Guardado en este dispositivo · se enviará al recuperar la conexión"

let account: Account
test.beforeEach(async ({ page, context }, info) => {
  await strictOffline(context)
  account = await newAccount(`offsave-${info.project.name}`)
  await signIn(page, account)
})
test.afterEach(async () => {
  await removeAccount(account)
})

test("a book saved offline opens its page only once it is on the device; a slow write says so; a double tap adds one; reload and reconnect send it once", async ({ page }) => {
  await page.goto("/knowledge/library/books")
  await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
  await prepared(page)
  await setConnection(page, false)
  await manualBook(page)
  await page.getByTestId("form-title").fill("Libro guardado sin red")

  await holdDeviceWrites(page, account)
  await page.getByTestId("form-save").dblclick()
  // Not on the device yet: the form stays, says so, and never opens the page.
  await expect(page.getByTestId("form-save")).toHaveText("Guardando en este dispositivo…")
  await expect(page.getByTestId("form-save")).toBeDisabled()
  await expect(page.getByTestId("form-slow")).toBeVisible({ timeout: 6_000 })
  await expect(page).toHaveURL(/\/knowledge\/library\/books$/)
  await expect(page.getByTestId("form-title")).toHaveValue("Libro guardado sin red")
  expect(await storedQueue(page, account)).toEqual([])

  await releaseDeviceWrites(page)
  await expect(heading(page, "Libro guardado sin red")).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId("item-save")).toHaveText("Guardado en este dispositivo · se enviará al recuperar la conexión")
  expect(await storedQueue(page, account)).toEqual(["library.item.create Libro guardado sin red"])

  // Closing and opening the app again without connection: still there, still waiting.
  await page.reload()
  await expect(heading(page, "Libro guardado sin red")).toBeVisible({ timeout: 20_000 })
  expect(await countRows("select count(*)::int n from public.library_items where user_id = $1", [account.id])).toBe(0)

  await setConnection(page, true)
  await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 20_000 })
  expect(await countRows("select count(*)::int n from public.library_items where user_id = $1 and title = 'Libro guardado sin red' and deleted_at is null", [account.id])).toBe(1)
  expect(await ops(account, "library.item.create")).toBe(1)
  await expect.poll(() => storedQueue(page, account)).toEqual([])
})

test("a show, its episode and a note created offline on a 6× slower CPU: each page opens with its content stored, in order, and everything reaches the server once", async ({ page, context }) => {
  await page.goto("/knowledge/library/podcasts")
  await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
  await prepared(page)
  const cdp = await context.newCDPSession(page)
  await setConnection(page, false)
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 })

  await page.getByTestId("add-menu").click()
  await page.getByRole("menuitem", { name: "Programa de podcast" }).click()
  // The podcast assistant (M4g.4); a show written by hand is its manual entry.
  await page.getByTestId("add-manual-show").click()
  await page.getByTestId("form-title").fill("Programa sin red")
  await page.getByTestId("form-save").click()
  await expect(heading(page, "Programa sin red")).toBeVisible({ timeout: 30_000 })

  await page.getByTestId("add-episode").click()
  await page.getByTestId("form-title").fill("Episodio sin red")
  await page.getByTestId("form-save").click()
  await expect(heading(page, "Episodio sin red")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("link", { name: "Programa sin red" }).first()).toBeVisible()

  await page.getByTestId("capture-open").locator("visible=true").click()
  await page.getByTestId("capture-text").locator("visible=true").fill("Idea apuntada sin red")
  await expect(page.getByTestId("capture-save").locator("visible=true")).toHaveText("Guardado en este dispositivo · se enviará al recuperar la conexión", { timeout: 20_000 })
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 })

  // The show goes before its episode, the note after both.
  expect(await storedQueue(page, account)).toEqual(["library.show.create Programa sin red", "library.item.create Episodio sin red", "library.note.create Idea apuntada sin red"])
  await page.reload()
  await expect(heading(page, "Episodio sin red")).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText("Idea apuntada sin red")).toBeVisible()
  expect(await countRows("select count(*)::int n from public.podcast_shows where user_id = $1", [account.id])).toBe(0)

  await setConnection(page, true)
  await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 20_000 })
  const linked = await db(async (c) =>
    (
      await c.query(
        "select s.title show, i.title item, n.body note from public.podcast_shows s join public.library_items i on i.show_id = s.id join public.knowledge_notes n on n.item_id = i.id where s.user_id = $1 and s.deleted_at is null and i.deleted_at is null and n.deleted_at is null",
        [account.id]
      )
    ).rows
  )
  expect(linked).toEqual([{ show: "Programa sin red", item: "Episodio sin red", note: "Idea apuntada sin red" }])
  expect([await ops(account, "library.show.create"), await ops(account, "library.item.create"), await ops(account, "library.note.create")]).toEqual([1, 1, 1])
})

test("storage refusing the write: the form says so, keeps what was typed, opens nothing, and «Reintentar» stores it once", async ({ page }) => {
  await page.goto("/knowledge/library/books")
  await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
  await prepared(page)
  await setConnection(page, false)
  await manualBook(page)
  await page.getByTestId("form-title").fill("Libro con el disco lleno")

  const restore = await failStorage(page)
  await page.getByTestId("form-save").click()
  await expect(page.getByTestId("form-error")).toContainText("No se ha podido guardar en este dispositivo")
  await expect(page.getByTestId("form-save")).toHaveText("Reintentar")
  await expect(page).toHaveURL(/\/knowledge\/library\/books$/)
  await expect(page.getByTestId("form-title")).toHaveValue("Libro con el disco lleno")
  expect(await storedQueue(page, account)).toEqual([])

  // Still refused: still here, and a retry never creates a second book.
  await page.getByTestId("form-save").click()
  await expect(page.getByTestId("form-error")).toContainText("No se ha podido guardar en este dispositivo")
  await restore()
  await page.getByTestId("form-save").click()
  await expect(heading(page, "Libro con el disco lleno")).toBeVisible({ timeout: 20_000 })
  expect(await storedQueue(page, account)).toEqual(["library.item.create Libro con el disco lleno"])

  await page.reload()
  await expect(heading(page, "Libro con el disco lleno")).toBeVisible({ timeout: 20_000 })
  await setConnection(page, true)
  await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 20_000 })
  expect(await countRows("select count(*)::int n from public.library_items where user_id = $1 and deleted_at is null", [account.id])).toBe(1)
  expect(await ops(account, "library.item.create")).toBe(1)
})

// ---------- M4g assistants ----------

const bookRow = (a: Account) =>
  db(async (c) => (await c.query("select title, external_provider, external_id, page_count from public.library_items where user_id = $1 and deleted_at is null", [a.id])).rows)
const appleShows = (a: Account) => countRows("select count(*)::int n from public.podcast_shows where user_id = $1 and external_id = $2 and deleted_at is null", [a.id, SHOW.id])

test("assistant · a book chosen in Open Library and saved offline opens only once it is on the device; a slow write says so; a double tap adds one; leaving at once and a reload keep it; it reaches the server once with its reference", async ({ page }) => {
  const unexpected = await providers(page)
  await page.goto("/knowledge/library/books")
  await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
  await prepared(page)
  await chooseBook(page)
  await setConnection(page, false)

  await holdDeviceWrites(page, account)
  await page.getByTestId("confirm-save").dblclick()
  await expect(page.getByTestId("confirm-save")).toHaveText("Guardando en este dispositivo…")
  await expect(page.getByTestId("confirm-save")).toBeDisabled()
  await expect(page.getByTestId("confirm-manual")).toBeDisabled()
  await expect(page.getByTestId("form-slow")).toBeVisible({ timeout: 6_000 })
  // What it just wrote is not offered as a duplicate of itself.
  await expect(page.getByTestId("duplicate")).toHaveCount(0)
  await expect(page).toHaveURL(/\/knowledge\/library\/books$/)
  await expect(page.getByTestId("confirm-title")).toHaveValue("Hábitos atómicos")
  expect(await storedQueue(page, account)).toEqual([])

  await releaseDeviceWrites(page)
  await expect(heading(page, "Hábitos atómicos")).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId("item-save")).toHaveText(SAVED_HERE)
  expect(await storedQueue(page, account)).toEqual(["library.item.create Hábitos atómicos"])

  // Leaving the page at once (offline: another full load), then opening the app again.
  await page.goto("/knowledge/library/books")
  await expect(page.getByText("Hábitos atómicos").first()).toBeVisible({ timeout: 20_000 })
  await page.reload()
  await expect(page.getByText("Hábitos atómicos").first()).toBeVisible({ timeout: 20_000 })
  expect(await countRows("select count(*)::int n from public.library_items where user_id = $1", [account.id])).toBe(0)

  await setConnection(page, true)
  await expect.poll(() => bookRow(account), { timeout: 20_000 }).toEqual([{ title: "Hábitos atómicos", external_provider: "openlibrary", external_id: BOOK.workId, page_count: 328 }])
  expect(await ops(account, "library.item.create")).toBe(1)
  await expect.poll(() => storedQueue(page, account)).toEqual([])
  expect(unexpected).toEqual([])
})

test("assistant · «Seguir el programa» offline opens the show only once it is on the device; a slow write says so; reload and reconnect send it once", async ({ page }) => {
  const unexpected = await providers(page)
  await page.goto("/knowledge/library/podcasts")
  await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
  await prepared(page)
  await chooseShow(page, "Programa de podcast")
  await setConnection(page, false)

  await holdDeviceWrites(page, account)
  await page.getByTestId("save-show").dblclick()
  await expect(page.getByTestId("save-show")).toHaveText("Guardando en este dispositivo…")
  await expect(page.getByTestId("save-show")).toBeDisabled()
  await expect(page.getByTestId("add-manual-episode")).toBeDisabled()
  await expect(page.getByTestId("form-slow")).toBeVisible({ timeout: 6_000 })
  await expect(page).toHaveURL(/\/knowledge\/library\/podcasts$/)
  expect(await storedQueue(page, account)).toEqual([])

  await releaseDeviceWrites(page)
  await expect(heading(page, "Programa de Apple")).toBeVisible({ timeout: 20_000 })
  expect(await storedQueue(page, account)).toEqual(["library.show.create Programa de Apple"])
  await page.reload()
  await expect(heading(page, "Programa de Apple")).toBeVisible({ timeout: 20_000 })
  expect(await appleShows(account)).toBe(0)

  await setConnection(page, true)
  await expect.poll(() => appleShows(account), { timeout: 20_000 }).toBe(1)
  expect(await ops(account, "library.show.create")).toBe(1)
  await expect.poll(() => storedQueue(page, account)).toEqual([])
  expect(unexpected).toEqual([])
})

test("assistant · an Apple episode and its new show saved offline on a 6× slower CPU: the page opens with both stored, show first; a note on it; reload; all reach the server once, linked", async ({ page, context }) => {
  const unexpected = await providers(page)
  await page.goto("/knowledge/library/podcasts")
  await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
  await prepared(page)
  await chooseShow(page, "Episodio")
  await page.getByTestId("episode-row").first().click()
  await expect(page.getByTestId("confirm-program")).toHaveValue("__new__")
  const cdp = await context.newCDPSession(page)
  await setConnection(page, false)
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 })

  await page.getByTestId("confirm-save").click()
  await expect(heading(page, "Episodio 2 de Apple")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("link", { name: "Programa de Apple" }).first()).toBeVisible()
  await page.getByTestId("capture-open").locator("visible=true").click()
  await page.getByTestId("capture-text").locator("visible=true").fill("Nota del episodio sin red")
  await expect(page.getByTestId("capture-save").locator("visible=true")).toHaveText(SAVED_HERE, { timeout: 20_000 })
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 })

  expect(await storedQueue(page, account)).toEqual(["library.show.create Programa de Apple", "library.item.create Episodio 2 de Apple", "library.note.create Nota del episodio sin red"])
  await page.reload()
  await expect(heading(page, "Episodio 2 de Apple")).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText("Nota del episodio sin red")).toBeVisible()
  expect(await countRows("select count(*)::int n from public.podcast_shows where user_id = $1", [account.id])).toBe(0)

  await setConnection(page, true)
  await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 20_000 })
  const linked = await db(async (c) =>
    (
      await c.query(
        "select s.title show, s.external_id show_ref, i.title item, i.external_id item_ref, n.body note from public.podcast_shows s join public.library_items i on i.show_id = s.id join public.knowledge_notes n on n.item_id = i.id where s.user_id = $1 and s.deleted_at is null and i.deleted_at is null and n.deleted_at is null",
        [account.id]
      )
    ).rows
  )
  expect(linked).toEqual([{ show: "Programa de Apple", show_ref: SHOW.id, item: "Episodio 2 de Apple", item_ref: EPISODE(2).id, note: "Nota del episodio sin red" }])
  expect([await ops(account, "library.show.create"), await ops(account, "library.item.create"), await ops(account, "library.note.create")]).toEqual([1, 1, 1])
  expect(unexpected).toEqual([])
})

test("assistant · storage refusing an Apple episode and its new show: the confirmation says so, keeps the choice, opens nothing, and «Reintentar» stores each once", async ({ page }) => {
  const unexpected = await providers(page)
  await page.goto("/knowledge/library/podcasts")
  await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
  await prepared(page)
  await chooseShow(page, "Episodio")
  await page.getByTestId("episode-row").first().click()
  await setConnection(page, false)

  const restore = await failStorage(page)
  await page.getByTestId("confirm-save").click()
  await expect(page.getByTestId("form-error")).toContainText("No se ha podido guardar en este dispositivo")
  await expect(page.getByTestId("confirm-save")).toHaveText("Reintentar")
  await expect(page.getByTestId("confirm-save")).toBeEnabled()
  await expect(page.getByTestId("duplicate")).toHaveCount(0)
  await expect(page).toHaveURL(/\/knowledge\/library\/podcasts$/)
  await expect(page.getByTestId("confirm-title")).toHaveValue("Episodio 2 de Apple")
  expect(await storedQueue(page, account)).toEqual([])

  // Still refused: still here, and a retry never creates a second show or episode.
  await page.getByTestId("confirm-save").click()
  await expect(page.getByTestId("form-error")).toContainText("No se ha podido guardar en este dispositivo")
  await restore()
  await page.getByTestId("confirm-save").click()
  await expect(heading(page, "Episodio 2 de Apple")).toBeVisible({ timeout: 20_000 })
  expect(await storedQueue(page, account)).toEqual(["library.show.create Programa de Apple", "library.item.create Episodio 2 de Apple"])

  await page.reload()
  await expect(heading(page, "Episodio 2 de Apple")).toBeVisible({ timeout: 20_000 })
  await setConnection(page, true)
  await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 20_000 })
  expect(await appleShows(account)).toBe(1)
  expect(await countRows("select count(*)::int n from public.library_items where user_id = $1 and deleted_at is null", [account.id])).toBe(1)
  expect([await ops(account, "library.show.create"), await ops(account, "library.item.create")]).toEqual([1, 1])
  expect(unexpected).toEqual([])
})
