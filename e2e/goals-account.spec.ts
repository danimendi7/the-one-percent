import type { BrowserContext, Page } from "@playwright/test"
import { expect, isMobile, test } from "./fixtures"
import { countRows, newAccount, removeAccount, signIn, type Account } from "./support/account"

/** M3.1c · goals in account mode against the LOCAL Supabase stack: real rows, sync, no fictitious data. */
test.use({ mode: "account" })

let account: Account
test.beforeEach(async ({}, info) => {
  account = await newAccount(`goals-${info.project.name}`)
})
test.afterEach(async () => {
  await removeAccount(account)
})

const goals = (userId: string) => countRows("select count(*)::int n from public.goals where user_id = $1", [userId])
const measurements = (userId: string) =>
  countRows("select count(*)::int n from public.goal_measurements where user_id = $1 and deleted_at is null", [userId])

async function createGoal(page: Page, title: string) {
  await page.goto("/goals")
  await page.getByRole("button", { name: /^(Crear|Nuevo) objetivo$/ }).first().click()
  const sheet = page.getByRole("dialog")
  await sheet.getByLabel("Objetivo", { exact: true }).fill(title)
  await sheet.getByRole("button", { name: "Siguiente" }).click()
  await sheet.getByRole("radio", { name: "Bajar" }).click()
  await sheet.getByLabel("Punto de partida").fill("82")
  await sheet.getByLabel("Meta").fill("78")
  await sheet.getByLabel("Unidad").fill("kg")
  await sheet.getByRole("button", { name: "Siguiente" }).click()
  await sheet.getByRole("button", { name: "Crear objetivo" }).click()
  await expect(sheet).toBeHidden()
}

async function register(page: Page, title: string, value: string) {
  await page.getByRole("article", { name: title }).getByRole("button", { name: /Registrar/ }).click()
  const m = page.getByRole("dialog", { name: "Registrar medición" })
  await m.getByLabel("Valor (kg)").fill(value)
  await m.getByRole("button", { name: "Guardar" }).click()
  await expect(m).toBeHidden()
}

test.describe("goals · account mode", () => {
  test("a new account shows honest empty states and no demo goals", async ({ page, consoleErrors }) => {
    await signIn(page, account)
    await expect(page.getByRole("region", { name: "Objetivos activos" }).getByText("Aún no hay objetivos")).toBeVisible()
    await page.goto("/goals")
    await expect(page.getByText("Define tu primer objetivo")).toBeVisible()
    await expect(page.getByText("Demo", { exact: true })).toHaveCount(0)
    await expect(page.getByText(/Correr 10 km/)).toHaveCount(0)
    expect(consoleErrors).toEqual([])
  })

  test("create and measure: stored once on the server, survives a reload", async ({ page }) => {
    await signIn(page, account)
    await createGoal(page, "Bajar a 78 kg")
    await expect.poll(() => goals(account.id)).toBe(1)
    await register(page, "Bajar a 78 kg", "81,2")
    await expect.poll(() => measurements(account.id)).toBe(1)
    // Same day again: replaces, never duplicates.
    await register(page, "Bajar a 78 kg", "81")
    await expect.poll(() => countRows("select count(*)::int n from public.goal_measurements where user_id = $1 and value = 81", [account.id])).toBe(1)
    expect(await measurements(account.id)).toBe(1)

    await page.reload()
    const card = page.getByRole("article", { name: "Bajar a 78 kg" })
    await expect(card.getByText("82 kg → 81 kg · meta 78 kg")).toBeVisible()
    await expect(card.getByText("25%")).toBeVisible()
  })

  test("an offline measurement is queued, shown at once and synced exactly once", async ({ page, context }) => {
    await signIn(page, account)
    await createGoal(page, "Bajar a 78 kg")
    await expect.poll(() => goals(account.id)).toBe(1)
    await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ })).toBeVisible({ timeout: 15_000 })

    await context.setOffline(true)
    await register(page, "Bajar a 78 kg", "80")
    await expect(page.getByRole("article", { name: "Bajar a 78 kg" }).getByText("50%")).toBeVisible() // optimistic
    expect(await measurements(account.id)).toBe(0)

    await context.setOffline(false)
    await expect.poll(() => measurements(account.id), { timeout: 15_000 }).toBe(1)
    const ops = await countRows("select count(*)::int n from public.sync_operations where user_id = $1 and operation_type = 'goal.measure'", [account.id])
    expect(ops).toBe(1)
  })

  test("a goal created on one device appears on another, and a measurement follows", async ({ browser, page }, info) => {
    test.skip(isMobile(info.project.name), "covered once")
    test.slow()
    await signIn(page, account)
    await createGoal(page, "Bajar a 78 kg")
    await expect.poll(() => goals(account.id)).toBe(1)

    const other: BrowserContext = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL })
    const second = await other.newPage()
    await signIn(second, account)
    await second.goto("/goals")
    await expect(second.getByRole("article", { name: "Bajar a 78 kg" })).toBeVisible({ timeout: 15_000 })

    await register(page, "Bajar a 78 kg", "80")
    await expect(second.getByRole("article", { name: "Bajar a 78 kg" }).getByText("50%")).toBeVisible({ timeout: 15_000 })
    await other.close()
  })
})
