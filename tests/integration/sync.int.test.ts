import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { adminClient, addDays, anonClient, createTestUser, db, deleteTestUser, isoWeekday, opId, type TestUser } from "./setup"

type Result = { op_id: string; status: string; outcome?: string; code?: string | null }

async function apply(u: TestUser, ops: unknown[]) {
  const { data, error } = await u.client.rpc("apply_ops", { p_device_id: "it", p_ops: ops })
  if (error) throw error
  return data as { results: Result[]; server_today: string }
}

async function pull(u: TestUser, since = 0) {
  const { data, error } = await u.client.rpc("pull_changes", { p_since: since })
  if (error) throw error
  return data as {
    server_today: string
    cursor: number
    habits: { id: string; version: number; versions: { valid_from: string; kind: string; weekdays: number[] | null }[] }[]
    entries: { habit_id: string; local_date: string; value_bool: boolean | null; value_numeric: number | null; deleted: boolean; server_seq: number }[]
    server_time: string
    rest_days: { local_date: string; rest: boolean }[]
  }
}

function createOp(id: string, start: string, rule: unknown, type: "binary" | "numeric" = "binary") {
  return {
    type: "habit.create",
    op_id: opId("create"),
    habit: {
      id, title: "Hábito de prueba", icon: "check", dimension: "body", habit_type: type,
      unit: type === "numeric" ? "pasos" : null,
      target_value: type === "numeric" ? 8000 : null,
      target_direction: type === "numeric" ? "at_least" : null,
      start_date: start,
    },
    versions: [{ valid_from: start, rule }],
  }
}

const entryOp = (habit: string, date: string, value: unknown, at = new Date().toISOString(), base: number | null = null) => ({
  type: "entry.set", op_id: opId("entry"), habit_id: habit, local_date: date, value, client_updated_at: at, base_seq: base,
})

let a: TestUser
let b: TestUser
let today: string

beforeAll(async () => {
  a = await createTestUser("a")
  b = await createTestUser("b")
  today = (await pull(a)).server_today
})

afterAll(async () => {
  await deleteTestUser(a)
  await deleteTestUser(b)
})

describe("identity", () => {
  it("creates a profile and the four dimensions for a new user", async () => {
    const { data } = await a.client.from("dimensions").select("slug").order("sort_order")
    expect(data?.map((d) => d.slug)).toEqual(["body", "mind", "learn", "work"])
    const { data: profile } = await a.client.from("profiles").select("timezone").single()
    expect(profile?.timezone).toBe("Europe/Madrid")
  })

  it("refuses accounts for emails that are not allowlisted (no public onboarding)", async () => {
    const { error } = await adminClient().auth.admin.createUser({ email: `intruder-${Date.now()}@example.com`, email_confirm: true })
    expect(error).not.toBeNull()
  })

  it("the allowlist is not reachable through the API", async () => {
    const { error } = await a.client.schema("private" as never).from("allowed_emails").select("*")
    expect(error).not.toBeNull()
  })
})

describe("RLS: private data is inaccessible to another user (acceptance #9)", () => {
  const habitA = randomUUID()

  beforeAll(async () => {
    const res = await apply(a, [createOp(habitA, addDays(today, -10), { kind: "daily" }), entryOp(habitA, today, true)])
    expect(res.results.map((r) => r.status)).toEqual(["applied", "applied"])
  })

  it("another user cannot read habits, entries, ledger or audit rows", async () => {
    for (const table of ["habits", "habit_entries", "habit_schedule_versions", "sync_operations", "audit_logs", "profiles"]) {
      const { data, error } = await b.client.from(table).select("*").eq(table === "profiles" ? "id" : "user_id", a.id)
      expect(error, table).toBeNull()
      expect(data, table).toEqual([])
    }
    const changes = await pull(b)
    expect(changes.habits).toEqual([])
    expect(changes.entries).toEqual([])
  })

  it("another user cannot write into, update or reference someone else's habit", async () => {
    const insert = await b.client.from("habit_entries").insert({
      user_id: a.id, habit_id: habitA, local_date: today, value_bool: true, client_op_id: opId(), client_updated_at: new Date().toISOString(),
    })
    expect(insert.error).not.toBeNull()

    const linked = await b.client.from("habit_entries").insert({
      habit_id: habitA, local_date: today, value_bool: true, client_op_id: opId(), client_updated_at: new Date().toISOString(),
    })
    expect(linked.error).not.toBeNull() // composite FK (habit_id, user_id) blocks cross-user links

    const upd = await b.client.from("habits").update({ title: "hacked" }).eq("id", habitA).select()
    expect(upd.data ?? []).toEqual([])

    const viaRpc = await apply(b, [entryOp(habitA, today, true)])
    expect(viaRpc.results[0]).toMatchObject({ status: "rejected" })

    const stillA = await db((c) => c.query("select title from public.habits where id = $1", [habitA]))
    expect(stillA.rows[0].title).toBe("Hábito de prueba")
  })

  it("anonymous requests get nothing", async () => {
    const anon = anonClient()
    const { data } = await anon.from("habits").select("*")
    expect(data ?? []).toEqual([])
    const rpc = await anon.rpc("pull_changes", { p_since: 0 })
    expect(rpc.error).not.toBeNull()
  })
})

describe("apply_ops", () => {
  it("is idempotent: replaying an op id never applies it twice", async () => {
    const h = randomUUID()
    await apply(a, [createOp(h, addDays(today, -3), { kind: "daily" })])
    const op = entryOp(h, today, true)
    const first = await apply(a, [op])
    const replay = await apply(a, [op])
    expect(first.results[0].status).toBe("applied")
    expect(replay.results[0]).toMatchObject({ status: "duplicate", outcome: "applied" })
    const rows = await db((c) => c.query("select count(*)::int n from public.habit_entries where habit_id = $1", [h]))
    expect(rows.rows[0].n).toBe(1)
    const ledger = await db((c) => c.query("select count(*)::int n from public.sync_operations where client_op_id = $1", [op.op_id]))
    expect(ledger.rows[0].n).toBe(1)
  })

  it("re-creating the same habit id is a harmless no-op (import retries)", async () => {
    const h = randomUUID()
    const res = await apply(a, [createOp(h, today, { kind: "daily" }), createOp(h, today, { kind: "daily" })])
    expect(res.results.map((r) => r.status)).toEqual(["applied", "applied"])
  })

  it("a bad op is rejected without aborting the rest of the batch", async () => {
    const h = randomUUID()
    const res = await apply(a, [
      createOp(h, addDays(today, -2), { kind: "daily" }),
      entryOp(h, addDays(today, 3), true), // future
      entryOp(h, today, true),
    ])
    expect(res.results.map((r) => [r.status, r.code])).toEqual([
      ["applied", null],
      ["rejected", "future_date"],
      ["applied", null],
    ])
  })
})

describe("habit engine rules enforced by the database", () => {
  it("only scheduled days accept records; rest days and wrong value types are refused", async () => {
    const h = randomUUID()
    const monday = addDays(today, -(isoWeekday(today) - 1) - 7) // Monday last week
    await apply(a, [createOp(h, addDays(monday, -7), { kind: "weekdays", weekdays: [1, 3] })])
    const res = await apply(a, [
      entryOp(h, monday, true), // Monday ✓
      entryOp(h, addDays(monday, 1), true), // Tuesday ✗
      entryOp(h, addDays(monday, 2), 5), // Wednesday but numeric on a binary habit ✗
    ])
    expect(res.results.map((r) => r.code ?? r.status)).toEqual(["applied", "not_eligible", "invalid_value"])

    const wednesday = addDays(monday, 2)
    await apply(a, [{ type: "rest_day.set", op_id: opId(), local_date: wednesday, rest: true, client_updated_at: new Date().toISOString() }])
    const rest = await apply(a, [entryOp(h, wednesday, true)])
    expect(rest.results[0].code).toBe("rest_day")
  })

  it("schedule changes are versioned from today and never rewrite history (acceptance #1)", async () => {
    const h = randomUUID()
    const start = addDays(today, -30)
    await apply(a, [createOp(h, start, { kind: "weekdays", weekdays: [1, 3] })])
    const before = await pull(a)
    const version = before.habits.find((x) => x.id === h)!.version

    const retro = await apply(a, [{
      type: "habit.update", op_id: opId(), habit_id: h, base_version: version, patch: {},
      schedule: { effective_from: addDays(today, -10), rule: { kind: "daily" } },
    }])
    expect(retro.results[0].code).toBe("invalid_effective_date")

    const ok = await apply(a, [{
      type: "habit.update", op_id: opId(), habit_id: h, base_version: version, patch: {},
      schedule: { effective_from: today, rule: { kind: "daily" } },
    }])
    expect(ok.results[0].status).toBe("applied")
    const after = (await pull(a)).habits.find((x) => x.id === h)!
    expect(after.versions.map((v) => [v.valid_from, v.kind])).toEqual([[start, "weekdays"], [today, "daily"]])

    // Even a direct API delete of an old version is blocked
    const del = await a.client.from("habit_schedule_versions").delete().eq("habit_id", h).eq("valid_from", start)
    expect(del.error?.message).toContain("history_immutable")
  })

  it("habit type and start date are immutable", async () => {
    const h = randomUUID()
    await apply(a, [createOp(h, today, { kind: "daily" })])
    const t = await a.client.from("habits").update({ habit_type: "numeric" }).eq("id", h)
    expect(t.error).not.toBeNull()
    const s = await a.client.from("habits").update({ start_date: addDays(today, -100) }).eq("id", h)
    expect(s.error?.message).toContain("immutable_start_date")
  })

  it("numeric values are stored exactly", async () => {
    const h = randomUUID()
    await apply(a, [createOp(h, today, { kind: "daily" }, "numeric"), entryOp(h, today, 12034.5)])
    const e = (await pull(a)).entries.find((x) => x.habit_id === h)!
    expect(Number(e.value_numeric)).toBe(12034.5)
  })
})

describe("conflicts and change feed", () => {
  it("last writer wins by device time; a clear leaves a tombstone that beats older marks", async () => {
    const h = randomUUID()
    await apply(a, [createOp(h, addDays(today, -1), { kind: "daily" })])
    const t1 = new Date(Date.now() - 60_000).toISOString()
    const t2 = new Date().toISOString()
    await apply(a, [entryOp(h, today, null, t2)]) // newer clear arrives first
    const late = await apply(a, [entryOp(h, today, true, t1)]) // older mark arrives later
    expect(late.results[0].status).toBe("superseded")
    const full = await pull(a)
    expect(full.entries.find((e) => e.habit_id === h)).toBeUndefined()
  })

  it("an edit based on a stale version is reported as a conflict", async () => {
    const h = randomUUID()
    await apply(a, [createOp(h, today, { kind: "daily" })])
    const v = (await pull(a)).habits.find((x) => x.id === h)!.version
    await apply(a, [{ type: "habit.update", op_id: opId(), habit_id: h, base_version: v, patch: { title: "Desde el móvil" } }])
    const stale = await apply(a, [{ type: "habit.update", op_id: opId(), habit_id: h, base_version: v, patch: { title: "Desde el PC" } }])
    expect(stale.results[0].status).toBe("conflict")
    const { data } = await a.client.from("habits").select("title, version").eq("id", h).single()
    expect(data).toMatchObject({ title: "Desde el móvil", version: v + 1 })
  })

  it("incremental pulls return only newer rows, including tombstones", async () => {
    const h = randomUUID()
    await apply(a, [createOp(h, today, { kind: "daily" }), entryOp(h, today, true)])
    const base = await pull(a)
    const quiet = await pull(a, base.cursor)
    expect(quiet.habits).toEqual([])
    expect(quiet.entries).toEqual([])
    await apply(a, [entryOp(h, today, null)])
    const delta = await pull(a, base.cursor)
    expect(delta.entries).toEqual([expect.objectContaining({ habit_id: h, deleted: true })])
    expect(delta.cursor).toBeGreaterThan(base.cursor)
  })

  it("backfilled records are written to the audit log", async () => {
    const h = randomUUID()
    await apply(a, [createOp(h, addDays(today, -5), { kind: "daily" }), entryOp(h, addDays(today, -2), true)])
    const { data } = await a.client.from("audit_logs").select("action, entity_id").eq("entity_id", h)
    expect(data?.map((r) => r.action).sort()).toEqual(["backfill", "create"])
  })
})

describe("conflict resolution v2 (base_seq + server-corrected time)", () => {
  const HOUR = 3_600_000

  it("both RPCs report the server clock", async () => {
    const r = await apply(a, [])
    expect(Date.parse((r as unknown as { server_time: string }).server_time)).not.toBeNaN()
    expect(Date.parse((await pull(a)).server_time)).not.toBeNaN()
  })

  it("a sequential edit applies even with a device time hours in the past", async () => {
    const h = randomUUID()
    await apply(a, [createOp(h, addDays(today, -1), { kind: "daily" }), entryOp(h, today, true)])
    const seen = (await pull(a)).entries.find((e) => e.habit_id === h)!.server_seq
    const res = await apply(a, [entryOp(h, today, null, new Date(Date.now() - 2 * HOUR).toISOString(), seen)])
    expect(res.results[0].status).toBe("applied")
    expect((await pull(a)).entries.find((e) => e.habit_id === h)).toBeUndefined()
  })

  it("a concurrent edit (stale base) with an older time is superseded", async () => {
    const h = randomUUID()
    await apply(a, [createOp(h, addDays(today, -1), { kind: "daily" }), entryOp(h, today, true)])
    const seen = (await pull(a)).entries.find((e) => e.habit_id === h)!.server_seq
    await apply(a, [entryOp(h, today, 1 > 0, new Date().toISOString(), seen)]) // another device moves the row on
    const res = await apply(a, [entryOp(h, today, null, new Date(Date.now() - HOUR).toISOString(), seen)])
    expect(res.results[0].status).toBe("superseded")
  })

  it("device times in the future are clamped to the server clock", async () => {
    const h = randomUUID()
    await apply(a, [createOp(h, addDays(today, -1), { kind: "daily" })])
    await apply(a, [entryOp(h, today, true, new Date(Date.now() + 24 * HOUR).toISOString())])
    const row = await db((c) => c.query("select client_updated_at from public.habit_entries where habit_id = $1", [h]))
    expect(new Date(row.rows[0].client_updated_at).getTime()).toBeLessThan(Date.now() + 2 * 60_000)
  })
})
