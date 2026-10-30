import { describe, expect, it } from "vitest"
import { memoryStorage, SyncEngine } from "./engine"
import { entryKey } from "@/features/habits/domain/types"
import type { Op } from "./domain/types"
import { FakeServer, fakeTransport } from "./testing/fake-server"
import { reviewKey } from "@/features/reviews/domain/types"

/**
 * M3.4d · risk B: several tabs of the same user share one IndexedDB record (cache + queue).
 * Each tab used to write its own queue over the stored one, so an operation queued offline in a
 * tab that was then closed could vanish from the device. These tests open two engines over the
 * same storage, as two tabs do.
 */

const TODAY = "2026-10-29"
const WEEK = "2026-10-19"
const T0 = Date.parse("2026-10-29T10:00:00Z")
const HABIT = "11111111-1111-4111-8111-111111111111"
let n = 0
const id = (p: string) => `${p}-${String(++n).padStart(8, "0")}`

function world() {
  const clock = { now: T0 }
  return { clock, server: new FakeServer(TODAY, () => clock.now), storage: memoryStorage() }
}

async function tab(w: ReturnType<typeof world>, online = true) {
  const transport = fakeTransport(w.server)
  transport.online = online
  const engine = new SyncEngine({ transport, storage: w.storage, deviceId: "dev-shared", now: () => w.clock.now, schedule: () => () => {} })
  await engine.start()
  return { engine, transport }
}

async function settle(e: SyncEngine) {
  const running = () => (e as unknown as { running: Promise<void> | null }).running
  await e.sync()
  for (let i = 0; i < 20 && running(); i++) await running()
}

const habitOp = (): Op => ({
  type: "habit.create",
  op_id: id("h"),
  habit: { id: HABIT, title: "Leer", icon: "book", dimension: "learn", habit_type: "binary", unit: null, target_value: null, target_direction: null, start_date: "2026-10-01" },
  versions: [{ valid_from: "2026-10-01", rule: { kind: "daily" } }],
})

const mark = (e: SyncEngine, date: string, value = true): Op => ({
  type: "entry.set",
  op_id: id("e"),
  habit_id: HABIT,
  local_date: date,
  value,
  client_updated_at: e.clientTime(),
  base_seq: e.rowSeq("entry", HABIT, date),
})

async function withHabit(w: ReturnType<typeof world>) {
  const setup = await tab(w)
  setup.engine.submit(habitOp())
  await settle(setup.engine)
  setup.engine.stop()
}

const serverEntry = (w: ReturnType<typeof world>, date: string) =>
  w.server.pull(0).entries.find((e) => e.habit_id === HABIT && e.local_date === date) ?? null

describe("several tabs over one device copy", () => {
  it("an offline write of a tab closed afterwards is not overwritten by another tab", async () => {
    const w = world()
    await withHabit(w)
    const a = await tab(w)
    const b = await tab(w)
    a.transport.online = false
    b.transport.online = false
    a.engine.submit(mark(a.engine, "2026-10-27"))
    await settle(a.engine)
    // B writes after A: before the fix B saved its own queue over A's and A's write was gone.
    b.engine.submit(mark(b.engine, "2026-10-28"))
    await settle(b.engine)
    a.engine.stop() // the user closes tab A while still offline
    b.engine.stop()

    expect(w.storage.data?.queue.map((q) => q.op.type === "entry.set" && q.op.local_date).sort()).toEqual(["2026-10-27", "2026-10-28"])
    const c = await tab(w) // reopening the app, online
    await settle(c.engine)
    expect(serverEntry(w, "2026-10-27")?.value_bool).toBe(true)
    expect(serverEntry(w, "2026-10-28")?.value_bool).toBe(true)
    expect(c.engine.getSnapshot().pending).toBe(0)
  })

  it("an open tab adopts the other tab's pending writes and shows them", async () => {
    const w = world()
    await withHabit(w)
    const a = await tab(w)
    const b = await tab(w)
    a.transport.online = false
    b.transport.online = false
    a.engine.submit(mark(a.engine, "2026-10-27"))
    await settle(a.engine)
    a.engine.stop()
    b.engine.saveReview("week", WEEK, { "content.wins": "Leí" })
    await settle(b.engine)
    // B now holds A's write too and sends it when the connection returns.
    expect(b.engine.getSnapshot().state.entries[entryKey(HABIT, "2026-10-27")]?.value).toBe(true)
    b.transport.online = true
    await settle(b.engine)
    expect(serverEntry(w, "2026-10-27")?.value_bool).toBe(true)
    expect(w.server.review("week", WEEK)?.content).toEqual({ wins: "Leí" })
  })

  it("a write another tab already sent is applied once and not brought back", async () => {
    const w = world()
    await withHabit(w)
    const a = await tab(w)
    const b = await tab(w)
    a.transport.online = false
    b.transport.online = false
    const op = mark(a.engine, "2026-10-27")
    a.engine.submit(op)
    await settle(a.engine)
    b.engine.saveReview("week", WEEK, { "content.wins": "Leí" })
    await settle(b.engine) // B adopts A's write
    a.transport.online = true
    await settle(a.engine) // A sends both and forgets them
    expect(w.server.applied.get(op.op_id)).toBe(1)

    b.transport.online = true
    await settle(b.engine)
    // B may send it again before reading the device copy: the server ledger applies it once, and
    // neither tab writes it back to the device afterwards.
    expect(w.server.applied.get(op.op_id)).toBe(1)
    expect(w.storage.data?.queue).toEqual([])
    expect(b.engine.getSnapshot().pending).toBe(0)
  })

  it("a write compacted in one tab is replaced, not kept twice, in the other", async () => {
    const w = world()
    const a = await tab(w)
    const b = await tab(w)
    a.transport.online = false
    b.transport.online = false
    a.engine.saveReview("week", WEEK, { "content.wins": "Leí" })
    await settle(a.engine)
    b.engine.saveReview("week", WEEK, { "content.lessons": "Menos móvil" })
    await settle(b.engine) // B adopts A's first write
    a.engine.saveReview("week", WEEK, { "content.wins": "Leí cada día" })
    await settle(a.engine) // A folds its two writes into one
    a.engine.stop()
    b.engine.stop()
    const saves = (w.storage.data?.queue ?? []).filter((q) => q.op.type === "review.save")
    const wins = saves.map((q) => q.op.type === "review.save" && q.op.fields["content.wins"]).filter(Boolean)
    expect(wins).toEqual(["Leí cada día"])

    const c = await tab(w)
    await settle(c.engine)
    expect(w.server.review("week", WEEK)?.content).toEqual({ wins: "Leí cada día", lessons: "Menos móvil" })
    expect(c.engine.getSnapshot().notices).toEqual([])
    expect(c.engine.getSnapshot().state.reviews[reviewKey("week", WEEK)]?.content).toEqual({ wins: "Leí cada día", lessons: "Menos móvil" })
  })
})

describe("the list of removed ops is shared through the device copy", () => {
  it("a tab closed right after sending: the other tab neither sends it again nor writes it back", async () => {
    const w = world()
    await withHabit(w)
    const a = await tab(w)
    const b = await tab(w)
    a.transport.online = false
    b.transport.online = false
    const op = mark(a.engine, "2026-10-27")
    a.engine.submit(op)
    await settle(a.engine)
    b.engine.saveReview("week", WEEK, { "content.wins": "Leí" })
    await settle(b.engine) // B adopts A's write
    a.transport.online = true
    await settle(a.engine) // A sends it, records it as removed and is closed
    a.engine.stop()
    expect(w.storage.data?.goneOps).toContain(op.op_id)

    // B writes again (offline): it must read A's list from the device copy and drop the op.
    b.engine.saveReview("week", WEEK, { "content.lessons": "Menos móvil" })
    await settle(b.engine)
    expect(w.storage.data?.queue.map((q) => q.op.op_id)).not.toContain(op.op_id)
    const sent: Op[][] = []
    b.transport.beforeApply = (ops) => sent.push(ops)
    b.transport.online = true
    await settle(b.engine)
    expect(sent.flat().map((o) => o.op_id)).not.toContain(op.op_id)
    expect(w.server.applied.get(op.op_id)).toBe(1)
  })
})

describe("two tabs saving at the same instant", () => {
  /** Device copy with real latency between read and write, like IndexedDB. */
  function slowStorage() {
    const s = memoryStorage()
    const delay = () => new Promise((r) => setTimeout(r, 5))
    return {
      data: () => s.data,
      load: async () => {
        await delay()
        return s.load()
      },
      save: async (d: Parameters<typeof s.save>[0]) => {
        await delay()
        return s.save(d)
      },
    }
  }
  /** The browser's Web Lock, as a promise chain. */
  function mutex() {
    let tail: Promise<unknown> = Promise.resolve()
    return <T,>(fn: () => Promise<T>): Promise<T> => {
      const run = tail.then(fn, fn)
      tail = run.catch(() => {})
      return run
    }
  }

  async function race(lock: (<T>(fn: () => Promise<T>) => Promise<T>) | undefined) {
    const clock = { now: T0 }
    const server = new FakeServer(TODAY, () => clock.now)
    const storage = slowStorage()
    const open = async () => {
      const transport = fakeTransport(server)
      transport.online = false
      const engine = new SyncEngine({ transport, storage, deviceId: "dev-shared", now: () => clock.now, schedule: () => () => {}, lock })
      await engine.start()
      return engine
    }
    const a = await open()
    const b = await open()
    // Both tabs write offline in the same tick: their read-merge-write of the device copy overlap.
    a.saveReview("week", WEEK, { "content.wins": "Pestaña 1" })
    b.saveReview("week", "2026-10-12", { "content.wins": "Pestaña 2" })
    await new Promise((r) => setTimeout(r, 100))
    a.stop()
    b.stop()
    return (storage.data()?.queue ?? []).map((q) => (q.op.type === "review.save" ? q.op.fields["content.wins"] : null)).sort()
  }

  it("without the lock the overlapping saves can drop one tab's write from the device copy (why the lock exists)", async () => {
    expect(await race(undefined)).toHaveLength(1)
  })

  it("with the lock both writes are on the device copy", async () => {
    expect(await race(mutex())).toEqual(["Pestaña 1", "Pestaña 2"])
  })
})
