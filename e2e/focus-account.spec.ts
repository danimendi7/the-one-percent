import type { BrowserContext, Page } from "@playwright/test"
import { db } from "../tests/integration/setup"
import { expect, isMobile, test } from "./fixtures"
import { countRows, newAccount, removeAccount, signIn, type Account } from "./support/account"

/** M3.2c · Deep Work in account mode against the LOCAL Supabase stack: real rows, sync, no fictitious data. */
test.use({ mode: "account" })

let account: Account
test.beforeEach(async ({}, info) => {
  account = await newAccount(`focus-${info.project.name}`)
})
test.afterEach(async () => {
  await removeAccount(account)
})

const ops = (type: string) => countRows("select count(*)::int n from public.sync_operations where user_id = $1 and operation_type = $2", [account.id, type])
const sessions = () => countRows("select count(*)::int n from public.focus_sessions where user_id = $1 and deleted_at is null", [account.id])

/** Test setup only (local stack): pretend the active block started `minutes` ago. The guard recomputes everything. */
async function backdateActive(minutes: number) {
  await db((c) =>
    c.query(
      `update public.focus_sessions set segments = jsonb_build_array(jsonb_build_object('start', private.iso(now() - make_interval(mins => $2)), 'end', null))
       where user_id = $1 and state = 'running' and deleted_at is null`,
      [account.id, minutes]
    )
  )
}

async function synced(page: Page) {
  await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
}

async function createFedHabit(page: Page) {
  await page.goto("/habits")
  await page.getByRole("button", { name: /^(Nuevo|Crear) hábito$/ }).first().click()
  const sheet = page.getByRole("dialog")
  await sheet.getByLabel("Nombre").fill("Deep Work")
  await sheet.getByRole("radiogroup", { name: "Tipo de registro" }).getByRole("radio", { name: "Duración" }).click()
  await sheet.getByRole("textbox", { name: "Objetivo", exact: true }).fill("90")
  await sheet.getByRole("switch", { name: "Se alimenta de sesiones de enfoque" }).click()
  await sheet.getByRole("button", { name: "Crear hábito" }).click()
  await expect(sheet).toBeHidden()
  await expect.poll(() => countRows("select count(*)::int n from public.habits where user_id = $1 and activity_source = 'focus'", [account.id])).toBe(1)
}

test.describe("focus · account mode", () => {
  test("a new account shows honest empty states and no demo sessions", async ({ page, consoleErrors }) => {
    await signIn(page, account)
    await page.goto("/focus")
    await expect(page.getByText("Aún no hay sesiones")).toBeVisible()
    await expect(page.getByText(/Demo/)).toHaveCount(0)
    await expect(page.getByTestId("focus-today-minutes")).toHaveText("0 min")
    await expect(page.getByText(/Escritura|Producto/)).toHaveCount(0)
    expect(consoleErrors).toEqual([])
  })

  test("started offline, app closed, reopened online: applied once; finishing feeds the linked habit exactly once", async ({ page, context }) => {
    await signIn(page, account)
    await createFedHabit(page)
    await page.goto("/focus")
    await synced(page)

    await context.setOffline(true)
    await page.getByRole("button", { name: /^Empezar/ }).click()
    await expect(page.getByRole("region", { name: "Bloque en curso" })).toBeVisible()
    expect(await sessions()).toBe(0)
    await page.close()
    await context.setOffline(false)

    const p = await context.newPage()
    await p.goto("/focus")
    await expect(p.getByRole("region", { name: "Bloque en curso" })).toBeVisible()
    await expect.poll(sessions, { timeout: 15_000 }).toBe(1)
    expect(await ops("focus.start")).toBe(1)

    await backdateActive(50)
    await p.reload()
    await expect(p.getByTestId("focus-clock")).toHaveText(/^\+?00:0\d$/, { timeout: 15_000 })
    await p.getByRole("button", { name: "Terminar" }).click()
    const sheet = p.getByRole("dialog")
    await expect(sheet.getByLabel("Minutos efectivos")).toHaveValue("50")
    await sheet.getByRole("radio", { name: "5 de 5" }).click()
    await sheet.getByRole("button", { name: "Guardar" }).click()

    const derived = () =>
      countRows("select coalesce(sum(value_numeric), 0)::int n from public.habit_entries where user_id = $1 and deleted_at is null and source_activity_type = 'focus_session'", [account.id])
    await expect.poll(derived, { timeout: 15_000 }).toBe(50)
    expect(await countRows("select count(*)::int n from public.habit_entries where user_id = $1 and deleted_at is null", [account.id])).toBe(1)
    expect(await ops("focus.finish")).toBe(1)
    await synced(p)

    await p.goto("/habits")
    const row = p.getByRole("region", { name: "Hoy" }).getByRole("listitem").filter({ hasText: "Deep Work" })
    await expect(row.getByText("Se alimenta de Enfoque · 50 de 90 min")).toBeVisible()
    await expect(row.getByRole("button")).toHaveCount(0)
  })

  test("a block started on one device appears on the other; pausing there freezes it here", async ({ browser, page }, info) => {
    test.skip(isMobile(info.project.name), "covered once")
    test.slow()
    await signIn(page, account)
    await page.goto("/focus")
    await page.getByRole("button", { name: /^Empezar/ }).click()
    await expect.poll(sessions, { timeout: 15_000 }).toBe(1)

    const other: BrowserContext = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL })
    const second = await other.newPage()
    await signIn(second, account)
    await expect(second.getByRole("link", { name: /En foco.*Volver al bloque/ }).first()).toBeVisible({ timeout: 15_000 })
    await second.goto("/focus")
    await second.getByRole("button", { name: "Pausar" }).click()
    await expect(page.getByRole("button", { name: "Reanudar" })).toBeVisible({ timeout: 15_000 })
    await other.close()
  })

  test("two devices starting at once: the second is told and joins the first block", async ({ browser, page }, info) => {
    test.skip(isMobile(info.project.name), "covered once")
    test.slow()
    await signIn(page, account)
    await page.goto("/focus")
    await synced(page)

    const other: BrowserContext = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL })
    const second = await other.newPage()
    await signIn(second, account)
    await second.goto("/focus")
    await synced(second)
    await other.setOffline(true)
    await second.getByRole("textbox", { name: /^Proyecto/ }).fill("Portátil")
    await second.getByRole("button", { name: /^Empezar/ }).click()

    await page.getByRole("textbox", { name: /^Proyecto/ }).fill("Móvil")
    await page.getByRole("button", { name: /^Empezar/ }).click()
    await expect.poll(sessions, { timeout: 15_000 }).toBe(1)

    await other.setOffline(false)
    await expect(second.getByText("Ya había un bloque en curso en otro dispositivo")).toBeVisible({ timeout: 20_000 })
    await expect(second.getByRole("region", { name: "Bloque en curso" }).getByText("Móvil")).toBeVisible()
    expect(await sessions()).toBe(1)
    await other.close()
  })
})
