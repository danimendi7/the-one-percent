import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { addDays, createTestUser, db, deleteTestUser, opId, type TestUser } from "./setup"

/** M3.1 · goals over the existing sync engine (supabase/migrations/*_goals.sql). LOCAL stack only. */

type Result = { op_id: string; status: string; outcome?: string; code?: string | null }
type WireGoal = {
  id: string
  version: number
  state: string
  server_seq: number
  habits: { habit_id: string; weight: number }[]
  checkpoints: { id: string; title: string; value: number | null; done_on: string | null }[]
}
type WireMeasurement = { goal_id: string; observed_on: string; value: number | null; deleted: boolean }

async function apply(u: TestUser, ops: unknown[]) {
  const { data, error } = await u.client.rpc("apply_ops", { p_device_id: "it", p_ops: ops })
  if (error) throw error
  return (data as { results: Result[] }).results
}

async function pull(u: TestUser, since = 0) {
  const { data, error } = await u.client.rpc("pull_changes", { p_since: since })
  if (error) throw error
  return data as { server_today: string; cursor: number; goals: WireGoal[]; measurements: WireMeasurement[] }
}

const habitCreate = (id: string, start: string, type: "binary" | "numeric") => ({
  type: "habit.create",
  op_id: opId("habit"),
  habit: {
    id, title: `Hábito ${type}`, icon: "check", dimension: "body", habit_type: type,
    unit: type === "numeric" ? "km" : null, target_value: type === "numeric" ? 5 : null,
    target_direction: type === "numeric" ? "at_least" : null, start_date: start,
  },
  versions: [{ valid_from: start, rule: { kind: "daily" } }],
})

function numericGoal(id: string, start: string, over: Record<string, unknown> = {}) {
  return {
    id, title: "Bajar a 78 kg", why: null, parent_id: null, dimension: "body", metric_type: "numeric",
    source: "manual", source_habit_id: null, aggregation: "last", unit: "kg", baseline: 82, target: 78, direction: "down",
    threshold: null, start_date: start, due_date: addDays(start, 120), horizon_override: null, priority: "primary",
    aggregate_children: false, ...over,
  }
}

const create = (goal: Record<string, unknown>, habits: unknown[] = [], checkpoints: unknown[] = []) => ({
  type: "goal.create", op_id: opId("goal"), goal, habits, checkpoints,
})
const measure = (goalId: string, date: string, value: number | null, base: number | null = null) => ({
  type: "goal.measure", op_id: opId("m"), goal_id: goalId, observed_on: date, value, note: null,
  client_updated_at: new Date().toISOString(), base_seq: base,
})

let a: TestUser
let b: TestUser
let today: string
let start: string
const runA = randomUUID()
const kmA = randomUUID()
const binB = randomUUID()

beforeAll(async () => {
  a = await createTestUser("ga")
  b = await createTestUser("gb")
  today = (await pull(a)).server_today
  start = addDays(today, -30)
  expect((await apply(a, [habitCreate(runA, start, "binary"), habitCreate(kmA, start, "numeric")])).map((r) => r.status)).toEqual(["applied", "applied"])
  expect((await apply(b, [habitCreate(binB, start, "binary")]))[0].status).toBe("applied")
})

afterAll(async () => {
  await deleteTestUser(a)
  await deleteTestUser(b)
})

describe("create and pull", () => {
  it("creates each kind; a goal travels whole with its links and milestones", async () => {
    const n = randomUUID()
    const h = randomUUID()
    const m = randomUUID()
    const fed = randomUUID()
    const cp = randomUUID()
    const res = await apply(a, [
      create(numericGoal(n, start), [{ habit_id: runA, weight: 3 }], [{ id: cp, title: "Bajar de 80", value: 80 }]),
      create({ ...numericGoal(h, start), metric_type: "habits", source: null, aggregation: null, unit: null, baseline: null, target: null, direction: null, threshold: 0.85 }, [{ habit_id: runA, weight: 1 }]),
      create({ ...numericGoal(m, start), metric_type: "milestones", source: null, aggregation: null, unit: null, baseline: null, target: null, direction: null }, [], [
        { id: randomUUID(), title: "Uno", done_on: addDays(today, -3) },
        { id: randomUUID(), title: "Dos" },
      ]),
      create(numericGoal(fed, start, { source: "habit", source_habit_id: kmA, aggregation: "sum", unit: "km", baseline: 0, target: 500, direction: "up" })),
    ])
    expect(res.map((r) => r.status)).toEqual(["applied", "applied", "applied", "applied"])

    const goals = (await pull(a)).goals
    const byId = new Map(goals.map((g) => [g.id, g]))
    expect(byId.get(n)).toMatchObject({ version: 1, state: "active", habits: [{ habit_id: runA, weight: 3 }], checkpoints: [{ id: cp, value: 80, done_on: null }] })
    expect(byId.get(m)!.checkpoints.map((c) => c.done_on)).toEqual([addDays(today, -3), null])
    expect(byId.get(fed)).toMatchObject({ habits: [] })
  })

  it("is idempotent: a replayed op is a duplicate, a re-sent create of the same id is a no-op", async () => {
    const id = randomUUID()
    const op = create(numericGoal(id, start))
    expect((await apply(a, [op]))[0].status).toBe("applied")
    expect((await apply(a, [op]))[0]).toMatchObject({ status: "duplicate", outcome: "applied" })
    expect((await apply(a, [{ ...op, op_id: opId("again") }]))[0].status).toBe("applied")
    const rows = await db((c) => c.query("select count(*)::int n from public.goals where id = $1", [id]))
    expect(rows.rows[0].n).toBe(1)
  })

  it("rejects malformed goals: wrong direction, binary habit as source, due before start", async () => {
    const res = await apply(a, [
      create(numericGoal(randomUUID(), start, { target: 90 })),
      create(numericGoal(randomUUID(), start, { source: "habit", source_habit_id: runA, aggregation: "sum", baseline: 0, target: 10, direction: "up" })),
      create(numericGoal(randomUUID(), start, { due_date: addDays(start, -1) })),
    ])
    expect(res.map((r) => r.status)).toEqual(["rejected", "rejected", "rejected"])
    expect(res[1].code).toBe("source_habit_not_numeric")
  })
})

describe("ownership (composite keys + RLS)", () => {
  const goalA = randomUUID()
  beforeAll(async () => {
    expect((await apply(a, [create(numericGoal(goalA, start), [{ habit_id: runA, weight: 1 }])]))[0].status).toBe("applied")
  })

  it("another user cannot link, source, parent or measure someone else's records", async () => {
    const res = await apply(b, [
      create(numericGoal(randomUUID(), start), [{ habit_id: runA, weight: 1 }]),
      create(numericGoal(randomUUID(), start, { source: "habit", source_habit_id: kmA, aggregation: "sum", baseline: 0, target: 10, direction: "up" })),
      create(numericGoal(randomUUID(), start, { parent_id: goalA })),
      measure(goalA, today, 80),
      { type: "goal.update", op_id: opId("u"), goal_id: goalA, base_version: 1, goal: numericGoal(goalA, start, { title: "hacked" }), habits: [], checkpoints: [] },
    ])
    expect(res.map((r) => r.status)).toEqual(["rejected", "rejected", "rejected", "rejected", "rejected"])
    const title = await db((c) => c.query("select title from public.goals where id = $1", [goalA]))
    expect(title.rows[0].title).toBe("Bajar a 78 kg")
  })

  it("another user reads nothing and cannot insert directly", async () => {
    for (const table of ["goals", "goal_habits", "goal_checkpoints", "goal_measurements"]) {
      const { data, error } = await b.client.from(table).select("*").eq("user_id", a.id)
      expect(error, table).toBeNull()
      expect(data, table).toEqual([])
    }
    expect((await pull(b)).goals.some((g) => g.id === goalA)).toBe(false)
    const ins = await b.client.from("goal_habits").insert({ goal_id: goalA, habit_id: binB, weight: 1 })
    expect(ins.error).not.toBeNull()
  })

  it("a goal cannot hang below its own descendant (no cycles)", async () => {
    const p = randomUUID()
    const c = randomUUID()
    await apply(a, [create(numericGoal(p, start)), create(numericGoal(c, start, { parent_id: p }))])
    const res = await apply(a, [{ type: "goal.update", op_id: opId("cyc"), goal_id: p, base_version: 1, goal: numericGoal(p, start, { parent_id: c }), habits: [], checkpoints: [] }])
    expect(res[0]).toMatchObject({ status: "rejected", code: "goal_cycle" })
  })
})

describe("measurements (desired state, one per day, no duplicates)", () => {
  const g = randomUUID()
  const fed = randomUUID()
  beforeAll(async () => {
    await apply(a, [
      create(numericGoal(g, start)),
      create(numericGoal(fed, start, { source: "habit", source_habit_id: kmA, aggregation: "sum", baseline: 0, target: 500, direction: "up" })),
    ])
  })

  it("a second value on the same day replaces the first", async () => {
    expect((await apply(a, [measure(g, today, 81), measure(g, today, 80.5)])).map((r) => r.status)).toEqual(["applied", "applied"])
    const rows = await db((c) => c.query("select value from public.goal_measurements where goal_id = $1 and deleted_at is null", [g]))
    expect(rows.rows.map((r) => Number(r.value))).toEqual([80.5])
  })

  it("rejects habit-fed goals, future days and days before the start", async () => {
    const res = await apply(a, [measure(fed, today, 10), measure(g, addDays(today, 1), 80), measure(g, addDays(start, -1), 80)])
    expect(res.map((r) => r.code)).toEqual(["not_manual", "future_date", "before_start"])
  })

  it("clearing leaves a tombstone for other devices; a full pull omits it", async () => {
    const before = (await pull(a)).cursor
    expect((await apply(a, [measure(g, today, null)]))[0].status).toBe("applied")
    const inc = await pull(a, before)
    expect(inc.measurements).toEqual([expect.objectContaining({ goal_id: g, observed_on: today, deleted: true, value: null })])
    expect((await pull(a)).measurements.some((m) => m.goal_id === g && m.observed_on === today)).toBe(false)
  })

  it("an older concurrent edit does not overwrite a newer one", async () => {
    const day = addDays(today, -2)
    await apply(a, [measure(g, day, 79)])
    const stale = { ...measure(g, day, 85), client_updated_at: new Date(Date.now() - 60_000).toISOString() }
    expect((await apply(a, [stale]))[0].status).toBe("superseded")
  })
})

describe("edits, milestones and state", () => {
  const g = randomUUID()
  const manual = randomUUID()
  const valued = randomUUID()

  beforeAll(async () => {
    await apply(a, [
      create(numericGoal(g, start), [{ habit_id: runA, weight: 1 }, { habit_id: kmA, weight: 2 }], [
        { id: manual, title: "Médico" },
        { id: valued, title: "Bajar de 80", value: 80 },
      ]),
    ])
  })

  it("an edit replaces links and milestone definitions; a stale version is a conflict", async () => {
    const res = await apply(a, [
      { type: "goal.update", op_id: opId("u1"), goal_id: g, base_version: 1, goal: numericGoal(g, start, { title: "Bajar a 77 kg", target: 77 }), habits: [{ habit_id: kmA, weight: 1 }], checkpoints: [{ id: manual, title: "Médico" }] },
      { type: "goal.update", op_id: opId("u2"), goal_id: g, base_version: 1, goal: numericGoal(g, start, { title: "Otro" }), habits: [], checkpoints: [] },
    ])
    expect(res.map((r) => r.status)).toEqual(["applied", "conflict"])
    const goal = (await pull(a)).goals.find((x) => x.id === g)!
    expect(goal).toMatchObject({ version: 2, habits: [{ habit_id: kmA, weight: 1 }], checkpoints: [{ id: manual, title: "Médico" }] })
  })

  it("ticking a manual milestone bumps the goal for other devices; data-driven or future ones are refused", async () => {
    const before = (await pull(a)).cursor
    const res = await apply(a, [
      { type: "goal.checkpoint.set", op_id: opId("cp"), goal_id: g, checkpoint_id: manual, done_on: today },
      { type: "goal.checkpoint.set", op_id: opId("cp"), goal_id: g, checkpoint_id: valued, done_on: today },
      { type: "goal.checkpoint.set", op_id: opId("cp"), goal_id: g, checkpoint_id: manual, done_on: addDays(today, 1) },
    ])
    expect(res.map((r) => r.status)).toEqual(["applied", "rejected", "rejected"])
    const inc = await pull(a, before)
    expect(inc.goals.find((x) => x.id === g)!.checkpoints).toEqual([expect.objectContaining({ id: manual, done_on: today })])
  })

  it("state and archive are recorded with their dates", async () => {
    const res = await apply(a, [
      { type: "goal.set_state", op_id: opId("s"), goal_id: g, state: "achieved", on: today },
      { type: "goal.archive", op_id: opId("ar"), goal_id: g, archived_on: today },
    ])
    expect(res.map((r) => r.status)).toEqual(["applied", "applied"])
    const row = await db((c) => c.query("select state, closed_on::text, archived_on::text from public.goals where id = $1", [g]))
    expect(row.rows[0]).toEqual({ state: "achieved", closed_on: today, archived_on: today })
  })

  it("the kind of measure is immutable (history would change)", async () => {
    const res = await apply(a, [
      { type: "goal.update", op_id: opId("k"), goal_id: g, base_version: 4, goal: { ...numericGoal(g, start), metric_type: "milestones" }, habits: [], checkpoints: [] },
    ])
    const row = await db((c) => c.query("select metric_type, version from public.goals where id = $1", [g]))
    // The server keeps the stored metric_type whatever the client sends.
    expect(row.rows[0].metric_type).toBe("numeric")
    expect(["applied", "conflict"]).toContain(res[0].status)
  })
})

describe("in review (additive column)", () => {
  const g = randomUUID()
  const setReview = (id: string, on: string | null) => ({ type: "goal.set_review", op_id: opId("rv"), goal_id: id, review_since: on })
  const snapshot = async () =>
    (await db((c) => c.query("select title, state, closed_on::text, archived_on::text, baseline, target, due_date::text from public.goals where id = $1", [g]))).rows[0]

  it("puts a goal in and out of review and pulls it, leaving every other value intact", async () => {
    expect((await apply(a, [create(numericGoal(g, start)), measure(g, today, 80)])).map((r) => r.status)).toEqual(["applied", "applied"])
    const before = await snapshot()
    expect((await pull(a)).goals.find((x) => x.id === g)).toMatchObject({ review_since: null, version: 1 })

    expect((await apply(a, [setReview(g, today)]))[0].status).toBe("applied")
    expect((await pull(a)).goals.find((x) => x.id === g)).toMatchObject({ review_since: today, state: "active", version: 2 })

    expect((await apply(a, [setReview(g, addDays(today, 1))]))[0].status).toBe("applied")
    expect((await pull(a)).goals.find((x) => x.id === g)).toMatchObject({ review_since: today, version: 2 })

    expect((await apply(a, [setReview(g, null)]))[0].status).toBe("applied")
    expect((await pull(a)).goals.find((x) => x.id === g)).toMatchObject({ review_since: null, version: 3 })

    expect(await snapshot()).toEqual(before)
    expect((await pull(a)).measurements.find((m) => m.goal_id === g)).toMatchObject({ observed_on: today, deleted: false })
    expect(Number((await pull(a)).measurements.find((m) => m.goal_id === g)!.value)).toBe(80)
  })

  it("an edit from a client that does not know the column keeps the review", async () => {
    await apply(a, [setReview(g, today)])
    const version = (await pull(a)).goals.find((x) => x.id === g)!.version
    const res = await apply(a, [{ type: "goal.update", op_id: opId("u"), goal_id: g, base_version: version, goal: numericGoal(g, start, { title: "Bajar a 77 kg" }), habits: [], checkpoints: [] }])
    expect(res[0].status).toBe("applied")
    expect((await pull(a)).goals.find((x) => x.id === g)).toMatchObject({ title: "Bajar a 77 kg", review_since: today })
  })

  it("rejects dates far from today and goals of another account", async () => {
    const res = await apply(a, [setReview(g, addDays(today, 5))])
    expect(res[0]).toMatchObject({ status: "rejected", code: "invalid_review_date" })
    const other = await apply(b, [setReview(g, today)])
    expect(other[0]).toMatchObject({ status: "rejected", code: "goal_not_found" })
    expect((await pull(a)).goals.find((x) => x.id === g)).toMatchObject({ review_since: today })
  })
})
