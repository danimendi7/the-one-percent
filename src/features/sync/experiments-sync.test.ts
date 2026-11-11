import { describe, expect, it } from "vitest"
import { memoryStorage, SyncEngine } from "./engine"
import type { Op } from "./domain/types"
import { FakeServer, fakeTransport } from "./testing/fake-server"
import { upgradePersisted } from "./domain/persisted"

/** E3 · Experiments over the real sync engine. */
const TODAY = "2026-11-10"
const T0 = Date.parse("2026-11-10T10:00:00Z")
const EXP = "11111111-1111-4111-8111-111111111111"
let n = 0
const id = (p: string) => `${p}-${String(++n).padStart(8, "0")}`

function world() {
  const clock = { now: T0 }
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
const create = (): Op => ({ type: "experiment.create", op_id: id("x"), experiment: { id: EXP, title: "Sin móvil en la cama", metric_kind: "checkin", metric_ref: "energy", start_on: TODAY, days: 14 }, at: "2026-11-10T10:00:00.000Z" })
const close = (status: "finished" | "abandoned", note: string | null): Op => ({ type: "experiment.close", op_id: id("c"), experiment_id: EXP, status, ended_on: TODAY, note })
const exp = (e: SyncEngine) => e.getSnapshot().state.experiments[EXP]

describe("experiments over the sync engine", () => {
  it("one created offline survives closing the app and reaches the other device", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    a.transport.online = false
    a.engine.submit(create())
    await settle(a.engine)
    expect(exp(a.engine)).toMatchObject({ title: "Sin móvil en la cama", metric: { kind: "checkin", indicator: "energy" }, status: "active" })
    a.engine.stop()
    const again = await device(w, a.storage)
    await settle(again.engine)
    await settle(b.engine)
    expect(exp(b.engine)).toMatchObject({ metric: { kind: "checkin", indicator: "energy" }, startOn: TODAY, days: 14, status: "active" })
    expect(b.engine.getSnapshot().experiments).toBe(true)
  })

  it("closed on two devices, the first close stays", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    a.engine.submit(create())
    await settle(a.engine)
    await settle(b.engine)
    a.engine.submit(close("finished", "Dormí mejor"))
    await settle(a.engine)
    b.engine.submit(close("abandoned", null))
    await settle(b.engine)
    for (const e of [a.engine, b.engine]) expect(exp(e)).toMatchObject({ status: "finished", note: "Dormí mejor" })
    expect(b.engine.getSnapshot().notices).toEqual([])
  })

  it("deleted, it leaves no text on the server and disappears elsewhere", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    a.engine.submit(create())
    await settle(a.engine)
    await settle(b.engine)
    a.engine.submit({ type: "experiment.delete", op_id: id("d"), experiment_id: EXP })
    await settle(a.engine)
    await settle(b.engine)
    expect(exp(b.engine)).toBeUndefined()
    expect(w.server.experiment(EXP)).toMatchObject({ deleted: true, title: "", note: null })
  })

  it("a copy saved before experiments existed opens with nothing lost", () => {
    expect(upgradePersisted({ cache: { state: { habits: [] } }, queue: [] } as never, TODAY)?.cache.state.experiments).toEqual({})
  })
})
