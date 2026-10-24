import type { BrowserContext, Page } from "@playwright/test"
import { expect, isMobile, test } from "./fixtures"
import { countRows, newAccount, removeAccount, signIn, type Account } from "./support/account"

test.use({ mode: "account" })

const MAILPIT = "http://127.0.0.1:55324"

let account: Account
test.beforeEach(async ({}, info) => {
  account = await newAccount(info.project.name)
})
test.afterEach(async () => {
  await removeAccount(account)
})

async function createHabit(page: Page, name: string) {
  await page.goto("/habits")
  await page.getByRole("button", { name: "Crear hábito" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Nombre").fill(name)
  await dialog.getByRole("button", { name: "Crear hábito" }).click()
  await expect(dialog).toBeHidden()
}

const todayButton = (page: Page, name: string) =>
  page.getByRole("region", { name: "Hoy" }).getByRole("button", { name: new RegExp(`^${name}, `) })

const liveEntries = (userId: string) =>
  countRows("select count(*)::int n from public.habit_entries where user_id = $1 and deleted_at is null", [userId])

test.describe("account mode", () => {
  test("anonymous visitors are sent to login; the magic-link email signs in", async ({ page }, info) => {
    test.skip(isMobile(info.project.name), "covered once")
    await page.goto("/habits")
    await expect(page).toHaveURL(/\/login$/)
    await page.getByLabel("Email").fill(account.email)
    await page.getByRole("button", { name: "Enviar enlace de acceso" }).click()
    await expect(page.getByText("Revisa tu correo")).toBeVisible()

    let link: string | undefined
    await expect
      .poll(async () => {
        const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${account.email}`)}`)).json()
        if (!list.messages?.length) return false
        const msg = await (await fetch(`${MAILPIT}/api/v1/message/${list.messages[0].ID}`)).json()
        link = msg.HTML.match(/href="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&")
        return !!link
      }, { timeout: 15_000 })
      .toBe(true)
    await page.goto(link!)
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole("heading", { level: 1, name: "Resumen" })).toBeVisible()
  })

  test("the 6-digit code from the email also signs in (other device / installed PWA)", async ({ page }, info) => {
    test.skip(isMobile(info.project.name), "covered once")
    await page.goto("/login")
    await page.getByLabel("Email").fill(account.email)
    await page.getByRole("button", { name: "Enviar enlace de acceso" }).click()
    let code: string | undefined
    await expect
      .poll(async () => {
        const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${account.email}`)}`)).json()
        if (!list.messages?.length) return false
        const msg = await (await fetch(`${MAILPIT}/api/v1/message/${list.messages[0].ID}`)).json()
        code = /monospace">(\d{6})</.exec(msg.HTML)?.[1]
        return !!code
      }, { timeout: 15_000 })
      .toBe(true)
    await page.getByLabel("¿Tienes el código del correo?").fill("000000")
    await page.getByRole("button", { name: "Entrar" }).click()
    await expect(page.getByRole("alert").filter({ hasText: "Código incorrecto" })).toBeVisible()
    await page.getByLabel("¿Tienes el código del correo?").fill(code!)
    await page.getByRole("button", { name: "Entrar" }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText("Empieza por tu primer hábito")).toBeVisible()
  })

  test("a new account shows informative empty states and no demo labels", async ({ page, consoleErrors }) => {
    await signIn(page, account)
    await expect(page.getByText("Empieza por tu primer hábito")).toBeVisible()
    await expect(page.getByText("Aún no hay datos de los últimos 30 días")).toBeVisible()
    await expect(page.getByText("Demo", { exact: true })).toHaveCount(0)
    await page.goto("/analytics")
    await expect(page.getByText("Todavía no hay nada que analizar")).toBeVisible()
    await page.goto("/habits")
    await expect(page.getByText("Aún no tienes hábitos activos")).toBeVisible()
    expect(consoleErrors).toEqual([])
  })

  test("habits and marks persist on the server and survive a reload", async ({ page }) => {
    await signIn(page, account)
    await createHabit(page, "Leer 20 minutos")
    await todayButton(page, "Leer 20 minutos").click()
    await expect(todayButton(page, "Leer 20 minutos")).toHaveAttribute("aria-pressed", "true")
    await expect.poll(() => liveEntries(account.id)).toBe(1)
    await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ })).toBeVisible()

    await page.reload()
    await expect(todayButton(page, "Leer 20 minutos")).toHaveAttribute("aria-pressed", "true")
    const versions = await countRows(
      "select count(*)::int n from public.habit_schedule_versions v join public.habits h on h.id = v.habit_id where h.user_id = $1",
      [account.id]
    )
    expect(versions).toBe(1)
  })

  test("a mark on one device appears on another without duplicates (acceptance #2)", async ({ browser, page }, info) => {
    await signIn(page, account)
    await createHabit(page, "Meditar")
    const other: BrowserContext = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL })
    const desktop = await other.newPage()
    await signIn(desktop, account)
    await desktop.goto("/habits")
    await expect(todayButton(desktop, "Meditar")).toHaveAttribute("aria-pressed", "false")

    await todayButton(page, "Meditar").click()
    // Realtime invalidation: no reload on the second device
    await expect(todayButton(desktop, "Meditar")).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 })
    expect(await liveEntries(account.id)).toBe(1)

    await todayButton(desktop, "Meditar").click()
    await expect(todayButton(page, "Meditar")).toHaveAttribute("aria-pressed", "false", { timeout: 15_000 })
    expect(await liveEntries(account.id)).toBe(0)
    await other.close()
  })

  test("an offline mark is queued, shown as pending and synced exactly once on reconnect (acceptance #2)", async ({ page, context }) => {
    await signIn(page, account)
    await createHabit(page, "Caminar")
    await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ })).toBeVisible()

    await context.setOffline(true)
    await todayButton(page, "Caminar").click()
    await expect(todayButton(page, "Caminar")).toHaveAttribute("aria-pressed", "true") // optimistic
    await expect(page.getByRole("button", { name: /Estado de datos: Sin conexión/ })).toBeVisible()
    expect(await liveEntries(account.id)).toBe(0)

    await context.setOffline(false)
    await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ })).toBeVisible({ timeout: 15_000 })
    expect(await liveEntries(account.id)).toBe(1)
    const ops = await countRows(
      "select count(*)::int n from public.sync_operations where user_id = $1 and operation_type = 'entry.set'",
      [account.id]
    )
    expect(ops).toBe(1)
  })

  test("demo data is never imported automatically; the selective import skips seeded records", async ({ page, context, baseURL }) => {
    // 1) Use the demo in this browser and make one real tap on a template habit
    await context.addCookies([{ name: "top_mode", value: "demo", url: baseURL! }])
    await page.goto("/habits")
    await todayButton(page, "Lectura").click()
    await page.getByRole("button", { name: /^Registrar 30 min/ }).click()
    await context.clearCookies({ name: "top_mode" })

    // 2) Sign in: the account starts empty
    await signIn(page, account)
    await expect(page.getByText("Empieza por tu primer hábito")).toBeVisible()
    expect(await countRows("select count(*)::int n from public.habits where user_id = $1", [account.id])).toBe(0)

    // 3) Explicit import of two template habits
    await page.goto("/settings")
    await page.getByRole("button", { name: "Importar a mi cuenta…" }).click()
    const sheet = page.getByRole("dialog", { name: "Importar desde la demo" })
    await sheet.getByRole("checkbox", { name: /^Lectura/ }).click()
    await sheet.getByRole("checkbox", { name: /^Meditación/ }).click()
    await sheet.getByRole("button", { name: "Importar a mi cuenta" }).click()

    await expect.poll(() => countRows("select count(*)::int n from public.habits where user_id = $1", [account.id])).toBe(2)
    // Only the single real tap is imported; the seeded history (and today's seeded meditation) is not.
    await expect.poll(() => liveEntries(account.id)).toBe(1)
    const backdated = await countRows(
      "select count(*)::int n from public.habits where user_id = $1 and start_date < public.user_today($1)",
      [account.id]
    )
    expect(backdated).toBe(0)
  })

  test("signing out returns to login and protects the app again", async ({ page }) => {
    await signIn(page, account)
    await page.goto("/settings")
    await page.getByRole("button", { name: "Cerrar sesión" }).click()
    await expect(page).toHaveURL(/\/login$/)
    await page.goto("/analytics")
    await expect(page).toHaveURL(/\/login$/)
  })
})
