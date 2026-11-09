import { errors, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test"
import { expect, isMobile, test } from "./fixtures"
import { countRows, newAccount, removeAccount, signIn, type Account } from "./support/account"
import { db } from "../tests/integration/setup"

/**
 * M3.4d · Life Review in account mode against the LOCAL Supabase stack: real rows, two browsers of
 * one account, offline edits, section conflicts, deferred and double closes. Real clock: the review
 * under test is the week due now (last week, or this one on Sunday) in the profile timezone.
 */
test.use({ mode: "account" })

let account: Account
test.beforeEach(async ({}, info) => {
  account = await newAccount(`reviews-${info.project.name}`)
})
test.afterEach(async () => {
  await removeAccount(account)
})

function dueWeek(): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date())
  const d = new Date(`${today}T12:00:00Z`)
  const wd = (d.getUTCDay() + 6) % 7 // 0 = Monday
  d.setUTCDate(d.getUTCDate() - wd - (wd === 6 ? 0 : 7))
  return d.toISOString().slice(0, 10)
}
const WEEK = dueWeek()
const URL = `/reviews/week/${WEEK}`

const row = () =>
  db(async (c) => (await c.query("select status, content, decisions, snapshot is not null as frozen from public.reviews where user_id = $1 and deleted_at is null", [account.id])).rows[0] ?? null)
const answer = async (key: string) => ((await row())?.content?.[key] as string | undefined) ?? null

async function synced(page: Page) {
  await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
}

async function open(page: Page) {
  await page.goto(URL)
  await synced(page)
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
}

/** Desktop shows every section; mobile opens the step first. */
async function step(page: Page, info: TestInfo, name: RegExp) {
  if (isMobile(info.project.name)) await page.getByRole("navigation", { name: "Pasos de la revisión" }).getByRole("button", { name }).click()
}

async function openCloseDialog(page: Page, info: TestInfo) {
  if (isMobile(info.project.name)) {
    await step(page, info, /Cerrar/)
    await page.getByTestId("review-close").click()
  } else await page.getByTestId("review-close-header").click()
}

async function closeReview(page: Page, info: TestInfo) {
  await openCloseDialog(page, info)
  await page.getByRole("dialog").getByTestId("review-close-confirm").click()
}

/**
 * Two browsers confirming the close at the same time. Two outcomes are legitimate for each one:
 * - «confirmed»: its own confirmation lands;
 * - «converged»: the other browser's close reaches it first, the review becomes closed and the draft
 *   editor (with this dialog) is replaced by the closed document, so the button goes away under the
 *   click (run 41654144424). The click then ends with a timeout — no click is left pending — and it
 *   counts only if the dialog is really gone and the page shows the closed review. Any other error,
 *   or a button still there, fails as before.
 */
async function closeReviewConcurrently(page: Page, info: TestInfo): Promise<"confirmed" | "converged"> {
  await openCloseDialog(page, info)
  const confirm = page.getByRole("dialog").getByTestId("review-close-confirm")
  try {
    await confirm.click({ timeout: 20_000 })
    return "confirmed"
  } catch (error) {
    if (!(error instanceof errors.TimeoutError)) throw error
    await expect(confirm, "the confirmation is still there: nothing closed this review").toHaveCount(0)
    await expect(page.getByTestId("review-closed-stamp"), "the dialog went away but the page did not converge to the closed review").toBeVisible({ timeout: 20_000 })
    return "converged"
  }
}

async function secondDevice(browser: Browser, info: TestInfo): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL })
  const page = await ctx.newPage()
  await signIn(page, account)
  return { ctx, page }
}

test.describe("life review · account mode", () => {
  test("written offline, the app closed and reopened online: the draft is there and reaches the server once; never «sincronizado» while only on the device", async ({ page, context, consoleErrors }, info) => {
    await signIn(page, account)
    await open(page)
    await context.setOffline(true)
    await step(page, info, /Reflexión/)
    await page.getByTestId("review-wins").fill("Escrito sin conexión")
    await expect(page.getByTestId("review-save")).toContainText("se enviará al recuperar la conexión")
    await expect(page.getByTestId("review-save")).not.toContainText("Sincronizado")
    expect(await row()).toBeNull()
    await page.close()
    await context.setOffline(false)

    const p = await context.newPage()
    await p.goto(URL)
    await expect.poll(() => answer("wins"), { timeout: 15_000 }).toBe("Escrito sin conexión")
    await step(p, info, /Reflexión/)
    await expect(p.getByTestId("review-wins")).toHaveValue("Escrito sin conexión")
    await expect(p.getByTestId("review-save")).toHaveText("Sincronizado")
    expect(await countRows("select count(*)::int n from public.sync_operations where user_id = $1 and operation_type = 'review.save'", [account.id])).toBe(1)
    // Requests failing while offline are expected; anything else is not.
    expect(consoleErrors.filter((e) => !e.includes("ERR_INTERNET_DISCONNECTED"))).toEqual([])
  })

  test("two browsers edit different sections: both survive, no artificial conflict", async ({ browser, page }, info) => {
    test.skip(isMobile(info.project.name), "covered once")
    test.slow()
    await signIn(page, account)
    await open(page)
    const b = await secondDevice(browser, info)
    await open(b.page)
    await page.getByTestId("review-wins").fill("Desde el portátil")
    await b.page.getByTestId("review-lessons").fill("Desde el móvil")
    await expect.poll(async () => (await row())?.content, { timeout: 15_000 }).toEqual({ wins: "Desde el portátil", lessons: "Desde el móvil" })
    // Each browser shows the other's section without reloading.
    await expect(page.getByTestId("review-lessons")).toHaveValue("Desde el móvil", { timeout: 15_000 })
    await expect(b.page.getByTestId("review-wins")).toHaveValue("Desde el portátil", { timeout: 15_000 })
    await expect(page.getByTestId("review-conflicts")).toHaveCount(0)
    await expect(b.page.getByTestId("review-conflicts")).toHaveCount(0)
    await b.ctx.close()
  })

  test("the same section on two browsers: both versions shown, cannot close, kept across a reopening, «Aplicar la mía» wins once and for all", async ({ browser, page }, info) => {
    test.skip(isMobile(info.project.name), "covered once")
    test.slow()
    await signIn(page, account)
    await open(page)
    const b = await secondDevice(browser, info)
    await open(b.page)
    await b.ctx.setOffline(true)
    await b.page.getByTestId("review-wins").fill("Versión del móvil")
    await b.page.getByTestId("review-wins").blur()
    await page.getByTestId("review-wins").fill("Versión del portátil")
    await expect.poll(() => answer("wins"), { timeout: 15_000 }).toBe("Versión del portátil")
    await b.ctx.setOffline(false)

    const panel = b.page.getByTestId("review-conflicts")
    await expect(panel).toBeVisible({ timeout: 20_000 })
    await expect(panel).toContainText("Versión del móvil")
    await expect(panel).toContainText("Versión del portátil")
    await expect(b.page.getByTestId("review-wins")).toBeDisabled()
    await expect(b.page.getByTestId("review-close-header")).toBeDisabled()
    await expect(b.page.getByTestId("review-save")).toContainText("espera tu decisión")
    // The server kept the other version; nothing was overwritten silently.
    expect(await answer("wins")).toBe("Versión del portátil")

    // Closing the app without deciding keeps the decision pending.
    await b.page.close()
    const reopened = await b.ctx.newPage()
    await reopened.goto(URL)
    const again = reopened.getByTestId("review-conflicts")
    await expect(again).toBeVisible({ timeout: 15_000 })
    await again.getByTestId("review-apply-mine").click()
    await expect.poll(() => answer("wins"), { timeout: 15_000 }).toBe("Versión del móvil")
    await expect(again).toHaveCount(0)
    await expect(page.getByTestId("review-wins")).toHaveValue("Versión del móvil", { timeout: 15_000 })
    await reopened.reload()
    await synced(reopened)
    await expect(reopened.getByTestId("review-conflicts")).toHaveCount(0)
    await b.ctx.close()
  })

  test("closing: confirmed explicitly, frozen on the server, read-only afterwards; a simultaneous close from a second browser changes nothing", async ({ browser, page }, info) => {
    test.slow()
    await signIn(page, account)
    await open(page)
    await step(page, info, /Reflexión/)
    await page.getByTestId("review-wins").fill("Cerrada desde aquí")
    await expect.poll(() => answer("wins"), { timeout: 15_000 }).toBe("Cerrada desde aquí")
    const b = await secondDevice(browser, info)
    await open(b.page)

    // Both browsers confirm the close at the same time: the first close wins, the other converges to it.
    const outcomes = await Promise.all([closeReviewConcurrently(page, info), closeReviewConcurrently(b.page, info)])
    test.info().annotations.push({ type: "close-outcome", description: `A=${outcomes[0]} B=${outcomes[1]}` })
    // Someone closed it: at least one of the two confirmations landed.
    expect(outcomes).toContain("confirmed")
    await expect(page.getByTestId("review-closed-stamp")).toBeVisible({ timeout: 20_000 })
    await expect(b.page.getByTestId("review-closed-stamp")).toBeVisible({ timeout: 20_000 })
    await expect.poll(async () => (await row())?.status, { timeout: 15_000 }).toBe("closed")
    const frozen = await db(async (c) => (await c.query("select snapshot, closed_at from public.reviews where user_id = $1", [account.id])).rows[0])
    await expect(page.locator("textarea")).toHaveCount(0)
    await expect(b.page.locator("textarea")).toHaveCount(0)
    await page.reload()
    await expect(page.getByTestId("review-closed-stamp")).toBeVisible({ timeout: 15_000 })
    expect(await db(async (c) => (await c.query("select snapshot, closed_at from public.reviews where user_id = $1", [account.id])).rows[0])).toEqual(frozen)
    expect(await countRows("select count(*)::int n from public.reviews where user_id = $1", [account.id])).toBe(1)
    await b.ctx.close()
  })

  test("offline, the close waits for the connection, can be seen as pending, and runs after syncing", async ({ page, context }, info) => {
    test.slow()
    await signIn(page, account)
    await open(page)
    await step(page, info, /Reflexión/)
    await page.getByTestId("review-wins").fill("Antes de cerrar")
    await expect.poll(() => answer("wins"), { timeout: 15_000 }).toBe("Antes de cerrar")
    await context.setOffline(true)
    await page.waitForTimeout(500)
    await closeReview(page, info)
    await expect(page.getByTestId("review-closing")).toContainText("Se cerrará al recuperar la conexión", { timeout: 15_000 })
    expect((await row())?.status).toBe("draft")
    await context.setOffline(false)
    await expect.poll(async () => (await row())?.status, { timeout: 30_000 }).toBe("closed")
    await expect(page.getByTestId("review-closed-stamp")).toBeVisible({ timeout: 20_000 })
  })

  test("a close asked offline does not run if the review changed meanwhile on another browser: it asks again", async ({ browser, page, context }, info) => {
    test.skip(isMobile(info.project.name), "covered once")
    test.slow()
    await signIn(page, account)
    await open(page)
    await page.getByTestId("review-wins").fill("Primera versión")
    await expect.poll(() => answer("wins"), { timeout: 15_000 }).toBe("Primera versión")
    await context.setOffline(true)
    await page.waitForTimeout(500)
    await closeReview(page, info)
    await expect(page.getByTestId("review-closing")).toBeVisible()

    const b = await secondDevice(browser, info)
    await open(b.page)
    await b.page.getByTestId("review-lessons").fill("Añadido en otro navegador")
    await expect.poll(() => answer("lessons"), { timeout: 15_000 }).toBe("Añadido en otro navegador")

    await context.setOffline(false)
    await expect(page.getByTestId("review-close-changed")).toBeVisible({ timeout: 30_000 })
    expect((await row())?.status).toBe("draft")
    await expect(page.getByTestId("review-lessons")).toHaveValue("Añadido en otro navegador")
    await page.getByTestId("review-close-changed").getByRole("button", { name: "Cerrar ahora" }).click()
    await expect.poll(async () => (await row())?.status, { timeout: 30_000 }).toBe("closed")
    await b.ctx.close()
  })

  test("two tabs of one browser, offline: closing the tab that wrote first loses nothing (risk B)", async ({ page, context }, info) => {
    test.skip(isMobile(info.project.name), "covered once")
    test.slow()
    await signIn(page, account)
    await open(page)
    const second = await context.newPage()
    await open(second)
    await context.setOffline(true)
    await page.getByTestId("review-wins").fill("Escrito en la pestaña 1")
    await page.getByTestId("review-wins").blur()
    await page.waitForTimeout(500)
    await second.getByTestId("review-lessons").fill("Escrito en la pestaña 2")
    await second.getByTestId("review-lessons").blur()
    await second.waitForTimeout(500)
    // Tab 1 is closed while offline; before M3.4d tab 2 had written its own queue over tab 1's.
    await page.close()
    await second.close()
    await context.setOffline(false)
    const p = await context.newPage()
    await p.goto(URL)
    await expect.poll(async () => (await row())?.content, { timeout: 20_000 }).toEqual({ wins: "Escrito en la pestaña 1", lessons: "Escrito en la pestaña 2" })
    await synced(p)
    await expect(p.getByTestId("review-conflicts")).toHaveCount(0)
  })

  test("a daily review: saved on the server, kept after reopening, closed and frozen, and seen from another browser", async ({ browser, page, consoleErrors }, info) => {
    test.slow()
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date())
    const dayUrl = `/reviews/day/${today}`
    await signIn(page, account)
    await page.goto(dayUrl)
    await synced(page)
    await step(page, info, /Reflexión/)
    await page.getByTestId("review-observations").fill("Dormí poco")
    await page.getByTestId("review-adjustments").fill("Acostarme antes")
    await expect.poll(() => answer("adjustments"), { timeout: 15_000 }).toBe("Acostarme antes")
    await expect.poll(() => answer("observations"), { timeout: 15_000 }).toBe("Dormí poco")
    await expect(page.getByTestId("review-save")).toContainText("Sincronizado")

    await page.reload()
    await synced(page)
    await step(page, info, /Reflexión/)
    await expect(page.getByTestId("review-observations")).toHaveValue("Dormí poco")

    await closeReview(page, info)
    await expect(page.getByTestId("review-closed-stamp")).toBeVisible({ timeout: 20_000 })
    await expect.poll(async () => (await row())?.status, { timeout: 15_000 }).toBe("closed")
    expect((await row())?.frozen).toBe(true)
    expect(await countRows("select count(*)::int n from public.reviews where user_id = $1 and kind = 'day' and period_start = $2 and period_end = $2", [account.id, today])).toBe(1)

    const b = await secondDevice(browser, info)
    await b.page.goto(dayUrl)
    await synced(b.page)
    await expect(b.page.getByTestId("review-closed-stamp")).toBeVisible({ timeout: 20_000 })
    await expect(b.page.getByText("Acostarme antes")).toBeVisible()
    await expect(b.page.locator("textarea")).toHaveCount(0)
    await b.ctx.close()
    expect(consoleErrors).toEqual([])
  })

  test("a new account: honest empty home, no demo reviews", async ({ page }) => {
    await signIn(page, account)
    await page.goto("/reviews")
    await expect(page.getByText("Tu primera revisión estará lista pronto")).toBeVisible()
    await expect(page.getByText(/Demo/)).toHaveCount(0)
    await expect(page.getByTestId("review-row")).toHaveCount(0)
  })
})
