import type { BrowserContext, Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { countRows, newAccount, removeAccount, signIn, type Account } from "./support/account"
import { db, localStatus } from "../tests/integration/setup"

/**
 * M4-H1 · something created WITHOUT connection is on the device before the app opens its page.
 * Offline, opening the page reloads the app (the service worker serves the shell); a write of the
 * device copy still in progress then dies with the page and the new content was lost for good
 * (run 41296762714). The barrier is the same Web Lock the engine writes the device copy under: held
 * by the test, the write cannot finish until it is released, whatever the speed of the machine.
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

/**
 * No connection, made sure twice. `setOffline` alone leaked: in the full reload that opening a page
 * offline causes, the new document's first request to Supabase sometimes went out (unreported by
 * Playwright), so the server had the write while the test was «offline» (3 of 6 runs; none of 10
 * with this). Every request to the local Supabase is aborted too; a device with no network has no gap.
 */
let cut = false
async function setConnection(context: BrowserContext, online: boolean) {
  cut = !online
  await context.setOffline(!online)
}

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name })
const ops = (a: Account, type: string) => countRows("select count(*)::int n from public.sync_operations where user_id = $1 and operation_type = $2", [a.id, type])

let account: Account
test.beforeEach(async ({ page, context }, info) => {
  cut = false
  const supabase = new URL(localStatus().API_URL).port
  await context.route((u) => u.port === supabase, (r) => (cut ? r.abort("internetdisconnected") : r.fallback()))
  account = await newAccount(`offsave-${info.project.name}`)
  await signIn(page, account)
})
test.afterEach(async () => {
  await removeAccount(account)
})

test("a book saved offline opens its page only once it is on the device; a slow write says so; a double tap adds one; reload and reconnect send it once", async ({ page, context }) => {
  await page.goto("/knowledge/library/books")
  await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
  await prepared(page)
  await setConnection(context, false)
  await page.getByTestId("add-book").click()
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

  await setConnection(context, true)
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
  await setConnection(context, false)
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 })

  await page.getByTestId("add-menu").click()
  await page.getByRole("menuitem", { name: "Programa de podcast" }).click()
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

  await setConnection(context, true)
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

test("storage refusing the write: the form says so, keeps what was typed, opens nothing, and «Reintentar» stores it once", async ({ page, context }) => {
  await page.goto("/knowledge/library/books")
  await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
  await prepared(page)
  await setConnection(context, false)
  await page.getByTestId("add-book").click()
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
  await setConnection(context, true)
  await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 20_000 })
  expect(await countRows("select count(*)::int n from public.library_items where user_id = $1 and deleted_at is null", [account.id])).toBe(1)
  expect(await ops(account, "library.item.create")).toBe(1)
})
