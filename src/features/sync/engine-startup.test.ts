import { describe, expect, it } from "vitest"
import { memoryStorage, SyncEngine } from "./engine"
import type { Op } from "./domain/types"
import { FakeServer, fakeTransport } from "./testing/fake-server"

/**
 * M4f regression (found by the Linux CI of ci/m4, run 41183910815): a sync() asked for before
 * start() has read the saved copy (the realtime channel connecting first) ran a cycle with an empty
 * queue and then waited on the pull, so the pending change was not sent until the next cycle.
 * A sync() before the copy is loaded must wait for it, and the first cycle must send the queue.
 */
const TODAY = "2026-10-21"
const NOW = Date.parse("2026-10-21T10:00:00Z")
const HABIT = "11111111-1111-4111-8111-111111111111"

const createHabit = (): Op => ({
  type: "habit.create",
  op_id: "create-1",
  habit: { id: HABIT, title: "Leer", icon: "book-open", dimension: "learn", habit_type: "binary", unit: null, target_value: null, target_direction: null, start_date: "2026-10-01" },
  versions: [{ valid_from: "2026-10-01", rule: { kind: "daily" } }],
})
const mark = (): Op => ({ type: "entry.set", op_id: "entry-1", habit_id: HABIT, local_date: TODAY, value: true, client_updated_at: new Date(NOW).toISOString(), base_seq: null })

describe("SyncEngine · startup ordering", () => {
  it("a sync asked for while the saved copy is still loading sends the saved queue first, before any pull", async () => {
    const server = new FakeServer(TODAY, () => NOW)
    // A first device creates the habit and leaves one change pending (offline), saved.
    const storage = memoryStorage()
    const t1 = fakeTransport(server)
    const first = new SyncEngine({ transport: t1, storage, deviceId: "dev-a", now: () => NOW, schedule: () => () => {} })
    await first.start()
    first.submit(createHabit())
    await first.sync()
    t1.online = false
    first.submit(mark())
    await first.sync()
    first.stop()
    expect(storage.data?.queue.map((q) => q.op.op_id)).toEqual(["entry-1"])

    // The app reopens: loading the copy is slow, and realtime asks for a sync in the meantime.
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const slow = { ...storage, load: async () => (await gate, storage.load()) }
    const t2 = fakeTransport(server)
    const calls: string[] = []
    const applyOps = t2.applyOps.bind(t2)
    const pull = t2.pull.bind(t2)
    t2.applyOps = async (d: string, ops: Op[]) => (calls.push(`push:${ops.map((o) => o.op_id).join(",")}`), applyOps(d, ops))
    t2.pull = async (since: number) => (calls.push("pull"), pull(since))
    const second = new SyncEngine({ transport: t2, storage: slow, deviceId: "dev-a", now: () => NOW, schedule: () => () => {} })
    const started = second.start()
    const early = second.sync() // what the realtime «SUBSCRIBED» callback does
    await Promise.resolve()
    expect(calls).toEqual([]) // nothing runs before the copy is loaded
    release()
    await Promise.all([started, early])
    expect(calls[0]).toBe("push:entry-1")
    expect(calls.indexOf("push:entry-1")).toBeLessThan(calls.indexOf("pull"))
    // one cycle for both requests: the change is sent once, and there is one pull, not two in parallel
    expect(calls.filter((c) => c.includes("entry-1"))).toHaveLength(1)
    expect(calls.filter((c) => c === "pull")).toHaveLength(1)
    expect(server.entryCount()).toBe(1)
    expect(second.getSnapshot()).toMatchObject({ pending: 0 })
    expect(storage.data?.queue).toEqual([])
  })

  it("the saved queue survives a start-up whose first cycle cannot reach the server, and is sent once later", async () => {
    const server = new FakeServer(TODAY, () => NOW)
    const storage = memoryStorage()
    const t1 = fakeTransport(server)
    const first = new SyncEngine({ transport: t1, storage, deviceId: "dev-a", now: () => NOW, schedule: () => () => {} })
    await first.start()
    first.submit(createHabit())
    await first.sync()
    t1.online = false
    first.submit(mark())
    await first.sync()
    first.stop()

    const t2 = fakeTransport(server)
    t2.online = false
    const second = new SyncEngine({ transport: t2, storage, deviceId: "dev-a", now: () => NOW, schedule: () => () => {} })
    await Promise.all([second.start(), second.sync()])
    expect(second.getSnapshot()).toMatchObject({ pending: 1 })
    expect(storage.data?.queue.map((q) => q.op.op_id)).toEqual(["entry-1"])
    t2.online = true
    await second.sync()
    await second.sync()
    expect(server.entryCount()).toBe(1)
    expect(storage.data?.queue).toEqual([])
  })
})
