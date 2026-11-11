import { describe, expect, it } from "vitest"
import { memoryStorage, SyncEngine } from "./engine"
import type { Op } from "./domain/types"
import { FakeServer, fakeTransport } from "./testing/fake-server"
import { upgradePersisted } from "./domain/persisted"
import { nextSchedule, newSchedule } from "@/features/recall/domain/schedule"
import { answerOutcome, addCard, emptyRecall } from "@/features/recall/domain/ops"
import { recallAnswerOp, recallCreateOp } from "./domain/recall-wire"

/** D2 · Active Recall over the real sync engine: durable offline answers, two devices, deletes. */
const TODAY = "2026-11-09"
const T0 = Date.parse("2026-11-09T10:00:00Z")
const CARD = "11111111-1111-4111-8111-111111111111"
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

const create = (cardId = CARD, question = "¿Qué es?"): Op => ({ type: "recall.create", op_id: id("c"), card: { id: cardId, question, answer: "Esto", source_type: null, source_id: null }, local_date: TODAY, algorithm_version: 1, at: "2026-11-09T10:00:00.000Z" })
function answer(grade: "again" | "good", respondedAt: string, attemptId = id("a"), localDate = TODAY): Op {
  const s = nextSchedule(newSchedule(TODAY), grade, localDate)
  return { type: "recall.answer", op_id: id("r"), card_id: CARD, attempt_id: attemptId, grade, responded_at: respondedAt, local_date: localDate, due_on_before: TODAY, algorithm_version: 1, schedule: { state: s.state, reps: s.reps, lapses: s.lapses, ease_factor: s.easeFactor, interval_days: s.intervalDays, due_on: s.dueOn } }
}
const card = (e: SyncEngine, cardId = CARD) => e.getSnapshot().state.recall.cards[cardId]

describe("recall over the sync engine", () => {
  it("a card created on one device shows at once, reaches the server and the other device", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    a.engine.submit(create())
    expect(card(a.engine)).toMatchObject({ question: "¿Qué es?", schedule: { state: "new" } })
    await settle(a.engine)
    await settle(b.engine)
    expect(card(b.engine)).toMatchObject({ question: "¿Qué es?", schedule: { state: "new", dueOn: TODAY } })
    expect(b.engine.getSnapshot().recall).toBe(true)
  })

  it("an answer given offline survives closing the app and reaches the server once", async () => {
    const w = world()
    const a = await device(w)
    a.engine.submit(create())
    await settle(a.engine)
    a.transport.online = false
    a.engine.submit(answer("good", "2026-11-09T11:00:00.000Z", "attempt-1"))
    await settle(a.engine)
    expect(card(a.engine).schedule).toMatchObject({ state: "review", dueOn: "2026-11-10" })
    expect(a.engine.getSnapshot().pending).toBe(1)
    a.engine.stop()

    const again = await device(w, a.storage)
    expect(card(again.engine).schedule.dueOn).toBe("2026-11-10")
    await settle(again.engine)
    expect(again.engine.getSnapshot().pending).toBe(0)
    expect(w.server.recallAttempts()).toHaveLength(1)
    expect(w.server.recallCard(CARD)).toMatchObject({ state: "review", due_on: "2026-11-10" })
  })

  it("two devices answering the same card keep both attempts, and the latest answer sets the date", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    a.engine.submit(create())
    await settle(a.engine)
    await settle(b.engine)
    a.engine.submit(answer("good", "2026-11-09T12:00:00.000Z", "from-a"))
    b.engine.submit(answer("again", "2026-11-09T09:00:00.000Z", "from-b"))
    await settle(a.engine)
    await settle(b.engine)
    await settle(a.engine)
    expect(w.server.recallAttempts().map((x) => x.id).sort()).toEqual(["from-a", "from-b"])
    expect(card(a.engine).schedule).toMatchObject({ state: "review", dueOn: "2026-11-10" })
    expect(card(b.engine).schedule).toEqual(card(a.engine).schedule)
    expect(Object.keys(b.engine.getSnapshot().state.recall.attempts).sort()).toEqual(["from-a", "from-b"])
  })

  it("a card deleted on one device disappears on the other, with no text kept, and a late answer is dropped", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    a.engine.submit(create())
    await settle(a.engine)
    await settle(b.engine)
    a.engine.submit({ type: "recall.delete", op_id: id("d"), card_id: CARD })
    await settle(a.engine)
    b.engine.submit(answer("good", "2026-11-09T12:00:00.000Z", "late"))
    await settle(b.engine)
    expect(card(b.engine)).toBeUndefined()
    expect(w.server.recallCard(CARD)).toMatchObject({ deleted: true, question: "", answer: "" })
    expect(b.engine.getSnapshot().notices).toEqual([])
    expect(w.server.recallAttempts()).toEqual([])
  })

  it("suspending travels between devices and keeps the schedule", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    a.engine.submit(create())
    await settle(a.engine)
    a.engine.submit({ type: "recall.suspend", op_id: id("s"), card_id: CARD, suspended_on: TODAY })
    await settle(a.engine)
    await settle(b.engine)
    expect(card(b.engine)).toMatchObject({ suspendedOn: TODAY, schedule: { state: "new", dueOn: TODAY } })
  })

  it("a server without the migration keeps cards on the device, and they are sent once it is there", async () => {
    const w = world()
    w.server.recallSupported = false
    const a = await device(w)
    a.engine.submit(create())
    await settle(a.engine)
    expect(a.engine.getSnapshot()).toMatchObject({ pending: 1, recall: false, notices: [] })
    expect(card(a.engine)).toBeDefined()
    expect(w.server.recallCard(CARD)).toBeNull()
    w.server.recallSupported = true
    await settle(a.engine)
    await settle(a.engine)
    expect(a.engine.getSnapshot()).toMatchObject({ pending: 0, recall: true })
    expect(w.server.recallCard(CARD)).toMatchObject({ question: "¿Qué es?" })
  })

  it("a copy saved before recall existed opens with nothing lost", () => {
    const up = upgradePersisted({ cache: { state: { habits: [] } }, queue: [] } as never, TODAY)
    expect(up?.cache.state.recall).toEqual({ cards: {}, attempts: {} })
  })
})

describe("the operations the app sends", () => {
  it("a new card, with its origin, is applied by the server as it was written", async () => {
    const w = world()
    const a = await device(w)
    const note = "22222222-2222-4222-8222-222222222222"
    a.engine.submit(recallCreateOp({ id: CARD, question: "¿Por qué?", answer: "Porque", sourceType: "note", sourceId: note, today: TODAY, at: "2026-11-09T10:00:00.000Z" }, id("c")))
    await settle(a.engine)
    expect(w.server.recallCard(CARD)).toMatchObject({ question: "¿Por qué?", answer: "Porque", source_type: "note", source_id: note, algorithm_version: 1 })
  })

  it("an answer stores on the server exactly what the device computed", async () => {
    const w = world()
    const a = await device(w)
    a.engine.submit(create())
    await settle(a.engine)
    const local = addCard(emptyRecall(), { id: CARD, question: "q", answer: "r", sourceType: null, sourceId: null, today: TODAY, at: "2026-11-09T10:00:00.000Z" }).cards[CARD]
    const outcome = answerOutcome(local, { attemptId: "attempt-x", grade: "easy", respondedAt: "2026-11-09T11:00:00.000Z", today: TODAY })
    a.engine.submit(recallAnswerOp(outcome, id("r")))
    await settle(a.engine)
    expect(w.server.recallCard(CARD)).toMatchObject({ state: "review", reps: 1, interval_days: 4, ease_factor: 2.5, due_on: "2026-11-13" })
    expect(w.server.recallAttempts()).toMatchObject([{ id: "attempt-x", grade: "easy", due_on_before: TODAY, due_on_after: "2026-11-13" }])
    expect(card(a.engine).schedule).toMatchObject({ state: "review", reps: 1, intervalDays: 4, dueOn: "2026-11-13" })
  })
})
