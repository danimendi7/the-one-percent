import { describe, expect, it } from "vitest"
import { entryKey } from "@/features/habits/domain/types"
import { memoryStorage, SyncEngine, type PersistedSync, type SyncStorage } from "./engine"
import type { Op } from "./domain/types"
import { keyValueJournal, memoryKeyValue, type OpJournal } from "./journal"
import { FakeServer, fakeTransport } from "./testing/fake-server"

/**
 * Orden 2 §1: a change shown on screen survives closing the app at once, before the device copy
 * (IndexedDB, asynchronous) holds it. The journal is written synchronously before listeners hear.
 */
const TODAY = "2026-10-21"
const NOW = Date.parse("2026-10-21T10:00:00Z")
const HABIT = "11111111-1111-4111-8111-111111111111"

let n = 0
const id = (p: string) => `${p}-${String(++n).padStart(8, "0")}`

const createHabit = (): Op => ({
  type: "habit.create",
  op_id: id("create"),
  habit: { id: HABIT, title: "Leer", icon: "book-open", dimension: "learn", habit_type: "binary", unit: null, target_value: null, target_direction: null, start_date: "2026-10-01" },
  versions: [{ valid_from: "2026-10-01", rule: { kind: "daily" } }],
})
const mark = (value: boolean): Op => ({ type: "entry.set", op_id: id("entry"), habit_id: HABIT, local_date: TODAY, value, client_updated_at: new Date(NOW).toISOString(), base_seq: null })

/** A device copy whose writes can be made to never finish, as when the app is closed mid-write. */
function slowStorage(): SyncStorage & { data: PersistedSync | null; hang: boolean } {
  const inner = memoryStorage()
  const s = {
    hang: false,
    get data() {
      return inner.data
    },
    load: () => inner.load(),
    save: (d: PersistedSync) => (s.hang ? new Promise<void>(() => {}) : inner.save(d)),
  }
  return s
}

const noTimers = () => () => {}

function open(server: FakeServer, storage: SyncStorage, journal: OpJournal) {
  const transport = fakeTransport(server)
  const engine = new SyncEngine({ transport, storage, journal, deviceId: "dev-a", now: () => NOW, schedule: noTimers })
  return { engine, transport }
}

describe("queue journal (Orden 2 §1)", () => {
  it("a write is in the journal before anything is shown", async () => {
    const server = new FakeServer(TODAY, () => NOW)
    const journal = keyValueJournal("u1", memoryKeyValue())
    const { engine } = open(server, memoryStorage(), journal)
    await engine.start()
    const op = createHabit()
    const seen: string[][] = []
    engine.subscribe(() => seen.push(journal.read().map((e) => e.opId)))
    engine.submit(op)
    expect(seen[0]).toContain(op.op_id)
  })

  it("closed offline before the device copy holds the write: reopened, it is there and reaches the server once", async () => {
    const server = new FakeServer(TODAY, () => NOW)
    const storage = slowStorage()
    const journal = keyValueJournal("u1", memoryKeyValue())
    const a = open(server, storage, journal)
    await a.engine.start()
    a.engine.submit(createHabit())
    await a.engine.sync()
    await expect.poll(() => storage.data?.queue).toEqual([])

    a.transport.online = false
    storage.hang = true
    const op = mark(true)
    a.engine.submit(op)
    expect(a.engine.getSnapshot().state.entries[entryKey(HABIT, TODAY)]?.value).toBe(true)
    a.engine.stop() // swiped away: the IndexedDB write never finishes
    expect(storage.data?.queue.map((q) => q.op.op_id)).not.toContain(op.op_id)

    storage.hang = false
    const b = open(server, storage, journal)
    b.transport.online = false
    await b.engine.start()
    expect(b.engine.getSnapshot().state.entries[entryKey(HABIT, TODAY)]?.value).toBe(true)
    expect(b.engine.getSnapshot().pending).toBe(1)

    b.transport.online = true
    await b.engine.sync()
    expect(server.entryCount()).toBe(1)
    expect(b.engine.getSnapshot()).toMatchObject({ status: "synced", pending: 0 })
    // Opened again: nothing left to replay.
    const c = open(server, storage, journal)
    await c.engine.start()
    expect(c.engine.getSnapshot().pending).toBe(0)
    expect(server.entryCount()).toBe(1)
  })

  it("an entry is released once the device copy holds it", async () => {
    const server = new FakeServer(TODAY, () => NOW)
    const kv = memoryKeyValue()
    const journal = keyValueJournal("u1", kv)
    const { engine, transport } = open(server, memoryStorage(), journal)
    await engine.start()
    transport.online = false
    engine.submit(createHabit())
    expect(journal.read()).toHaveLength(1)
    await engine.sync()
    expect(journal.read()).toEqual([])
  })

  it("a write folded into a newer one offline comes back as the newer one only", async () => {
    const server = new FakeServer(TODAY, () => NOW)
    const storage = slowStorage()
    const journal = keyValueJournal("u1", memoryKeyValue())
    const a = open(server, storage, journal)
    await a.engine.start()
    a.engine.submit(createHabit())
    await a.engine.sync()
    a.transport.online = false
    a.engine.submit(mark(true))
    await a.engine.sync() // the first mark reaches the device copy
    storage.hang = true
    a.engine.submit(mark(false)) // folds the first mark; the copy still holds the old one
    a.engine.stop()
    expect(storage.data?.queue.map((q) => q.op.type)).toEqual(["entry.set"])

    storage.hang = false
    const b = open(server, storage, journal)
    b.transport.online = false
    await b.engine.start()
    expect(b.engine.getSnapshot().pending).toBe(1)
    expect(b.engine.getSnapshot().state.entries[entryKey(HABIT, TODAY)]?.value ?? false).toBe(false)
    b.transport.online = true
    await b.engine.sync()
    expect(server.entryCount()).toBe(0)
    expect(b.engine.getSnapshot().pending).toBe(0)
  })

  it("storage refuses the journal during a fold: the old write survives, never neither", async () => {
    const server = new FakeServer(TODAY, () => NOW)
    const storage = slowStorage()
    const kv = memoryKeyValue()
    const journal = keyValueJournal("u1", kv)
    const a = open(server, storage, journal)
    await a.engine.start()
    a.engine.submit(createHabit())
    await a.engine.sync()
    a.transport.online = false
    a.engine.submit(mark(true))
    await a.engine.sync() // the first mark is in the device copy
    storage.hang = true
    // The next write fits nowhere: neither the new mark nor the removal of the old one is journaled.
    const setItem = kv.setItem
    kv.setItem = () => {
      throw new Error("QuotaExceededError")
    }
    a.engine.submit(mark(false))
    a.engine.stop()
    kv.setItem = setItem

    storage.hang = false
    const b = open(server, storage, journal)
    b.transport.online = false
    await b.engine.start()
    expect(b.engine.getSnapshot().pending).toBe(1)
    expect(b.engine.getSnapshot().state.entries[entryKey(HABIT, TODAY)]?.value).toBe(true)
  })

  it("without a usable journal the device copy still works as before", async () => {
    const server = new FakeServer(TODAY, () => NOW)
    const journal = keyValueJournal("u1", null)
    const storage = memoryStorage()
    const { engine } = open(server, storage, journal)
    await engine.start()
    engine.submit(createHabit())
    await engine.sync()
    expect(engine.getSnapshot()).toMatchObject({ status: "synced", pending: 0 })
    await expect.poll(() => storage.data?.queue).toEqual([])
  })
})
