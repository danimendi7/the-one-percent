import { describe, expect, it } from "vitest"
import { entryKey } from "@/features/habits/domain/types"
import { memoryStorage, SyncEngine } from "./engine"
import type { Op } from "./domain/types"
import { FakeServer, fakeTransport } from "./testing/fake-server"

const TODAY = "2026-10-21" // Wednesday
const NOW = Date.parse("2026-10-21T10:00:00Z")
const HABIT = "11111111-1111-4111-8111-111111111111"

let n = 0
const id = (p: string) => `${p}-${String(++n).padStart(8, "0")}`

function createHabit(): Op {
  return {
    type: "habit.create",
    op_id: id("create"),
    habit: {
      id: HABIT, title: "Leer", icon: "book-open", dimension: "learn", habit_type: "binary",
      unit: null, target_value: null, target_direction: null, start_date: "2026-10-01",
    },
    versions: [{ valid_from: "2026-10-01", rule: { kind: "daily" } }],
  }
}

function mark(date: string, value: boolean | number | null, at = NOW, base: number | null = null): Op {
  return { type: "entry.set", op_id: id("entry"), habit_id: HABIT, local_date: date, value, client_updated_at: new Date(at).toISOString(), base_seq: base }
}

/** Manual scheduler: retries only run when the test says so. */
function manualTimers() {
  const pending: (() => void)[] = []
  return {
    schedule: (fn: () => void) => {
      pending.push(fn)
      return () => {
        const i = pending.indexOf(fn)
        if (i >= 0) pending.splice(i, 1)
      }
    },
    pending,
  }
}

async function device(server: FakeServer, opts: { deviceId?: string; storage?: ReturnType<typeof memoryStorage>; skewMs?: number } = {}) {
  const transport = fakeTransport(server)
  const storage = opts.storage ?? memoryStorage()
  const timers = manualTimers()
  const engine = new SyncEngine({ transport, storage, deviceId: opts.deviceId ?? "dev-a", now: () => NOW + (opts.skewMs ?? 0), schedule: timers.schedule })
  await engine.start()
  return { engine, transport, storage, timers }
}

describe("SyncEngine", () => {
  it("applies writes optimistically and confirms them on the server", async () => {
    const server = new FakeServer(TODAY, () => NOW)
    const { engine } = await device(server)
    engine.submit(createHabit())
    engine.submit(mark(TODAY, true))
    // Optimistic: visible before the network round-trip completes
    expect(engine.getSnapshot().state.entries[entryKey(HABIT, TODAY)]?.value).toBe(true)
    await engine.sync()
    expect(server.entryCount()).toBe(1)
    expect(engine.getSnapshot()).toMatchObject({ status: "synced", pending: 0 })
  })

  it("an offline write is queued durably and syncs exactly once after reconnecting (acceptance #2)", async () => {
    const server = new FakeServer(TODAY, () => NOW)
    const a = await device(server)
    a.engine.submit(createHabit())
    await a.engine.sync()

    a.transport.online = false
    const op = mark(TODAY, true)
    a.engine.submit(op)
    await a.engine.sync()
    expect(a.engine.getSnapshot().status).toBe("offline")
    expect(a.engine.getSnapshot().pending).toBe(1)
    expect(a.storage.data?.queue.map((q) => q.op.op_id)).toContain(op.op_id)

    // App restarts while still offline: the queue survives
    const restarted = new SyncEngine({ transport: a.transport, storage: a.storage, deviceId: "dev-a", now: () => NOW, schedule: manualTimers().schedule })
    await restarted.start()
    expect(restarted.getSnapshot().state.entries[entryKey(HABIT, TODAY)]?.value).toBe(true)

    a.transport.online = true
    await restarted.sync()
    expect(server.applied.get(op.op_id)).toBe(1)
    expect(server.entryCount()).toBe(1)
    expect(restarted.getSnapshot()).toMatchObject({ status: "synced", pending: 0 })
  })

  it("a lost acknowledgement is retried without double-applying (idempotent op ids)", async () => {
    const server = new FakeServer(TODAY, () => NOW)
    const { engine, transport, timers } = await device(server)
    engine.submit(createHabit())
    await engine.sync()
    const op = mark(TODAY, 3 > 2)
    transport.dropNextResponse = true
    engine.submit(op)
    await engine.sync()
    expect(engine.getSnapshot().status).toBe("offline")
    expect(timers.pending.length).toBeGreaterThan(0)
    await engine.sync()
    expect(server.applied.get(op.op_id)).toBe(1)
    expect(engine.getSnapshot().pending).toBe(0)
  })

  it("compacts unsent toggles of the same day into the latest desired state", async () => {
    const server = new FakeServer(TODAY, () => NOW)
    const { engine, transport } = await device(server)
    engine.submit(createHabit())
    await engine.sync()
    transport.online = false
    engine.submit(mark(TODAY, true))
    engine.submit(mark(TODAY, null))
    engine.submit(mark(TODAY, true))
    expect(engine.getSnapshot().pending).toBe(1)
    transport.online = true
    await engine.sync()
    expect(server.entryCount()).toBe(1)
  })

  it("a mark on device A appears on device B without duplicates (acceptance #2)", async () => {
    const server = new FakeServer(TODAY, () => NOW)
    const a = await device(server, { deviceId: "phone" })
    const b = await device(server, { deviceId: "desktop" })
    a.engine.submit(createHabit())
    a.engine.submit(mark(TODAY, true))
    await a.engine.sync()
    await b.engine.sync()
    expect(b.engine.getSnapshot().state.habits.map((h) => h.id)).toEqual([HABIT])
    expect(b.engine.getSnapshot().state.entries[entryKey(HABIT, TODAY)]?.value).toBe(true)
    // B unmarks; A converges to "not done" (tombstone propagates on incremental pull)
    b.engine.submit(mark(TODAY, null, NOW + 1000))
    await b.engine.sync()
    await a.engine.sync()
    expect(a.engine.getSnapshot().state.entries[entryKey(HABIT, TODAY)]).toBeUndefined()
  })

  it("last writer wins between devices: an older offline intent does not overwrite a newer one", async () => {
    const server = new FakeServer(TODAY, () => NOW)
    const a = await device(server, { deviceId: "phone" })
    const b = await device(server, { deviceId: "desktop" })
    a.engine.submit(createHabit())
    await a.engine.sync()
    await b.engine.sync()

    a.transport.online = false
    a.engine.submit(mark(TODAY, true, NOW + 1_000)) // phone marks at t1 while offline
    b.engine.submit(mark(TODAY, null, NOW + 5_000)) // desktop clears at t2 > t1
    await b.engine.sync()
    a.transport.online = true
    await a.engine.sync()
    expect(server.entryCount()).toBe(0)
    expect(a.engine.getSnapshot().state.entries[entryKey(HABIT, TODAY)]).toBeUndefined()
  })

  it("concurrent habit edits produce a conflict notice instead of a silent overwrite", async () => {
    const server = new FakeServer(TODAY, () => NOW)
    const a = await device(server, { deviceId: "phone" })
    const b = await device(server, { deviceId: "desktop" })
    a.engine.submit(createHabit())
    await a.engine.sync()
    await b.engine.sync()

    const edit = (title: string, base: number): Op => ({ type: "habit.update", op_id: id("upd"), habit_id: HABIT, base_version: base, patch: { title } })
    a.engine.submit(edit("Leer 30 min", a.engine.habitVersion(HABIT)))
    await a.engine.sync()
    b.engine.submit(edit("Lectura nocturna", b.engine.habitVersion(HABIT)))
    await b.engine.sync()

    const snap = b.engine.getSnapshot()
    expect(snap.state.habits[0].name).toBe("Leer 30 min")
    expect(snap.notices).toHaveLength(1)
    expect(snap.notices[0]).toMatchObject({ kind: "conflict", opType: "habit.update" })
  })

  it("server rejections are surfaced and removed from the queue", async () => {
    const server = new FakeServer(TODAY, () => NOW)
    const { engine } = await device(server)
    engine.submit(createHabit())
    engine.submit(mark("2026-10-30", true)) // future: rejected locally and by the server
    await engine.sync()
    const snap = engine.getSnapshot()
    expect(snap.pending).toBe(0)
    expect(snap.notices[0]).toMatchObject({ kind: "rejected", code: "future_date" })
  })

  it("schedule edits keep historical versions on every device", async () => {
    const server = new FakeServer(TODAY, () => NOW)
    const a = await device(server)
    const b = await device(server, { deviceId: "desktop" })
    a.engine.submit(createHabit())
    await a.engine.sync()
    a.engine.submit({
      type: "habit.update", op_id: id("upd"), habit_id: HABIT, base_version: a.engine.habitVersion(HABIT),
      patch: {}, schedule: { effective_from: TODAY, rule: { kind: "weekdays", weekdays: [1, 3] } },
    })
    await a.engine.sync()
    await b.engine.sync()
    expect(b.engine.getSnapshot().state.habits[0].schedule.map((v) => v.validFrom)).toEqual(["2026-10-01", TODAY])
  })
})

describe("conflict resolution v2: clocks are not the primary arbiter", () => {
  const HOUR = 3_600_000

  it("learns the server clock offset, so hybrid times are correct even on a skewed device", async () => {
    const server = new FakeServer(TODAY, () => NOW)
    const { engine } = await device(server, { skewMs: -2 * HOUR })
    const t = Date.parse(engine.clientTime())
    expect(Math.abs(t - NOW)).toBeLessThan(1000)
    // strictly increasing on the device
    expect(Date.parse(engine.clientTime())).toBeGreaterThan(t)
  })

  it("a sequential edit wins even if its raw device time is hours older", async () => {
    const server = new FakeServer(TODAY, () => NOW)
    const a = await device(server, { deviceId: "phone" })
    const b = await device(server, { deviceId: "desktop", skewMs: -2 * HOUR })
    a.engine.submit(createHabit())
    a.engine.submit(mark(TODAY, true, NOW))
    await a.engine.sync()
    await b.engine.sync() // B has now seen A's mark
    const base = b.engine.rowSeq("entry", HABIT, TODAY)
    expect(base).not.toBeNull()
    b.engine.submit(mark(TODAY, null, NOW - 2 * HOUR, base)) // raw old time, but sequential
    await b.engine.sync()
    expect(server.entryCount()).toBe(0)
    await a.engine.sync()
    expect(a.engine.getSnapshot().state.entries[entryKey(HABIT, TODAY)]).toBeUndefined()
  })

  it("truly concurrent edits fall back to the hybrid time", async () => {
    const server = new FakeServer(TODAY, () => NOW + 10_000)
    const a = await device(server, { deviceId: "phone" })
    const b = await device(server, { deviceId: "desktop" })
    a.engine.submit(createHabit())
    await a.engine.sync()
    await b.engine.sync()
    const seen = b.engine.rowSeq("entry", HABIT, TODAY) // null: neither saw an entry row
    a.engine.submit(mark(TODAY, true, NOW + 5_000, seen))
    await a.engine.sync()
    b.engine.submit(mark(TODAY, null, NOW + 1_000, seen)) // concurrent and earlier → loses
    await b.engine.sync()
    expect(server.entryCount()).toBe(1)
    b.engine.submit(mark(TODAY, null, NOW + 9_000, null)) // concurrent and later → wins
    await b.engine.sync()
    expect(server.entryCount()).toBe(0)
  })

  it("a device clock running far ahead is clamped by the server and cannot win forever", async () => {
    let serverNow = NOW
    const server = new FakeServer(TODAY, () => serverNow)
    const fast = await device(server, { deviceId: "fast" })
    const normal = await device(server, { deviceId: "normal" })
    fast.engine.submit(createHabit())
    fast.engine.submit(mark(TODAY, true, NOW + 24 * HOUR)) // claims tomorrow
    await fast.engine.sync()
    serverNow = NOW + 2 * 60_000 // two minutes later on the server
    normal.engine.submit(mark(TODAY, null, serverNow, null)) // concurrent (never saw the row)
    await normal.engine.sync()
    expect(server.entryCount()).toBe(0)
  })
})
