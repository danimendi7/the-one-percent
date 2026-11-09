import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchHabitHistory } from "@/features/sync/habit-history"
import { addDays, adminClient, anonClient, db, opId } from "./setup"

/** C6 · The change history of a habit, read from audit_logs against real PostgreSQL. LOCAL stack only. */

type Result = { op_id: string; status: string; code?: string | null }
interface User {
  id: string
  email: string
  client: SupabaseClient
}

async function createUser(label: string): Promise<User> {
  const email = `it-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@theonepercent.local`
  const password = `pw-${Math.random().toString(36).slice(2)}-A1!`
  await db((c) => c.query("insert into private.allowed_emails (email, note) values ($1, 'integration test')", [email]))
  const { data, error } = await adminClient().auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw error ?? new Error("createUser failed")
  const client = anonClient()
  const s = await client.auth.signInWithPassword({ email, password })
  if (s.error) throw s.error
  return { id: data.user.id, email, client }
}

async function removeUser(u: User) {
  await adminClient().auth.admin.deleteUser(u.id)
  await db((c) => c.query("delete from private.allowed_emails where email = $1", [u.email]))
}

async function apply(c: SupabaseClient, ops: unknown[]): Promise<Result[]> {
  const { data, error } = await c.rpc("apply_ops", { p_device_id: "it-history", p_ops: ops })
  if (error) throw error
  return (data as { results: Result[] }).results
}

const HABIT = "aaaaaaaa-1111-4111-8111-111111111111"
const OTHER = "bbbbbbbb-2222-4222-8222-222222222222"
let a: User
let b: User
let today: string

const create = (id: string, title: string) => ({
  type: "habit.create",
  op_id: opId("h-create"),
  habit: { id, title, icon: "book", dimension: "mind", habit_type: "binary", unit: null, target_value: null, target_direction: null, start_date: addDays(today, -10) },
  versions: [{ valid_from: addDays(today, -10), rule: { kind: "daily" } }],
})
const rename = (id: string, title: string, base_version: number) => ({ type: "habit.update", op_id: opId("h-update"), habit_id: id, base_version, patch: { title, icon: "book", dimension: "mind" } })

beforeAll(async () => {
  a = await createUser("history-a")
  b = await createUser("history-b")
  const { data, error } = await a.client.rpc("pull_changes", { p_since: 0 })
  if (error) throw error
  today = (data as { server_today: string }).server_today
  const created = await apply(a.client, [create(HABIT, "Leer"), create(OTHER, "Correr")])
  expect(created.map((r) => r.status)).toEqual(["applied", "applied"])
})
afterAll(async () => {
  await removeUser(a)
  await removeUser(b)
})

describe("reading the history of a habit", () => {
  it("returns that habit's changes, newest first, and none of another habit's", async () => {
    await apply(a.client, [rename(HABIT, "Leer en papel", 1)])
    const rows = await fetchHabitHistory(a.client, HABIT)
    expect(rows.map((r) => r.action)).toEqual(["update", "create"])
    expect(rows[1].metadata_json).toEqual({ title: "Leer" })
    expect(rows[0].metadata_json).toMatchObject({ title: "Leer en papel" })
  })

  it("includes a day recorded afterwards, and leaves out the marks of today", async () => {
    const entry = (date: string) => ({ type: "entry.set", op_id: opId("e"), habit_id: OTHER, local_date: date, value: true, client_updated_at: new Date().toISOString(), base_seq: null })
    expect((await apply(a.client, [entry(addDays(today, -2)), entry(today)])).map((r) => r.status)).toEqual(["applied", "applied"])
    const rows = await fetchHabitHistory(a.client, OTHER)
    const backfill = rows.filter((r) => r.action === "backfill")
    expect(backfill).toHaveLength(1)
    expect(backfill[0]).toMatchObject({ entity_type: "habit_entry", metadata_json: { local_date: addDays(today, -2), value: true } })
  })

  it("keeps the order of several changes sent together", async () => {
    const id = "cccccccc-3333-4333-8333-333333333333"
    const results = await apply(a.client, [create(id, "Uno"), rename(id, "Dos", 1), rename(id, "Tres", 2)])
    expect(results.map((r) => r.status)).toEqual(["applied", "applied", "applied"])
    const rows = await fetchHabitHistory(a.client, id)
    expect(rows.map((r) => (r.metadata_json as { title: string }).title)).toEqual(["Tres", "Dos", "Uno"])
  })

  it("honours the limit, keeping the newest", async () => {
    const rows = await fetchHabitHistory(a.client, HABIT, 1)
    expect(rows.map((r) => r.action)).toEqual(["update"])
  })
})

describe("RLS: the log is private and append-only", () => {
  it("another user reads nothing, even knowing the id", async () => {
    expect(await fetchHabitHistory(b.client, HABIT)).toEqual([])
  })

  it("an anonymous visitor reads nothing", async () => {
    const { data } = await anonClient().from("audit_logs").select("id").eq("entity_id", HABIT)
    expect(data ?? []).toEqual([])
  })

  it("the owner can neither change nor delete a past entry", async () => {
    const before = await db(async (c) => (await c.query("select id, action, metadata_json from public.audit_logs where user_id = $1 and entity_id = $2 order by occurred_at", [a.id, HABIT])).rows)
    expect(before.length).toBeGreaterThan(0)
    const upd = await a.client.from("audit_logs").update({ action: "forged" }).eq("entity_id", HABIT)
    expect(upd.error).not.toBeNull()
    const del = await a.client.from("audit_logs").delete().eq("entity_id", HABIT)
    expect(del.error).not.toBeNull()
    const after = await db(async (c) => (await c.query("select id, action, metadata_json from public.audit_logs where user_id = $1 and entity_id = $2 order by occurred_at", [a.id, HABIT])).rows)
    expect(after).toEqual(before)
  })
})
