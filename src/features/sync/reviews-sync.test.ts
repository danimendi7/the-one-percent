import { describe, expect, it } from "vitest"
import { memoryStorage, SyncEngine, type PersistedSync } from "./engine"
import type { Op } from "./domain/types"
import { FakeServer, fakeTransport } from "./testing/fake-server"
import { upgradePersisted } from "./domain/persisted"
import { enqueue } from "./domain/rebase"
import { reviewKey } from "@/features/reviews/domain/types"

/** M3.4c · Life Review over the real sync engine: durable drafts, section conflicts, closes and deletes. */

const TODAY = "2026-10-29" // Thursday
const WEEK = "2026-10-19" // last week, already over
const PREV = "2026-10-12"
const T0 = Date.parse("2026-10-29T10:00:00Z")
const HABIT = "11111111-1111-4111-8111-111111111111"
let n = 0
const id = (p: string) => `${p}-${String(++n).padStart(8, "0")}`

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

/** Waits for the engine and every follow-up cycle it scheduled (rerun). */
async function settle(e: SyncEngine) {
  const running = () => (e as unknown as { running: Promise<void> | null }).running
  await e.sync()
  for (let i = 0; i < 20 && running(); i++) await running()
}

const review = (e: SyncEngine, start = WEEK) => e.getSnapshot().state.reviews[reviewKey("week", start)]
const serverReview = (w: ReturnType<typeof world>, start = WEEK) => w.server.review("week", start)
const sentOps = (t: ReturnType<typeof fakeTransport>, log: Op[][]) => {
  t.beforeApply = (ops) => log.push(ops)
}

function habitOp(): Op {
  return {
    type: "habit.create",
    op_id: id("h"),
    habit: { id: HABIT, title: "Leer", icon: "book", dimension: "learn", habit_type: "binary", unit: null, target_value: null, target_direction: null, start_date: "2026-10-01" },
    versions: [{ valid_from: "2026-10-01", rule: { kind: "daily" } }],
  }
}

const mark = (e: SyncEngine, date: string): Op => ({
  type: "entry.set",
  op_id: id("e"),
  habit_id: HABIT,
  local_date: date,
  value: true,
  client_updated_at: e.clientTime(),
  base_seq: e.rowSeq("entry", HABIT, date),
})

describe("drafts: durable, optimistic and compacted", () => {
  it("a draft written offline survives closing the app and reaches the server once, as one write", async () => {
    const w = world()
    const a = await device(w)
    a.transport.online = false
    // Each save tries to send at once and fails offline; the next one (the UI saves after 800 ms idle) is folded in.
    expect(a.engine.saveReview("week", WEEK, { "content.wins": "Leí" })).toEqual({ ok: true })
    await settle(a.engine)
    expect(a.engine.saveReview("week", WEEK, { "content.wins": "Leí cada día" })).toEqual({ ok: true })
    await settle(a.engine)
    expect(a.engine.saveReview("week", WEEK, { "content.lessons": "Menos móvil" })).toEqual({ ok: true })
    await settle(a.engine)
    // Optimistic, compacted into one queued write, saved on this device only.
    expect(review(a.engine)?.content).toEqual({ wins: "Leí cada día", lessons: "Menos móvil" })
    expect(a.engine.getSnapshot().pending).toBe(1)
    expect(a.engine.reviewSyncState("week", WEEK)).toBe("local")
    expect(a.storage.data?.queue).toHaveLength(1)
    a.engine.stop()

    const b = await device(w, a.storage)
    await settle(b.engine)
    expect(serverReview(w)).toMatchObject({ status: "draft", content: { wins: "Leí cada día", lessons: "Menos móvil" } })
    expect(b.engine.getSnapshot()).toMatchObject({ status: "synced", pending: 0, reviews: true })
    expect(b.engine.reviewSyncState("week", WEEK)).toBe("synced")
    expect(review(b.engine)?.fieldSeqs?.["content.wins"]).toBe(serverReview(w)!.seq)
  })

  it("an unchanged value writes nothing; invalid content or a period not over yet is refused without writing", async () => {
    const w = world()
    const a = await device(w)
    a.engine.saveReview("week", WEEK, { "content.wins": "Uno" })
    await settle(a.engine)
    const calls = a.transport.calls
    expect(a.engine.saveReview("week", WEEK, { "content.wins": "  Uno " })).toEqual({ ok: true })
    expect(a.engine.getSnapshot().pending).toBe(0)
    expect(a.engine.saveReview("week", WEEK, { "content.wins": "x".repeat(601) })).toEqual({ ok: false, reason: "invalid" })
    expect(a.engine.saveReview("week", "2026-10-26", { "content.wins": "Esta semana" })).toEqual({ ok: false, reason: "not_available" })
    expect(a.engine.saveReview("week", "2026-10-20", { "content.wins": "Martes" })).toEqual({ ok: false, reason: "invalid_period" })
    await settle(a.engine)
    expect(a.transport.calls).toBe(calls)
  })

  it("consecutive edits of a section while the previous one is in flight never conflict with the user's own text", async () => {
    const w = world()
    const a = await device(w)
    a.engine.saveReview("week", WEEK, { "content.wins": "A" })
    const p = a.engine.sync() // the write is now in flight
    a.engine.saveReview("week", WEEK, { "content.wins": "AB" })
    await p
    await settle(a.engine)
    expect(a.engine.getSnapshot().notices).toEqual([])
    expect(serverReview(w)?.content).toEqual({ wins: "AB" })
    expect(a.engine.getSnapshot().pending).toBe(0)
  })

  it("…but another device writing that section in between is a real conflict, kept for the user", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    // Right after A's first write is applied, and before A pulls, B writes the same section on top of it.
    a.transport.beforePull = () => {
      a.transport.beforePull = null
      const seq = w.server.review("week", WEEK)!.field_seqs["content.wins"]
      w.server.applyOps([{ type: "review.save", op_id: id("b"), kind: "week", period_start: WEEK, fields: { "content.wins": "De B" }, base_seqs: { "content.wins": seq } }])
    }
    a.engine.saveReview("week", WEEK, { "content.wins": "A" }) // in flight from here
    a.engine.saveReview("week", WEEK, { "content.wins": "AB" })
    await settle(a.engine)
    await settle(b.engine)
    expect(serverReview(w)?.content).toEqual({ wins: "De B" })
    const [notice] = a.engine.getSnapshot().notices
    expect(notice).toMatchObject({ kind: "conflict", code: "review_field_conflict", op: { type: "review.save", fields: { "content.wins": "AB" } } })
  })
})

describe("compaction (pure)", () => {
  it("folds unsent writes of a review: newest value per section, base of the first unsent write of each section", () => {
    const op = (fields: Record<string, string>, base_seqs: Record<string, number | null>): Op => ({ type: "review.save", op_id: id("r"), kind: "week", period_start: WEEK, fields, base_seqs })
    let q = enqueue([], op({ "content.wins": "a" }, { "content.wins": 5 }), 1, new Set())
    q = enqueue(q, op({ "content.wins": "ab", "content.note": "n" }, { "content.wins": 9, "content.note": 0 }), 2, new Set())
    expect(q).toHaveLength(1)
    expect(q[0].op).toMatchObject({ fields: { "content.wins": "ab", "content.note": "n" }, base_seqs: { "content.wins": 5, "content.note": 0 } })
    // An in-flight write is never touched; another review is never folded in.
    const inFlight = new Set([q[0].op.op_id])
    q = enqueue(q, op({ "content.wins": "abc" }, { "content.wins": 5 }), 3, inFlight)
    q = enqueue(q, { type: "review.save", op_id: id("r"), kind: "week", period_start: PREV, fields: { "content.wins": "x" }, base_seqs: { "content.wins": null } }, 4, inFlight)
    expect(q).toHaveLength(3)
  })
})

describe("two devices", () => {
  it("different sections merge without a notice; the same review is never duplicated", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    a.transport.online = false
    b.transport.online = false
    a.engine.saveReview("week", WEEK, { "content.wins": "Desde el móvil" })
    b.engine.saveReview("week", WEEK, { "content.struggles": "Desde el ordenador" })
    await a.engine.sync()
    await b.engine.sync()
    a.transport.online = true
    b.transport.online = true
    await settle(a.engine)
    await settle(b.engine)
    await settle(a.engine)
    const both = { wins: "Desde el móvil", struggles: "Desde el ordenador" }
    expect(serverReview(w)?.content).toEqual(both)
    expect(review(a.engine)?.content).toEqual(both)
    expect(review(b.engine)?.content).toEqual(both)
    expect(a.engine.getSnapshot().notices).toEqual([])
    expect(b.engine.getSnapshot().notices).toEqual([])
    expect(w.server.pull(0).reviews).toHaveLength(1)
  })

  it("the same section: both versions kept, a decision asked for; the other sections of that write still apply", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    a.engine.saveReview("week", WEEK, { "content.wins": "Base" })
    await settle(a.engine)
    await settle(b.engine)
    a.transport.online = false
    a.engine.saveReview("week", WEEK, { "content.wins": "Mío", "content.note": "Nota de A" })
    await a.engine.sync()
    b.engine.saveReview("week", WEEK, { "content.wins": "Suyo" })
    await settle(b.engine)
    a.transport.online = true
    await settle(a.engine)

    expect(serverReview(w)?.content).toEqual({ wins: "Suyo", note: "Nota de A" })
    // A sees the other version and keeps its own, durably, until it decides.
    expect(review(a.engine)?.content.wins).toBe("Suyo")
    const [notice] = a.engine.getSnapshot().notices
    expect(notice).toMatchObject({ kind: "conflict", code: "review_field_conflict", op: { fields: { "content.wins": "Mío" } } })
    expect(a.storage.data?.pendingNotes?.map((x) => x.id)).toEqual([notice.id])
    expect(a.engine.reviewSyncState("week", WEEK)).toBe("conflict")
    expect(a.engine.reviewFieldsWaiting("week", WEEK)).toEqual(["content.wins"])
    // The section in conflict cannot be overwritten before deciding; the others can.
    expect(a.engine.saveReview("week", WEEK, { "content.wins": "Otro" })).toEqual({ ok: false, reason: "conflict" })
    expect(a.engine.requestClose("week", WEEK)).toEqual({ ok: false, reason: "conflicts" })
  })

  it("an unresolved conflict survives closing the app; «Aplicar la mía» wins and the decision never comes back", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    a.engine.saveReview("week", WEEK, { "content.wins": "Base" })
    await settle(a.engine)
    await settle(b.engine)
    a.transport.online = false
    a.engine.saveReview("week", WEEK, { "content.wins": "Mío" })
    await a.engine.sync()
    b.engine.saveReview("week", WEEK, { "content.wins": "Suyo" })
    await settle(b.engine)
    a.transport.online = true
    await settle(a.engine)
    a.engine.stop()

    const a2 = await device(w, a.storage)
    const [notice] = a2.engine.getSnapshot().notices
    expect(notice).toMatchObject({ code: "review_field_conflict", op: { fields: { "content.wins": "Mío" } } })
    expect(a2.engine.resolveReviewText(notice.id, "content.wins", "mine")).toBe(true)
    await settle(a2.engine)
    expect(serverReview(w)?.content.wins).toBe("Mío")
    expect(a2.engine.getSnapshot().notices).toEqual([])
    // Further pulls and a reopening do not bring the decided conflict back.
    await settle(a2.engine)
    a2.engine.stop()
    const a3 = await device(w, a2.storage)
    await settle(a3.engine)
    expect(a3.engine.getSnapshot().notices).toEqual([])
    expect(a3.storage.data?.resolvedNotes).toContain(notice.id)
    await settle(b.engine)
    expect(review(b.engine)?.content.wins).toBe("Mío")
  })

  it("«Mantener la otra» forgets the kept text durably, including in another tab's older copy", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    a.engine.saveReview("week", WEEK, { "content.wins": "Base" })
    await settle(a.engine)
    await settle(b.engine)
    a.transport.online = false
    a.engine.saveReview("week", WEEK, { "content.wins": "Mío" })
    await a.engine.sync()
    b.engine.saveReview("week", WEEK, { "content.wins": "Suyo" })
    await settle(b.engine)
    a.transport.online = true
    await settle(a.engine)
    const older = structuredClone(a.storage.data!) // another tab's copy, still with the conflict
    const [notice] = a.engine.getSnapshot().notices
    a.engine.resolveReviewText(notice.id, "content.wins", "theirs")
    await settle(a.engine)
    expect(a.engine.getSnapshot().notices).toEqual([])
    expect(serverReview(w)?.content.wins).toBe("Suyo")

    // The other tab saves its older copy; this tab's next save still keeps the decision.
    const tab = await device(w, memoryStorage(older))
    expect(tab.engine.getSnapshot().notices).toHaveLength(1)
    a.storage.data = { ...a.storage.data!, pendingNotes: older.pendingNotes }
    await settle(a.engine)
    expect(a.engine.getSnapshot().notices).toEqual([])
  })
})

describe("closing", () => {
  it("online: closes after a push and a fresh pull, with the M3.4b contract (base_seq, based_on_cursor)", async () => {
    const w = world()
    const a = await device(w)
    const log: Op[][] = []
    sentOps(a.transport, log)
    a.engine.submit(habitOp())
    a.engine.submit(mark(a.engine, "2026-10-20"))
    a.engine.saveReview("week", WEEK, { "content.wins": "Constancia" })
    expect(a.engine.requestClose("week", WEEK)).toEqual({ ok: true, deferred: false })
    expect(a.engine.closeIntent("week", WEEK)).toMatchObject({ state: "waiting", opId: null })
    await settle(a.engine)

    const close = log.flat().find((o) => o.type === "review.close")
    expect(close).toMatchObject({ type: "review.close", based_on_cursor: expect.any(Number) })
    // The close goes alone, after every save was applied and pulled.
    expect(log.find((b) => b.some((o) => o.type === "review.close"))).toHaveLength(1)
    const before = log.flat().find((o) => o.type === "review.save")
    expect(before).toBeDefined()
    const s = serverReview(w)!
    expect(s).toMatchObject({ status: "closed", content: { wins: "Constancia" } })
    expect(s.snapshot?.habits.current).toMatchObject({ fulfilled: 1 })
    expect(review(a.engine)).toMatchObject({ status: "closed" })
    expect(a.engine.closeIntent("week", WEEK)).toBeUndefined()
    // Immutable from the client too.
    expect(a.engine.saveReview("week", WEEK, { "content.wins": "Cambio" })).toEqual({ ok: false, reason: "closed" })
    expect(a.engine.requestClose("week", WEEK)).toEqual({ ok: false, reason: "already_closed" })
  })

  it("offline: the close waits (durably) for the connection, then runs after the saves and a pull that brings another device's data", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    b.engine.submit(habitOp())
    await settle(b.engine)
    await settle(a.engine)
    a.transport.online = false
    await a.engine.sync()
    a.engine.saveReview("week", WEEK, { "content.wins": "Sin conexión" })
    expect(a.engine.requestClose("week", WEEK)).toEqual({ ok: true, deferred: true })
    await a.engine.sync()
    expect(serverReview(w)).toBeNull()
    expect(review(a.engine)).toMatchObject({ status: "draft" })
    // Meanwhile another device records data of that week.
    b.engine.submit(mark(b.engine, "2026-10-21"))
    await settle(b.engine)
    a.engine.stop()

    const a2 = await device(w, a.storage, false)
    expect(a2.engine.closeIntent("week", WEEK)).toMatchObject({ state: "waiting" })
    a2.transport.online = true
    await settle(a2.engine)
    const s = serverReview(w)!
    expect(s).toMatchObject({ status: "closed", content: { wins: "Sin conexión" } })
    expect(s.snapshot?.habits.current).toMatchObject({ fulfilled: 1 })
    expect(a2.engine.closeIntent("week", WEEK)).toBeUndefined()
  })

  it("data recorded between the pull and the close: refused as stale, computed again after a new pull, then applied", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    a.engine.submit(habitOp())
    await settle(a.engine)
    await settle(b.engine)
    let injected = false
    const closes: Op[] = []
    a.transport.beforeApply = (ops) => {
      for (const o of ops) if (o.type === "review.close") closes.push(o)
      if (!injected && ops.some((o) => o.type === "review.close")) {
        injected = true
        w.server.applyOps([mark(b.engine, "2026-10-22")])
      }
    }
    a.engine.requestClose("week", WEEK)
    await settle(a.engine)
    expect(closes).toHaveLength(2)
    expect(serverReview(w)?.snapshot?.habits.current).toMatchObject({ fulfilled: 1 })
    expect(a.engine.closeIntent("week", WEEK)).toBeUndefined()
  })

  it("never closes with pending writes, sections waiting for a decision or a review changed since the user asked", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    a.engine.saveReview("week", WEEK, { "content.wins": "Base" })
    await settle(a.engine)
    await settle(b.engine)
    a.transport.online = false
    await a.engine.sync()
    expect(a.engine.requestClose("week", WEEK)).toEqual({ ok: true, deferred: true })
    // While the close waits, the review is read-only here.
    expect(a.engine.saveReview("week", WEEK, { "content.lessons": "Tarde" })).toEqual({ ok: false, reason: "closing" })
    // Another device adds a section: the review is no longer what the user asked to close.
    b.engine.saveReview("week", WEEK, { "content.lessons": "Desde B" })
    await settle(b.engine)
    a.transport.online = true
    await settle(a.engine)
    expect(serverReview(w)).toMatchObject({ status: "draft" })
    expect(a.engine.closeIntent("week", WEEK)).toMatchObject({ state: "needs_confirmation", opId: null })
    // Asked again after seeing it: it closes.
    expect(a.engine.requestClose("week", WEEK)).toEqual({ ok: true, deferred: false })
    await settle(a.engine)
    expect(serverReview(w)).toMatchObject({ status: "closed", content: { wins: "Base", lessons: "Desde B" } })
  })

  it("two devices closing: the first close wins, the second changes nothing and converges to it", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    a.engine.saveReview("week", WEEK, { "content.wins": "Cerrar" })
    await settle(a.engine)
    await settle(b.engine)
    a.engine.requestClose("week", WEEK)
    b.engine.requestClose("week", WEEK)
    await Promise.all([settle(a.engine), settle(b.engine)])
    await settle(a.engine)
    await settle(b.engine)
    const s = serverReview(w)!
    expect(s.status).toBe("closed")
    expect(review(a.engine)?.snapshot).toEqual(s.snapshot)
    expect(review(b.engine)?.snapshot).toEqual(s.snapshot)
    const closeIds = [...w.server.applied.keys()].filter((k) => k.length > 0)
    expect(closeIds.length).toBeGreaterThan(0)
    expect(a.engine.closeIntent("week", WEEK)).toBeUndefined()
    expect(b.engine.closeIntent("week", WEEK)).toBeUndefined()
    expect(a.engine.getSnapshot().notices).toEqual([])
    expect(b.engine.getSnapshot().notices).toEqual([])
  })

  it("a double tap is one intent and one close; a lost acknowledgement is retried without closing twice", async () => {
    const w = world()
    const a = await device(w)
    const closes: Op[] = []
    a.transport.beforeApply = (ops) => closes.push(...ops.filter((o) => o.type === "review.close"))
    a.engine.requestClose("week", WEEK)
    a.engine.requestClose("week", WEEK)
    await a.engine.sync()
    a.transport.dropNextResponse = true
    await settle(a.engine).catch(() => {})
    await settle(a.engine)
    expect(new Set(closes.map((o) => o.op_id)).size).toBe(1)
    expect(closes.length).toBeGreaterThanOrEqual(1)
    expect(serverReview(w)).toMatchObject({ status: "closed" })
    expect(w.server.applied.get(closes[0].op_id)).toBe(1)
    expect(a.engine.closeIntent("week", WEEK)).toBeUndefined()
  })

  it("a text written offline after another device closed the review is kept, and the closed review does not change", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    a.engine.saveReview("week", WEEK, { "content.wins": "Base" })
    await settle(a.engine)
    await settle(b.engine)
    a.transport.online = false
    a.engine.saveReview("week", WEEK, { "content.note": "Escrito sin conexión" })
    await a.engine.sync()
    b.engine.requestClose("week", WEEK)
    await settle(b.engine)
    const frozen = serverReview(w)!
    a.transport.online = true
    await settle(a.engine)
    expect(serverReview(w)).toEqual(frozen)
    const [notice] = a.engine.getSnapshot().notices
    expect(notice).toMatchObject({ kind: "rejected", code: "review_closed", op: { fields: { "content.note": "Escrito sin conexión" } } })
    expect(a.storage.data?.pendingNotes).toHaveLength(1)
    // It can only be kept aside or discarded: «Aplicar la mía» is not possible on a closed review.
    expect(a.engine.resolveReviewText(notice.id, "content.note", "mine")).toBe(false)
    expect(a.engine.getSnapshot().notices).toHaveLength(1)
  })

  it("an intent whose close op is not in this copy's queue (another tab sent it, or its copy was overwritten) runs again instead of hanging", async () => {
    const w = world()
    const a = await device(w)
    a.engine.saveReview("week", WEEK, { "content.wins": "Huérfana" })
    await settle(a.engine)
    a.engine.requestClose("week", WEEK)
    const intent = { ...a.engine.closeIntent("week", WEEK)!, opId: "op-lost-close" }
    a.engine.stop()
    const copy = structuredClone(a.storage.data!)
    copy.closeIntents = [intent]
    const b = await device(w, memoryStorage(copy))
    await settle(b.engine)
    expect(serverReview(w)).toMatchObject({ status: "closed", content: { wins: "Huérfana" } })
    expect(b.engine.closeIntent("week", WEEK)).toBeUndefined()
  })

  it("not offered without the server migration: drafts stay on the device, unsent and without busy retries", async () => {
    const w = world()
    w.server.reviewsSupported = false
    const a = await device(w)
    expect(a.engine.getSnapshot().reviews).toBe(false)
    expect(a.engine.saveReview("week", WEEK, { "content.wins": "Guardado aquí" })).toEqual({ ok: true })
    await settle(a.engine)
    const calls = a.transport.calls
    await settle(a.engine)
    expect(a.transport.calls).toBe(calls)
    expect(a.engine.getSnapshot()).toMatchObject({ pending: 1, status: "pending" })
    expect(a.engine.reviewSyncState("week", WEEK)).toBe("local")
    expect(a.engine.requestClose("week", WEEK)).toEqual({ ok: false, reason: "no_server_support" })
    expect(w.server.applied.size).toBe(0)
    // The migration arrives: the draft is sent.
    w.server.reviewsSupported = true
    await settle(a.engine)
    await settle(a.engine)
    expect(serverReview(w)?.content).toEqual({ wins: "Guardado aquí" })
  })
})

describe("exceptional delete (D52)", () => {
  it("needs confirmation, a synced review and the version this device shows; never automatic", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    expect(a.engine.deleteReview("week", WEEK, "delete")).toEqual({ ok: false, reason: "not_synced" })
    a.engine.saveReview("week", WEEK, { "content.wins": "Borrar" })
    expect(a.engine.deleteReview("week", WEEK, "delete")).toEqual({ ok: false, reason: "not_synced" })
    await settle(a.engine)
    await settle(b.engine)
    expect(a.engine.deleteReview("week", WEEK, "yes")).toEqual({ ok: false, reason: "confirmation_required" })
    // B changes it after A loaded it: A's delete (queued offline) does not remove B's work.
    a.transport.online = false
    await a.engine.sync()
    expect(a.engine.deleteReview("week", WEEK, "delete")).toEqual({ ok: true })
    expect(review(a.engine)).toBeUndefined()
    b.engine.saveReview("week", WEEK, { "content.lessons": "Trabajo posterior" })
    await settle(b.engine)
    a.transport.online = true
    await settle(a.engine)
    expect(serverReview(w)).toMatchObject({ deleted: false, content: { wins: "Borrar", lessons: "Trabajo posterior" } })
    expect(a.engine.getSnapshot().notices).toMatchObject([{ opType: "review.delete", code: "review_changed" }])
    expect(review(a.engine)?.content.lessons).toBe("Trabajo posterior")
  })

  it("an edit written offline before another device deleted it does not bring it back; the user decides", async () => {
    const w = world()
    const a = await device(w)
    const b = await device(w)
    a.engine.saveReview("week", WEEK, { "content.wins": "Original" })
    await settle(a.engine)
    await settle(b.engine)
    a.transport.online = false
    await a.engine.sync()
    // A writes a section it never had (base 0: the review was seen).
    a.engine.saveReview("week", WEEK, { "content.lessons": "Sin conexión" })
    expect(b.engine.deleteReview("week", WEEK, "delete")).toEqual({ ok: true })
    await settle(b.engine)
    a.transport.online = true
    await settle(a.engine)
    expect(serverReview(w)).toMatchObject({ deleted: true, content: {} })
    expect(review(a.engine)).toBeUndefined()
    const [notice] = a.engine.getSnapshot().notices
    expect(notice).toMatchObject({ kind: "conflict", code: "review_deleted", op: { fields: { "content.lessons": "Sin conexión" } } })
    // «Recuperar con mi texto» is an explicit decision: a fresh draft with the user's text only.
    a.engine.resolveReviewText(notice.id, "content.lessons", "mine")
    await settle(a.engine)
    expect(serverReview(w)).toMatchObject({ deleted: false, content: { lessons: "Sin conexión" } })
  })

  it("a deleted review can be closed again from a device that only saw it after a full pull", async () => {
    const w = world()
    const a = await device(w)
    a.engine.saveReview("week", WEEK, { "content.wins": "Borrar" })
    await settle(a.engine)
    a.engine.deleteReview("week", WEEK, "delete")
    await settle(a.engine)
    a.engine.stop()
    const fresh = await device(w)
    expect(review(fresh.engine)).toBeUndefined()
    expect(fresh.engine.requestClose("week", WEEK)).toEqual({ ok: true, deferred: false })
    await settle(fresh.engine)
    expect(serverReview(w)).toMatchObject({ status: "closed", deleted: false, content: {} })
  })
})

describe("persisted copies of earlier versions (D39)", () => {
  /** Exactly what M3.3 saved: no reviews, no close intents, a pending check-in and a kept reflection. */
  function m33Copy(): PersistedSync {
    const up = upgradePersisted({ cache: { state: { version: 1, timezone: "Europe/Madrid", habits: [], entries: {}, restDays: [], seededOn: "2026-10-01" } }, queue: [] }, TODAY)!
    const state = { ...up.cache.state } as Record<string, unknown>
    delete state.reviews
    const reflection: Op = { type: "checkin.set", op_id: "op-note-1", local_date: "2026-10-28", phase: "pm", fields: { note: "Mi reflexión" }, at: "2026-10-28T20:00:00.000Z", base_note_seq: 3 }
    return {
      cache: { ...up.cache, state: state as never, features: { goals: true, focus: true, checkins: true } },
      queue: [{ op: { type: "checkin.set", op_id: "op-pending-1", local_date: "2026-10-29", phase: "am", fields: { energy: 4 }, at: "2026-10-29T07:00:00.000Z", base_note_seq: null }, enqueuedAt: T0, attempts: 0 }],
      pendingNotes: [{ id: "op-note-1", kind: "conflict", opType: "checkin.set", code: "note_conflict", op: reflection }],
      resolvedNotes: [],
    }
  }

  it("an M3.3 copy upgrades in place: reviews empty, the queue and the reflection kept", () => {
    const old = m33Copy()
    const up = upgradePersisted(structuredClone(old), TODAY)!
    expect(up.cache.state.reviews).toEqual({})
    expect(up.closeIntents).toEqual([])
    expect(up.queue).toEqual(old.queue)
    expect(up.pendingNotes).toEqual(old.pendingNotes)
    expect(up.cache.features).toEqual(old.cache.features)
  })

  it("the engine opens an M3.3 copy, sends its pending op once and keeps the reflection waiting", async () => {
    const w = world()
    const a = await device(w, memoryStorage(m33Copy()))
    await settle(a.engine)
    expect(w.server.applied.get("op-pending-1")).toBe(1)
    expect(a.engine.getSnapshot()).toMatchObject({ pending: 0, reviews: true })
    expect(a.engine.getSnapshot().notices.map((x) => x.id)).toEqual(["op-note-1"])
    expect(a.storage.data?.pendingNotes?.map((x) => x.id)).toEqual(["op-note-1"])
    expect(a.storage.data?.cache.state.reviews).toEqual({})
  })

  it("kept review texts and close intents survive a reload of the current shape", () => {
    const current = m33Copy()
    const kept = { id: "op-r-1", kind: "conflict" as const, opType: "review.save" as const, code: "review_field_conflict", op: { type: "review.save" as const, op_id: "op-r-1", kind: "week" as const, period_start: WEEK, fields: { "content.wins": "Mío" }, base_seqs: { "content.wins": 4 } } }
    const intent = { id: "ci-1", kind: "week" as const, periodStart: PREV, fingerprint: "{}", requestedAt: T0, opId: null, attempts: 0, state: "waiting" as const }
    const up = upgradePersisted({ ...current, pendingNotes: [...current.pendingNotes!, kept], closeIntents: [intent] }, TODAY)!
    expect(up.pendingNotes?.map((x) => x.id)).toEqual(["op-note-1", "op-r-1"])
    expect(up.closeIntents).toEqual([intent])
  })
})
