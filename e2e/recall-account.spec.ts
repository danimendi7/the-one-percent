import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { countRows, newAccount, removeAccount, signIn, type Account } from "./support/account"
import { db } from "../tests/integration/setup"

/** D3 · Active Recall in account mode against the LOCAL Supabase stack: real rows, offline answers, two browsers. */
test.use({ mode: "account" })

const URL = "/knowledge/brain/repaso"
let account: Account
test.beforeEach(async ({}, info) => {
  account = await newAccount(`recall-${info.project.name}`)
})
test.afterEach(async () => {
  await removeAccount(account)
})

async function synced(page: Page) {
  await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
}

async function createCard(page: Page, question: string, answer: string) {
  await page.getByTestId("recall-new").click()
  const sheet = page.getByRole("dialog")
  await sheet.getByLabel("Pregunta").fill(question)
  await sheet.getByLabel("Respuesta").fill(answer)
  await sheet.getByRole("button", { name: "Crear tarjeta" }).click()
  await expect(sheet).toBeHidden()
}

const cards = () => countRows("select count(*)::int n from public.recall_cards where user_id = $1 and deleted_at is null", [account.id])
const attempts = () => countRows("select count(*)::int n from public.recall_attempts where user_id = $1", [account.id])

test.describe("active recall · account mode", () => {
  test("a new account has no example cards", async ({ page, consoleErrors }) => {
    await signIn(page, account)
    await page.goto(URL)
    await synced(page)
    await expect(page.getByTestId("recall-done")).toContainText("Todavía no tienes tarjetas")
    expect(consoleErrors).toEqual([])
  })

  test("a card reaches the server; answered with no connection, the answer waits and arrives once", async ({ page, context }) => {
    test.slow()
    await signIn(page, account)
    await page.goto(URL)
    await synced(page)
    await createCard(page, "¿Cuál es la capital de Islandia?", "Reikiavik")
    await expect.poll(cards, { timeout: 15_000 }).toBe(1)
    await synced(page)

    await context.setOffline(true)
    await page.getByTestId("recall-reveal").click()
    await expect(page.getByTestId("recall-answer")).toHaveText("Reikiavik")
    await page.getByTestId("recall-grade-good").click()
    await expect(page.getByTestId("recall-done")).toContainText("Hoy no te queda nada por repasar")
    expect(await attempts()).toBe(0)

    await context.setOffline(false)
    await expect.poll(attempts, { timeout: 20_000 }).toBe(1)
    await synced(page)
    const row = await db(async (c) => (await c.query("select state, reps, interval_days from public.recall_cards where user_id = $1", [account.id])).rows[0])
    expect(row).toEqual({ state: "review", reps: 1, interval_days: 1 })
    await page.reload()
    await synced(page)
    await expect(page.getByTestId("recall-done")).toBeVisible()
    expect(await attempts()).toBe(1)
  })

  test("a card appears in another browser, and deleting it there removes it here with no text left on the server", async ({ browser, page }, info) => {
    test.slow()
    await signIn(page, account)
    await page.goto(URL)
    await synced(page)
    await createCard(page, "¿Quién escribió Rayuela?", "Cortázar")
    await expect.poll(cards, { timeout: 15_000 }).toBe(1)

    const other = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL })
    const phone = await other.newPage()
    await signIn(phone, account)
    await phone.goto(URL)
    await synced(phone)
    await expect(phone.getByTestId("recall-question")).toHaveText("¿Quién escribió Rayuela?")
    await phone.getByTestId("recall-delete").click()
    await phone.getByTestId("recall-delete-confirm").click()
    await expect.poll(cards, { timeout: 15_000 }).toBe(0)
    await other.close()

    await page.reload()
    await synced(page)
    await expect(page.getByTestId("recall-done")).toContainText("Todavía no tienes tarjetas")
    const row = await db(async (c) => (await c.query("select question, answer from public.recall_cards where user_id = $1", [account.id])).rows[0])
    expect(row).toEqual({ question: "", answer: "" })
  })
})
