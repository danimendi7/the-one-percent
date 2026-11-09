import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { makeState } from "@/features/habits/domain/test-helpers"
import { buildReviewSnapshot, type ReviewSnapshot } from "@/features/reviews/domain/snapshot"
import { addDays, adminClient, anonClient, db, isoWeekday, opId } from "./setup"

/**
 * M3.4b · Life Review persistence (supabase/migrations/*_reviews.sql) against real PostgreSQL:
 * RLS, privileges, uniqueness, immutability, idempotency, section conflicts and concurrency.
 * Each user signs in twice: two sessions are two devices. LOCAL stack only.
 */

type Result = { op_id: string; status: string; outcome?: string; code?: string | null; fields?: string[] }
type WireReview = {
  kind: "day" | "week" | "month"
  period_start: string
  period_end: string
  status: "draft" | "closed"
  content: Record<string, string>
  decisions: unknown[]
  evaluations: unknown[]
  field_seqs: Record<string, number>
  snapshot: ReviewSnapshot | null
  metrics_version: number | null
  timezone: string | null
  closed_at: string | null
  deleted: boolean
  server_seq: number
}
type Pull = { server_today: string; cursor: number; profile: { timezone: string }; reviews: WireReview[]; daily_reviews: WireReview[] }

interface User {
  id: string
  email: string
  /** Two devices of the same user. */
  d1: SupabaseClient
  d2: SupabaseClient
}

async function createUser(label: string): Promise<User> {
  const email = `it-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@theonepercent.local`
  const password = `pw-${Math.random().toString(36).slice(2)}-A1!`
  await db((c) => c.query("insert into private.allowed_emails (email, note) values ($1, 'integration test')", [email]))
  const { data, error } = await adminClient().auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw error ?? new Error("createUser failed")
  const device = async () => {
    const c = anonClient()
    const s = await c.auth.signInWithPassword({ email, password })
    if (s.error) throw s.error
    return c
  }
  return { id: data.user.id, email, d1: await device(), d2: await device() }
}

async function removeUser(u: User) {
  await adminClient().auth.admin.deleteUser(u.id)
  await db((c) => c.query("delete from private.allowed_emails where email = $1", [u.email]))
}

async function apply(c: SupabaseClient, ops: unknown[]): Promise<Result[]> {
  const { data, error } = await c.rpc("apply_ops", { p_device_id: "it-reviews", p_ops: ops })
  if (error) throw error
  return (data as { results: Result[] }).results
}
const applyOne = async (c: SupabaseClient, op: unknown) => (await apply(c, [op]))[0]

async function pull(c: SupabaseClient, since = 0): Promise<Pull> {
  const { data, error } = await c.rpc("pull_changes", { p_since: since })
  if (error) throw error
  return data as Pull
}

const save = (kind: string, start: string, fields: Record<string, unknown>, base_seqs: Record<string, number | null> = {}) => ({
  type: "review.save",
  op_id: opId("rv-save"),
  kind,
  period_start: start,
  fields,
  base_seqs,
  at: new Date().toISOString(),
})
const close = (kind: string, start: string, snapshot: unknown, based_on_cursor: number, base_seq: number | null) => ({
  type: "review.close",
  op_id: opId("rv-close"),
  kind,
  period_start: start,
  snapshot,
  based_on_cursor,
  base_seq,
})
const del = (kind: string, start: string, base_seq: number | null, confirm: string | null = "delete") => ({
  type: "review.delete",
  op_id: opId("rv-del"),
  kind,
  period_start: start,
  base_seq,
  ...(confirm ? { confirm } : {}),
})

const UUID = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"]
const decision = (i: number, p: Record<string, unknown> = {}) => ({ id: UUID[i], text: `Decisión ${i}`, kind: "keep", expected: null, link: null, ...p })

let a: User
let b: User
let today: string
let tz: string
/** Monday of the week before the current one (already over) and the one before it. */
let week: string
let prevWeek: string
let month: string

const one = async (c: SupabaseClient, kind: string, start: string, since = 0) => (await pull(c, since)).reviews.find((r) => r.kind === kind && r.period_start === start) ?? null
const snapshotFor = (kind: "day" | "week" | "month", start: string) =>
  buildReviewSnapshot({ state: { ...makeState([]), timezone: tz }, kind, periodStart: start, today, computedAt: new Date().toISOString() })

beforeAll(async () => {
  a = await createUser("reviews-a")
  b = await createUser("reviews-b")
  const p = await pull(a.d1)
  today = p.server_today
  tz = p.profile.timezone
  week = addDays(today, 1 - isoWeekday(today) - 7)
  prevWeek = addDays(week, -7)
  const m = new Date(`${today.slice(0, 7)}-01T00:00:00Z`)
  m.setUTCMonth(m.getUTCMonth() - 1)
  month = m.toISOString().slice(0, 10)
})
afterAll(async () => {
  await removeUser(a)
  await removeUser(b)
})

describe("identity and uniqueness (D49)", () => {
  it("a save creates one draft; a replayed op applies once; the table itself refuses a duplicate", async () => {
    const op = save("week", week, { "content.wins": "  Terminé el informe  " })
    expect(await applyOne(a.d1, op)).toMatchObject({ status: "applied" })
    expect(await applyOne(a.d1, op)).toMatchObject({ status: "duplicate", outcome: "applied" })
    const r = (await one(a.d1, "week", week))!
    expect(r).toMatchObject({ status: "draft", content: { wins: "Terminé el informe" }, period_end: addDays(week, 6), deleted: false })
    expect(r.field_seqs["content.wins"]).toBe(r.server_seq)
    // A real UNIQUE constraint: even an authorized write path cannot add a second row.
    await expect(
      db(async (c) => {
        await c.query("begin")
        try {
          await c.query("select set_config('top.review_op', 'on', true)")
          await c.query("insert into public.reviews (user_id, kind, period_start, period_end) values ($1, 'week', $2, $3)", [a.id, week, addDays(week, 6)])
        } finally {
          await c.query("rollback")
        }
      })
    ).rejects.toThrow(/reviews_one_per_period|duplicate key/)
  })

  it("only a Monday (week) or a 1st (month) starts a period, and only once its last day is reached", async () => {
    expect(await applyOne(a.d1, save("week", addDays(week, 1), { "content.wins": "x" }))).toMatchObject({ status: "rejected", code: "invalid_period" })
    expect(await applyOne(a.d1, save("month", addDays(month, 1), { "content.pattern": "x" }))).toMatchObject({ status: "rejected", code: "invalid_period" })
    const current = addDays(today, 1 - isoWeekday(today))
    const r = await applyOne(a.d1, save("week", current, { "content.wins": "x" }))
    if (addDays(current, 6) > today) expect(r).toMatchObject({ status: "rejected", code: "not_available" })
    expect(await applyOne(a.d1, save("week", "2026-13-01", { "content.wins": "x" }))).toMatchObject({ status: "rejected", code: "invalid_period" })
  })

  it("two devices creating the same review at the same time end on one row with both sections", async () => {
    const start = addDays(week, -21)
    const [r1, r2] = await Promise.all([
      applyOne(a.d1, save("week", start, { "content.wins": "Desde el móvil" })),
      applyOne(a.d2, save("week", start, { "content.lessons": "Desde el portátil" })),
    ])
    expect([r1.status, r2.status]).toEqual(["applied", "applied"])
    const rows = await db(async (c) => (await c.query("select content from public.reviews where user_id = $1 and kind = 'week' and period_start = $2", [a.id, start])).rows)
    expect(rows).toHaveLength(1)
    expect(rows[0].content).toEqual({ wins: "Desde el móvil", lessons: "Desde el portátil" })
  })
})

describe("security: RLS, privileges and writes only through the operations", () => {
  it("anon can neither read nor call the operations", async () => {
    const anon = anonClient()
    const { data } = await anon.from("reviews").select("*")
    expect(data ?? []).toEqual([])
    const rpc = await anon.rpc("apply_ops", { p_device_id: "x", p_ops: [save("week", week, { "content.wins": "x" })] })
    expect(rpc.error).not.toBeNull()
    const privileges = await db(async (c) => (await c.query("select has_table_privilege('anon', 'public.reviews', 'select') s, has_table_privilege('anon', 'public.reviews', 'insert') i")).rows[0])
    expect(privileges).toEqual({ s: false, i: false })
  })

  it("direct API writes are refused, even on the user's own rows (no closed review can be forged)", async () => {
    const forged = await a.d1.from("reviews").insert({ kind: "week", period_start: addDays(week, -70), period_end: addDays(week, -64), status: "closed" })
    expect(forged.error?.message).toMatch(/reviews_via_ops_only/)
    const upd = await a.d1.from("reviews").update({ content: { wins: "hackeado" } }).eq("kind", "week").eq("period_start", week).select()
    expect(upd.error?.message).toMatch(/reviews_via_ops_only/)
    const rm = await a.d1.from("reviews").delete().eq("kind", "week").eq("period_start", week).select()
    expect(rm.error).not.toBeNull()
    expect((await one(a.d1, "week", week))!.content).toEqual({ wins: "Terminé el informe" })
  })

  it("another account sees nothing, cannot touch it and cannot link to its habits", async () => {
    expect((await b.d1.from("reviews").select("*")).data).toEqual([])
    expect((await pull(b.d1)).reviews).toEqual([])
    // The same period for B is B's own review: identity includes the user.
    expect(await applyOne(b.d1, save("week", week, { "content.wins": "La mía" }))).toMatchObject({ status: "applied" })
    expect((await one(a.d1, "week", week))!.content).toEqual({ wins: "Terminé el informe" })
    // A decision cannot point to another user's habit.
    const habitId = crypto.randomUUID()
    expect(
      await applyOne(a.d1, {
        type: "habit.create",
        op_id: opId("habit"),
        habit: { id: habitId, title: "Leer", icon: "book", dimension: "learn", habit_type: "binary", unit: null, target_value: null, target_direction: null, start_date: today },
        versions: [{ valid_from: today, rule: { kind: "daily" } }],
      })
    ).toMatchObject({ status: "applied" })
    const link = { type: "habit", id: habitId, title: "Leer" }
    expect(await applyOne(b.d1, save("week", week, { decisions: [decision(0, { link })] }, { decisions: null }))).toMatchObject({ status: "rejected", code: "invalid_link" })
    expect(await applyOne(a.d1, save("week", week, { decisions: [decision(0, { link, kind: "start", expected: "5 de 7 días" })] }))).toMatchObject({ status: "applied" })
  })

  it("the audit log records section names, never the text", async () => {
    const logs = await db(async (c) => (await c.query("select metadata_json::text m from public.audit_logs where user_id = $1 and entity_type = 'review'", [a.id])).rows)
    expect(logs.length).toBeGreaterThan(0)
    expect(logs.map((l) => l.m).join(" ")).not.toMatch(/Terminé|móvil|portátil/)
  })
})

describe("section conflicts (decision 5)", () => {
  const start = () => addDays(week, -28)

  it("different sections from two devices merge; the same section with a stale base conflicts, all or nothing", async () => {
    expect(await applyOne(a.d1, save("week", start(), { "content.wins": "Móvil" }, { "content.wins": null }))).toMatchObject({ status: "applied" })
    const r1 = (await one(a.d2, "week", start()))!
    // Device 2 never saw device 1's answer: base null on the same section → conflict, nothing applied.
    expect(await applyOne(a.d2, save("week", start(), { "content.wins": "Portátil", "content.lessons": "Algo" }, { "content.wins": null, "content.lessons": null }))).toMatchObject({
      status: "conflict",
      code: "review_field_conflict",
      fields: ["content.wins"],
    })
    expect((await one(a.d1, "week", start()))!.content).toEqual({ wins: "Móvil" })
    // The other section alone goes through; the same text with a stale base is no conflict.
    expect(await applyOne(a.d2, save("week", start(), { "content.lessons": "Algo" }, { "content.lessons": null }))).toMatchObject({ status: "applied" })
    expect(await applyOne(a.d2, save("week", start(), { "content.wins": "Móvil" }, { "content.wins": null }))).toMatchObject({ status: "applied" })
    // With the right base the edit wins.
    expect(await applyOne(a.d2, save("week", start(), { "content.wins": "Portátil" }, { "content.wins": r1.field_seqs["content.wins"] }))).toMatchObject({ status: "applied" })
    expect((await one(a.d1, "week", start()))!.content).toEqual({ wins: "Portátil", lessons: "Algo" })
  })

  it("a replayed conflicting op answers the same, with its sections", async () => {
    const op = save("week", start(), { "content.wins": "Otra" }, { "content.wins": null })
    const first = await applyOne(a.d1, op)
    expect(first).toMatchObject({ status: "conflict", fields: ["content.wins"] })
    expect(await applyOne(a.d1, op)).toMatchObject({ status: "duplicate", outcome: "conflict", code: "review_field_conflict", fields: ["content.wins"] })
  })

  it("validates content, decisions and evaluations like the domain", async () => {
    const s = start()
    expect(await applyOne(a.d1, save("week", s, { "content.pattern": "x" }))).toMatchObject({ status: "rejected", code: "invalid_value" })
    expect(await applyOne(a.d1, save("week", s, { "content.struggles": "a".repeat(601) }))).toMatchObject({ status: "rejected", code: "invalid_value" })
    expect(await applyOne(a.d1, save("week", s, { decisions: [0, 1, 2, 3].map((i) => decision(i)) }))).toMatchObject({ status: "rejected", code: "invalid_value" })
    expect(await applyOne(a.d1, save("week", s, { decisions: [decision(0, { kind: "pause" })] }))).toMatchObject({ status: "rejected", code: "invalid_value" })
    const evaluation = { decisionId: UUID[0], from: addDays(s, -7), outcome: "done", note: null }
    expect(await applyOne(a.d1, save("week", s, { evaluations: [{ ...evaluation, from: addDays(s, -14) }] }))).toMatchObject({ status: "rejected", code: "invalid_value" })
    expect(await applyOne(a.d1, save("week", s, { evaluations: [evaluation] }))).toMatchObject({ status: "applied" })
    // An empty answer clears it.
    expect(await applyOne(a.d2, save("week", s, { "content.lessons": "   " }, { "content.lessons": (await one(a.d2, "week", s))!.field_seqs["content.lessons"] }))).toMatchObject({ status: "applied" })
    expect((await one(a.d1, "week", s))!.content).toEqual({ wins: "Portátil" })
  })
})

describe("closing (decisions 1, 2 and 4)", () => {
  it("needs a snapshot computed after the latest data change; then freezes it with the server clock", async () => {
    const r = (await one(a.d1, "week", week))!
    const p = await pull(a.d1)
    const snap = snapshotFor("week", week)
    // Data changed after this cursor (a check-in written from another device): stale.
    await apply(a.d2, [{ type: "checkin.set", op_id: opId("ci"), local_date: today, phase: "am", fields: { energy: 3 }, at: new Date().toISOString(), base_note_seq: null }])
    expect(await applyOne(a.d1, close("week", week, snap, p.cursor, r.server_seq))).toMatchObject({ status: "conflict", code: "stale_snapshot" })
    const fresh = await pull(a.d1)
    const before = Date.now()
    expect(await applyOne(a.d1, close("week", week, snap, fresh.cursor, r.server_seq))).toMatchObject({ status: "applied" })
    const closed = (await one(a.d1, "week", week))!
    expect(closed).toMatchObject({ status: "closed", metrics_version: snap.metricsVersion, timezone: tz })
    expect(closed.snapshot).toEqual(snap)
    expect(Date.parse(closed.closed_at!)).toBeGreaterThanOrEqual(before - 5_000)
  })

  it("a late or replayed edit never changes or reopens a closed review", async () => {
    const r = (await one(a.d1, "week", week))!
    expect(await applyOne(a.d2, save("week", week, { "content.wins": "Tarde" }, { "content.wins": r.field_seqs["content.wins"] }))).toMatchObject({ status: "rejected", code: "review_closed" })
    // Not even an authorized write path can change it: only the explicit delete is accepted.
    await expect(
      db(async (c) => {
        await c.query("begin")
        try {
          await c.query("select set_config('top.review_op', 'on', true)")
          await c.query("update public.reviews set status = 'draft', snapshot = null where user_id = $1 and kind = 'week' and period_start = $2", [a.id, week])
        } finally {
          await c.query("rollback")
        }
      })
    ).rejects.toThrow(/review_closed/)
    // And without the flag nothing writes at all, not even the table owner.
    await expect(db((c) => c.query("update public.reviews set content = '{}' where user_id = $1", [a.id]))).rejects.toThrow(/reviews_via_ops_only/)
    expect((await one(a.d1, "week", week))!).toMatchObject({ status: "closed", content: { wins: "Terminé el informe" } })
  })

  it("the first close wins: a repeated close changes nothing", async () => {
    const r = (await one(a.d1, "week", week))!
    const p = await pull(a.d1)
    const other = { ...snapshotFor("week", week), computedAt: "2030-01-01T00:00:00.000Z" }
    expect(await applyOne(a.d2, close("week", week, other, p.cursor, r.server_seq))).toMatchObject({ status: "superseded", code: "already_closed" })
    expect((await one(a.d1, "week", week))!.snapshot).toEqual(r.snapshot)
  })

  it("two devices closing at the same time: exactly one close applies", async () => {
    const start = addDays(week, -35)
    await applyOne(a.d1, save("week", start, { "content.wins": "Concurrente" }))
    const r = (await one(a.d1, "week", start))!
    const p = await pull(a.d1)
    const s1 = { ...snapshotFor("week", start), computedAt: "2026-01-01T00:00:01.000Z" }
    const s2 = { ...snapshotFor("week", start), computedAt: "2026-01-01T00:00:02.000Z" }
    const results = await Promise.all([applyOne(a.d1, close("week", start, s1, p.cursor, r.server_seq)), applyOne(a.d2, close("week", start, s2, p.cursor, r.server_seq))])
    expect(results.map((x) => x.status).sort()).toEqual(["applied", "superseded"])
    const winner = results[0].status === "applied" ? s1 : s2
    expect((await one(a.d1, "week", start))!.snapshot).toEqual(winner)
  })

  it("closes exactly the version the user saw, and refuses a foreign or malformed snapshot", async () => {
    const start = addDays(week, -42)
    await applyOne(a.d1, save("week", start, { "content.wins": "v1" }))
    const r = (await one(a.d1, "week", start))!
    await applyOne(a.d2, save("week", start, { "content.lessons": "otro dispositivo" }))
    const p = await pull(a.d1)
    const snap = snapshotFor("week", start)
    expect(await applyOne(a.d1, close("week", start, snap, p.cursor, r.server_seq))).toMatchObject({ status: "conflict", code: "review_changed" })
    const seen = (await one(a.d1, "week", start))!.server_seq
    expect(await applyOne(a.d1, close("week", start, snapshotFor("week", prevWeek), p.cursor, seen))).toMatchObject({ status: "rejected", code: "invalid_snapshot" })
    expect(await applyOne(a.d1, close("week", start, { ...snap, v: 2 }, p.cursor, seen))).toMatchObject({ status: "rejected", code: "invalid_snapshot" })
    expect(await applyOne(a.d1, close("week", start, { ...snap, timezone: "America/New_York" }, p.cursor, seen))).toMatchObject({ status: "conflict", code: "stale_snapshot" })
    expect(await applyOne(a.d1, { ...close("week", start, snap, p.cursor, seen), based_on_cursor: null })).toMatchObject({ status: "rejected", code: "invalid_value" })
    expect((await one(a.d1, "week", start))!.status).toBe("draft")
  })

  it("a review with no text can be closed (sections are optional); a monthly one needs its weekly rows", async () => {
    const p = await pull(a.d1)
    expect(await applyOne(a.d1, close("month", month, snapshotFor("month", month), p.cursor, null))).toMatchObject({ status: "applied" })
    expect((await one(a.d1, "month", month))!).toMatchObject({ status: "closed", content: {} })
    const noWeekly: Partial<ReviewSnapshot> = snapshotFor("month", month)
    delete noWeekly.weekly
    const p2 = await pull(b.d1)
    expect(await applyOne(b.d1, close("month", month, noWeekly, p2.cursor, null))).toMatchObject({ status: "rejected", code: "invalid_snapshot" })
  })
})

describe("exceptional delete (D52): explicit, confirmed, never automatic", () => {
  const start = () => addDays(week, -49)

  it("needs the confirmation and the exact version; it removes the content and leaves a tombstone", async () => {
    await applyOne(a.d1, save("week", start(), { "content.wins": "Para borrar" }))
    const r = (await one(a.d1, "week", start()))!
    expect(await applyOne(a.d1, del("week", start(), r.server_seq, null))).toMatchObject({ status: "rejected", code: "confirmation_required" })
    expect(await applyOne(a.d1, del("week", start(), r.server_seq - 1))).toMatchObject({ status: "conflict", code: "review_changed" })
    const cursor = (await pull(a.d1)).cursor
    expect(await applyOne(a.d1, del("week", start(), r.server_seq))).toMatchObject({ status: "applied" })
    expect(await one(a.d1, "week", start())).toBeNull()
    expect(await one(a.d1, "week", start(), cursor)).toMatchObject({ deleted: true, content: {}, decisions: [], status: "draft" })
    const row = await db(async (c) => (await c.query("select content, snapshot from public.reviews where user_id = $1 and kind = 'week' and period_start = $2", [a.id, start()])).rows[0])
    expect(row).toEqual({ content: {}, snapshot: null })
  })

  it("an edit written before the delete does not bring it back; a new edit starts a fresh draft", async () => {
    expect(await applyOne(a.d2, save("week", start(), { "content.wins": "Antiguo" }, { "content.wins": 123 }))).toMatchObject({ status: "conflict", code: "review_deleted" })
    expect(await applyOne(a.d2, save("week", start(), { "content.wins": "Nuevo" }, { "content.wins": null }))).toMatchObject({ status: "applied" })
    expect((await one(a.d1, "week", start()))!).toMatchObject({ status: "draft", content: { wins: "Nuevo" }, deleted: false })
  })

  it("M3.4c: a deleted review can be closed again by a device that never saw its tombstone (full pull), not with the version before the delete", async () => {
    const s = addDays(week, -63)
    await applyOne(a.d1, save("week", s, { "content.wins": "Se borrará" }))
    const before = (await one(a.d1, "week", s))!
    expect(await applyOne(a.d1, del("week", s, before.server_seq))).toMatchObject({ status: "applied" })
    // An edit made by a device that had seen the review (base 0: review seen, section unwritten) does not revive it.
    expect(await applyOne(a.d2, save("week", s, { "content.lessons": "Tarde" }, { "content.lessons": 0 }))).toMatchObject({ status: "conflict", code: "review_deleted" })
    const full = await pull(a.d2)
    expect(full.reviews.find((r) => r.kind === "week" && r.period_start === s)).toBeUndefined()
    expect(await applyOne(a.d2, close("week", s, snapshotFor("week", s), full.cursor, before.server_seq))).toMatchObject({ status: "conflict", code: "review_changed" })
    expect(await applyOne(a.d2, close("week", s, snapshotFor("week", s), full.cursor, null))).toMatchObject({ status: "applied" })
    expect((await one(a.d1, "week", s))!).toMatchObject({ status: "closed", content: {}, deleted: false })
  })

  it("a closed review can only be deleted explicitly; a delete of an unknown review changes nothing", async () => {
    const r = (await one(a.d1, "month", month))!
    expect(await applyOne(a.d1, del("month", month, r.server_seq))).toMatchObject({ status: "applied" })
    expect(await one(a.d1, "month", month)).toBeNull()
    expect(await applyOne(a.d1, del("week", addDays(week, -350), null))).toMatchObject({ status: "applied" })
    expect(await db(async (c) => (await c.query("select count(*)::int n from public.reviews where user_id = $1 and period_start = $2", [a.id, addDays(week, -350)])).rows[0].n)).toBe(0)
  })
})

describe("pull_changes and the cursor", () => {
  it("sends reviews incrementally with their section versions; the cursor covers them", async () => {
    const p0 = await pull(a.d1)
    expect(p0.cursor).toBeGreaterThanOrEqual(Math.max(...p0.reviews.map((r) => r.server_seq)))
    const start = addDays(week, -56)
    await applyOne(a.d1, save("week", start, { "content.struggles": "Incremental" }))
    const p1 = await pull(a.d2, p0.cursor)
    expect(p1.reviews.map((r) => r.period_start)).toEqual([start])
    expect(p1.reviews[0].field_seqs["content.struggles"]).toBe(p1.reviews[0].server_seq)
    expect(p1.cursor).toBeGreaterThan(p0.cursor)
  })
})

describe("daily reviews (C5)", () => {
  const day = (c: SupabaseClient, date: string, since = 0) => pull(c, since).then((p) => p.daily_reviews.find((r) => r.period_start === date) ?? null)
  /** A past day far from the dates the other describes write on. */
  const past = (n: number) => addDays(today, -n)

  it("today and any past day are a period of one date; tomorrow and a non-date are not", async () => {
    expect(await applyOne(a.d1, save("day", today, { "content.observations": "  Dormí poco  ", "content.adjustments": "Acostarme antes" }))).toMatchObject({ status: "applied" })
    expect((await day(a.d1, today))!).toMatchObject({ kind: "day", status: "draft", period_start: today, period_end: today, content: { observations: "Dormí poco", adjustments: "Acostarme antes" } })
    expect(await applyOne(a.d1, save("day", addDays(today, 1), { "content.observations": "x" }))).toMatchObject({ status: "rejected", code: "not_available" })
    expect(await applyOne(a.d1, save("day", "2026-13-01", { "content.observations": "x" }))).toMatchObject({ status: "rejected", code: "invalid_period" })
  })

  it("the table itself allows a single date and one review per day", async () => {
    const attempt = (date: string, end: string) =>
      db(async (c) => {
        await c.query("begin")
        try {
          await c.query("select set_config('top.review_op', 'on', true)")
          await c.query("insert into public.reviews (user_id, kind, period_start, period_end) values ($1, 'day', $2, $3)", [a.id, date, end])
        } finally {
          await c.query("rollback")
        }
      })
    await expect(attempt(past(500), past(499))).rejects.toThrow(/reviews_day_period/)
    await expect(attempt(today, today)).rejects.toThrow(/reviews_one_per_period|duplicate key/)
  })

  it("takes only its two questions: no free note, no answers of another kind, no decisions", async () => {
    const d = past(510)
    expect(await applyOne(a.d1, save("day", d, { "content.note": "Libre" }))).toMatchObject({ status: "rejected", code: "invalid_value" })
    expect(await applyOne(a.d1, save("day", d, { "content.wins": "Semanal" }))).toMatchObject({ status: "rejected", code: "invalid_value" })
    expect(await applyOne(a.d1, save("day", d, { "content.observations": "x".repeat(601) }))).toMatchObject({ status: "rejected" })
    expect(await applyOne(a.d1, save("day", d, { decisions: [decision(0)] }))).toMatchObject({ status: "rejected" })
    expect(await day(a.d1, d)).toBeNull()
  })

  it("is written only through the operations, and only its owner sees it", async () => {
    const d = past(520)
    await applyOne(a.d1, save("day", d, { "content.observations": "Privado" }))
    const { error } = await a.d1.from("reviews").update({ content: { observations: "Directo" } }).eq("kind", "day").eq("period_start", d)
    expect(error?.message).toMatch(/reviews_via_ops_only/)
    expect((await day(a.d1, d))!.content).toEqual({ observations: "Privado" })
    expect(await day(b.d1, d)).toBeNull()
    const { data } = await b.d1.from("reviews").select("id").eq("kind", "day").eq("period_start", d)
    expect(data).toEqual([])
  })

  it("two devices editing different questions end on one row with both", async () => {
    const d = past(530)
    const [r1, r2] = await Promise.all([applyOne(a.d1, save("day", d, { "content.observations": "Móvil" })), applyOne(a.d2, save("day", d, { "content.adjustments": "Portátil" }))])
    expect([r1.status, r2.status]).toEqual(["applied", "applied"])
    expect((await day(a.d1, d))!.content).toEqual({ observations: "Móvil", adjustments: "Portátil" })
  })

  it("closes once with frozen figures and then refuses any edit", async () => {
    const d = past(540)
    await applyOne(a.d1, save("day", d, { "content.observations": "Buen día" }))
    const r = (await day(a.d1, d))!
    const cursor = (await pull(a.d1)).cursor
    expect(await applyOne(a.d1, close("day", d, snapshotFor("day", d), cursor, r.server_seq))).toMatchObject({ status: "applied" })
    expect((await day(a.d1, d))!).toMatchObject({ status: "closed", content: { observations: "Buen día" }, snapshot: { kind: "day", goals: [] } })
    expect(await applyOne(a.d1, close("day", d, snapshotFor("day", d), cursor, r.server_seq))).toMatchObject({ status: "superseded", code: "already_closed" })
    expect(await applyOne(a.d1, save("day", d, { "content.observations": "Tarde" }))).toMatchObject({ status: "rejected", code: "review_closed" })
  })

  it("a snapshot of another kind or day cannot close it", async () => {
    const d = past(550)
    await applyOne(a.d1, save("day", d, { "content.observations": "x" }))
    const r = (await day(a.d1, d))!
    const cursor = (await pull(a.d1)).cursor
    expect(await applyOne(a.d1, close("day", d, snapshotFor("day", addDays(d, -1)), cursor, r.server_seq))).toMatchObject({ status: "rejected", code: "invalid_snapshot" })
    expect(await applyOne(a.d1, close("day", d, snapshotFor("week", addDays(today, 1 - isoWeekday(today) - 7)), cursor, r.server_seq))).toMatchObject({ status: "rejected", code: "invalid_snapshot" })
  })

  it("can be deleted explicitly and stays gone on a full pull", async () => {
    const d = past(560)
    await applyOne(a.d1, save("day", d, { "content.observations": "Para borrar" }))
    const r = (await day(a.d1, d))!
    expect(await applyOne(a.d1, del("day", d, r.server_seq))).toMatchObject({ status: "applied" })
    expect(await day(a.d2, d)).toBeNull()
  })

  it("travels only under daily_reviews, incrementally: a published client never receives one", async () => {
    const p0 = await pull(a.d1)
    expect(p0.reviews.some((r) => (r.kind as string) === "day")).toBe(false)
    expect(p0.daily_reviews.length).toBeGreaterThan(0)
    const d = past(570)
    await applyOne(a.d1, save("day", d, { "content.adjustments": "Incremental" }))
    const p1 = await pull(a.d2, p0.cursor)
    expect(p1.daily_reviews.map((r) => r.period_start)).toEqual([d])
    expect(p1.reviews).toEqual([])
    expect(p1.cursor).toBeGreaterThan(p0.cursor)
  })

  it("leaves earlier reviews intact: writing and closing days changes no week or month", async () => {
    const start = addDays(week, -84)
    await applyOne(a.d1, save("week", start, { "content.wins": "Semana anterior", "content.note": "Se queda" }, {}))
    const prior = await db(async (c) => (await c.query("select kind, period_start, content, decisions, evaluations, status, snapshot, version, server_seq from public.reviews where user_id = $1 and kind <> 'day' order by kind, period_start", [a.id])).rows)
    expect(prior.length).toBeGreaterThan(0)

    const d = past(580)
    await applyOne(a.d1, save("day", d, { "content.observations": "Un día más" }))
    const r = (await day(a.d1, d))!
    const cursor = (await pull(a.d1)).cursor
    expect(await applyOne(a.d1, close("day", d, snapshotFor("day", d), cursor, r.server_seq))).toMatchObject({ status: "applied" })

    const after = await db(async (c) => (await c.query("select kind, period_start, content, decisions, evaluations, status, snapshot, version, server_seq from public.reviews where user_id = $1 and kind <> 'day' order by kind, period_start", [a.id])).rows)
    expect(after).toEqual(prior)
  })
})

