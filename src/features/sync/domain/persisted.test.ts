import { describe, expect, it } from "vitest"
import { memoryStorage, SyncEngine, type PersistedSync } from "../engine"
import { FakeServer, fakeTransport } from "../testing/fake-server"
import { upgradePersisted } from "./persisted"

const TODAY = "2026-10-21"
const NOW = Date.parse("2026-10-21T10:00:00Z")
const HABIT = "11111111-1111-4111-8111-111111111111"

/** Exactly the shape M3.0 (8bd8070) saved in IndexedDB: no goals, measurements or features. */
function m30Copy() {
  return {
    cache: {
      state: {
        version: 1,
        timezone: "Europe/Madrid",
        dimensions: [{ id: "mind", name: "Mente" }],
        habits: [{ id: HABIT, name: "Respirar", icon: "wind", dimensionId: "mind", type: "binary", schedule: [{ validFrom: "2026-10-01", rule: { kind: "daily" } }], startDate: "2026-10-01", archivedOn: null, createdAt: "2026-10-01T08:00:00Z" }],
        entries: {},
        restDays: [],
        seededOn: "2026-10-01",
      },
      habitVersion: { [HABIT]: 1 },
      rowSeq: { [`h:${HABIT}`]: 3 },
      cursor: 3,
      serverToday: "2026-10-20",
    },
    queue: [
      {
        op: { type: "entry.set", op_id: "op-legacy-1", habit_id: HABIT, local_date: "2026-10-20", value: true, client_updated_at: "2026-10-20T09:00:00.000Z", base_seq: null },
        enqueuedAt: NOW - 3600_000,
        attempts: 1,
      },
    ],
  }
}

describe("upgradePersisted (copies saved by older versions)", () => {
  it("adds the fields M3.1 introduced and keeps everything else untouched, including the queue", () => {
    const old = m30Copy()
    const up = upgradePersisted(structuredClone(old), TODAY)!
    expect(up.cache.state.goals).toEqual([])
    expect(up.cache.state.measurements).toEqual({})
    expect(up.cache.state.habits).toEqual(old.cache.state.habits)
    expect(up.cache.state.seededOn).toBe("2026-10-01")
    expect(up.cache).toMatchObject({ cursor: 3, serverToday: "2026-10-20", habitVersion: old.cache.habitVersion, rowSeq: old.cache.rowSeq })
    // Capabilities are unknown until the next pull: goals stay off until the server confirms them.
    expect(up.cache.features).toBeUndefined()
    expect(up.queue).toEqual(old.queue)
  })

  it("is a no-op on a current copy", () => {
    const current = { ...m30Copy(), cache: { ...m30Copy().cache, state: { ...m30Copy().cache.state, goals: [], measurements: {} }, features: { goals: true } } }
    expect(upgradePersisted(structuredClone(current), TODAY)).toEqual(current)
  })

  it("never throws on damaged data and keeps any recoverable pending work", () => {
    expect(upgradePersisted(null, TODAY)).toBeNull()
    expect(upgradePersisted("x", TODAY)).toBeNull()
    const queueOnly = upgradePersisted({ cache: 42, queue: m30Copy().queue }, TODAY)!
    expect(queueOnly.queue).toHaveLength(1)
    expect(queueOnly.cache.state.goals).toEqual([])
  })
})

describe("engine started from an M3.0 copy", () => {
  it("renders goals without crashing, sends the pending op exactly once and saves the upgraded copy", async () => {
    const server = new FakeServer(TODAY, () => NOW)
    // The habit exists on the server, as it did when M3.0 saved the copy.
    fakeTransport(server).applyOps("other", [
      { type: "habit.create", op_id: "seed", habit: { id: HABIT, title: "Respirar", icon: "wind", dimension: "mind", habit_type: "binary", unit: null, target_value: null, target_direction: null, start_date: "2026-10-01" }, versions: [{ valid_from: "2026-10-01", rule: { kind: "daily" } }] },
    ])
    const storage = memoryStorage(m30Copy() as unknown as PersistedSync)
    let snapshotBeforePull: ReturnType<SyncEngine["getSnapshot"]> | null = null
    const transport = fakeTransport(server)
    const pull = transport.pull.bind(transport)
    transport.pull = (since) => {
      snapshotBeforePull ??= engine.getSnapshot()
      return pull(since)
    }
    const engine = new SyncEngine({ transport, storage, deviceId: "dev", now: () => NOW, schedule: () => () => {} })
    await engine.start()

    // The cached copy was usable (and goal-safe) before the network answered.
    expect(snapshotBeforePull!.state.goals).toEqual([])
    expect(snapshotBeforePull!.state.measurements).toEqual({})
    expect(server.applied.get("op-legacy-1")).toBe(1)
    expect(engine.getSnapshot()).toMatchObject({ status: "synced", pending: 0, goals: true })
    expect(storage.data!.cache.state.goals).toEqual([])
    expect(storage.data!.queue).toEqual([])
  })
})
