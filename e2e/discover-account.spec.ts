import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { countRows, newAccount, removeAccount, signIn, type Account } from "./support/account"
import { db } from "../tests/integration/setup"

/** D4 · Daily Discovery in account mode against the LOCAL Supabase stack: real rows, offline, two browsers. */
test.use({ mode: "account" })

const URL = "/knowledge/discover"
let account: Account
test.beforeEach(async ({}, info) => {
  account = await newAccount(`discover-${info.project.name}`)
})
test.afterEach(async () => {
  await removeAccount(account)
})

async function synced(page: Page) {
  await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
}

const rating = () => db(async (c) => (await c.query("select rating from public.topic_feedback where user_id = $1", [account.id])).rows[0]?.rating ?? null)

test.describe("daily discovery · account mode", () => {
  test("a new account labels nothing as demo and has nothing rated", async ({ page, consoleErrors }) => {
    await signIn(page, account)
    await page.goto(URL)
    await synced(page)
    await expect(page.locator("#topic-title")).toBeVisible()
    await expect(page.getByText(/^Demo/)).toHaveCount(0)
    await expect(page.getByTestId("discover-rating")).toHaveText("")
    expect(await countRows("select count(*)::int n from public.topic_feedback where user_id = $1", [account.id])).toBe(0)
    expect(consoleErrors).toEqual([])
  })

  test("a rating given with no connection arrives once, and another browser sees it", async ({ browser, page, context }, info) => {
    test.slow()
    await signIn(page, account)
    await page.goto(URL)
    await synced(page)
    const shown = await page.locator("#topic-title").innerText()

    await context.setOffline(true)
    await page.getByRole("radio", { name: "9 de 10" }).click()
    await expect(page.getByTestId("discover-rating")).toHaveText("9/10")
    expect(await rating()).toBeNull()
    await context.setOffline(false)
    await expect.poll(rating, { timeout: 20_000 }).toBe(9)

    const other = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL })
    const phone = await other.newPage()
    await signIn(phone, account)
    await phone.goto(URL)
    await synced(phone)
    await expect(phone.locator("#topic-title")).toHaveText(shown)
    await expect(phone.getByTestId("discover-rating")).toHaveText("9/10")
    await other.close()
    expect(await countRows("select count(*)::int n from public.topic_feedback where user_id = $1", [account.id])).toBe(1)
  })

  test("an own topic reaches the server; deleting it leaves no text there", async ({ page }) => {
    test.slow()
    await signIn(page, account)
    await page.goto(URL)
    await synced(page)
    await page.getByTestId("discover-add").click()
    const sheet = page.getByRole("dialog")
    await sheet.getByLabel("Título").fill("Tema con cuenta")
    await sheet.getByLabel("Texto").fill("Texto con cuenta")
    await sheet.getByRole("button", { name: "Guardar tema" }).click()
    await expect(sheet).toBeHidden()
    const live = () => countRows("select count(*)::int n from public.discovery_topics where user_id = $1 and deleted_at is null", [account.id])
    await expect.poll(live, { timeout: 15_000 }).toBe(1)

    await page.getByTestId("discover-own").locator("summary").click()
    await page.getByRole("button", { name: "Borrar: Tema con cuenta" }).click()
    await page.getByTestId("discover-remove-confirm").click()
    await expect.poll(live, { timeout: 15_000 }).toBe(0)
    const row = await db(async (c) => (await c.query("select title, body from public.discovery_topics where user_id = $1", [account.id])).rows[0])
    expect(row).toEqual({ title: "", body: "" })
  })
})

test.describe("intelligence · account mode", () => {
  test("a new account sees no demo label and no finding without data", async ({ page, consoleErrors }) => {
    await signIn(page, account)
    await page.goto("/intelligence")
    await synced(page)
    await expect(page.getByTestId("insights-empty")).toContainText("Aún no hay datos suficientes")
    await expect(page.getByTestId("insights-rules-badge")).toBeVisible()
    await expect(page.getByText(/^Demo/)).toHaveCount(0)
    expect(consoleErrors).toEqual([])
  })
})
