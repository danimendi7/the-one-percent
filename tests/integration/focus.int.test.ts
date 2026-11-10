import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { addDays, createTestUser, db, deleteTestUser, opId, type TestUser } from "./setup"

/** M3.2 · focus sessions over the existing sync engine (supabase/migrations/*_focus.sql). LOCAL stack only. */

type Result = { op_id: string; status: string; outcome?: string; code?: string | null }
type WireSession = {
  id: string
  habit_id: string | null
  state: string
  segments: { start: string; end: string | null }[]
  active_seconds: number
  local_date: string
  version: number
  rating: number | null
  deleted: boolean
  server_seq: number
}
type WireEntry = { habit_id: string; local_date: string; value_numeric: number | null; deleted: boolean; client_updated_at: string }

async function apply(u: TestUser, ops: unknown[]) {
  const { data, error } = await u.client.rpc("apply_ops", { p_device_id: "it", p_ops: ops })
  if (error) throw error
  return (data as { results: Result[] }).results
}

async function pull(u: TestUser, since = 0) {
  const { data, error } = await u.client.rpc("pull_changes", { p_since: since })
  if (error) throw error
  return data as {
    server_today: string
    cursor: number
    focus_sessions: WireSession[]
    entries: WireEntry[]
    habits: { id: string; activity_source: string | null; activity_source_from: string | null }[]
  }
}

const iso = (t: number) => new Date(t).toISOString()
const NOW = () => Date.now()
const min = (n: number) => n * 60_000

const start = (id: string, at: number, habitId: string | null = null, planned = 50) => ({
  type: "focus.start",
  op_id: opId("fs"),
  session: { id, habit_id: habitId, project: "  Tesis ", planned_output: "Capítulo", planned_minutes: planned, started_at: iso(at) },
})
const act = (type: "focus.pause" | "focus.resume", id: string, at: number) => ({ type, op_id: opId("fa"), session_id: id, at: iso(at) })
const finish = (id: string, at: number, extra: Record<string, unknown> = {}) => ({
  type: "focus.finish", op_id: opId("ff"), session_id: id, at: iso(at), trim_to: null, actual_output: "Hecho", rating: 4, ...extra,
})
const discard = (id: string) => ({ type: "focus.discard", op_id: opId("fd"), session_id: id })
const link = (habitId: string, from: string, source: "focus" | null = "focus") => ({ type: "habit.set_source", op_id: opId("src"), habit_id: habitId, source, from })

const habitCreate = (id: string, startDate: string, type: "duration" | "binary") => ({
  type: "habit.create",
  op_id: opId("habit"),
  habit: {
    id, title: type === "duration" ? "Deep Work 90 min" : "Leer", icon: "target", dimension: "work", habit_type: type,
    unit: type === "duration" ? "min" : null, target_value: type === "duration" ? 90 : null,
    target_direction: type === "duration" ? "at_least" : null, start_date: startDate,
  },
  versions: [{ valid_from: startDate, rule: { kind: "daily" } }],
})

async function session(u: TestUser, id: string) {
  return (await pull(u)).focus_sessions.find((s) => s.id === id)
}
async function entry(u: TestUser, habitId: string, date: string) {
  return (await pull(u)).entries.find((e) => e.habit_id === habitId && e.local_date === date)
}

/**
 * Several sessions here start up to 3 h before now and are then read on «today». A session belongs
 * to the day it started, so just after midnight they fall on yesterday: this user lives in a
 * timezone where it is at least 4 a.m. (run 42716447865 failed at 00:01 in Madrid).
 */
function zoneWellPastMidnight(): string {
  const hour = (timeZone: string) => Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(new Date()))
  return hour("Europe/Madrid") >= 4 ? "Europe/Madrid" : "America/New_York"
}

let a: TestUser
let b: TestUser
let today: string
const dw = randomUUID()
const bin = randomUUID()

beforeAll(async () => {
  a = await createTestUser("fa")
  b = await createTestUser("fb")
  await db((c) => c.query("update public.profiles set timezone = $1 where id = $2", [zoneWellPastMidnight(), a.id]))
  today = (await pull(a)).server_today
  const res = await apply(a, [habitCreate(dw, addDays(today, -10), "duration"), habitCreate(bin, addDays(today, -10), "binary")])
  expect(res.map((r) => r.status)).toEqual(["applied", "applied"])
})

afterAll(async () => {
  await deleteTestUser(a)
  await deleteTestUser(b)
})

describe("one active session per user (decision 5)", () => {
  it("a second start while one is active is a conflict naming the active session; after discarding, it is allowed", async () => {
    const s1 = randomUUID()
    const s2 = randomUUID()
    expect((await apply(a, [start(s1, NOW() - min(5))]))[0].status).toBe("applied")
    const second = (await apply(a, [start(s2, NOW())]))[0]
    expect(second).toMatchObject({ status: "conflict", code: "session_active" })
    // The rejected device simply joins the active one: only s1 exists.
    expect(await session(a, s2)).toBeUndefined()
    expect((await apply(a, [discard(s1)]))[0].status).toBe("applied")
    expect((await apply(a, [start(s2, NOW())]))[0].status).toBe("applied")
    expect((await apply(a, [discard(s2)]))[0].status).toBe("applied")
  })

  it("the unique index holds even for direct writes", async () => {
    const x = randomUUID()
    expect((await apply(a, [start(x, NOW())]))[0].status).toBe("applied")
    const { error } = await a.client.from("focus_sessions").insert({
      id: randomUUID(), planned_minutes: 25, segments: [{ start: iso(NOW()), end: null }], state: "running", started_at: iso(NOW()), local_date: today,
    })
    expect(error?.code).toBe("23505")
    await apply(a, [discard(x)])
  })
})

describe("idempotency and isolation", () => {
  it("a replayed op is a duplicate; a re-sent start of the same id is a no-op", async () => {
    const id = randomUUID()
    const op = start(id, NOW() - min(1))
    expect((await apply(a, [op]))[0].status).toBe("applied")
    expect((await apply(a, [op]))[0]).toMatchObject({ status: "duplicate", outcome: "applied" })
    expect((await apply(a, [{ ...op, op_id: opId("again") }]))[0].status).toBe("applied")
    const rows = await db((c) => c.query("select count(*)::int n from public.focus_sessions where id = $1", [id]))
    expect(rows.rows[0].n).toBe(1)
    await apply(a, [discard(id)])
  })

  it("another user can neither see nor touch a session", async () => {
    const id = randomUUID()
    await apply(a, [start(id, NOW())])
    expect((await pull(b)).focus_sessions).toEqual([])
    const { data } = await b.client.from("focus_sessions").select("id").eq("id", id)
    expect(data).toEqual([])
    expect((await apply(b, [act("focus.pause", id, NOW())]))[0]).toMatchObject({ status: "rejected", code: "session_not_found" })
    expect((await apply(b, [start(id, NOW())]))[0]).toMatchObject({ status: "rejected", code: "id_conflict" })
    // Sessions are never hard-deleted by clients.
    await a.client.from("focus_sessions").delete().eq("id", id)
    expect(await session(a, id)).toBeDefined()
    await apply(a, [discard(id)])
  })
})

describe("time is computed by the server from segments", () => {
  it("pause/resume/finish build segments; active_seconds excludes pauses; pause twice is a no-op", async () => {
    const id = randomUUID()
    const t0 = NOW() - min(60)
    const res = await apply(a, [start(id, t0), act("focus.pause", id, t0 + min(20)), act("focus.pause", id, t0 + min(25)), act("focus.resume", id, t0 + min(30)), finish(id, t0 + min(55))])
    expect(res.map((r) => r.status)).toEqual(["applied", "applied", "applied", "applied", "applied"])
    const s = (await session(a, id))!
    expect(s.state).toBe("finished")
    expect(s.segments).toHaveLength(2)
    expect(s.active_seconds).toBe(45 * 60)
    expect(s.rating).toBe(4)
    // Finishing again (another device) is superseded, not an error.
    expect((await apply(a, [finish(id, NOW())]))[0]).toMatchObject({ status: "superseded", code: "not_active" })
  })

  it("trim cuts a forgotten timer; under one minute is rejected; a clock ahead is clamped to now", async () => {
    const id = randomUUID()
    const t0 = NOW() - min(180)
    await apply(a, [start(id, t0)])
    expect((await apply(a, [finish(id, NOW(), { trim_to: iso(t0 + min(50)) })]))[0].status).toBe("applied")
    expect((await session(a, id))!.active_seconds).toBe(50 * 60)

    const short = randomUUID()
    await apply(a, [start(short, NOW() - 30_000)])
    expect((await apply(a, [finish(short, NOW())]))[0]).toMatchObject({ status: "rejected", code: "too_short" })
    await apply(a, [discard(short)])

    const ahead = randomUUID()
    const res = await apply(a, [start(ahead, NOW() + min(30))])
    expect(res[0].status).toBe("applied")
    const s = (await session(a, ahead))!
    expect(Date.parse(s.segments[0].start)).toBeLessThanOrEqual(NOW() + min(1) + 5_000)
    await apply(a, [discard(ahead)])
  })

  it("edit validates segments: future, overlap, > 12 h and version conflicts", async () => {
    const id = randomUUID()
    const t0 = NOW() - min(120)
    await apply(a, [start(id, t0), finish(id, t0 + min(50))])
    const v = (await session(a, id))!.version
    const edit = (segments: unknown, base = v) => ({
      type: "focus.edit", op_id: opId("fe"), session_id: id, base_version: base, segments, habit_id: null, project: "Tesis", planned_output: null, actual_output: null, rating: 5,
    })
    const r = await apply(a, [
      edit([{ start: iso(t0), end: iso(NOW() + min(10)) }]),
      edit([{ start: iso(t0), end: iso(t0 + min(30)) }, { start: iso(t0 + min(20)), end: iso(t0 + min(40)) }]),
      edit([{ start: iso(t0 - min(800)), end: iso(t0) }]),
    ])
    expect(r.map((x) => x.code)).toEqual(["segments_future", "segments_overlap", "segments_too_long"])
    expect((await apply(a, [edit([{ start: iso(t0), end: iso(t0 + min(30)) }])]))[0].status).toBe("applied")
    expect((await session(a, id))!.active_seconds).toBe(30 * 60)
    expect((await apply(a, [edit([{ start: iso(t0), end: iso(t0 + min(20)) }], v)]))[0].status).toBe("conflict")
  })

  it("a session crossing midnight counts on the day it started (profile timezone)", async () => {
    const id = randomUUID()
    const y = addDays(today, -2)
    // 23:30 in Madrid: 21:30Z in summer time, 22:30Z in winter time; try both and keep the one that is 23:30 local.
    const startAt = [`${y}T21:30:00Z`, `${y}T22:30:00Z`].map(Date.parse).find((t) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t) === "23:30")!
    await apply(a, [start(id, startAt), finish(id, startAt + min(75))])
    expect((await session(a, id))!.local_date).toBe(y)
  })
})

describe("habit fed by focus (decision 1): materialised once, never logged twice", () => {
  it("linking only accepts duration habits and dates around today", async () => {
    expect((await apply(a, [link(bin, today)]))[0]).toMatchObject({ status: "rejected", code: "not_duration_habit" })
    expect((await apply(a, [link(dw, addDays(today, -5))]))[0]).toMatchObject({ status: "rejected", code: "invalid_effective_date" })
  })

  it("history before the link stays manual; from the link on, finish/edit/discard re-derive the day", async () => {
    const yesterday = addDays(today, -1)
    // Manual history logged before linking.
    expect((await apply(a, [{ type: "entry.set", op_id: opId("e"), habit_id: dw, local_date: yesterday, value: 30, client_updated_at: iso(NOW()), base_seq: null }]))[0].status).toBe("applied")
    expect((await apply(a, [link(dw, today)]))[0].status).toBe("applied")
    expect((await pull(a)).habits.find((h) => h.id === dw)).toMatchObject({ activity_source: "focus", activity_source_from: today })

    const s1 = randomUUID()
    const s2 = randomUUID()
    const t0 = NOW() - min(150)
    await apply(a, [start(s1, t0, dw), finish(s1, t0 + min(50))])
    expect(Number((await entry(a, dw, today))?.value_numeric)).toBe(50)
    await apply(a, [start(s2, t0 + min(60), dw), finish(s2, t0 + min(100))])
    expect(Number((await entry(a, dw, today))?.value_numeric)).toBe(90)

    // Manual logging of a fed day is refused, through the RPC and through the table. The derived
    // entry is stamped by the database clock (clock_timestamp()), which may run a few ms ahead of
    // this machine: stamping the manual write from the host clock made the outcome depend on that
    // skew (M3.4d, risk A). Both orders are pinned here, relative to the stored stamp.
    const derivedAt = Date.parse((await entry(a, dw, today))!.client_updated_at)
    expect((await apply(a, [{ type: "entry.set", op_id: opId("e"), habit_id: dw, local_date: today, value: 10, client_updated_at: iso(derivedAt + 1000), base_seq: null }]))[0]).toMatchObject({
      status: "rejected", code: "derived_entry",
    })
    // An older manual write loses to the derived value before reaching the guard: also never applied.
    expect((await apply(a, [{ type: "entry.set", op_id: opId("e"), habit_id: dw, local_date: today, value: 10, client_updated_at: iso(derivedAt - 1), base_seq: null }]))[0]).toMatchObject({
      status: "superseded",
    })
    expect(Number((await entry(a, dw, today))?.value_numeric)).toBe(90)
    const { error } = await a.client.from("habit_entries").update({ value_numeric: 999 }).eq("habit_id", dw).eq("local_date", today)
    expect(error?.message).toBe("derived_entry")

    // Moving a session to the day before the link leaves that manual history untouched.
    const v = (await session(a, s2))!.version
    const yStart = Date.parse(`${yesterday}T09:00:00Z`)
    expect(
      (await apply(a, [{ type: "focus.edit", op_id: opId("fe"), session_id: s2, base_version: v, segments: [{ start: iso(yStart), end: iso(yStart + min(40)) }], habit_id: dw, project: null, planned_output: null, actual_output: null, rating: null }]))[0].status
    ).toBe("applied")
    expect(Number((await entry(a, dw, today))?.value_numeric)).toBe(50)
    expect(Number((await entry(a, dw, yesterday))?.value_numeric)).toBe(30)

    await apply(a, [discard(s1)])
    expect(await entry(a, dw, today)).toBeUndefined()
    // Incremental pulls carry the tombstone so other devices drop the day too.
    const inc = await db((c) => c.query("select deleted_at is not null d, source_activity_type t from public.habit_entries where habit_id = $1 and local_date = $2", [dw, today]))
    expect(inc.rows[0]).toEqual({ d: true, t: "focus_session" })
    // Every op applied exactly once.
    const dup = await db((c) => c.query("select count(*)::int n from (select client_op_id from public.sync_operations where user_id = $1 group by 1 having count(*) > 1) x", [a.id]))
    expect(dup.rows[0].n).toBe(0)
  })

  it("the habit's minutes equal the sum of the sessions' active seconds (Analytics parity)", async () => {
    const id = randomUUID()
    const t0 = NOW() - min(40)
    await apply(a, [start(id, t0, dw), finish(id, t0 + min(25) + 20_000)])
    const sessions = (await pull(a)).focus_sessions.filter((s) => s.habit_id === dw && s.local_date === today && !s.deleted && s.state === "finished")
    const total = sessions.reduce((acc, s) => acc + s.active_seconds, 0)
    expect(Number((await entry(a, dw, today))?.value_numeric)).toBe(Math.round(total / 60))
  })

  it("pull_changes is incremental and carries focus tombstones", async () => {
    const before = (await pull(a)).cursor
    const id = randomUUID()
    await apply(a, [start(id, NOW())])
    const inc1 = await pull(a, before)
    expect(inc1.focus_sessions.map((s) => s.id)).toEqual([id])
    await apply(a, [discard(id)])
    const inc2 = await pull(a, inc1.cursor)
    expect(inc2.focus_sessions).toMatchObject([{ id, deleted: true }])
    expect((await pull(a)).focus_sessions.some((s) => s.id === id)).toBe(false)
  })
})

describe("interruptions (additive column)", () => {
  let u: TestUser
  const s1 = randomUUID()
  const s2 = randomUUID()
  type Row = { id: string; version: number; rating: number | null; interruptions: number | null; segments: unknown[] }
  const row = async (id: string) => (await pull(u)).focus_sessions.find((x) => x.id === id) as unknown as Row
  const edit = (id: string, r: Row, extra: Record<string, unknown> = {}) => ({
    type: "focus.edit", op_id: opId("fe"), session_id: id, base_version: r.version, segments: r.segments, habit_id: null, project: "Tesis",
    planned_output: null, actual_output: null, rating: r.rating, ...extra,
  })

  beforeAll(async () => {
    u = await createTestUser("fi")
  })
  afterAll(async () => {
    await deleteTestUser(u)
  })

  it("a session finished without the key stays not noted, never 0", async () => {
    const t = NOW() - min(200)
    expect((await apply(u, [start(s1, t), finish(s1, t + min(40))])).map((r) => r.status)).toEqual(["applied", "applied"])
    expect((await row(s1)).interruptions).toBeNull()
  })

  it("records the number at the close, keeps it through an edit that does not know the key, and changes it through one that does", async () => {
    const t = NOW() - min(120)
    await apply(u, [start(s2, t), finish(s2, t + min(40), { interruptions: 3 })])
    expect((await row(s2)).interruptions).toBe(3)

    expect((await apply(u, [edit(s2, await row(s2))]))[0].status).toBe("applied")
    expect(await row(s2)).toMatchObject({ interruptions: 3, project: "Tesis" })

    expect((await apply(u, [edit(s2, await row(s2), { interruptions: 0 })]))[0].status).toBe("applied")
    expect((await row(s2)).interruptions).toBe(0)
    expect((await apply(u, [edit(s2, await row(s2), { interruptions: null })]))[0].status).toBe("applied")
    expect((await row(s2)).interruptions).toBeNull()
  })

  it("rejects numbers out of range and leaves the session as it was", async () => {
    const before = await row(s1)
    expect((await apply(u, [edit(s1, before, { interruptions: 100 })]))[0].status).toBe("rejected")
    expect((await apply(u, [edit(s1, before, { interruptions: -1 })]))[0].status).toBe("rejected")
    expect(await row(s1)).toMatchObject({ version: before.version, interruptions: null })
  })
})
