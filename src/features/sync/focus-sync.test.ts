import { describe, expect, it } from "vitest"
import { entryKey } from "@/features/habits/domain/types"
import { activeSession } from "@/features/focus/domain/ops"
import { activeSeconds } from "@/features/focus/domain/time"
import { memoryStorage, SyncEngine } from "./engine"
import type { Op } from "./domain/types"
import { FakeServer, fakeTransport } from "./testing/fake-server"

/** M3.2c · focus sessions over the existing engine: offline-first, idempotent, one active session, derived habit. */

const TODAY = "2026-10-21"
const T0 = Date.parse("2026-10-21T07:00:00Z") // 09:00 Madrid
const DW = "44444444-4444-4444-8444-444444444444"
let n = 0
const id = (p: string) => `${p}-${String(++n).padStart(8, "0")}`
const iso = (t: number) => new Date(t).toISOString()
const min = (m: number) => m * 60_000

/** Device and server share a controllable clock. */
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

function seedHabit(w: ReturnType<typeof world>) {
  const ops: Op[] = [
    {
      type: "habit.create",
      op_id: id("h"),
      habit: { id: DW, title: "Deep Work 90 min", icon: "target", dimension: "work", habit_type: "duration", unit: "min", target_value: 90, target_direction: "at_least", start_date: "2026-10-01" },
      versions: [{ valid_from: "2026-10-01", rule: { kind: "daily" } }],
    },
    { type: "habit.set_source", op_id: id("src"), habit_id: DW, source: "focus", from: TODAY },
  ]
  w.server.applyOps(ops)
}

const start = (sid: string, at: number, habitId: string | null = DW): Op => ({
  type: "focus.start", op_id: id("fs"), session: { id: sid, habit_id: habitId, project: "Tesis", planned_output: null, planned_minutes: 50, started_at: iso(at) },
})
const finish = (sid: string, at: number): Op => ({ type: "focus.finish", op_id: id("ff"), session_id: sid, at: iso(at), trim_to: null, actual_output: "Hecho", rating: 4 })

describe("focus over the sync engine", () => {
  it("starts offline, survives closing the app, finishes later: applied exactly once, minutes from segments, habit derived", async () => {
    const w = world()
    seedHabit(w)
    const a = await device(w)
    a.transport.online = false
    const sid = "55555555-5555-4555-8555-555555555555"
    const startOp = start(sid, w.clock.now)
    a.engine.submit(startOp)
    await a.engine.sync()
    expect(activeSession(a.engine.getSnapshot().state)?.id).toBe(sid)
    a.engine.stop() // app closed with the start still queued

    w.clock.now += min(50)
    const b = await device(w, a.storage, false) // same device, reopened, still offline
    expect(b.engine.getSnapshot().pending).toBe(1)
    const finishOp = finish(sid, w.clock.now)
    b.engine.submit(finishOp)
    // Optimistic: the habit's day already shows the derived minutes.
    expect(b.engine.getSnapshot().state.entries[entryKey(DW, TODAY)]?.value).toBe(50)
    // Manual logging of the fed day is refused locally (and by the server).
    b.transport.online = true
    await b.engine.sync()
    expect(w.server.applied.get(startOp.op_id)).toBe(1)
    expect(w.server.applied.get(finishOp.op_id)).toBe(1)
    const snap = b.engine.getSnapshot()
    expect(snap).toMatchObject({ status: "synced", pending: 0, focus: true })
    expect(activeSeconds(snap.state.focusSessions[0].segments)).toBe(50 * 60)
    expect(snap.state.entries[entryKey(DW, TODAY)]?.value).toBe(50)
    expect(w.server.entryCount()).toBe(1)
  })

  it("a lost acknowledgement is resent and answered as a duplicate: no second session", async () => {
    const w = world()
    const a = await device(w)
    const sid = "66666666-6666-4666-8666-666666666666"
    const op = start(sid, w.clock.now, null)
    a.transport.dropNextResponse = true
    a.engine.submit(op)
    await a.engine.sync()
    await a.engine.sync()
    expect(w.server.applied.get(op.op_id)).toBe(1)
    expect(a.engine.getSnapshot().state.focusSessions).toHaveLength(1)
    expect(a.engine.getSnapshot().notices).toEqual([])
  })

  it("two devices starting at once: the first wins, the second is told and joins it", async () => {
    const w = world()
    const phone = await device(w)
    const laptop = await device(w)
    const p = "77777777-7777-4777-8777-777777777777"
    const l = "88888888-8888-4888-8888-888888888888"
    phone.engine.submit(start(p, w.clock.now, null))
    laptop.engine.submit(start(l, w.clock.now, null))
    await phone.engine.sync()
    await laptop.engine.sync()
    const snap = laptop.engine.getSnapshot()
    expect(snap.notices).toMatchObject([{ kind: "conflict", opType: "focus.start", code: "session_active" }])
    expect(snap.state.focusSessions.map((s) => s.id)).toEqual([p])
    expect(activeSession(snap.state)?.id).toBe(p)
  })

  it("pausing on one device is seen on the other; finishing twice is silently superseded", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    const sid = "99999999-9999-4999-8999-999999999999"
    a.engine.submit(start(sid, w.clock.now, null))
    await a.engine.sync()
    await b.engine.sync()
    w.clock.now += min(20)
    a.engine.submit({ type: "focus.pause", op_id: id("p"), session_id: sid, at: iso(w.clock.now) })
    await a.engine.sync()
    await b.engine.sync()
    expect(b.engine.getSnapshot().state.focusSessions[0].state).toBe("paused")

    w.clock.now += min(5)
    a.engine.submit(finish(sid, w.clock.now))
    b.engine.submit(finish(sid, w.clock.now + 1000))
    await a.engine.sync()
    await b.engine.sync()
    expect(b.engine.getSnapshot().notices).toEqual([])
    expect(activeSeconds(b.engine.getSnapshot().state.focusSessions[0].segments)).toBe(20 * 60)
  })

  it("a concurrent edit is a conflict the user can re-apply", async () => {
    const w = world()
    const a = await device(w)
    const sid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    a.engine.submit(start(sid, w.clock.now, null))
    w.clock.now += min(30)
    a.engine.submit(finish(sid, w.clock.now))
    await a.engine.sync()
    const b = await device(w)
    const seg = a.engine.getSnapshot().state.focusSessions[0].segments
    const edit = (rating: number, base: number): Op => ({
      type: "focus.edit", op_id: id("e"), session_id: sid, base_version: base, segments: seg, habit_id: null, project: "Tesis", planned_output: null, actual_output: null, rating, at: iso(w.clock.now),
    })
    b.engine.submit(edit(5, b.engine.focusVersion(sid)))
    await b.engine.sync()
    a.engine.submit(edit(2, a.engine.focusVersion(sid))) // stale version
    await a.engine.sync()
    expect(a.engine.getSnapshot().notices).toMatchObject([{ kind: "conflict", opType: "focus.edit", subject: "Tesis" }])
    expect(a.engine.getSnapshot().state.focusSessions[0].rating).toBe(5)
  })

  it("a server without the focus migration keeps focus off (nothing is sent as if saved)", async () => {
    const w = world()
    w.server.focusSupported = false
    const a = await device(w)
    expect(a.engine.getSnapshot().focus).toBe(false)
    w.server.focusSupported = true
    await a.engine.sync()
    expect(a.engine.getSnapshot().focus).toBe(true)
  })

  it("serverNow() is the corrected clock and has no side effects on hybrid time", async () => {
    const w = world()
    const a = await device(w)
    const before = a.engine.clientTime()
    expect(Math.abs(a.engine.serverNow() - w.clock.now)).toBeLessThan(5)
    a.engine.serverNow()
    expect(Date.parse(a.engine.clientTime())).toBe(Date.parse(before) + 1)
  })
})
