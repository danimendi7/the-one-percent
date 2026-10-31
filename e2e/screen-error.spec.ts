import { expect, test } from "./fixtures"
import { countRows, newAccount, removeAccount, signIn, type Account } from "./support/account"

/**
 * Runs in the page: opening the device copy (the «the-one-percent» database) answers `ms` later, as
 * on a slow phone. Nothing else changes; the data itself is untouched.
 */
function delayDeviceCopy(ms: number) {
  const open = IDBFactory.prototype.open
  const onsuccess = Object.getOwnPropertyDescriptor(IDBRequest.prototype, "onsuccess")!
  IDBFactory.prototype.open = function (this: IDBFactory, name: string, version?: number) {
    const req = open.call(this, name, version)
    if (name !== "the-one-percent") return req
    Object.defineProperty(req, "onsuccess", {
      configurable: true,
      get: () => onsuccess.get!.call(req),
      set: (fn: ((e: Event) => void) | null) => onsuccess.set!.call(req, fn && ((e: Event) => setTimeout(() => fn.call(req, e), ms))),
    })
    return req
  }
}

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

  for (const slowCopy of [false, true])
  test(slowCopy ? "Objetivos fails as above on a device whose copy is slow to open; the queue is still sent first and once (M4f)" : "Objetivos throws on a malformed local goal; the shell, the queue and the sync survive", async ({ page, context }) => {
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

    // ci/m4 (run 41183910815): on the slower runner the realtime channel connected before the engine
    // had read the device copy, and its early cycle sat on the held pull with an empty queue (D89).
    if (slowCopy) await context.addInitScript(delayDeviceCopy, 2500)
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

/**
 * M4d · the same guarantee for the Library: a content whose device copy is damaged fails inside its
 * own page; the shell stays, a note captured offline still reaches the server once, and Cerebro
 * (which does not render that field) keeps working.
 */
test.describe("account · a failing Library page keeps syncing", () => {
  test.use({ mode: "account" })
  let account: Account
  test.beforeEach(async ({}, info) => {
    account = await newAccount(`screenerr-lib-${info.project.name}`)
  })
  test.afterEach(async () => {
    await removeAccount(account)
  })

  test("a book with a broken date in the device copy; the shell, the queue and the sync survive", async ({ page, context }) => {
    await signIn(page, account)
    await page.goto("/knowledge/library/books")
    await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
    await page.getByTestId("add-book").click()
    await page.getByTestId("form-title").fill("Libro dañado")
    await page.getByTestId("form-save").click()
    await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 15_000 })
    const id = new URL(page.url()).searchParams.get("id")!

    await context.setOffline(true)
    await page.getByTestId("capture-open").click()
    await page.getByTestId("capture-text").fill("Idea pendiente")
    await expect(page.getByTestId("capture-save")).toContainText("se enviará al recuperar la conexión")
    // Damage the confirmed row in the Library's own IndexedDB: an impossible start date.
    const damaged = await page.evaluate(async ({ uid, id }) => {
      const db: IDBDatabase = await new Promise((res) => {
        const r = indexedDB.open("the-one-percent-library")
        r.onsuccess = () => res(r.result)
      })
      const store = () => db.transaction("item", "readwrite").objectStore("item")
      const key = `${uid}:${id}`
      const row = await new Promise<Record<string, unknown> | undefined>((res) => {
        const r = store().get(key)
        r.onsuccess = () => res(r.result)
      })
      if (!row) return false
      row.started_on = "fecha-rota"
      await new Promise((res) => {
        const r = store().put(row, key)
        r.onsuccess = res
      })
      return true
    }, { uid: account.id, id })
    expect(damaged).toBe(true)
    await page.close()
    await context.setOffline(false)

    // Hold the Library download back so the damaged copy is what renders; pushes go through.
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    await context.route("**/rest/v1/rpc/pull_library", async (route) => {
      await gate
      await route.continue()
    })

    const p = await context.newPage()
    const errors: string[] = []
    p.on("pageerror", (e) => errors.push(e.message))
    await p.goto(`/knowledge/library/item?id=${id}`)
    await expect(p.getByRole("alert").getByText("No se pudo mostrar esta pantalla")).toBeVisible()
    await expect.poll(() => countRows("select count(*)::int n from public.knowledge_notes where user_id = $1 and body = 'Idea pendiente'", [account.id]), { timeout: 15_000 }).toBe(1)
    await expect(p.getByRole("button", { name: /Estado de datos/ }).first()).toBeVisible()
    // Cerebro still works, without a reload.
    const brain = p.getByRole("link", { name: "Cerebro" }).locator("visible=true")
    if ((await brain.count()) === 0) await p.getByRole("link", { name: "Más" }).locator("visible=true").click()
    await brain.first().click()
    await expect(p.getByTestId("note").locator("visible=true").filter({ hasText: "Idea pendiente" })).toBeVisible()
    release()
    expect(await countRows("select count(*)::int n from public.sync_operations where user_id = $1 and operation_type = 'library.note.create'", [account.id])).toBe(1)
    expect(errors).toEqual([])
  })
})
