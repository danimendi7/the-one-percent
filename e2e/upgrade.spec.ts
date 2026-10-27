import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { countRows, newAccount, removeAccount, signIn, type Account } from "./support/account"

/**
 * Updating the app over data saved by an older version (incident 27/10/2026: M3.0 → M3.1 crashed
 * with «This page couldn't load» on devices that had a persisted copy). Cookies, localStorage,
 * IndexedDB and the offline queue are kept exactly as the old version left them; nothing is cleared.
 */

/** Rewrite the persisted copy into the exact shape M3.0 saved (no goals, measurements or features). */
async function downgradeToM30Copy(page: Page) {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open("the-one-percent")
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    const store = () => db.transaction("sync", "readwrite").objectStore("sync")
    const keys: IDBValidKey[] = await new Promise((res) => {
      const r = store().getAllKeys()
      r.onsuccess = () => res(r.result)
    })
    for (const key of keys) {
      const value = await new Promise<{ cache: { state: Record<string, unknown>; features?: unknown }; queue: unknown[] }>((res) => {
        const r = store().get(key)
        r.onsuccess = () => res(r.result)
      })
      delete value.cache.state.goals
      delete value.cache.state.measurements
      delete value.cache.features
      await new Promise((res) => {
        const r = store().put(value, key)
        r.onsuccess = res
      })
    }
    return keys.length
  })
}

async function persistedCopy(page: Page) {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res) => {
      const r = indexedDB.open("the-one-percent")
      r.onsuccess = () => res(r.result)
    })
    const all: { cache: { state: Record<string, unknown> }; queue: unknown[] }[] = await new Promise((res) => {
      const r = db.transaction("sync", "readonly").objectStore("sync").getAll()
      r.onsuccess = () => res(r.result)
    })
    return all.map((v) => ({ hasGoals: Array.isArray(v.cache.state.goals), queue: v.queue.length }))
  })
}

test.describe("account · update over a copy saved by M3.0", () => {
  test.use({ mode: "account" })
  let account: Account
  test.beforeEach(async ({}, info) => {
    account = await newAccount(`upgrade-${info.project.name}`)
  })
  test.afterEach(async () => {
    await removeAccount(account)
  })

  test("the app opens with the old session and copy, sends the pending op once and keeps working", async ({ page, context }) => {
    await signIn(page, account)
    await page.goto("/habits")
    await page.getByRole("button", { name: /^(Nuevo|Crear) hábito$/ }).first().click()
    await page.getByRole("dialog").getByLabel("Nombre").fill("Respirar")
    await page.getByRole("dialog").getByRole("button", { name: "Crear hábito" }).click()
    await expect.poll(() => countRows("select count(*)::int n from public.habits where user_id = $1", [account.id])).toBe(1)
    await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ })).toBeVisible({ timeout: 15_000 })

    // Pending work made offline, then the app is closed with an old-format copy on disk.
    await context.setOffline(true)
    await page.getByRole("region", { name: "Hoy" }).getByRole("button", { name: /^Respirar, / }).click()
    await page.waitForTimeout(500)
    expect(await downgradeToM30Copy(page)).toBe(1)
    await page.close()
    await context.setOffline(false)

    // "New version": same cookies, localStorage, IndexedDB and queue.
    const errors: string[] = []
    const reopened = await context.newPage()
    reopened.on("pageerror", (e) => errors.push(e.message))
    await reopened.goto("/")
    await expect(reopened.getByRole("heading", { level: 1, name: "Resumen" })).toBeVisible()
    await expect(reopened.getByRole("region", { name: "Objetivos activos" })).toBeVisible()
    await expect(reopened.getByText("This page couldn’t load")).toHaveCount(0)

    // The pending mark reached the server exactly once, and the copy was upgraded in place.
    await expect.poll(() => countRows("select count(*)::int n from public.habit_entries where user_id = $1 and deleted_at is null", [account.id]), { timeout: 15_000 }).toBe(1)
    await expect(reopened.getByRole("button", { name: /Estado de datos: Sincronizado/ })).toBeVisible({ timeout: 15_000 })
    expect(await countRows("select count(*)::int n from public.sync_operations where user_id = $1 and operation_type = 'entry.set'", [account.id])).toBe(1)
    await expect.poll(() => persistedCopy(reopened)).toEqual([{ hasGoals: true, queue: 0 }])

    // Goals work on the upgraded copy, and the habit is still there.
    await reopened.goto("/goals")
    await expect(reopened.getByText("Define tu primer objetivo")).toBeVisible()
    await reopened.goto("/habits")
    await expect(reopened.getByRole("region", { name: "Hoy" }).getByRole("button", { name: /^Respirar, / })).toHaveAttribute("aria-pressed", "true")
    expect(errors).toEqual([])
  })
})

test.describe("demo · update over a copy saved by M3.0", () => {
  test("an old demo copy without goals opens and gets the demo goals, keeping its own records", async ({ page, consoleErrors }) => {
    await page.goto("/habits")
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    const kept = await page.evaluate(() => {
      const key = "the-one-percent:demo:habits:v1"
      const state = JSON.parse(localStorage.getItem(key)!)
      delete state.goals
      delete state.measurements
      localStorage.setItem(key, JSON.stringify(state))
      return Object.keys(state.entries).length
    })
    await page.goto("/")
    await expect(page.getByRole("region", { name: "Objetivos activos" }).getByRole("link", { name: /Correr 10 km/ })).toBeVisible()
    await page.goto("/goals")
    await expect(page.getByRole("region", { name: "Principales" }).getByRole("article")).toHaveCount(3)
    const after = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("the-one-percent:demo:habits:v1")!).entries).length)
    expect(after).toBe(kept)
    expect(consoleErrors).toEqual([])
  })
})
