import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { randomUUID } from "node:crypto"
import { newSchedule, nextSchedule, type Grade, type Schedule } from "@/features/recall/domain/schedule"
import { addDays, adminClient, anonClient, db, opId } from "./setup"

/** D2 · Active Recall persistence against real PostgreSQL: RLS, writes only through operations, two devices. LOCAL stack only. */

type Result = { op_id: string; status: string; outcome?: string; code?: string | null }
type Card = { id: string; question: string; answer: string; state: string; reps: number; lapses: number; ease_factor: number; interval_days: number; due_on: string; suspended_on: string | null; first_answered_on: string | null; deleted: boolean; server_seq: number; source_type: string | null; source_id: string | null }
type Attempt = { id: string; card_id: string; grade: string; local_date: string; due_on_before: string; due_on_after: string; server_seq: number }
type Pull = { server_today: string; cursor: number; recall_cards: Card[]; recall_attempts: Attempt[] }

interface User {
  id: string
  email: string
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

async function applyOne(c: SupabaseClient, op: unknown): Promise<Result> {
  const { data, error } = await c.rpc("apply_ops", { p_device_id: "it-recall", p_ops: [op] })
  if (error) throw error
  return (data as { results: Result[] }).results[0]
}

async function pull(c: SupabaseClient, since = 0): Promise<Pull> {
  const { data, error } = await c.rpc("pull_changes", { p_since: since })
  if (error) throw error
  return data as Pull
}

let a: User
let b: User
let today: string

const create = (id: string, p: Record<string, unknown> = {}) => ({
  type: "recall.create",
  op_id: opId("rc"),
  card: { id, question: "¿Qué es?", answer: "Esto", source_type: null, source_id: null, ...p },
  local_date: today,
  algorithm_version: 1,
  at: new Date().toISOString(),
})
function wire(s: Schedule) {
  return { state: s.state, reps: s.reps, lapses: s.lapses, ease_factor: s.easeFactor, interval_days: s.intervalDays, due_on: s.dueOn }
}
const answer = (cardId: string, grade: Grade, p: Record<string, unknown> = {}) => ({
  type: "recall.answer",
  op_id: opId("ra"),
  card_id: cardId,
  attempt_id: randomUUID(),
  grade,
  responded_at: new Date().toISOString(),
  local_date: today,
  due_on_before: today,
  algorithm_version: 1,
  schedule: wire(nextSchedule(newSchedule(today), grade, today)),
  ...p,
})
const card = async (c: SupabaseClient, id: string, since = 0) => (await pull(c, since)).recall_cards.find((r) => r.id === id) ?? null
const attemptsOf = async (c: SupabaseClient, id: string) => (await pull(c)).recall_attempts.filter((r) => r.card_id === id)
async function newCard(p: Record<string, unknown> = {}) {
  const id = randomUUID()
  expect(await applyOne(a.d1, create(id, p))).toMatchObject({ status: "applied" })
  return id
}

beforeAll(async () => {
  a = await createUser("recall-a")
  b = await createUser("recall-b")
  today = (await pull(a.d1)).server_today
})
afterAll(async () => {
  await removeUser(a)
  await removeUser(b)
})

describe("creating and answering", () => {
  it("creates a card, new and due that day, with its text trimmed and its origin; a replay applies once", async () => {
    const id = randomUUID()
    const note = randomUUID()
    const op = create(id, { question: "  ¿Por qué?  ", answer: " Porque ", source_type: "note", source_id: note })
    expect(await applyOne(a.d1, op)).toMatchObject({ status: "applied" })
    expect(await applyOne(a.d1, op)).toMatchObject({ status: "duplicate", outcome: "applied" })
    expect(await card(a.d2, id)).toMatchObject({ question: "¿Por qué?", answer: "Porque", state: "new", reps: 0, ease_factor: 2.5, interval_days: 0, due_on: today, source_type: "note", source_id: note, deleted: false })
    expect(await db(async (c) => (await c.query("select count(*)::int n from public.recall_cards where id = $1", [id])).rows[0].n)).toBe(1)
  })

  it("an answer moves the card to the date computed and keeps the attempt", async () => {
    const id = await newCard()
    expect(await applyOne(a.d1, answer(id, "easy"))).toMatchObject({ status: "applied" })
    expect(await card(a.d1, id)).toMatchObject({ state: "review", reps: 1, interval_days: 4, due_on: addDays(today, 4), first_answered_on: today })
    expect(await attemptsOf(a.d1, id)).toMatchObject([{ grade: "easy", due_on_before: today, due_on_after: addDays(today, 4) }])
  })

  it("two devices answering the same card keep both attempts, and the latest answer sets the date", async () => {
    const id = await newCard()
    const later = new Date(Date.now() - 1000).toISOString()
    const earlier = new Date(Date.now() - 60_000).toISOString()
    expect(await applyOne(a.d1, answer(id, "good", { responded_at: later }))).toMatchObject({ status: "applied" })
    expect(await applyOne(a.d2, answer(id, "again", { responded_at: earlier }))).toMatchObject({ status: "applied" })
    expect(await card(a.d1, id)).toMatchObject({ state: "review", interval_days: 1, due_on: addDays(today, 1) })
    expect((await attemptsOf(a.d1, id)).map((t) => t.grade).sort()).toEqual(["again", "good"])
  })

  it("the same attempt under another operation is stored once", async () => {
    const id = await newCard()
    const attempt_id = randomUUID()
    await applyOne(a.d1, answer(id, "good", { attempt_id }))
    expect(await applyOne(a.d1, answer(id, "good", { attempt_id }))).toMatchObject({ status: "applied" })
    expect(await attemptsOf(a.d1, id)).toHaveLength(1)
  })

  it("an answer whose clock runs ahead is stored at the present, not in the future", async () => {
    const id = await newCard()
    await applyOne(a.d1, answer(id, "good", { responded_at: new Date(Date.now() + 86_400_000).toISOString() }))
    const at = await db(async (c) => (await c.query("select responded_at from public.recall_attempts where card_id = $1", [id])).rows[0].responded_at as Date)
    expect(at.getTime()).toBeLessThan(Date.now() + 120_000)
  })
})

describe("what the server refuses", () => {
  const rejected = { status: "rejected" }

  it("empty or oversized text, a future day and an unknown origin", async () => {
    expect(await applyOne(a.d1, create(randomUUID(), { question: "   " }))).toMatchObject({ status: "rejected", code: "invalid_value" })
    expect(await applyOne(a.d1, create(randomUUID(), { answer: "" }))).toMatchObject({ status: "rejected", code: "invalid_value" })
    expect(await applyOne(a.d1, create(randomUUID(), { question: "x".repeat(501) }))).toMatchObject(rejected)
    expect(await applyOne(a.d1, create(randomUUID(), { answer: "x".repeat(2001) }))).toMatchObject(rejected)
    expect(await applyOne(a.d1, { ...create(randomUUID()), local_date: addDays(today, 2) })).toMatchObject({ status: "rejected", code: "invalid_value" })
    expect(await applyOne(a.d1, create(randomUUID(), { source_type: "book", source_id: randomUUID() }))).toMatchObject(rejected)
    expect(await applyOne(a.d1, create(randomUUID(), { source_type: "note", source_id: null }))).toMatchObject(rejected)
  })

  it("a grade that does not exist or a schedule that does not add up leaves the card as it was", async () => {
    const id = await newCard()
    const s = wire(nextSchedule(newSchedule(today), "good", today))
    expect(await applyOne(a.d1, answer(id, "good", { grade: "perfect" }))).toMatchObject(rejected)
    expect(await applyOne(a.d1, answer(id, "good", { schedule: { ...s, due_on: addDays(today, 9) } }))).toMatchObject({ status: "rejected", code: "invalid_value" })
    expect(await applyOne(a.d1, answer(id, "good", { schedule: { ...s, state: "new" } }))).toMatchObject({ status: "rejected", code: "invalid_value" })
    expect(await applyOne(a.d1, answer(id, "good", { schedule: { ...s, interval_days: 400, due_on: addDays(today, 400) } }))).toMatchObject(rejected)
    expect(await applyOne(a.d1, answer(id, "good", { schedule: { ...s, ease_factor: 0.5 } }))).toMatchObject(rejected)
    expect(await applyOne(a.d1, answer(id, "good", { local_date: addDays(today, 2), schedule: { ...s, due_on: addDays(today, 3) } }))).toMatchObject({ status: "rejected", code: "invalid_value" })
    expect(await card(a.d1, id)).toMatchObject({ state: "new", reps: 0, due_on: today })
    expect(await attemptsOf(a.d1, id)).toEqual([])
  })

  it("an unknown operation", async () => {
    expect(await applyOne(a.d1, { type: "recall.nope", op_id: opId("rx"), card_id: await newCard() })).toMatchObject({ status: "rejected", code: "unknown_op_type" })
  })
})

describe("suspending and deleting", () => {
  it("suspends and resumes without touching the schedule", async () => {
    const id = await newCard()
    await applyOne(a.d1, answer(id, "easy"))
    expect(await applyOne(a.d1, { type: "recall.suspend", op_id: opId("rs"), card_id: id, suspended_on: today })).toMatchObject({ status: "applied" })
    expect(await card(a.d2, id)).toMatchObject({ suspended_on: today, interval_days: 4, due_on: addDays(today, 4) })
    expect(await applyOne(a.d1, { type: "recall.suspend", op_id: opId("rs"), card_id: id, suspended_on: null })).toMatchObject({ status: "applied" })
    expect(await card(a.d2, id)).toMatchObject({ suspended_on: null, due_on: addDays(today, 4) })
  })

  it("deleting removes the text, keeps the attempts, and a late answer changes nothing", async () => {
    const id = await newCard({ question: "Secreto", source_type: "note", source_id: randomUUID() })
    await applyOne(a.d1, answer(id, "good"))
    const before = (await pull(a.d1)).cursor
    expect(await applyOne(a.d1, { type: "recall.delete", op_id: opId("rd"), card_id: id })).toMatchObject({ status: "applied" })
    expect(await applyOne(a.d1, { type: "recall.delete", op_id: opId("rd"), card_id: id })).toMatchObject({ status: "applied" })
    expect(await applyOne(a.d2, answer(id, "good"))).toMatchObject({ status: "superseded", code: "card_deleted" })
    const row = await db(async (c) => (await c.query("select question, answer, source_type, source_id, deleted_at is not null as gone from public.recall_cards where id = $1", [id])).rows[0])
    expect(row).toEqual({ question: "", answer: "", source_type: null, source_id: null, gone: true })
    expect(await attemptsOf(a.d1, id)).toHaveLength(1)
    // A full pull has no tombstones; an incremental one announces it.
    expect(await card(a.d2, id)).toBeNull()
    expect(await card(a.d2, id, before)).toMatchObject({ deleted: true, question: "" })
  })

  it("answering or suspending a card that does not exist is refused", async () => {
    expect(await applyOne(a.d1, answer(randomUUID(), "good"))).toMatchObject({ status: "rejected", code: "card_not_found" })
    expect(await applyOne(a.d1, { type: "recall.suspend", op_id: opId("rs"), card_id: randomUUID(), suspended_on: today })).toMatchObject({ status: "rejected", code: "card_not_found" })
  })
})

describe("RLS and writes only through the operations", () => {
  it("another user sees nothing and cannot answer, suspend or delete it", async () => {
    const id = await newCard({ question: "Privado" })
    expect(await card(b.d1, id)).toBeNull()
    const { data } = await b.d1.from("recall_cards").select("id").eq("id", id)
    expect(data).toEqual([])
    expect(await applyOne(b.d1, answer(id, "good"))).toMatchObject({ status: "rejected", code: "card_not_found" })
    expect(await applyOne(b.d1, { type: "recall.suspend", op_id: opId("rs"), card_id: id, suspended_on: today })).toMatchObject({ status: "rejected", code: "card_not_found" })
    expect(await applyOne(b.d1, { type: "recall.delete", op_id: opId("rd"), card_id: id })).toMatchObject({ status: "applied" })
    expect(await card(a.d1, id)).toMatchObject({ question: "Privado", deleted: false })
  })

  it("the id of someone else's card cannot be taken over", async () => {
    const id = await newCard({ question: "Mía" })
    expect(await applyOne(b.d1, create(id, { question: "Robada" }))).toMatchObject({ status: "rejected", code: "id_conflict" })
    expect(await card(a.d1, id)).toMatchObject({ question: "Mía" })
  })

  it("an anonymous visitor cannot read or call anything", async () => {
    const anon = anonClient()
    const cards = await anon.from("recall_cards").select("id")
    expect(cards.data ?? []).toEqual([])
    const attempts = await anon.from("recall_attempts").select("id")
    expect(attempts.data ?? []).toEqual([])
    const rpc = await anon.rpc("apply_ops", { p_device_id: "x", p_ops: [create(randomUUID())] })
    expect(rpc.error).not.toBeNull()
  })

  it("direct API writes are refused, even on the user's own rows", async () => {
    const id = await newCard({ question: "Original" })
    await applyOne(a.d1, answer(id, "good"))
    const forged = await a.d1.from("recall_cards").insert({ id: randomUUID(), question: "x", answer: "y", due_on: today, algorithm_version: 1 })
    expect(forged.error?.message).toMatch(/recall_via_ops_only/)
    const upd = await a.d1.from("recall_cards").update({ question: "Cambiada" }).eq("id", id)
    expect(upd.error?.message).toMatch(/recall_via_ops_only/)
    const fakeAttempt = await a.d1.from("recall_attempts").insert({ id: randomUUID(), card_id: id, grade: "easy", responded_at: new Date().toISOString(), local_date: today, due_on_before: today, due_on_after: today, interval_days: 0, algorithm_version: 1 })
    expect(fakeAttempt.error?.message).toMatch(/recall_via_ops_only/)
    expect((await a.d1.from("recall_attempts").update({ grade: "easy" }).eq("card_id", id)).error).not.toBeNull()
    expect((await a.d1.from("recall_attempts").delete().eq("card_id", id)).error).not.toBeNull()
    expect((await a.d1.from("recall_cards").delete().eq("id", id)).error).not.toBeNull()
    expect(await card(a.d1, id)).toMatchObject({ question: "Original" })
    expect(await attemptsOf(a.d1, id)).toMatchObject([{ grade: "good" }])
  })
})

describe("pull_changes and the cursor", () => {
  it("sends cards and attempts incrementally; the cursor covers them", async () => {
    const p0 = await pull(a.d1)
    expect(p0.cursor).toBeGreaterThanOrEqual(Math.max(...p0.recall_cards.map((c) => c.server_seq), ...p0.recall_attempts.map((t) => t.server_seq)))
    const id = randomUUID()
    await applyOne(a.d1, create(id))
    const p1 = await pull(a.d2, p0.cursor)
    expect(p1.recall_cards.map((c) => c.id)).toEqual([id])
    expect(p1.recall_attempts).toEqual([])
    await applyOne(a.d1, answer(id, "good"))
    const p2 = await pull(a.d2, p1.cursor)
    expect(p2.recall_cards.map((c) => c.id)).toEqual([id])
    expect(p2.recall_attempts.map((t) => t.card_id)).toEqual([id])
    expect(p2.cursor).toBeGreaterThan(p1.cursor)
  })

  it("a full pull brings 90 days of attempts; an incremental one, whatever is new", async () => {
    const id = await newCard()
    const old = addDays(today, -100)
    const p0 = await pull(a.d1)
    await applyOne(a.d1, answer(id, "good", { local_date: old, schedule: wire(nextSchedule(newSchedule(old), "good", old)) }))
    expect((await pull(a.d1)).recall_attempts.filter((t) => t.card_id === id)).toEqual([])
    expect((await pull(a.d1, p0.cursor)).recall_attempts.map((t) => t.card_id)).toEqual([id])
  })
})
