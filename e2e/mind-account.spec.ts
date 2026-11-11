import type { BrowserContext, Page } from "@playwright/test"
import { expect, isMobile, test } from "./fixtures"
import { countRows, newAccount, removeAccount, signIn, type Account } from "./support/account"
import { storedOpTypes } from "./support/offline"

/**
 * M3.3c · Mind & Energy in account mode against the LOCAL Supabase stack: real rows, two devices,
 * offline, reflection conflicts and no fictitious data. The real clock is used, so these tests open
 * the morning check-in explicitly (its day is always today, whatever the hour).
 */
test.use({ mode: "account" })

let account: Account
test.beforeEach(async ({}, info) => {
  account = await newAccount(`mind-${info.project.name}`)
})
test.afterEach(async () => {
  await removeAccount(account)
})

const rows = () => countRows("select count(*)::int n from public.daily_checkins where user_id = $1 and deleted_at is null", [account.id])
const value = (col: "energy" | "mood" | "stress", phase = "am") =>
  countRows(`select coalesce((select ${col} from public.daily_checkins where user_id = $1 and phase = $2 and deleted_at is null), -1)::int n`, [account.id, phase])

async function synced(page: Page) {
  await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
}

const sheet = (page: Page) => page.getByRole("dialog")
const scale = (page: Page, name: string) => sheet(page).getByRole("radiogroup", { name })

async function secondDevice(browser: import("@playwright/test").Browser, info: import("@playwright/test").TestInfo): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL })
  const page = await ctx.newPage()
  await signIn(page, account)
  return { ctx, page }
}

test.describe("mind & energy · account mode", () => {
  test("a new account: honest empty states, no demo check-ins anywhere", async ({ page, consoleErrors }) => {
    await signIn(page, account)
    await page.goto("/mind")
    await expect(page.getByTestId("mind-state-none")).toBeVisible()
    await expect(page.getByText(/Demo/)).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "Historial" })).toHaveCount(0)
    await page.goto("/analytics#mente")
    await expect(page.getByRole("region", { name: /^Mente y energía/ })).toHaveCount(0)
    expect(consoleErrors).toEqual([])
  })

  test("saved offline field by field, app closed, reopened online: one row, every value, sent once", async ({ page, context }) => {
    await signIn(page, account)
    await page.goto("/mind")
    await synced(page)
    await context.setOffline(true)
    await page.getByTestId("mind-card-am").click()
    await sheet(page).getByRole("button", { name: "7 horas" }).click()
    await scale(page, "Energía").getByRole("radio", { name: "4, Alta" }).click()
    await scale(page, "Ánimo").getByRole("radio", { name: "3, Normal" }).click()
    await expect(sheet(page).getByRole("status")).toContainText("se enviará al recuperar la conexión")
    expect(await rows()).toBe(0)
    // Closed once the write is on the device, as a person closing the app seconds later (PR #27).
    await expect.poll(() => storedOpTypes(page), { timeout: 15_000 }).toContain("checkin.set")
    await page.close()
    await context.setOffline(false)

    const p = await context.newPage()
    await p.goto("/mind")
    await expect.poll(rows, { timeout: 15_000 }).toBe(1)
    await expect.poll(() => value("energy")).toBe(4)
    expect(await value("mood")).toBe(3)
    await synced(p)
    await expect(p.getByTestId("mind-card-am")).toContainText("7 h · Energía 4 · Ánimo 3")
  })

  test("a check-in on one device appears on the other without reloading; different indicators converge", async ({ browser, page }, info) => {
    test.skip(isMobile(info.project.name), "covered once")
    test.slow()
    await signIn(page, account)
    await page.goto("/mind")
    await synced(page)
    const b = await secondDevice(browser, info)
    await b.page.goto("/mind")
    await synced(b.page)

    await page.getByTestId("mind-card-am").click()
    await scale(page, "Energía").getByRole("radio", { name: "2, Baja" }).click()
    await expect(b.page.getByTestId("mind-card-am")).toContainText("Energía 2", { timeout: 15_000 })

    // The other device adds a different indicator to the same check-in: nothing is lost.
    await b.page.getByTestId("mind-card-am").click()
    await scale(b.page, "Ánimo").getByRole("radio", { name: "5, Muy bueno" }).click()
    await expect(page.getByRole("dialog").getByRole("radiogroup", { name: "Ánimo" }).getByRole("radio", { name: "5, Muy bueno" })).toHaveAttribute("aria-checked", "true", { timeout: 15_000 })
    await expect.poll(() => value("mood")).toBe(5)
    expect(await value("energy")).toBe(2)
    expect(await rows()).toBe(1)
    await b.ctx.close()
  })

  test("a reflection written meanwhile on another device is never lost, not even closing the app: decision kept until «Aplicar la mía» (D47)", async ({ browser, page }, info) => {
    test.skip(isMobile(info.project.name), "covered once")
    test.slow()
    await signIn(page, account)
    await page.goto("/mind")
    await synced(page)
    // The morning has no reflection by default: show it in both phases first (setting syncs).
    await page.getByRole("button", { name: "Indicadores" }).click()
    await page.getByRole("dialog").getByRole("group", { name: "Mañana" }).getByRole("switch", { name: "Reflexión" }).click()
    await expect.poll(() => countRows("select (settings_json -> 'checkin' -> 'am' ? 'note')::int n from public.profiles where id = $1", [account.id])).toBe(1)
    await page.keyboard.press("Escape")

    const b = await secondDevice(browser, info)
    await b.page.goto("/mind")
    await synced(b.page)
    await b.ctx.setOffline(true)
    await b.page.getByTestId("mind-card-am").click()
    await sheet(b.page).getByRole("button", { name: /Añadir reflexión/ }).click()
    await sheet(b.page).getByLabel(/Reflexión/).fill("Escrito en el portátil")
    await sheet(b.page).getByRole("button", { name: "Listo" }).click()

    await page.getByTestId("mind-card-am").click()
    await sheet(page).getByRole("button", { name: /Añadir reflexión/ }).click()
    await sheet(page).getByLabel(/Reflexión/).fill("Escrito en el móvil")
    await sheet(page).getByRole("button", { name: "Listo" }).click()
    await expect.poll(() => countRows("select count(*)::int n from public.daily_checkins where user_id = $1 and note = 'Escrito en el móvil'", [account.id]), { timeout: 15_000 }).toBe(1)

    await b.ctx.setOffline(false)
    const notice = b.page.getByText(/La reflexión del «Check-in de mañana del .*» cambió en otro dispositivo/)
    await expect(notice).toBeVisible({ timeout: 20_000 })
    await expect(b.page.getByText(/La tuya se conserva en este dispositivo hasta que decidas: «Escrito en el portátil»/)).toBeVisible()
    // Not silently dropped: the notice stays until the user decides.
    await b.page.waitForTimeout(13_000)
    await expect(notice).toBeVisible()

    // The app is closed without deciding, and reopened: the decision is still there, nothing was overwritten.
    await b.page.close()
    const reopened = await b.ctx.newPage()
    await reopened.goto("/mind")
    const panel = reopened.getByTestId("mind-pending-reflections")
    await expect(panel).toBeVisible({ timeout: 15_000 })
    await expect(panel).toContainText("Tu versión, guardada en este dispositivo: «Escrito en el portátil»")
    await expect(panel).toContainText("La que hay ahora: «Escrito en el móvil»")
    await expect(reopened.getByText(/La reflexión del «Check-in de mañana del .*» cambió en otro dispositivo/)).toBeVisible()
    expect(await countRows("select count(*)::int n from public.daily_checkins where user_id = $1 and note = 'Escrito en el móvil'", [account.id])).toBe(1)

    await panel.getByRole("button", { name: "Aplicar la mía" }).click()
    await expect.poll(() => countRows("select count(*)::int n from public.daily_checkins where user_id = $1 and note = 'Escrito en el portátil'", [account.id]), { timeout: 15_000 }).toBe(1)
    await expect(panel).toHaveCount(0)
    // The toast goes with the decision.
    await expect(reopened.getByText(/cambió en otro dispositivo/)).toHaveCount(0)
    // Decided once: reopening again does not ask again.
    await reopened.reload()
    await synced(reopened)
    await expect(reopened.getByTestId("mind-pending-reflections")).toHaveCount(0)
    await b.ctx.close()
  })

  test("Analytics shows the account's own check-ins only, with their sample size", async ({ page }) => {
    await signIn(page, account)
    await page.goto("/mind?checkin=am")
    await scale(page, "Energía").getByRole("radio", { name: "3, Normal" }).click()
    await sheet(page).getByRole("button", { name: "Listo" }).click()
    await expect.poll(rows, { timeout: 15_000 }).toBe(1)
    await page.goto("/analytics#mente")
    const section = page.getByRole("region", { name: /^Mente y energía/ })
    await expect(section.getByText("Pocos datos", { exact: true })).toBeVisible()
    await expect(section.getByRole("button", { name: /^Energía/ })).toContainText("n = 1")
    await expect(section.getByText(/Descriptivo, no causal/)).toHaveCount(0)
  })
})
