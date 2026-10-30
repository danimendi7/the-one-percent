import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test"
import { expect, isMobile, test } from "./fixtures"
import { countRows, newAccount, removeAccount, signIn, type Account } from "./support/account"
import { db } from "../tests/integration/setup"

/**
 * M4d · Library in account mode against the LOCAL Supabase stack: real rows, two browsers of one
 * account, offline capture, text conflicts, deletes with pending edits, «Deshacer», isolation
 * between users and the sign-out warning. Never «Sincronizado» for something only on the device.
 */
test.use({ mode: "account" })

let account: Account
test.beforeEach(async ({}, info) => {
  account = await newAccount(`library-${info.project.name}`)
})
test.afterEach(async () => {
  await removeAccount(account)
})

type Row = Record<string, unknown>
const one = (sql: string, params: unknown[]) => db(async (c) => ((await c.query(sql, params)).rows[0] as Row | undefined) ?? null)
const item = (title: string) => one("select id, kind, title, creators, status, rating, show_id, deleted_at from public.library_items where user_id = $1 and title = $2", [account.id, title])
const note = (body: string) => one("select id, item_id, note_type, body, page, deleted_at from public.knowledge_notes where user_id = $1 and body = $2", [account.id, body])
const liveNotes = () => countRows("select count(*)::int n from public.knowledge_notes where user_id = $1 and deleted_at is null", [account.id])
const ops = (type: string) => countRows("select count(*)::int n from public.sync_operations where user_id = $1 and operation_type = $2", [account.id, type])

const offlineErrors = (errors: string[]) => errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|ERR_FAILED|net::/.test(e))

async function synced(page: Page) {
  await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
}

async function openLibrary(page: Page, path = "/knowledge/library") {
  await page.goto(path)
  await synced(page)
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
}

/** A book with only its title, created from Libros; returns its id. */
async function addBook(page: Page, title: string): Promise<string> {
  await openLibrary(page, "/knowledge/library/books")
  await page.getByTestId("add-book").click()
  await page.getByTestId("form-title").fill(title)
  await page.getByTestId("form-save").click()
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible()
  await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 15_000 })
  return new URL(page.url()).searchParams.get("id")!
}

async function capture(page: Page, body: string, locator?: string) {
  if (await page.getByTestId("capture-open").isVisible()) await page.getByTestId("capture-open").click()
  if (locator) await page.getByTestId("capture-locator").fill(locator)
  await page.getByTestId("capture-text").fill(body)
}

const card = (page: Page, text: string) => page.getByTestId("note").locator("visible=true").filter({ hasText: text })

async function editNote(page: Page, from: string, to: string) {
  await page.getByRole("button", { name: new RegExp(`^Editar nota: ${from}`) }).locator("visible=true").click()
  await page.getByTestId("note-edit").fill(to)
  await page.getByTestId("note-edit").blur()
}

async function secondDevice(browser: Browser, info: TestInfo, who: Account = account): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL })
  const page = await ctx.newPage()
  await signIn(page, who)
  return { ctx, page }
}

test.describe("library · account mode", () => {
  test("a book with only its title, edited later; a quick idea saved while typing reaches the server once and survives a reload", async ({ page, consoleErrors }) => {
    await signIn(page, account)
    const id = await addBook(page, "Libro de cuenta E2E")
    expect(await item("Libro de cuenta E2E")).toMatchObject({ id, kind: "book", creators: [], status: "planned", rating: null, deleted_at: null })

    await page.getByTestId("edit").click()
    await page.getByLabel("Autor o autores").fill("Autora Ficticia, Otro Autor")
    await page.getByTestId("form-save").click()
    await expect.poll(async () => (await item("Libro de cuenta E2E"))?.creators, { timeout: 15_000 }).toEqual(["Autora Ficticia", "Otro Autor"])
    await page.getByRole("radiogroup", { name: "Valoración de 1 a 10" }).getByRole("radio", { name: "8 de 10" }).click()
    await expect.poll(async () => (await item("Libro de cuenta E2E"))?.rating, { timeout: 15_000 }).toBe(8)

    await capture(page, "Idea guardada sola desde la cuenta", "33")
    await expect(page.getByTestId("capture-save")).toHaveText("Sincronizado", { timeout: 15_000 })
    expect(await note("Idea guardada sola desde la cuenta")).toMatchObject({ item_id: id, note_type: "idea", page: 33, deleted_at: null })
    expect(await ops("library.note.create")).toBe(1)

    // edit an existing note (a learning) in place
    await page.getByTestId("capture-next").click()
    await page.getByRole("radiogroup", { name: "Tipo de nota" }).getByRole("radio").nth(1).click()
    await page.getByTestId("capture-text").fill("Un aprendizaje")
    await expect(page.getByTestId("capture-save")).toHaveText("Sincronizado", { timeout: 15_000 })
    await editNote(page, "Un aprendizaje", "Un aprendizaje, corregido")
    await expect.poll(async () => (await note("Un aprendizaje, corregido"))?.note_type, { timeout: 15_000 }).not.toBeUndefined()

    await page.reload()
    await synced(page)
    await expect(card(page, "Idea guardada sola desde la cuenta")).toBeVisible()
    await expect(card(page, "Un aprendizaje, corregido")).toBeVisible()
    await expect(page.getByText("Autora Ficticia, Otro Autor").first()).toBeVisible()
    expect(consoleErrors).toEqual([])
  })

  test("podcasts: a show with an episode and an episode without a show, as real rows", async ({ page, consoleErrors }) => {
    await signIn(page, account)
    await openLibrary(page, "/knowledge/library/podcasts")
    await page.getByTestId("add-menu").click()
    await page.getByRole("menuitem", { name: "Programa de podcast" }).click()
    await page.getByTestId("form-title").fill("Programa de cuenta E2E")
    await page.getByTestId("form-save").click()
    await expect(page).toHaveURL(/\/knowledge\/library\/show\?id=[^&]+$/)
    const showId = new URL(page.url()).searchParams.get("id")
    await page.getByTestId("add-episode").click()
    await page.getByTestId("form-title").fill("Episodio con programa E2E")
    await page.getByTestId("form-save").click()
    await expect(page.getByRole("heading", { level: 1, name: "Episodio con programa E2E" })).toBeVisible()
    await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 15_000 })
    expect(await item("Episodio con programa E2E")).toMatchObject({ kind: "episode", show_id: showId })

    await openLibrary(page, "/knowledge/library/podcasts")
    await page.getByTestId("add-menu").click()
    await page.getByRole("menuitem", { name: "Episodio" }).click()
    await page.getByTestId("form-title").fill("Episodio suelto E2E")
    await page.getByTestId("form-save").click()
    await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 15_000 })
    expect(await item("Episodio suelto E2E")).toMatchObject({ kind: "episode", show_id: null })
    await capture(page, "Nota con minuto", "12:34")
    await expect(page.getByTestId("capture-save")).toHaveText("Sincronizado", { timeout: 15_000 })
    expect(await one("select position_seconds from public.knowledge_notes where user_id = $1 and body = 'Nota con minuto'", [account.id])).toEqual({ position_seconds: 754 })
    expect(consoleErrors).toEqual([])
  })

  test("captured offline: «se enviará al recuperar la conexión», never «Sincronizado»; back online it reaches the server once", async ({ page, context, consoleErrors }) => {
    await signIn(page, account)
    await addBook(page, "Libro offline E2E")
    await context.setOffline(true)
    await capture(page, "Escrita sin conexión")
    await expect(page.getByTestId("capture-save")).toHaveText("Guardado en este dispositivo · se enviará al recuperar la conexión")
    await expect(page.getByTestId("capture-save")).not.toContainText("Sincronizado")
    await expect(card(page, "Escrita sin conexión").getByRole("status")).not.toContainText("Sincronizado")
    expect(await note("Escrita sin conexión")).toBeNull()
    await context.setOffline(false)
    await expect(page.getByTestId("capture-save")).toHaveText("Sincronizado", { timeout: 20_000 })
    expect(await note("Escrita sin conexión")).toMatchObject({ deleted_at: null })
    expect(await ops("library.note.create")).toBe(1)
    expect(offlineErrors(consoleErrors)).toEqual([])
  })

  test("two browsers: a note written in one appears in the other; the same note edited in both keeps both texts until «Guardar las dos»", async ({ browser, page }, info) => {
    test.skip(isMobile(info.project.name), "covered once")
    test.slow()
    await signIn(page, account)
    const id = await addBook(page, "Libro compartido E2E")
    await capture(page, "Texto original")
    await expect(page.getByTestId("capture-save")).toHaveText("Sincronizado", { timeout: 15_000 })

    const b = await secondDevice(browser, info)
    await openLibrary(b.page, `/knowledge/library/item?id=${id}`)
    await expect(card(b.page, "Texto original")).toBeVisible({ timeout: 15_000 })

    await b.ctx.setOffline(true)
    await editNote(b.page, "Texto original", "Versión del móvil")
    await expect(card(b.page, "Versión del móvil").getByRole("status")).toContainText("se enviará al recuperar la conexión")
    await page.reload()
    await synced(page)
    await editNote(page, "Texto original", "Versión del portátil")
    await expect.poll(async () => (await note("Versión del portátil"))?.deleted_at, { timeout: 15_000 }).toBeNull()
    await b.ctx.setOffline(false)

    const conflict = b.page.getByTestId("library-conflict").locator("visible=true")
    await expect(conflict).toBeVisible({ timeout: 20_000 })
    await expect(conflict).toHaveAttribute("data-code", "field_conflict")
    await expect(conflict).toContainText("Versión del móvil")
    await expect(conflict).toContainText("Versión del portátil")
    // nothing overwritten silently
    expect(await note("Versión del portátil")).not.toBeNull()
    expect(await note("Versión del móvil")).toBeNull()

    await conflict.getByRole("button", { name: "Guardar las dos" }).click()
    await expect.poll(async () => (await note("Versión del móvil"))?.item_id, { timeout: 15_000 }).toBe(id)
    expect(await note("Versión del portátil")).toMatchObject({ deleted_at: null })
    await expect(b.page.getByTestId("library-conflict").locator("visible=true")).toHaveCount(0)
    await b.ctx.close()
  })

  test("deleted in another browser while edited offline here: the text is kept and «Restaurar con mi texto» brings it back", async ({ browser, page }, info) => {
    test.skip(isMobile(info.project.name), "covered once")
    test.slow()
    await signIn(page, account)
    const id = await addBook(page, "Libro borrado fuera E2E")
    await capture(page, "Nota que se borrará fuera")
    await expect(page.getByTestId("capture-save")).toHaveText("Sincronizado", { timeout: 15_000 })

    const b = await secondDevice(browser, info)
    await openLibrary(b.page, `/knowledge/library/item?id=${id}`)
    await b.ctx.setOffline(true)
    await editNote(b.page, "Nota que se borrará fuera", "Mi texto sin conexión")

    await page.reload()
    await synced(page)
    await card(page, "Nota que se borrará fuera").getByRole("button", { name: "Más acciones de la nota" }).click()
    await page.getByRole("menuitem", { name: "Eliminar" }).click()
    await expect.poll(async () => (await note("Nota que se borrará fuera"))?.deleted_at, { timeout: 15_000 }).not.toBeNull()
    await b.ctx.setOffline(false)

    const conflict = b.page.getByTestId("library-conflict").locator("visible=true")
    await expect(conflict).toBeVisible({ timeout: 20_000 })
    await expect(conflict).toHaveAttribute("data-code", "deleted")
    await expect(conflict.getByTestId("conflict-mine")).toHaveText("Mi texto sin conexión")
    await conflict.getByRole("button", { name: "Restaurar con mi texto" }).click()
    await expect.poll(async () => (await note("Mi texto sin conexión"))?.deleted_at, { timeout: 15_000 }).toBeNull()
    await b.ctx.close()
  })

  test("a book is not deleted while its notes have unsent edits; once sent it is, and «Deshacer» brings back the book and its notes", async ({ page, context, consoleErrors }) => {
    await signIn(page, account)
    const id = await addBook(page, "Libro con pendientes E2E")
    await capture(page, "Nota del libro")
    await expect(page.getByTestId("capture-save")).toHaveText("Sincronizado", { timeout: 15_000 })

    await context.setOffline(true)
    await editNote(page, "Nota del libro", "Nota del libro editada sin conexión")
    await page.getByTestId("delete").click()
    await page.getByTestId("delete-confirm").click()
    await expect(page.getByText("Hay cambios de sus notas sin enviar")).toBeVisible()
    await expect(page.getByRole("heading", { level: 1, name: "Libro con pendientes E2E" })).toBeVisible()
    await context.setOffline(false)
    await expect.poll(async () => (await note("Nota del libro editada sin conexión"))?.deleted_at, { timeout: 20_000 }).toBeNull()

    await page.getByTestId("delete").click()
    await page.getByTestId("delete-confirm").click()
    await expect(page).toHaveURL(/\/knowledge\/library\/books$/)
    await expect.poll(async () => (await item("Libro con pendientes E2E"))?.deleted_at, { timeout: 15_000 }).not.toBeNull()
    expect(await liveNotes()).toBe(0)
    await page.getByRole("button", { name: "Deshacer" }).click()
    await expect.poll(async () => (await item("Libro con pendientes E2E"))?.deleted_at, { timeout: 15_000 }).toBeNull()
    await expect.poll(liveNotes, { timeout: 15_000 }).toBe(1)
    await page.goto(`/knowledge/library/item?id=${id}`)
    await expect(card(page, "Nota del libro editada sin conexión")).toBeVisible()
    expect(offlineErrors(consoleErrors)).toEqual([])
  })

  test("Cerebro: a free idea is a real note without a book, and it is listed with the others", async ({ page, consoleErrors }) => {
    await signIn(page, account)
    await openLibrary(page, "/knowledge/brain")
    await capture(page, "Idea suelta de cuenta")
    await expect(page.getByTestId("capture-save")).toHaveText("Sincronizado", { timeout: 15_000 })
    expect(await note("Idea suelta de cuenta")).toMatchObject({ item_id: null, deleted_at: null })
    await page.reload()
    await synced(page)
    await page.goto("/knowledge/brain?origen=sueltas")
    await synced(page)
    await expect(card(page, "Idea suelta de cuenta")).toBeVisible()
    expect(consoleErrors).toEqual([])
  })

  test("isolation: another account sees none of it, and the demo never shows account data", async ({ browser, page }, info) => {
    test.skip(isMobile(info.project.name), "covered once")
    await signIn(page, account)
    await addBook(page, "Libro privado E2E")
    const other = await newAccount(`library-other-${info.project.name}`)
    try {
      const b = await secondDevice(browser, info, other)
      await openLibrary(b.page)
      await expect(b.page.getByText("Tu biblioteca empieza con un título")).toBeVisible()
      await expect(b.page.getByText("Libro privado E2E")).toHaveCount(0)
      expect(await countRows("select count(*)::int n from public.library_items where user_id = $1", [other.id])).toBe(0)
      await b.ctx.close()
    } finally {
      await removeAccount(other)
    }
    const demo = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL })
    await demo.addCookies([{ name: "top_mode", value: "demo", url: info.project.use.baseURL! }])
    const d = await demo.newPage()
    await d.goto("/knowledge/library/books")
    await expect(d.getByText("Demo · datos de ejemplo").first()).toBeVisible()
    await expect(d.getByTestId("item-tile").first()).toBeVisible()
    await expect(d.getByText("Libro privado E2E")).toHaveCount(0)
    await demo.close()
  })

  test("signing out with a library change not sent yet: the dialog says so, and wiping warns before anything is lost", async ({ page, context }) => {
    await signIn(page, account)
    await addBook(page, "Libro antes de salir E2E")
    // the server becomes unreachable (the app itself still loads)
    await context.route("**/rest/v1/**", (r) => r.abort())
    await capture(page, "Pendiente al cerrar sesión")
    await expect(page.getByTestId("capture-save")).not.toHaveText("Sincronizado")
    await expect(page.getByTestId("capture-save")).toContainText("Guardado en este dispositivo")
    await page.goto("/settings")
    await page.getByRole("button", { name: "Cerrar sesión" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toContainText(/Hay \d+ cambios? sin sincronizar/)
    await dialog.getByRole("switch").click()
    await expect(dialog.getByRole("alert")).toContainText("Se perderán")
    await expect(dialog.getByRole("button", { name: "Borrar y cerrar sesión" })).toBeVisible()
    await dialog.getByRole("button", { name: "Cancelar" }).click()
    await context.unroute("**/rest/v1/**")
    await expect.poll(async () => (await note("Pendiente al cerrar sesión"))?.deleted_at, { timeout: 30_000 }).toBeNull()
  })
})
