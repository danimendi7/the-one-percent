import { describe, expect, it } from "vitest"
import { memoryStorage, SyncEngine } from "./engine"
import { FakeServer, fakeTransport } from "./testing/fake-server"
import { upgradePersisted } from "./domain/persisted"
import { enqueue } from "./domain/rebase"
import { DEFAULT_SETTINGS } from "@/features/notifications/domain/motivation"

/** E6 · Notification settings over the real sync engine. */
const TODAY = "2026-11-10"
let n = 0
const id = (p: string) => `${p}-${String(++n).padStart(8, "0")}`
function world() {
  const clock = { now: Date.parse("2026-11-10T10:00:00Z") }
  return { clock, server: new FakeServer(TODAY, () => clock.now) }
}
async function device(w: ReturnType<typeof world>, storage = memoryStorage()) {
  const transport = fakeTransport(w.server)
  const engine = new SyncEngine({ transport, storage, deviceId: id("dev"), now: () => w.clock.now, schedule: () => () => {} })
  await engine.start()
  return { engine, transport, storage }
}
async function settle(e: SyncEngine) {
  const running = () => (e as unknown as { running: Promise<void> | null }).running
  await e.sync()
  for (let i = 0; i < 20 && running(); i++) await running()
}

describe("notification settings over the sync engine", () => {
  it("start with the defaults, and a change reaches the other device", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    expect(a.engine.getSnapshot().state.motivation).toEqual(DEFAULT_SETTINGS)
    a.engine.submit({ type: "profile.motivation", op_id: id("m"), settings: { ...DEFAULT_SETTINGS, tone: "calm", dailyCap: 2 } })
    expect(a.engine.getSnapshot().state.motivation).toMatchObject({ tone: "calm", dailyCap: 2 })
    await settle(a.engine)
    await settle(b.engine)
    expect(b.engine.getSnapshot().state.motivation).toMatchObject({ tone: "calm", dailyCap: 2 })
    expect(b.engine.getSnapshot().motivation).toBe(true)
  })

  it("several quick changes travel as the last one only", () => {
    const op = (dailyCap: number) => ({ type: "profile.motivation" as const, op_id: id("m"), settings: { ...DEFAULT_SETTINGS, dailyCap } })
    let q = enqueue([], op(2), 0, new Set())
    q = enqueue(q, op(3), 1, new Set())
    q = enqueue(q, op(5), 2, new Set())
    expect(q).toHaveLength(1)
    expect(q[0].op).toMatchObject({ settings: { dailyCap: 5 } })
  })

  it("a change made offline survives closing the app", async () => {
    const w = world()
    const a = await device(w)
    a.transport.online = false
    a.engine.submit({ type: "profile.motivation", op_id: id("m"), settings: { ...DEFAULT_SETTINGS, quietStart: "21:00" } })
    await settle(a.engine)
    a.engine.stop()
    const again = await device(w, a.storage)
    expect(again.engine.getSnapshot().state.motivation.quietStart).toBe("21:00")
    await settle(again.engine)
    expect(w.server.motivation()).toMatchObject({ quietStart: "21:00" })
  })

  it("a copy saved before E6 opens with the defaults", () => {
    expect(upgradePersisted({ cache: { state: { habits: [] } }, queue: [] } as never, TODAY)?.cache.state.motivation).toEqual(DEFAULT_SETTINGS)
  })
})
