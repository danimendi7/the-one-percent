import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { countRows, newAccount, removeAccount, signIn, type Account } from "./support/account"

/**
 * Updating the app over data saved by an older version (incident 27/10/2026: M3.0 → M3.1 crashed
 * with «This page couldn't load» on devices that had a persisted copy). Cookies, localStorage,
 * IndexedDB and the offline queue are kept exactly as the old version left them; nothing is cleared.
 * Every phase that adds a persisted field adds its older shape here (M3.2: focusSessions; M3.3: checkins
 * and checkinConfig; M3.4: reviews and closeIntents, with a reflection still waiting for a decision;
 * M4c: the M3.4 copy, without the library capability or database and with a review text kept).
 * PERMANENT regression gate (D39): runs in CI on every push; never delete, skip or weaken it.
 */

type Shape = "m30" | "m31" | "m32" | "m33" | "m34"
const SHAPE_NAME: Record<Shape, string> = { m30: "M3.0", m31: "M3.1", m32: "M3.2", m33: "M3.3", m34: "M3.4" }

/** Rewrite the persisted copy into the exact shape an older version saved. */
async function downgradeCopy(page: Page, shape: Shape) {
  return page.evaluate(async (shape) => {
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
      const value = await new Promise<{ cache: { state: Record<string, unknown>; features?: unknown }; queue: unknown[]; closeIntents?: unknown; pendingNotes?: unknown[] }>((res) => {
        const r = store().get(key)
        r.onsuccess = () => res(r.result)
      })
      if (shape === "m34") {
        // M3.4 (the version before the library) knew four capabilities, had no library database and
        // could hold a review text waiting for a decision.
        value.cache.features = { goals: true, focus: true, checkins: true, reviews: true }
        value.pendingNotes = [
          {
            id: "op-m34-review",
            kind: "conflict",
            opType: "review.save",
            code: "review_field_conflict",
            subject: "Revisión: semana del 19 oct al 25 oct",
            op: { type: "review.save", op_id: "op-m34-review", kind: "week", period_start: "2026-10-19", fields: { "content.wins": "Texto guardado por M3.4" }, base_seqs: { "content.wins": 1 } },
          },
        ]
        await new Promise((res) => {
          const r = indexedDB.deleteDatabase("the-one-percent-library")
          r.onsuccess = r.onerror = r.onblocked = res
        })
        await new Promise((res) => {
          const r = store().put(value, key)
          r.onsuccess = res
        })
        continue
      }
      // M3.3 saved no reviews or close intents, knew three capabilities and could hold a reflection waiting for a decision.
      delete value.cache.state.reviews
      delete value.closeIntents
      if (shape === "m33") {
        value.cache.features = { goals: true, focus: true, checkins: true }
        value.pendingNotes = [
          {
            id: "op-m33-note",
            kind: "conflict",
            opType: "checkin.set",
            code: "note_conflict",
            subject: "Check-in de noche del 28/10/2026",
            op: { type: "checkin.set", op_id: "op-m33-note", local_date: "2026-10-28", phase: "pm", fields: { note: "Reflexión guardada por M3.3" }, at: "2026-10-28T20:00:00.000Z", base_note_seq: 1 },
          },
        ]
      } else {
        // M3.2 saved no check-ins and knew the goals and focus capabilities.
        delete value.cache.state.checkins
        delete value.cache.state.checkinConfig
        if (shape === "m32") value.cache.features = { goals: true, focus: true }
        // M3.1 saved no focus sessions and only knew the goals capability.
        else if (shape === "m31") {
          delete value.cache.state.focusSessions
          value.cache.features = { goals: true }
        } else {
          delete value.cache.state.focusSessions
          // M3.0 saved no goals, measurements or features at all.
          delete value.cache.state.goals
          delete value.cache.state.measurements
          delete value.cache.features
        }
      }
      await new Promise((res) => {
        const r = store().put(value, key)
        r.onsuccess = res
      })
    }
    return keys.length
  }, shape)
}

async function persistedCopy(page: Page) {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res) => {
      const r = indexedDB.open("the-one-percent")
      r.onsuccess = () => res(r.result)
    })
    const all: { cache: { state: Record<string, unknown> }; queue: unknown[]; pendingNotes?: { id: string }[]; closeIntents?: unknown[] }[] = await new Promise((res) => {
      const r = db.transaction("sync", "readonly").objectStore("sync").getAll()
      r.onsuccess = () => res(r.result)
    })
    return all.map((v) => ({
      hasGoals: Array.isArray(v.cache.state.goals),
      hasFocus: Array.isArray(v.cache.state.focusSessions),
      hasCheckins: typeof v.cache.state.checkins === "object" && v.cache.state.checkins !== null && typeof v.cache.state.checkinConfig === "object",
      hasReviews: typeof v.cache.state.reviews === "object" && v.cache.state.reviews !== null && Array.isArray(v.closeIntents),
      pendingNotes: (v.pendingNotes ?? []).map((n) => n.id),
      queue: v.queue.length,
    }))
  })
}

for (const shape of ["m30", "m31", "m32", "m33", "m34"] as const) test.describe(`account · update over a copy saved by ${SHAPE_NAME[shape]}`, () => {
  test.use({ mode: "account" })
  let account: Account
  test.beforeEach(async ({}, info) => {
    account = await newAccount(`upgrade-${shape}-${info.project.name}`)
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
    expect(await downgradeCopy(page, shape)).toBe(1)
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
    await expect
      .poll(() => persistedCopy(reopened))
      .toEqual([{ hasGoals: true, hasFocus: true, hasCheckins: true, hasReviews: true, pendingNotes: shape === "m33" ? ["op-m33-note"] : shape === "m34" ? ["op-m34-review"] : [], queue: 0 }])
    // The library capability is learned from the server and its own database is created (empty) without touching anything else.
    await expect.poll(() => reopened.evaluate(() => new Promise((res) => { const r = indexedDB.open("the-one-percent-library"); r.onsuccess = () => res([...r.result.objectStoreNames].sort().join(",")) }))).toBe("item,link,meta,note,show")

    // Goals work on the upgraded copy, and the habit is still there.
    await reopened.goto("/goals")
    await expect(reopened.getByText("Define tu primer objetivo")).toBeVisible()
    // Focus works on the upgraded copy and is saved (the server has the migration).
    await reopened.goto("/focus")
    await expect(reopened.getByText("Aún no hay sesiones")).toBeVisible()
    await expect(reopened.getByText(/no guarda sesiones/)).toHaveCount(0)
    // Check-ins work on the upgraded copy and are saved (M3.3): no demo data, nothing pretended.
    await reopened.goto("/mind")
    await expect(reopened.getByText("Aún no hay check-ins en este periodo")).toBeVisible()
    await expect(reopened.getByText(/aún no guarda check-ins/)).toHaveCount(0)
    await reopened.goto("/habits")
    await expect(reopened.getByRole("region", { name: "Hoy" }).getByRole("button", { name: /^Respirar, / })).toHaveAttribute("aria-pressed", "true")
    expect(errors).toEqual([])
  })
})

test.describe("demo · update over copies saved by older versions", () => {
  test("an old demo copy without goals opens and gets the demo goals, keeping its own records", async ({ page, consoleErrors }) => {
    await page.goto("/habits")
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    // The demo store writes its copy right after hydration: wait for it before rewriting it.
    await expect.poll(() => page.evaluate(() => localStorage.getItem("the-one-percent:demo:habits:v1") !== null)).toBe(true)
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

  test("an old demo copy without focus sessions (M3.1) gets the demo sessions and keeps its own records and goals", async ({ page, consoleErrors }) => {
    await page.goto("/habits")
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    // The demo store writes its copy right after hydration: wait for it before rewriting it.
    await expect.poll(() => page.evaluate(() => localStorage.getItem("the-one-percent:demo:habits:v1") !== null)).toBe(true)
    const kept = await page.evaluate(() => {
      const key = "the-one-percent:demo:habits:v1"
      const state = JSON.parse(localStorage.getItem(key)!)
      delete state.focusSessions
      state.habits = state.habits.filter((h: { id: string }) => h.id !== "demo-focus")
      for (const k of Object.keys(state.entries)) if (k.startsWith("demo-focus:")) delete state.entries[k]
      localStorage.setItem(key, JSON.stringify(state))
      return { entries: Object.keys(state.entries).length, goals: state.goals.length }
    })
    await page.goto("/focus")
    await expect(page.getByRole("heading", { name: "Esta semana" })).toBeVisible()
    await expect(page.getByText("Aún no hay sesiones")).toHaveCount(0)
    const after = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("the-one-percent:demo:habits:v1")!)
      return { own: Object.keys(s.entries).filter((k) => !k.startsWith("demo-focus:")).length, goals: s.goals.length }
    })
    expect(after).toEqual({ own: kept.entries, goals: kept.goals })
    expect(consoleErrors).toEqual([])
  })

  test("an old demo copy without check-ins (M3.2) gets the demo check-ins and keeps its own records, goals and sessions", async ({ page, consoleErrors }) => {
    await page.goto("/habits")
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await expect.poll(() => page.evaluate(() => localStorage.getItem("the-one-percent:demo:habits:v1") !== null)).toBe(true)
    const kept = await page.evaluate(() => {
      const key = "the-one-percent:demo:habits:v1"
      const state = JSON.parse(localStorage.getItem(key)!)
      delete state.checkins
      delete state.checkinConfig
      localStorage.setItem(key, JSON.stringify(state))
      return { entries: Object.keys(state.entries).length, goals: state.goals.length, sessions: state.focusSessions.length }
    })
    await page.goto("/mind")
    await expect(page.getByRole("heading", { name: "Historial" })).toBeVisible()
    await expect(page.getByText("Aún no hay check-ins en este periodo")).toHaveCount(0)
    const after = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("the-one-percent:demo:habits:v1")!)
      return { entries: Object.keys(s.entries).length, goals: s.goals.length, sessions: s.focusSessions.length }
    })
    // The stored copy is only rewritten on the next change; what it had is untouched.
    expect(after).toEqual(kept)
    expect(consoleErrors).toEqual([])
  })

  test("an old demo copy without reviews (M3.3) opens with everything it had; the next change stores reviews, and stored reviews are never dropped", async ({ page, consoleErrors }) => {
    const key = "the-one-percent:demo:habits:v1"
    await page.goto("/habits")
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k) !== null, key)).toBe(true)
    const kept = await page.evaluate((k) => {
      const state = JSON.parse(localStorage.getItem(k)!)
      delete state.reviews
      localStorage.setItem(k, JSON.stringify(state))
      return { entries: Object.keys(state.entries).length, goals: state.goals.length, sessions: state.focusSessions.length, checkins: Object.keys(state.checkins).length }
    }, key)
    await page.reload()
    const cell = page.getByRole("region", { name: "Hoy" }).getByRole("button", { name: /^Bloque de trabajo profundo, miércoles, 21 de octubre/ })
    await expect(cell).toHaveAttribute("aria-pressed", "false")
    await cell.click()
    await expect(cell).toHaveAttribute("aria-pressed", "true")
    const read = (k: string) =>
      page.evaluate((k) => {
        const s = JSON.parse(localStorage.getItem(k)!)
        return { entries: Object.keys(s.entries).length, goals: s.goals.length, sessions: s.focusSessions.length, checkins: Object.keys(s.checkins).length, reviews: s.reviews }
      }, k)
    await expect.poll(() => read(key)).toEqual({ ...kept, entries: kept.entries + 1, reviews: {} })

    // A copy with a review keeps it through a reload and the next write.
    await page.evaluate((k) => {
      const state = JSON.parse(localStorage.getItem(k)!)
      state.reviews = {
        "week:2026-10-12": { kind: "week", periodStart: "2026-10-12", periodEnd: "2026-10-18", status: "draft", content: { wins: "Demo: semana tranquila" }, decisions: [], evaluations: [], snapshot: null, closedAt: null, updatedAt: "2026-10-19T08:00:00.000Z" },
      }
      localStorage.setItem(k, JSON.stringify(state))
    }, key)
    await page.reload()
    await cell.click()
    await expect(cell).toHaveAttribute("aria-pressed", "false")
    await expect.poll(async () => (await read(key)).reviews).toMatchObject({ "week:2026-10-12": { content: { wins: "Demo: semana tranquila" } } })
    expect(consoleErrors).toEqual([])
  })
})
