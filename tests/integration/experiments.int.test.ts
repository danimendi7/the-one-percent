import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { randomUUID } from "node:crypto"
import { addDays, anonClient, createTestUser, db, deleteTestUser, opId, type TestUser } from "./setup"

/** E3 · Experiments against real PostgreSQL: RLS, writes only through operations. LOCAL stack only. */
type Result = { status: string; code?: string | null }
type Row = { id: string; title: string; metric_kind: string; metric_ref: string | null; start_on: string; days: number; status: string; ended_on: string | null; note: string | null; deleted: boolean }

let a: TestUser
let b: TestUser
let today: string
const HABIT = randomUUID()

async function applyOne(u: TestUser, op: unknown): Promise<Result> {
  const { data, error } = await u.client.rpc("apply_ops", { p_device_id: "it-exp", p_ops: [op] })
  if (error) throw error
  return (data as { results: Result[] }).results[0]
}
async function row(u: TestUser, id: string, since = 0): Promise<Row | null> {
  const { data, error } = await u.client.rpc("pull_changes", { p_since: since })
  if (error) throw error
  return (data as { experiments: Row[] }).experiments.find((e) => e.id === id) ?? null
}
const create = (id: string, p: Record<string, unknown> = {}) => ({ type: "experiment.create", op_id: opId("xc"), experiment: { id, title: "Sin móvil en la cama", metric_kind: "checkin", metric_ref: "energy", start_on: today, days: 14, ...p }, at: new Date().toISOString() })
const close = (id: string, p: Record<string, unknown> = {}) => ({ type: "experiment.close", op_id: opId("xx"), experiment_id: id, status: "finished", ended_on: today, note: "Funcionó", ...p })

beforeAll(async () => {
  a = await createTestUser("xa")
  b = await createTestUser("xb")
  const { data } = await a.client.rpc("pull_changes", { p_since: 0 })
  today = (data as { server_today: string }).server_today
  const habit = { type: "habit.create", op_id: opId("h"), habit: { id: HABIT, title: "Correr", icon: "check", dimension: "body", habit_type: "binary", unit: null, target_value: null, target_direction: null, start_date: addDays(today, -30) }, versions: [{ valid_from: addDays(today, -30), rule: { kind: "daily" } }] }
  expect(await applyOne(a, habit)).toMatchObject({ status: "applied" })
})
afterAll(async () => {
  await deleteTestUser(a)
  await deleteTestUser(b)
})

describe("experiments", () => {
  it("creates one per metric kind; a replay applies once", async () => {
    const id = randomUUID()
    const op = create(id, { title: "  Sin móvil  " })
    expect(await applyOne(a, op)).toMatchObject({ status: "applied" })
    expect(await applyOne(a, op)).toMatchObject({ status: "duplicate" })
    expect(await row(a, id)).toMatchObject({ title: "Sin móvil", metric_kind: "checkin", metric_ref: "energy", start_on: today, days: 14, status: "active", deleted: false })
    expect(await applyOne(a, create(randomUUID(), { metric_kind: "habit", metric_ref: HABIT }))).toMatchObject({ status: "applied" })
    expect(await applyOne(a, create(randomUUID(), { metric_kind: "focus", metric_ref: null }))).toMatchObject({ status: "applied" })
  })

  it("refuses what does not make sense", async () => {
    for (const p of [{ title: " " }, { title: "x".repeat(141) }, { days: 10 }, { metric_kind: "weight" }, { metric_ref: "hunger" }, { metric_kind: "focus", metric_ref: "energy" }, { start_on: addDays(today, 5) }, { start_on: addDays(today, -5) }]) {
      expect(await applyOne(a, create(randomUUID(), p)), JSON.stringify(p)).toMatchObject({ status: "rejected" })
    }
    expect(await applyOne(b, create(randomUUID(), { metric_kind: "habit", metric_ref: HABIT }))).toMatchObject({ status: "rejected", code: "invalid_link" })
  })

  it("closes once: the first close stays and a later one is superseded", async () => {
    const id = randomUUID()
    await applyOne(a, create(id))
    expect(await applyOne(a, close(id, { note: "  Dormí mejor  " }))).toMatchObject({ status: "applied" })
    expect(await applyOne(a, close(id, { status: "abandoned", note: null }))).toMatchObject({ status: "superseded" })
    expect(await row(a, id)).toMatchObject({ status: "finished", ended_on: today, note: "Dormí mejor" })
    expect(await applyOne(a, close(randomUUID()))).toMatchObject({ status: "rejected", code: "experiment_not_found" })
    const early = randomUUID()
    await applyOne(a, create(early))
    expect(await applyOne(a, close(early, { ended_on: addDays(today, -3) }))).toMatchObject({ status: "rejected" })
    expect(await applyOne(a, close(early, { status: "active" }))).toMatchObject({ status: "rejected" })
  })

  it("deleting leaves no text, is idempotent and a full pull no longer brings it", async () => {
    const id = randomUUID()
    await applyOne(a, create(id, { title: "Secreto" }))
    await applyOne(a, close(id, { note: "Nota privada" }))
    expect(await applyOne(a, { type: "experiment.delete", op_id: opId("xd"), experiment_id: id })).toMatchObject({ status: "applied" })
    expect(await applyOne(a, { type: "experiment.delete", op_id: opId("xd"), experiment_id: id })).toMatchObject({ status: "applied" })
    const r = await db(async (c) => (await c.query("select title, note, deleted_at is not null as gone from public.experiments where id = $1", [id])).rows[0])
    expect(r).toEqual({ title: "", note: null, gone: true })
    expect(await row(a, id)).toBeNull()
  })

  it("RLS: another user sees and touches nothing; no direct writes; anon reads nothing", async () => {
    const id = randomUUID()
    await applyOne(a, create(id, { title: "Privado" }))
    expect(await row(b, id)).toBeNull()
    expect(await applyOne(b, close(id))).toMatchObject({ status: "rejected", code: "experiment_not_found" })
    expect(await applyOne(b, { type: "experiment.delete", op_id: opId("xd"), experiment_id: id })).toMatchObject({ status: "applied" })
    expect(await applyOne(b, create(id, { title: "Robado" }))).toMatchObject({ status: "rejected", code: "id_conflict" })
    expect(await row(a, id)).toMatchObject({ title: "Privado", status: "active" })
    expect((await a.client.from("experiments").update({ title: "x" }).eq("id", id)).error?.message).toMatch(/experiments_via_ops_only/)
    expect((await a.client.from("experiments").insert({ id: randomUUID(), title: "x", metric_kind: "focus", start_on: today, days: 7 })).error?.message).toMatch(/experiments_via_ops_only/)
    expect((await a.client.from("experiments").delete().eq("id", id)).error).not.toBeNull()
    expect((await anonClient().from("experiments").select("id")).data ?? []).toEqual([])
  })
})
