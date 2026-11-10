import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { randomUUID } from "node:crypto"
import { addDays, adminClient, anonClient, createTestUser, db, deleteTestUser, opId, type TestUser } from "./setup"

/** D4 · Daily Discovery persistence against real PostgreSQL: RLS, writes only through operations, two devices. LOCAL stack only. */

type Result = { op_id: string; status: string; outcome?: string; code?: string | null }
type Topic = { id: string; title: string; category: string; body: string; source_title: string | null; source_url: string | null; deleted: boolean; server_seq: number }
type Feedback = { topic_key: string; rating: number | null; saved: boolean; dismissed: string | null; decided_on: string; server_seq: number }
type Pull = { server_today: string; cursor: number; discovery_topics: Topic[]; topic_feedback: Feedback[] }

let a: TestUser
let b: TestUser
let today: string
const KEY = "curated:dichotomy"
const client = (u: TestUser): SupabaseClient => u.client

async function applyOne(u: TestUser, op: unknown): Promise<Result> {
  const { data, error } = await client(u).rpc("apply_ops", { p_device_id: "it-discovery", p_ops: [op] })
  if (error) throw error
  return (data as { results: Result[] }).results[0]
}
async function pull(u: TestUser, since = 0): Promise<Pull> {
  const { data, error } = await client(u).rpc("pull_changes", { p_since: since })
  if (error) throw error
  return data as Pull
}
const create = (id: string, p: Record<string, unknown> = {}) => ({ type: "discovery.topic.create", op_id: opId("dt"), topic: { id, title: "Mi tema", category: "Ciencia", body: "Notas", source_title: null, source_url: null, ...p }, at: new Date().toISOString() })
const set = (fields: Record<string, unknown>, p: Record<string, unknown> = {}) => ({ type: "discovery.feedback.set", op_id: opId("df"), topic_key: KEY, fields, local_date: today, at: new Date().toISOString(), ...p })
const topic = async (u: TestUser, id: string, since = 0) => (await pull(u, since)).discovery_topics.find((t) => t.id === id) ?? null
const feedback = async (u: TestUser, key = KEY) => (await pull(u)).topic_feedback.find((f) => f.topic_key === key) ?? null

beforeAll(async () => {
  a = await createTestUser("da")
  b = await createTestUser("db")
  today = (await pull(a)).server_today
})
afterAll(async () => {
  await deleteTestUser(a)
  await deleteTestUser(b)
})

describe("own topics", () => {
  it("creates a topic with its text trimmed and its source; a replay applies once", async () => {
    const id = randomUUID()
    const op = create(id, { title: "  Título  ", body: " Cuerpo ", source_title: " Libro ", source_url: "https://ejemplo.org/a" })
    expect(await applyOne(a, op)).toMatchObject({ status: "applied" })
    expect(await applyOne(a, op)).toMatchObject({ status: "duplicate", outcome: "applied" })
    expect(await topic(a, id)).toMatchObject({ title: "Título", body: "Cuerpo", source_title: "Libro", source_url: "https://ejemplo.org/a", category: "Ciencia", deleted: false })
  })

  it("refuses empty or oversized text, unknown categories and links that are not http", async () => {
    for (const p of [{ title: "  " }, { body: "" }, { title: "x".repeat(201) }, { body: "x".repeat(10_001) }, { category: "Inventada" }, { source_url: "javascript:alert(1)" }, { source_title: "x".repeat(301) }]) {
      expect(await applyOne(a, create(randomUUID(), p)), JSON.stringify(p).slice(0, 40)).toMatchObject({ status: "rejected" })
    }
  })

  it("deleting removes every text, is idempotent, and a full pull no longer brings it", async () => {
    const id = randomUUID()
    await applyOne(a, create(id, { title: "Secreto", source_title: "Fuente", source_url: "https://ejemplo.org" }))
    const before = (await pull(a)).cursor
    expect(await applyOne(a, { type: "discovery.topic.delete", op_id: opId("dd"), topic_id: id })).toMatchObject({ status: "applied" })
    expect(await applyOne(a, { type: "discovery.topic.delete", op_id: opId("dd"), topic_id: id })).toMatchObject({ status: "applied" })
    const row = await db(async (c) => (await c.query("select title, body, source_title, source_url, deleted_at is not null as gone from public.discovery_topics where id = $1", [id])).rows[0])
    expect(row).toEqual({ title: "", body: "", source_title: null, source_url: null, gone: true })
    expect(await topic(a, id)).toBeNull()
    expect(await topic(a, id, before)).toMatchObject({ deleted: true, title: "" })
  })
})

describe("feedback", () => {
  it("stores each field on its own and dates the decision", async () => {
    expect(await applyOne(a, set({ rating: 8 }))).toMatchObject({ status: "applied" })
    expect(await applyOne(a, set({ saved: true }))).toMatchObject({ status: "applied" })
    expect(await feedback(a)).toMatchObject({ rating: 8, saved: true, dismissed: null, decided_on: today })
    expect(await db(async (c) => (await c.query("select count(*)::int n from public.topic_feedback where user_id = $1 and topic_key = $2", [a.id, KEY])).rows[0].n)).toBe(1)
  })

  it("a rating and a dismissal can be cleared", async () => {
    const key = "curated:occam"
    await applyOne(a, set({ rating: 3, dismissed: "not_interested" }, { topic_key: key }))
    expect(await feedback(a, key)).toMatchObject({ rating: 3, dismissed: "not_interested" })
    await applyOne(a, set({ rating: null, dismissed: null }, { topic_key: key }))
    expect(await feedback(a, key)).toMatchObject({ rating: null, dismissed: null })
  })

  it("the same field written earlier does not overwrite a later one, and another field still applies", async () => {
    const key = "curated:lindy"
    const later = new Date(Date.now() - 1_000).toISOString()
    const earlier = new Date(Date.now() - 60_000).toISOString()
    await applyOne(a, set({ rating: 9 }, { topic_key: key, at: later }))
    expect(await applyOne(a, set({ rating: 2, saved: true }, { topic_key: key, at: earlier }))).toMatchObject({ status: "applied" })
    expect(await feedback(a, key)).toMatchObject({ rating: 9, saved: true })
  })

  it("a clock running ahead cannot win forever", async () => {
    const key = "curated:spacing"
    await applyOne(a, set({ rating: 9 }, { topic_key: key, at: new Date(Date.now() + 86_400_000).toISOString() }))
    await new Promise((r) => setTimeout(r, 1200))
    await applyOne(a, set({ rating: 5 }, { topic_key: key, at: new Date(Date.now() + 120_000).toISOString() }))
    expect((await feedback(a, key))?.rating).toBe(5)
  })

  it("refuses ratings off the scale, unknown fields, reasons and keys, and a future day", async () => {
    for (const op of [set({ rating: 0 }), set({ rating: 11 }), set({ rating: 7.5 }), set({ saved: "si" }), set({ dismissed: "aburrido" }), set({ nope: 1 }), set({}), set({ rating: 5 }, { topic_key: "Con Espacios" }), set({ rating: 5 }, { local_date: addDays(today, 2) })]) {
      expect(await applyOne(a, op)).toMatchObject({ status: "rejected" })
    }
    expect((await feedback(a, "Con Espacios"))).toBeNull()
  })
})

describe("RLS and writes only through the operations", () => {
  it("another user sees nothing of mine, and has feedback of their own for the same topic", async () => {
    const id = randomUUID()
    await applyOne(a, create(id, { title: "Privado" }))
    expect(await topic(b, id)).toBeNull()
    expect((await client(b).from("discovery_topics").select("id").eq("id", id)).data).toEqual([])
    expect(await applyOne(b, { type: "discovery.topic.delete", op_id: opId("dd"), topic_id: id })).toMatchObject({ status: "applied" })
    expect(await topic(a, id)).toMatchObject({ title: "Privado", deleted: false })
    expect(await applyOne(b, create(id, { title: "Robado" }))).toMatchObject({ status: "rejected", code: "id_conflict" })
    await applyOne(b, set({ rating: 1 }))
    expect((await feedback(b))?.rating).toBe(1)
    expect((await feedback(a))?.rating).toBe(8)
  })

  it("an anonymous visitor cannot read or call anything", async () => {
    const anon = anonClient()
    expect((await anon.from("discovery_topics").select("id")).data ?? []).toEqual([])
    expect((await anon.from("topic_feedback").select("topic_key")).data ?? []).toEqual([])
    expect((await anon.rpc("apply_ops", { p_device_id: "x", p_ops: [set({ rating: 5 })] })).error).not.toBeNull()
  })

  it("direct API writes are refused, even on the user's own rows", async () => {
    const id = randomUUID()
    await applyOne(a, create(id, { title: "Original" }))
    expect((await client(a).from("discovery_topics").insert({ id: randomUUID(), title: "x", category: "Otros", body: "y" })).error?.message).toMatch(/discovery_via_ops_only/)
    expect((await client(a).from("discovery_topics").update({ title: "Cambiado" }).eq("id", id)).error?.message).toMatch(/discovery_via_ops_only/)
    expect((await client(a).from("topic_feedback").insert({ topic_key: "curated:forged", rating: 10, decided_on: today })).error?.message).toMatch(/discovery_via_ops_only/)
    expect((await client(a).from("topic_feedback").update({ rating: 1 }).eq("topic_key", KEY)).error?.message).toMatch(/discovery_via_ops_only/)
    expect((await client(a).from("topic_feedback").delete().eq("topic_key", KEY)).error).not.toBeNull()
    expect((await client(a).from("discovery_topics").delete().eq("id", id)).error).not.toBeNull()
    expect(await topic(a, id)).toMatchObject({ title: "Original" })
    expect((await feedback(a))?.rating).toBe(8)
  })
})

describe("pull_changes and the cursor", () => {
  it("sends topics and feedback incrementally; the cursor covers them", async () => {
    const p0 = await pull(a)
    expect(p0.cursor).toBeGreaterThanOrEqual(Math.max(...p0.discovery_topics.map((t) => t.server_seq), ...p0.topic_feedback.map((f) => f.server_seq)))
    const id = randomUUID()
    await applyOne(a, create(id))
    const p1 = await pull(a, p0.cursor)
    expect(p1.discovery_topics.map((t) => t.id)).toEqual([id])
    expect(p1.topic_feedback).toEqual([])
    await applyOne(a, set({ rating: 7 }, { topic_key: "curated:network" }))
    const p2 = await pull(a, p1.cursor)
    expect(p2.discovery_topics).toEqual([])
    expect(p2.topic_feedback.map((f) => f.topic_key)).toEqual(["curated:network"])
    expect(p2.cursor).toBeGreaterThan(p1.cursor)
  })
})
