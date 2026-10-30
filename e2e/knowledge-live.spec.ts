import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test"
import { expect, isMobile, test } from "./fixtures"
import { countRows, newAccount, removeAccount, signIn, type Account } from "./support/account"
import { db } from "../tests/integration/setup"

/**
 * M4e · live sync of the Library between two browsers of one account (local Supabase, realtime):
 * what one does appears in the other WITHOUT reloading. Each test counts the page loads after the
 * first one and requires zero, so a reload can never make it pass.
 */
test.use({ mode: "account" })

let account: Account
test.beforeEach(async ({}, info) => {
  test.skip(isMobile(info.project.name), "two browsers: covered once, on desktop")
  account = await newAccount(`live-${info.project.name}`)
})
test.afterEach(async ({}, info) => {
  if (!isMobile(info.project.name)) await removeAccount(account)
})

const LIVE = { timeout: 20_000 }
type Row = Record<string, unknown>
const one = (sql: string, params: unknown[]) => db(async (c) => ((await c.query(sql, params)).rows[0] as Row | undefined) ?? null)
const noteRow = (body: string) => one("select id, item_id, deleted_at from public.knowledge_notes where user_id = $1 and body = $2", [account.id, body])
const live = (page: Page) => page.getByTestId("note").locator("visible=true")
const card = (page: Page, text: string) => live(page).filter({ hasText: text })

/** Counts full page loads of the main frame from now on. */
function loads(page: Page) {
  let n = 0
  page.on("load", () => n++)
  return () => n
}

async function synced(page: Page) {
  await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
}

async function device(browser: Browser, info: TestInfo): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL })
  const page = await ctx.newPage()
  await signIn(page, account)
  return { ctx, page }
}

async function addBook(page: Page, title: string): Promise<string> {
  await page.goto("/knowledge/library/books")
  await synced(page)
  await page.getByTestId("add-book").click()
  await page.getByTestId("form-title").fill(title)
  await page.getByTestId("form-save").click()
  await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 15_000 })
  return new URL(page.url()).searchParams.get("id")!
}

async function capture(page: Page, body: string) {
  const open = page.getByTestId("capture-open").locator("visible=true")
  if (await open.count()) await open.click()
  else await page.getByTestId("capture-next").locator("visible=true").click()
  await page.getByTestId("capture-text").locator("visible=true").fill(body)
}

async function edit(page: Page, from: string, to: string) {
  await page.getByRole("button", { name: new RegExp(`^Editar nota: ${from}`) }).locator("visible=true").click()
  await page.getByTestId("note-edit").fill(to)
  await page.getByTestId("note-edit").blur()
}

test.describe("library · live sync between two browsers", () => {
  test("created in A appears in B, edited in B updates A, deleted in A disappears in B; states truthful; no reloads", async ({ page, browser }, info) => {
    test.slow()
    await signIn(page, account)
    const id = await addBook(page, "Libro en vivo")
    const b = await device(browser, info)
    await b.page.goto(`/knowledge/library/item?id=${id}`)
    await synced(b.page)
    const loadsA = loads(page)
    const loadsB = loads(b.page)

    await capture(page, "Nota escrita en A")
    await expect(page.getByTestId("capture-save").locator("visible=true")).toHaveText("Sincronizado", { timeout: 15_000 })
    let t0 = Date.now()
    await expect(card(b.page, "Nota escrita en A")).toBeVisible(LIVE)
    const createMs = Date.now() - t0
    await expect(card(b.page, "Nota escrita en A").getByRole("status")).toHaveText("Sincronizado")

    await edit(b.page, "Nota escrita en A", "Nota corregida en B")
    await expect(card(b.page, "Nota corregida en B").getByRole("status")).toHaveText("Sincronizado", { timeout: 15_000 })
    t0 = Date.now()
    await expect(card(page, "Nota corregida en B")).toBeVisible(LIVE)
    const editMs = Date.now() - t0
    await expect(card(page, "Nota escrita en A")).toHaveCount(0)

    await card(page, "Nota corregida en B").getByRole("button", { name: "Más acciones de la nota" }).click()
    await page.getByRole("menuitem", { name: "Eliminar" }).click()
    t0 = Date.now()
    await expect(card(b.page, "Nota corregida en B")).toHaveCount(0, LIVE)
    const deleteMs = Date.now() - t0
    // From «Sincronizado» on one browser to visible on the other (realtime + grouped pull).
    info.annotations.push({ type: "latency", description: `alta ${createMs} ms · edición ${editMs} ms · borrado (desde el clic) ${deleteMs} ms` })
    await expect.poll(async () => (await noteRow("Nota corregida en B"))?.deleted_at, { timeout: 15_000 }).not.toBeNull()

    expect(loadsA()).toBe(0)
    expect(loadsB()).toBe(0)
    await b.ctx.close()
  })

  test("B offline while both write: nothing is lost, each change reaches the server once, and both converge without reloading", async ({ page, browser }, info) => {
    test.slow()
    await signIn(page, account)
    const id = await addBook(page, "Libro sin red")
    const b = await device(browser, info)
    await b.page.goto(`/knowledge/library/item?id=${id}`)
    await synced(b.page)
    const loadsA = loads(page)
    const loadsB = loads(b.page)

    await b.ctx.setOffline(true)
    await capture(page, "Escrita en A mientras B no tiene red")
    await expect(page.getByTestId("capture-save").locator("visible=true")).toHaveText("Sincronizado", { timeout: 15_000 })
    await capture(b.page, "Escrita en B sin red")
    await expect(b.page.getByTestId("capture-save").locator("visible=true")).toHaveText("Guardado en este dispositivo · se enviará al recuperar la conexión")
    await expect(b.page.getByRole("button", { name: /Estado de datos/ }).first()).not.toHaveAccessibleName(/Sincronizado/)
    expect(await noteRow("Escrita en B sin red")).toBeNull()

    await b.ctx.setOffline(false)
    await expect(b.page.getByTestId("capture-save").locator("visible=true")).toHaveText("Sincronizado", LIVE)
    await expect(card(b.page, "Escrita en A mientras B no tiene red")).toBeVisible(LIVE)
    await expect(card(page, "Escrita en B sin red")).toBeVisible(LIVE)
    await synced(page)
    await synced(b.page)
    expect(await countRows("select count(*)::int n from public.knowledge_notes where user_id = $1 and deleted_at is null", [account.id])).toBe(2)
    expect(await countRows("select count(*)::int n from public.sync_operations where user_id = $1 and operation_type = 'library.note.create'", [account.id])).toBe(2)
    expect(loadsA()).toBe(0)
    expect(loadsB()).toBe(0)
    await b.ctx.close()
  })

  test("the same note edited in both: B keeps both texts until it decides; «Guardar las dos» reaches A without reloading", async ({ page, browser }, info) => {
    test.slow()
    await signIn(page, account)
    const id = await addBook(page, "Libro en conflicto")
    await capture(page, "Texto común")
    await expect(page.getByTestId("capture-save").locator("visible=true")).toHaveText("Sincronizado", { timeout: 15_000 })
    const b = await device(browser, info)
    await b.page.goto(`/knowledge/library/item?id=${id}`)
    await expect(card(b.page, "Texto común")).toBeVisible(LIVE)
    const loadsA = loads(page)
    const loadsB = loads(b.page)

    await b.ctx.setOffline(true)
    await edit(b.page, "Texto común", "Versión de B")
    await edit(page, "Texto común", "Versión de A")
    await expect.poll(async () => (await noteRow("Versión de A"))?.deleted_at, { timeout: 15_000 }).toBeNull()
    await b.ctx.setOffline(false)

    const conflict = b.page.getByTestId("library-conflict").locator("visible=true")
    await expect(conflict).toBeVisible(LIVE)
    await expect(conflict).toContainText("Versión de B")
    await expect(conflict).toContainText("Versión de A")
    await expect(card(b.page, "Versión de A").getByRole("status")).toHaveText("Hay otra versión: decide cuál se queda")
    await conflict.getByRole("button", { name: "Guardar las dos" }).click()
    await expect(card(page, "Versión de B")).toBeVisible(LIVE)
    await expect(card(page, "Versión de A")).toBeVisible()
    await expect(b.page.getByTestId("library-conflict").locator("visible=true")).toHaveCount(0)
    expect(await noteRow("Versión de B")).toMatchObject({ item_id: id, deleted_at: null })
    expect(loadsA()).toBe(0)
    expect(loadsB()).toBe(0)
    await b.ctx.close()
  })

  test("a connection and a move made in A show in B without reloading; the server keeps one link and the new owner", async ({ page, browser }, info) => {
    test.slow()
    await signIn(page, account)
    const first = await addBook(page, "Primer libro")
    await capture(page, "Idea viajera")
    await expect(page.getByTestId("capture-save").locator("visible=true")).toHaveText("Sincronizado", { timeout: 15_000 })
    const second = await addBook(page, "Segundo libro")
    const noteId = (await noteRow("Idea viajera"))!.id as string

    const b = await device(browser, info)
    await b.page.goto(`/knowledge/brain?nota=${noteId}`)
    await expect(b.page.getByTestId("note-focus")).toBeVisible(LIVE)
    await expect(card(b.page, "Idea viajera").getByRole("link", { name: "Primer libro" })).toBeVisible()
    const loadsB = loads(b.page)

    await page.goto(`/knowledge/brain?nota=${noteId}`)
    await page.getByTestId("connect").click()
    await page.getByTestId("picker-search").fill("segundo")
    await page.getByTestId("picker").getByTestId("picker-row").filter({ hasText: "Segundo libro" }).click()
    await page.keyboard.press("Escape")
    await expect(b.page.getByTestId("connections")).toContainText("Segundo libro", LIVE)
    await expect.poll(() => countRows("select count(*)::int n from public.knowledge_links where user_id = $1 and deleted_at is null", [account.id]), { timeout: 15_000 }).toBe(1)

    await card(page, "Idea viajera").getByRole("button", { name: "Más acciones de la nota" }).click()
    await page.getByRole("menuitem", { name: "Mover a…" }).click()
    await page.getByTestId("picker-search").fill("segundo")
    await page.getByTestId("picker").getByTestId("picker-row").filter({ hasText: "Segundo libro" }).click()
    await expect(card(b.page, "Idea viajera").getByRole("link", { name: "Segundo libro" })).toBeVisible(LIVE)
    await expect.poll(async () => (await noteRow("Idea viajera"))?.item_id, { timeout: 15_000 }).toBe(second)
    // the connection survived the move
    await expect(b.page.getByTestId("connections")).toContainText("Segundo libro")
    expect(first).not.toBe(second)
    expect(loadsB()).toBe(0)
    await b.ctx.close()
  })
})
