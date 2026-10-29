import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { memoryStorage, NetworkError, SyncEngine, type SyncTransport } from "@/features/sync/engine"
import { supabaseTransport } from "@/features/sync/supabase-transport"
import type { Op } from "@/features/sync/domain/types"
import { reviewKey } from "@/features/reviews/domain/types"
import { addDays, adminClient, anonClient, db, isoWeekday } from "./setup"

/**
 * M3.4c · Life Review sync end to end: the real SyncEngine and the real Supabase transport against
 * the LOCAL PostgreSQL with the M3.4b migration, one user signed in on two devices (two sessions,
 * two engines, two device copies). No fake server: conflicts, closes, deletes and idempotency are
 * decided by the real SQL. Offline is simulated by failing the transport like a dropped network.
 */

interface User {
  id: string
  email: string
  password: string
}

async function createUser(label: string): Promise<User> {
  const email = `it-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@theonepercent.local`
  const password = `pw-${Math.random().toString(36).slice(2)}-A1!`
  await db((c) => c.query("insert into private.allowed_emails (email, note) values ($1, 'integration test')", [email]))
  const { data, error } = await adminClient().auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw error ?? new Error("createUser failed")
  return { id: data.user.id, email, password }
}

async function removeUser(u: User) {
  await adminClient().auth.admin.deleteUser(u.id)
  await db((c) => c.query("delete from private.allowed_emails where email = $1", [u.email]))
}

async function session(u: User): Promise<SupabaseClient> {
  const c = anonClient()
  const s = await c.auth.signInWithPassword({ email: u.email, password: u.password })
  if (s.error) throw s.error
  return c
}

/** The real transport, with a switch that fails like a lost connection and an optional lost answer. */
function switchable(sb: SupabaseClient) {
  const real = supabaseTransport(sb)
  const t = {
    online: true,
    dropNextAnswer: false,
    /** Every op that reached the server, in order. */
    sent: [] as Op[],
    async applyOps(device: string, ops: Op[]) {
      if (!t.online) throw new NetworkError("offline")
      t.sent.push(...ops)
      const res = await real.applyOps(device, ops)
      if (t.dropNextAnswer) {
        t.dropNextAnswer = false
        throw new NetworkError("answer lost")
      }
      return res
    },
    async pull(since: number) {
      if (!t.online) throw new NetworkError("offline")
      return real.pull(since)
    },
  }
  return t satisfies SyncTransport
}

async function device(u: User, storage = memoryStorage()) {
  const transport = switchable(await session(u))
  const engine = new SyncEngine({ transport, storage, deviceId: `it-${randomUUID()}`, schedule: () => () => {} })
  await engine.start()
  return { engine, transport, storage }
}

async function settle(e: SyncEngine) {
  const running = () => (e as unknown as { running: Promise<void> | null }).running
  await e.sync()
  for (let i = 0; i < 20 && running(); i++) await running()
}

async function serverRow(u: User, start: string) {
  return db(
    async (c) =>
      (
        await c.query(
          "select status, content, snapshot, deleted_at is not null as deleted, server_seq from public.reviews where user_id = $1 and kind = 'week' and period_start = $2",
          [u.id, start]
        )
      ).rows[0] ?? null
  )
}

const count = (sql: string, params: unknown[]) => db(async (c) => (await c.query(sql, params)).rows[0].n as number)

let u: User
let week: string
let today: string
const HABIT = randomUUID()
/** A distinct, already finished week for each test. */
const weekAgo = (k: number) => addDays(week, -7 * k)

beforeAll(async () => {
  u = await createUser("reviews-sync")
  const probe = await device(u)
  today = probe.engine.getSnapshot().today
  week = addDays(today, 1 - isoWeekday(today) - 7)
  probe.engine.submit({
    type: "habit.create",
    op_id: randomUUID(),
    habit: { id: HABIT, title: "Leer", icon: "book", dimension: "learn", habit_type: "binary", unit: null, target_value: null, target_direction: null, start_date: addDays(week, -140) },
    versions: [{ valid_from: addDays(week, -140), rule: { kind: "daily" } }],
  })
  await settle(probe.engine)
  probe.engine.stop()
})
afterAll(async () => {
  await removeUser(u)
})

const review = (e: SyncEngine, start: string) => e.getSnapshot().state.reviews[reviewKey("week", start)]

describe("two real devices of one account", () => {
  it("offline edits of different sections converge on one row, without notices", async () => {
    const s = weekAgo(1)
    const a = await device(u)
    const b = await device(u)
    a.transport.online = false
    b.transport.online = false
    expect(a.engine.saveReview("week", s, { "content.wins": "Desde el móvil" })).toEqual({ ok: true })
    expect(b.engine.saveReview("week", s, { "content.struggles": "Desde el ordenador" })).toEqual({ ok: true })
    await settle(a.engine)
    await settle(b.engine)
    expect(a.engine.reviewSyncState("week", s)).toBe("local")
    a.transport.online = true
    b.transport.online = true
    await settle(a.engine)
    await settle(b.engine)
    await settle(a.engine)
    const both = { wins: "Desde el móvil", struggles: "Desde el ordenador" }
    expect((await serverRow(u, s)).content).toEqual(both)
    expect(review(a.engine, s)?.content).toEqual(both)
    expect(review(b.engine, s)?.content).toEqual(both)
    expect(a.engine.getSnapshot().notices).toEqual([])
    expect(b.engine.getSnapshot().notices).toEqual([])
    expect(a.engine.reviewSyncState("week", s)).toBe("synced")
    expect(await count("select count(*)::int n from public.reviews where user_id = $1 and period_start = $2", [u.id, s])).toBe(1)
    a.engine.stop()
    b.engine.stop()
  })

  it("the same section: kept durably across a reopening, «Aplicar la mía» wins and the decision does not come back", async () => {
    const s = weekAgo(2)
    const a = await device(u)
    const b = await device(u)
    a.engine.saveReview("week", s, { "content.wins": "Base" })
    await settle(a.engine)
    await settle(b.engine)
    a.transport.online = false
    a.engine.saveReview("week", s, { "content.wins": "Mío", "content.note": "Nota de A" })
    await settle(a.engine)
    b.engine.saveReview("week", s, { "content.wins": "Suyo" })
    await settle(b.engine)
    a.transport.online = true
    await settle(a.engine)
    expect((await serverRow(u, s)).content).toEqual({ wins: "Suyo", note: "Nota de A" })
    const [notice] = a.engine.getSnapshot().notices
    expect(notice).toMatchObject({ code: "review_field_conflict", op: { fields: { "content.wins": "Mío" } } })
    a.engine.stop()

    const a2 = await device(u, a.storage)
    expect(a2.engine.getSnapshot().notices.map((n) => n.id)).toEqual([notice.id])
    expect(a2.engine.resolveReviewText(notice.id, "content.wins", "mine")).toBe(true)
    await settle(a2.engine)
    await settle(a2.engine)
    expect((await serverRow(u, s)).content).toEqual({ wins: "Mío", note: "Nota de A" })
    expect(a2.engine.getSnapshot().notices).toEqual([])
    await settle(b.engine)
    expect(review(b.engine, s)?.content.wins).toBe("Mío")
    a2.engine.stop()
    const a3 = await device(u, a2.storage)
    await settle(a3.engine)
    expect(a3.engine.getSnapshot().notices).toEqual([])
    a3.engine.stop()
    b.engine.stop()
  })

  it("a lost answer is retried with the same op: applied once", async () => {
    const s = weekAgo(3)
    const a = await device(u)
    a.transport.dropNextAnswer = true
    a.engine.saveReview("week", s, { "content.lessons": "Una vez" })
    await settle(a.engine)
    await settle(a.engine)
    expect((await serverRow(u, s)).content).toEqual({ lessons: "Una vez" })
    // Sent twice with the same op_id (the first answer was lost); the ledger applied it once.
    const saves = a.transport.sent.filter((o) => o.type === "review.save")
    expect(saves).toHaveLength(2)
    expect(saves[1].op_id).toBe(saves[0].op_id)
    expect(await count("select count(*)::int n from public.sync_operations where user_id = $1 and client_op_id = $2", [u.id, saves[0].op_id])).toBe(1)
    expect(a.engine.getSnapshot().pending).toBe(0)
    a.engine.stop()
  })
})

describe("closing against the real server", () => {
  it("online: the real SQL accepts the snapshot (contract), freezes it, and a second device's close changes nothing", async () => {
    const s = weekAgo(4)
    const a = await device(u)
    const b = await device(u)
    a.engine.submit({ type: "entry.set", op_id: randomUUID(), habit_id: HABIT, local_date: addDays(s, 1), value: true, client_updated_at: a.engine.clientTime(), base_seq: null })
    a.engine.saveReview("week", s, { "content.wins": "Constancia" })
    expect(a.engine.requestClose("week", s)).toEqual({ ok: true, deferred: false })
    await settle(a.engine)
    const row = await serverRow(u, s)
    expect(row).toMatchObject({ status: "closed", content: { wins: "Constancia" } })
    expect(row.snapshot.habits.current).toMatchObject({ fulfilled: 1 })
    expect(a.engine.closeIntent("week", s)).toBeUndefined()

    // B had not seen the close: its close is answered already_closed and it converges to A's snapshot.
    expect(b.engine.requestClose("week", s)).toEqual({ ok: true, deferred: false })
    await settle(b.engine)
    expect(await serverRow(u, s)).toEqual(row)
    expect(review(b.engine, s)?.snapshot).toEqual(row.snapshot)
    expect(b.engine.closeIntent("week", s)).toBeUndefined()
    // Immutable from the client.
    expect(b.engine.saveReview("week", s, { "content.wins": "Cambio" })).toEqual({ ok: false, reason: "closed" })
    a.engine.stop()
    b.engine.stop()
  })

  it("offline: waits for the connection; the snapshot includes data another device recorded meanwhile", async () => {
    const s = weekAgo(5)
    const a = await device(u)
    const b = await device(u)
    a.transport.online = false
    await settle(a.engine)
    a.engine.saveReview("week", s, { "content.wins": "Sin conexión" })
    expect(a.engine.requestClose("week", s)).toEqual({ ok: true, deferred: true })
    await settle(a.engine)
    expect(await serverRow(u, s)).toBeNull()
    b.engine.submit({ type: "entry.set", op_id: randomUUID(), habit_id: HABIT, local_date: addDays(s, 2), value: true, client_updated_at: b.engine.clientTime(), base_seq: null })
    await settle(b.engine)
    a.engine.stop()

    const a2 = await device(u, a.storage)
    await settle(a2.engine)
    const row = await serverRow(u, s)
    expect(row).toMatchObject({ status: "closed", content: { wins: "Sin conexión" } })
    expect(row.snapshot.habits.current).toMatchObject({ fulfilled: 1 })
    a2.engine.stop()
    b.engine.stop()
  })

  it("a text written offline after another device closed the review is kept here; the closed review is unchanged", async () => {
    const s = weekAgo(6)
    const a = await device(u)
    const b = await device(u)
    a.engine.saveReview("week", s, { "content.wins": "Base" })
    await settle(a.engine)
    await settle(b.engine)
    a.transport.online = false
    a.engine.saveReview("week", s, { "content.note": "Escrito sin conexión" })
    await settle(a.engine)
    b.engine.requestClose("week", s)
    await settle(b.engine)
    const frozen = await serverRow(u, s)
    expect(frozen.status).toBe("closed")
    a.transport.online = true
    await settle(a.engine)
    expect(await serverRow(u, s)).toEqual(frozen)
    expect(a.engine.getSnapshot().notices).toMatchObject([{ code: "review_closed", op: { fields: { "content.note": "Escrito sin conexión" } } }])
    expect(a.storage.data?.pendingNotes).toHaveLength(1)
    a.engine.stop()
    b.engine.stop()
  })
})

describe("exceptional delete against the real server", () => {
  it("an offline edit made before another device deleted the review does not bring it back", async () => {
    const s = weekAgo(7)
    const a = await device(u)
    const b = await device(u)
    a.engine.saveReview("week", s, { "content.wins": "Original" })
    await settle(a.engine)
    await settle(b.engine)
    a.transport.online = false
    a.engine.saveReview("week", s, { "content.lessons": "Sin conexión" })
    await settle(a.engine)
    expect(b.engine.deleteReview("week", s, "delete")).toEqual({ ok: true })
    await settle(b.engine)
    a.transport.online = true
    await settle(a.engine)
    expect(await serverRow(u, s)).toMatchObject({ deleted: true, content: {} })
    expect(a.engine.getSnapshot().notices).toMatchObject([{ code: "review_deleted", op: { fields: { "content.lessons": "Sin conexión" } } }])
    expect(review(a.engine, s)).toBeUndefined()
    a.engine.stop()
    b.engine.stop()
  })
})
