import { describe, expect, it } from "vitest"
import { memoryStorage, SyncEngine } from "./engine"
import type { Op } from "./domain/types"
import { FakeServer, fakeTransport } from "./testing/fake-server"
import { upgradePersisted } from "./domain/persisted"

/** D4 · Daily Discovery over the real sync engine: own topics and feedback, offline, two devices. */
const TODAY = "2026-11-10"
const T0 = Date.parse("2026-11-10T10:00:00Z")
const TOPIC = "11111111-1111-4111-8111-111111111111"
const KEY = "curated:dichotomy"
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

const createTopic = (): Op => ({ type: "discovery.topic.create", op_id: id("t"), topic: { id: TOPIC, title: "Mi tema", category: "Ciencia", body: "Lo que quiero recordar", source_title: "Un libro", source_url: null }, at: "2026-11-10T10:00:00.000Z" })
const feedback = (fields: Extract<Op, { type: "discovery.feedback.set" }>["fields"], at = "2026-11-10T10:00:00.000Z", key = KEY): Op => ({ type: "discovery.feedback.set", op_id: id("f"), topic_key: key, fields, local_date: TODAY, at })
const fb = (e: SyncEngine, key = KEY) => e.getSnapshot().state.discovery.feedback[key]
const topic = (e: SyncEngine) => e.getSnapshot().state.discovery.topics[TOPIC]

describe("discovery over the sync engine", () => {
  it("an own topic shows at once and reaches the other device", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    a.engine.submit(createTopic())
    expect(topic(a.engine)).toMatchObject({ title: "Mi tema", sourceTitle: "Un libro" })
    await settle(a.engine)
    await settle(b.engine)
    expect(topic(b.engine)).toMatchObject({ title: "Mi tema", category: "Ciencia", body: "Lo que quiero recordar", sourceTitle: "Un libro", sourceUrl: null })
    expect(b.engine.getSnapshot().discovery).toBe(true)
  })

  it("a rating given offline survives closing the app and is applied once", async () => {
    const w = world()
    const a = await device(w)
    a.transport.online = false
    a.engine.submit(feedback({ rating: 8 }))
    await settle(a.engine)
    expect(fb(a.engine)).toMatchObject({ rating: 8, decidedOn: TODAY })
    expect(a.engine.getSnapshot().pending).toBe(1)
    a.engine.stop()
    const again = await device(w, a.storage)
    expect(fb(again.engine).rating).toBe(8)
    await settle(again.engine)
    expect(again.engine.getSnapshot().pending).toBe(0)
    expect(w.server.topicFeedback(KEY)).toMatchObject({ rating: 8, saved: false, decided_on: TODAY })
  })

  it("a rating on one device and a bookmark on another both stay", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    a.engine.submit(feedback({ rating: 9 }))
    b.engine.submit(feedback({ saved: true }, "2026-11-10T10:00:01.000Z"))
    await settle(a.engine)
    await settle(b.engine)
    await settle(a.engine)
    for (const e of [a.engine, b.engine]) expect(fb(e)).toMatchObject({ rating: 9, saved: true })
  })

  it("the same field written on two devices keeps the latest, whichever arrives first", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    a.engine.submit(feedback({ rating: 9 }, "2026-11-10T12:00:00.000Z"))
    await settle(a.engine)
    b.engine.submit(feedback({ rating: 2 }, "2026-11-10T09:00:00.000Z"))
    await settle(b.engine)
    await settle(a.engine)
    expect(w.server.topicFeedback(KEY)?.rating).toBe(9)
    expect(fb(a.engine).rating).toBe(9)
    expect(fb(b.engine).rating).toBe(9)
  })

  it("a deleted topic disappears elsewhere with no text left on the server", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    a.engine.submit(createTopic())
    await settle(a.engine)
    await settle(b.engine)
    a.engine.submit({ type: "discovery.topic.delete", op_id: id("d"), topic_id: TOPIC })
    await settle(a.engine)
    await settle(b.engine)
    expect(topic(b.engine)).toBeUndefined()
    expect(w.server.discoveryTopic(TOPIC)).toMatchObject({ deleted: true, title: "", body: "", source_title: null })
  })

  it("a server without the migration keeps everything on the device, and it is sent once it is there", async () => {
    const w = world()
    w.server.discoverySupported = false
    const a = await device(w)
    a.engine.submit(feedback({ saved: true }))
    await settle(a.engine)
    expect(a.engine.getSnapshot()).toMatchObject({ pending: 1, discovery: false, notices: [] })
    expect(fb(a.engine).saved).toBe(true)
    w.server.discoverySupported = true
    await settle(a.engine)
    await settle(a.engine)
    expect(a.engine.getSnapshot()).toMatchObject({ pending: 0, discovery: true })
    expect(w.server.topicFeedback(KEY)?.saved).toBe(true)
  })

  it("a copy saved before discovery existed opens with nothing lost", () => {
    expect(upgradePersisted({ cache: { state: { habits: [] } }, queue: [] } as never, TODAY)?.cache.state.discovery).toEqual({ topics: {}, feedback: {} })
  })
})
