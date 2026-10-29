import { describe, expect, it } from "vitest"
import { measurementKey } from "@/features/goals/domain/types"
import type { GoalInput } from "@/features/goals/domain/ops"
import { memoryStorage, SyncEngine } from "./engine"
import { goalToWire } from "./domain/goal-wire"
import { mergePull, emptyCache } from "./domain/merge"
import type { Op } from "./domain/types"
import { FakeServer, fakeTransport } from "./testing/fake-server"

/** M3.1c · goals over the existing engine: optimistic, durable offline queue, idempotent, conflicts. */

const TODAY = "2026-10-21"
const NOW = Date.parse("2026-10-21T10:00:00Z")
const GOAL = "22222222-2222-4222-8222-222222222222"
const CP = "33333333-3333-4333-8333-333333333333"

let n = 0
const id = (p: string) => `${p}-${String(++n).padStart(8, "0")}`

const input = (p: Partial<GoalInput> = {}): GoalInput => ({
  title: "Bajar a 78 kg",
  kind: "numeric",
  numeric: { source: "manual", habitId: null, aggregation: "last", unit: "kg", baseline: 82, target: 78, direction: "down" },
  startDate: "2026-10-01",
  dueDate: "2027-03-01",
  priority: "primary",
  habits: [],
  checkpoints: [{ id: CP, title: "Revisión médica" }],
  ...p,
})

function create(): Op {
  const w = goalToWire(input())
  return { type: "goal.create", op_id: id("goal"), goal: { ...w.goal, id: GOAL }, habits: w.habits, checkpoints: w.checkpoints }
}
const measure = (date: string, value: number | null, base: number | null = null): Op => ({
  type: "goal.measure", op_id: id("m"), goal_id: GOAL, observed_on: date, value, note: null, client_updated_at: new Date(NOW).toISOString(), base_seq: base,
})
const update = (title: string, base: number): Op => {
  const w = goalToWire(input({ title }))
  return { type: "goal.update", op_id: id("u"), goal_id: GOAL, base_version: base, goal: w.goal, habits: w.habits, checkpoints: w.checkpoints }
}

async function device(server: FakeServer, storage = memoryStorage()) {
  const transport = fakeTransport(server)
  const engine = new SyncEngine({ transport, storage, deviceId: "dev", now: () => NOW, schedule: () => () => {} })
  await engine.start()
  return { engine, transport, storage }
}

describe("goals over the sync engine", () => {
  it("creates and measures optimistically, then converges with the server", async () => {
    const server = new FakeServer(TODAY, () => NOW)
    const { engine } = await device(server)
    engine.submit(create())
    engine.submit(measure("2026-10-20", 81))
    expect(engine.getSnapshot().state.goals.map((g) => g.title)).toEqual(["Bajar a 78 kg"])
    expect(engine.getSnapshot().state.measurements[measurementKey(GOAL, "2026-10-20")]?.value).toBe(81)
    await engine.sync()
    expect(engine.getSnapshot()).toMatchObject({ status: "synced", pending: 0, goals: true })
    expect(engine.getSnapshot().state.goals[0]).toMatchObject({ id: GOAL, version: 1, checkpoints: [{ id: CP, title: "Revisión médica" }] })
  })

  it("an offline measurement survives an app restart and is applied exactly once", async () => {
    const server = new FakeServer(TODAY, () => NOW)
    const a = await device(server)
    a.engine.submit(create())
    await a.engine.sync()
    a.transport.online = false
    const op = measure("2026-10-21", 80.4)
    a.engine.submit(op)
    await a.engine.sync()
    expect(a.engine.getSnapshot().pending).toBe(1)
    a.engine.stop()

    const b = await device(server, a.storage) // same device, reopened
    expect(b.engine.getSnapshot().state.measurements[measurementKey(GOAL, "2026-10-21")]?.value).toBe(80.4)
    await b.engine.sync()
    expect(server.applied.get(op.op_id)).toBe(1)
    expect(b.engine.getSnapshot().pending).toBe(0)
  })

  it("compacts several values for the same day into the last one before sending", async () => {
    const server = new FakeServer(TODAY, () => NOW)
    const { engine, transport } = await device(server)
    engine.submit(create())
    await engine.sync()
    transport.online = false
    engine.submit(measure("2026-10-21", 81))
    engine.submit(measure("2026-10-21", 80.8))
    expect(engine.getSnapshot().pending).toBe(1)
  })

  it("a concurrent edit of the definition is a conflict the user can re-apply", async () => {
    const server = new FakeServer(TODAY, () => NOW)
    const phone = await device(server)
    phone.engine.submit(create())
    await phone.engine.sync()
    const laptop = await device(server)
    await laptop.engine.sync()

    laptop.engine.submit(update("Bajar a 77 kg", laptop.engine.goalVersion(GOAL)))
    await laptop.engine.sync()
    phone.engine.submit(update("Bajar a 76 kg", 1)) // based on the old version
    await phone.engine.sync()
    const notice = phone.engine.getSnapshot().notices[0]
    // Named as this device knew it (the notice is raised before the pull that brings the other edit).
    expect(notice).toMatchObject({ kind: "conflict", opType: "goal.update", subject: "Bajar a 78 kg" })
    expect(phone.engine.getSnapshot().state.goals[0].title).toBe("Bajar a 77 kg")
  })

  it("milestone ticks from two devices converge", async () => {
    const server = new FakeServer(TODAY, () => NOW)
    const a = await device(server)
    a.engine.submit(create())
    await a.engine.sync()
    const b = await device(server)
    await b.engine.sync()
    a.engine.submit({ type: "goal.checkpoint.set", op_id: id("cp"), goal_id: GOAL, checkpoint_id: CP, done_on: TODAY })
    await a.engine.sync()
    await b.engine.sync()
    expect(b.engine.getSnapshot().state.goals[0].checkpoints[0].doneOn).toBe(TODAY)
  })
})

describe("mergePull for goals", () => {
  it("keeps the newest row, applies tombstones and flags server support", () => {
    const base = emptyCache(TODAY)
    const goalRow = { ...goalToWire(input()).goal, id: GOAL, state: "active" as const, closed_on: null, archived_on: null, version: 2, created_at: "", updated_at: "", server_seq: 10, habits: [], checkpoints: [] }
    const m = { goal_id: GOAL, observed_on: "2026-10-20", value: 81, note: null, deleted: false, client_op_id: "x", client_updated_at: "", server_seq: 11 }
    const pull = (p: object) => ({ server_today: TODAY, full: false, profile: null, dimensions: [], habits: [], entries: [], rest_days: [], cursor: 11, ...p })
    let c = mergePull(base, pull({ goals: [goalRow], measurements: [m] }))
    expect(c.state.goals[0].version).toBe(2)
    expect(c.features).toEqual({ goals: true, focus: false, checkins: false, reviews: false })
    c = mergePull(c, pull({ goals: [{ ...goalRow, title: "viejo", server_seq: 9 }] }))
    expect(c.state.goals[0].title).toBe("Bajar a 78 kg")
    c = mergePull(c, pull({ measurements: [{ ...m, deleted: true, value: null, server_seq: 12 }] }))
    expect(c.state.measurements).toEqual({})
    // A server without the migration: goals stay off in account mode.
    expect(mergePull(base, pull({})).features).toEqual({ goals: false, focus: false, checkins: false, reviews: false })
  })
})
