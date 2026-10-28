import { describe, expect, it } from "vitest"
import { checkinFor } from "@/features/mind/domain/ops"
import { memoryStorage, SyncEngine } from "./engine"
import type { Op } from "./domain/types"
import { enqueue } from "./domain/rebase"
import { FakeServer, fakeTransport } from "./testing/fake-server"

/** M3.3c · check-ins over the existing engine: offline-first, idempotent, per-field convergence, no silent loss of reflections. */

const TODAY = "2026-10-21"
const T0 = Date.parse("2026-10-21T06:00:00Z") // 08:00 Madrid
let n = 0
const id = (p: string) => `${p}-${String(++n).padStart(8, "0")}`
const iso = (t: number) => new Date(t).toISOString()

function world() {
  const clock = { now: T0 }
  const server = new FakeServer(TODAY, () => clock.now)
  return { clock, server }
}

async function device(w: ReturnType<typeof world>, storage = memoryStorage(), online = true) {
  const transport = fakeTransport(w.server)
  transport.online = online
  const engine = new SyncEngine({ transport, storage, deviceId: id("dev"), now: () => w.clock.now, schedule: () => () => {} })
  await engine.start()
  return { engine, transport, storage }
}

const set = (
  e: SyncEngine,
  w: ReturnType<typeof world>,
  fields: Extract<Op, { type: "checkin.set" }>["fields"],
  phase: "am" | "pm" = "am",
  date = TODAY
): Extract<Op, { type: "checkin.set" }> => ({
  type: "checkin.set",
  op_id: id("ci"),
  local_date: date,
  phase,
  fields,
  at: iso(w.clock.now),
  base_note_seq: "note" in fields ? e.checkinNoteSeq(date, phase) : null,
})

describe("check-ins over the sync engine", () => {
  it("saved offline, app closed and reopened: sent exactly once, one row per day and phase", async () => {
    const w = world()
    const a = await device(w)
    a.transport.online = false
    const op1 = set(a.engine, w, { sleep_hours: 7.5 })
    a.engine.submit(op1)
    await a.engine.sync() // the offline attempt ends; op1 is no longer in flight
    w.clock.now += 1000
    const op2 = set(a.engine, w, { energy: 4 })
    a.engine.submit(op2)
    await a.engine.sync()
    // Optimistic and compacted into one queued write.
    expect(checkinFor(a.engine.getSnapshot().state, TODAY, "am")).toMatchObject({ sleep: 7.5, energy: 4 })
    expect(a.engine.getSnapshot().pending).toBe(1)
    a.engine.stop()

    const b = await device(w, a.storage, true)
    expect(b.engine.getSnapshot()).toMatchObject({ status: "synced", pending: 0, checkins: true })
    expect(w.server.pull(0).daily_checkins).toHaveLength(1)
    expect(checkinFor(b.engine.getSnapshot().state, TODAY, "am")).toMatchObject({ sleep: 7.5, energy: 4, mood: null })
  })

  it("a lost acknowledgement is retried without applying twice", async () => {
    const w = world()
    const a = await device(w)
    a.transport.dropNextResponse = true
    const op = set(a.engine, w, { mood: 3 })
    a.engine.submit(op)
    await a.engine.sync().catch(() => {})
    await a.engine.sync()
    expect(w.server.applied.get(op.op_id)).toBe(1)
    expect(a.engine.getSnapshot().pending).toBe(0)
  })

  it("two devices editing different indicators of the same check-in converge without losing either", async () => {
    const w = world()
    const phone = await device(w)
    const desk = await device(w)
    phone.transport.online = false
    desk.transport.online = false
    phone.engine.submit(set(phone.engine, w, { energy: 2 }, "pm"))
    w.clock.now += 500
    desk.engine.submit(set(desk.engine, w, { stress: 4 }, "pm"))
    phone.transport.online = true
    desk.transport.online = true
    await phone.engine.sync()
    await desk.engine.sync()
    await phone.engine.sync()
    for (const d of [phone, desk]) expect(checkinFor(d.engine.getSnapshot().state, TODAY, "pm")).toMatchObject({ energy: 2, stress: 4 })
  })

  it("the same indicator edited on two devices: the latest write wins on both (decision 3)", async () => {
    const w = world()
    const phone = await device(w)
    const desk = await device(w)
    phone.transport.online = false
    desk.engine.submit(set(desk.engine, w, { mood: 4 }))
    await desk.engine.sync()
    w.clock.now -= 60_000 // the phone's (offline) write happened earlier
    phone.engine.submit(set(phone.engine, w, { mood: 2 }))
    w.clock.now += 120_000
    phone.transport.online = true
    await phone.engine.sync()
    await desk.engine.sync()
    for (const d of [phone, desk]) expect(checkinFor(d.engine.getSnapshot().state, TODAY, "am")!.mood).toBe(4)
  })

  it("a reflection written meanwhile on another device is never silently overwritten: conflict + «Aplicar el mío»", async () => {
    const w = world()
    const phone = await device(w)
    const desk = await device(w)
    desk.transport.online = false
    phone.engine.submit(set(phone.engine, w, { note: "Escrito en el móvil" }, "pm"))
    await phone.engine.sync()
    w.clock.now += 1000
    // The desk never saw the phone's reflection.
    desk.engine.submit(set(desk.engine, w, { note: "Escrito en el ordenador" }, "pm"))
    await desk.engine.sync() // the offline attempt ends
    desk.transport.online = true
    await desk.engine.sync()
    const snap = desk.engine.getSnapshot()
    expect(checkinFor(snap.state, TODAY, "pm")!.note).toBe("Escrito en el móvil")
    expect(snap.notices).toHaveLength(1)
    expect(snap.notices[0]).toMatchObject({ kind: "conflict", opType: "checkin.set", code: "note_conflict" })

    // «Aplicar el mío» re-sends against the reflection now seen: it wins, explicitly.
    const notice = snap.notices[0]
    desk.engine.dismissNotice(notice.id)
    const op = notice.op as Extract<Op, { type: "checkin.set" }>
    desk.engine.submit({ ...op, op_id: id("re"), at: iso(w.clock.now), base_note_seq: desk.engine.checkinNoteSeq(TODAY, "pm") })
    await desk.engine.sync()
    await phone.engine.sync()
    for (const d of [phone, desk]) expect(checkinFor(d.engine.getSnapshot().state, TODAY, "pm")!.note).toBe("Escrito en el ordenador")
  })

  it("editing one's own reflection again (sequential edits) is not a conflict", async () => {
    const w = world()
    const a = await device(w)
    a.engine.submit(set(a.engine, w, { note: "v1" }))
    await a.engine.sync()
    w.clock.now += 1000
    a.engine.submit(set(a.engine, w, { note: "v2" }))
    await a.engine.sync()
    expect(a.engine.getSnapshot().notices).toHaveLength(0)
    expect(checkinFor(a.engine.getSnapshot().state, TODAY, "am")!.note).toBe("v2")
  })

  it("clearing every field leaves a tombstone that removes the check-in on the other device", async () => {
    const w = world()
    const phone = await device(w)
    const desk = await device(w)
    phone.engine.submit(set(phone.engine, w, { energy: 3 }))
    await phone.engine.sync()
    await desk.engine.sync()
    expect(checkinFor(desk.engine.getSnapshot().state, TODAY, "am")).not.toBeNull()
    w.clock.now += 1000
    phone.engine.submit(set(phone.engine, w, { sleep_hours: null, energy: null, mood: null, stress: null, note: null }))
    await phone.engine.sync()
    await desk.engine.sync()
    expect(checkinFor(desk.engine.getSnapshot().state, TODAY, "am")).toBeNull()
  })

  it("future days are rejected by the server; the indicators configuration syncs as a whole", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    const res = w.server.applyOps([{ ...set(a.engine, w, { energy: 3 }, "am", "2026-10-23") }])
    expect(res.results[0]).toMatchObject({ status: "rejected", code: "future_date" })
    a.engine.submit({ type: "profile.checkin_fields", op_id: id("cfg"), am: ["energy"], pm: ["mood", "note"] })
    await a.engine.sync()
    await b.engine.sync()
    expect(b.engine.getSnapshot().state.checkinConfig).toEqual({ am: ["energy"], pm: ["mood", "note"] })
    expect(w.server.applyOps([{ type: "profile.checkin_fields", op_id: id("bad"), am: [], pm: ["mood"] }]).results[0]).toMatchObject({ status: "rejected", code: "invalid_config" })
  })

  it("a server without the check-ins migration reports checkins=false (nothing is pretended to be saved)", async () => {
    const w = world()
    w.server.checkinsSupported = false
    const a = await device(w)
    expect(a.engine.getSnapshot()).toMatchObject({ checkins: false, focus: true, goals: true })
  })

  it("compaction folds unsent writes of the same check-in field by field and keeps the reflection's base", () => {
    const w = world()
    const a = { checkinNoteSeq: () => 7 } as unknown as SyncEngine
    const op1 = set(a, w, { note: "x", energy: 2 })
    const op2 = { ...set(a, w, { energy: 3 }), base_note_seq: null }
    const q = enqueue(enqueue([], op1, 0, new Set()), op2, 1, new Set())
    expect(q).toHaveLength(1)
    expect(q[0].op).toMatchObject({ fields: { note: "x", energy: 3 }, base_note_seq: 7 })
    // An op already in flight is never merged into.
    expect(enqueue(enqueue([], op1, 0, new Set()), op2, 1, new Set([op1.op_id]))).toHaveLength(2)
  })
})

/**
 * D47 · a reflection that lost a conflict waits for the user's decision durably (with the user's
 * IndexedDB copy): closing, reloading or another tab never loses it, and nothing is overwritten silently.
 */
describe("pending reflections survive closing and reopening", () => {
  type CheckinOp = Extract<Op, { type: "checkin.set" }>

  /** The phone writes a reflection; the desk, offline and unaware, writes another one (plus extra fields). */
  async function conflict(w: ReturnType<typeof world>, extra: CheckinOp["fields"] = {}, opts: { failPull?: boolean } = {}) {
    const phone = await device(w)
    const storage = memoryStorage()
    const desk = await device(w, storage)
    desk.transport.online = false
    phone.engine.submit(set(phone.engine, w, { note: "Escrito en el móvil" }, "pm"))
    await phone.engine.sync()
    w.clock.now += 1000
    desk.engine.submit(set(desk.engine, w, { note: "Escrito en el ordenador", ...extra }, "pm"))
    await desk.engine.sync()
    desk.transport.online = true
    desk.transport.failNextPull = !!opts.failPull
    await desk.engine.sync()
    return { phone, desk, storage }
  }

  /** What «Aplicar la mía» does (account-backend reapplyNotice). */
  function applyMine(e: SyncEngine, w: ReturnType<typeof world>, noticeId: string) {
    const notice = e.getSnapshot().notices.find((n) => n.id === noticeId)!
    const op = notice.op as CheckinOp
    e.dismissNotice(noticeId)
    e.submit({ ...op, op_id: id("re"), at: iso(w.clock.now), base_note_seq: e.checkinNoteSeq(op.local_date, op.phase) })
  }

  it("the pending reflection is saved at once with the user's copy, even if the connection drops right after", async () => {
    const w = world()
    const { desk, storage } = await conflict(w, {}, { failPull: true })
    expect(desk.engine.getSnapshot().status).toBe("offline")
    expect(storage.data!.pendingNotes).toHaveLength(1)
    expect(storage.data!.pendingNotes![0]).toMatchObject({
      code: "note_conflict",
      op: { type: "checkin.set", local_date: TODAY, phase: "pm", fields: { note: "Escrito en el ordenador" } },
    })
  })

  it("closing the app without deciding and reopening shows the same decision again; nothing was overwritten", async () => {
    const w = world()
    const { phone, desk, storage } = await conflict(w)
    const before = desk.engine.getSnapshot().notices[0]
    desk.engine.stop() // app closed, no decision
    const reopened = await device(w, storage)
    const snap = reopened.engine.getSnapshot()
    expect(snap.notices).toEqual([before])
    expect(checkinFor(snap.state, TODAY, "pm")!.note).toBe("Escrito en el móvil")
    // Reopening again keeps it: only a decision removes it.
    reopened.engine.stop()
    expect((await device(w, storage)).engine.getSnapshot().notices).toHaveLength(1)
    await phone.engine.sync()
    expect(checkinFor(phone.engine.getSnapshot().state, TODAY, "pm")!.note).toBe("Escrito en el móvil")
  })

  it("after reopening, «Aplicar la mía» recovers the reflection on every device and the decision is not asked again", async () => {
    const w = world()
    const { phone, desk, storage } = await conflict(w)
    desk.engine.stop()
    const reopened = await device(w, storage)
    w.clock.now += 1000
    applyMine(reopened.engine, w, reopened.engine.getSnapshot().notices[0].id)
    await reopened.engine.sync()
    await phone.engine.sync()
    for (const d of [phone, reopened]) expect(checkinFor(d.engine.getSnapshot().state, TODAY, "pm")!.note).toBe("Escrito en el ordenador")
    expect(storage.data!.pendingNotes).toEqual([])
    reopened.engine.stop()
    expect((await device(w, storage)).engine.getSnapshot().notices).toEqual([])
  })

  it("«Mantener la otra» is a decision too: kept durably, the other reflection stays", async () => {
    const w = world()
    const { desk, storage } = await conflict(w)
    desk.engine.dismissNotice(desk.engine.getSnapshot().notices[0].id)
    await desk.engine.sync()
    desk.engine.stop()
    const reopened = await device(w, storage)
    expect(reopened.engine.getSnapshot().notices).toEqual([])
    expect(checkinFor(reopened.engine.getSnapshot().state, TODAY, "pm")!.note).toBe("Escrito en el móvil")
  })

  it("the other indicators of the refused write are not lost: they are re-sent alone and decided field by field", async () => {
    const w = world()
    const { phone, desk } = await conflict(w, { energy: 2, stress: 4 })
    await desk.engine.sync()
    await phone.engine.sync()
    for (const d of [phone, desk]) {
      expect(checkinFor(d.engine.getSnapshot().state, TODAY, "pm")).toMatchObject({ energy: 2, stress: 4, note: "Escrito en el móvil" })
    }
    // The pending decision holds the reflection only, so applying it never re-sends old values.
    expect((desk.engine.getSnapshot().notices[0].op as CheckinOp).fields).toEqual({ note: "Escrito en el ordenador" })
  })

  it("closed before the answer was saved: the write is re-sent and the server's stored answer raises one notice only", async () => {
    const w = world()
    const phone = await device(w)
    const storage = memoryStorage()
    const desk = await device(w, storage)
    desk.transport.online = false
    phone.engine.submit(set(phone.engine, w, { note: "Escrito en el móvil" }, "pm"))
    await phone.engine.sync()
    desk.engine.submit(set(desk.engine, w, { note: "Escrito en el ordenador" }, "pm"))
    await desk.engine.sync()
    // The server answers «conflict» but the device never receives it (closed meanwhile).
    desk.transport.online = true
    desk.transport.dropNextResponse = true
    await desk.engine.sync()
    expect(desk.engine.getSnapshot().notices).toEqual([])
    desk.engine.stop()
    const reopened = await device(w, storage)
    await reopened.engine.sync()
    expect(reopened.engine.getSnapshot().notices).toHaveLength(1)
    expect(reopened.engine.getSnapshot().pending).toBe(0)
    expect(storage.data!.pendingNotes).toHaveLength(1)
  })

  it("two tabs of the same user: one tab's save never drops the other's pending reflection, and a decision reaches both", async () => {
    const w = world()
    const { desk, storage } = await conflict(w)
    // A second tab of the same user (same stored copy), already running before the conflict was saved.
    const tab = await device(w, memoryStorage())
    const tab2 = new SyncEngine({ transport: tab.transport, storage, deviceId: id("tab"), now: () => w.clock.now, schedule: () => () => {} })
    tab2.submit(set(tab2, w, { mood: 4 }, "am"))
    await tab2.sync()
    expect(storage.data!.pendingNotes).toHaveLength(1)
    expect(tab2.getSnapshot().notices).toHaveLength(1) // adopted, so this tab shows it too
    // Deciding in the first tab is not undone by the second tab's next save.
    desk.engine.dismissNotice(desk.engine.getSnapshot().notices[0].id)
    await desk.engine.sync()
    tab2.submit(set(tab2, w, { mood: 5 }, "am"))
    await tab2.sync()
    expect(storage.data!.pendingNotes).toEqual([])
    expect(tab2.getSnapshot().notices).toEqual([])
  })

  it("a copy saved before D47 (no pending field) and damaged entries are upgraded without losing anything", async () => {
    const w = world()
    const a = await device(w)
    a.engine.submit(set(a.engine, w, { energy: 3 }))
    await a.engine.sync()
    const old = memoryStorage({ ...structuredClone(a.storage.data!), pendingNotes: undefined, resolvedNotes: undefined })
    expect((await device(w, old)).engine.getSnapshot().notices).toEqual([])
    const damaged = memoryStorage({ ...structuredClone(a.storage.data!), pendingNotes: [null, { id: 1 }, "x"] as never, resolvedNotes: [3] as never })
    const b = await device(w, damaged)
    expect(b.engine.getSnapshot().notices).toEqual([])
    expect(checkinFor(b.engine.getSnapshot().state, TODAY, "am")!.energy).toBe(3)
  })
})
