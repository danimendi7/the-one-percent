import { expect, test } from "./fixtures"
import { countRows, newAccount, removeAccount, signIn, type Account } from "./support/account"

/**
 * Incident 27/10/2026 (docs/reports/incident-2026-10-27-m3.1-upgrade.md): an error while rendering one
 * screen must stay inside that screen. The per-screen boundary (src/app/(app)/error.tsx) sits below the
 * shell, so navigation, the data-status pill and the sync engine keep working: pending offline work is
 * still sent (exactly once) and the local copy is still saved.
 * PERMANENT regression gate (D39): runs in CI on every push; never delete, skip or weaken it.
 */
test.describe("account · a failing screen keeps syncing", () => {
  test.use({ mode: "account" })
  let account: Account
  test.beforeEach(async ({}, info) => {
    account = await newAccount(`screenerr-${info.project.name}`)
  })
  test.afterEach(async () => {
    await removeAccount(account)
  })

  test("Objetivos throws on a malformed local goal; the shell, the queue and the sync survive", async ({ page, context }) => {
    await signIn(page, account)
    await page.goto("/habits")
    await page.getByRole("button", { name: /^(Nuevo|Crear) hábito$/ }).first().click()
    await page.getByRole("dialog").getByLabel("Nombre").fill("Respirar")
    await page.getByRole("dialog").getByRole("button", { name: "Crear hábito" }).click()
    await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ })).toBeVisible({ timeout: 15_000 })

    await context.setOffline(true)
    await page.getByRole("region", { name: "Hoy" }).getByRole("button", { name: /^Respirar, / }).click()
    await page.waitForTimeout(500)
    // Corrupt one goal in the local copy so the Goals screen throws while rendering.
    const queued = await page.evaluate(async () => {
      const db: IDBDatabase = await new Promise((res) => {
        const r = indexedDB.open("the-one-percent")
        r.onsuccess = () => res(r.result)
      })
      const store = () => db.transaction("sync", "readwrite").objectStore("sync")
      const keys: IDBValidKey[] = await new Promise((res) => {
        const r = store().getAllKeys()
        r.onsuccess = () => res(r.result)
      })
      const v = await new Promise<{ cache: { state: { goals: unknown[] } }; queue: unknown[] }>((res) => {
        const r = store().get(keys[0])
        r.onsuccess = () => res(r.result)
      })
      v.cache.state.goals = [{ id: "broken-goal" }]
      // M3.4d: a malformed local review must stay inside the Revisiones screen too.
      ;(v.cache.state as unknown as { reviews: unknown }).reviews = { "week:2026-10-19": { kind: "week", periodStart: "2026-10-19" } }
      await new Promise((res) => {
        const r = store().put(v, keys[0])
        r.onsuccess = res
      })
      return v.queue.length
    })
    expect(queued).toBe(1)
    await page.close()
    await context.setOffline(false)

    // Hold the server copy back (a full pull would replace the damaged one) so the failing screen is
    // deterministic; pushes go through untouched.
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    await context.route("**/rest/v1/rpc/pull_changes", async (route) => {
      await gate
      await route.continue()
    })

    const p = await context.newPage()
    const errors: string[] = []
    p.on("pageerror", (e) => errors.push(e.message))
    await p.goto("/goals")
    await expect(p.getByRole("alert").getByText("No se pudo mostrar esta pantalla")).toBeVisible()
    // While that screen is failing, the engine below it still sends the pending op, exactly once.
    await expect.poll(() => countRows("select count(*)::int n from public.habit_entries where user_id = $1 and deleted_at is null", [account.id]), { timeout: 15_000 }).toBe(1)
    // The shell is still mounted: status pill and navigation.
    await expect(p.getByRole("button", { name: /Estado de datos/ }).first()).toBeVisible()
    // M3.4d: Revisiones fails inside its own boundary as well, with the shell still there.
    await p.goto("/reviews")
    await expect(p.getByRole("alert").getByText("No se pudo mostrar esta pantalla")).toBeVisible()
    await expect(p.getByRole("button", { name: /Estado de datos/ }).first()).toBeVisible()
    release()
    await expect(p.getByRole("button", { name: /Estado de datos: Sincronizado/ })).toBeVisible({ timeout: 15_000 })
    expect(await countRows("select count(*)::int n from public.sync_operations where user_id = $1 and operation_type = 'entry.set'", [account.id])).toBe(1)
    const queueAfter = await p.evaluate(async () => {
      const db: IDBDatabase = await new Promise((res) => {
        const r = indexedDB.open("the-one-percent")
        r.onsuccess = () => res(r.result)
      })
      const all: { queue: unknown[] }[] = await new Promise((res) => {
        const r = db.transaction("sync", "readonly").objectStore("sync").getAll()
        r.onsuccess = () => res(r.result)
      })
      return all.map((v) => v.queue.length)
    })
    expect(queueAfter).toEqual([0])
    // Navigating away from the failing screen works without a reload.
    await p.getByRole("link", { name: "Hábitos" }).first().click()
    await expect(p.getByRole("region", { name: "Hoy" }).getByRole("button", { name: /^Respirar, / })).toHaveAttribute("aria-pressed", "true")
    // The boundary handled it: no uncaught page error.
    expect(errors).toEqual([])
  })
})
