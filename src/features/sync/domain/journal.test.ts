import { describe, expect, it } from "vitest"
import { journalChanges, parseJournalEntry, recoverQueue, type JournalEntry } from "./journal"
import type { Op, QueuedOp } from "./types"

const entry = (opId: string, value: boolean, local_date = "2026-11-11"): QueuedOp => ({
  op: { type: "entry.set", op_id: opId, habit_id: "h1", local_date, value, client_updated_at: "2026-11-11T10:00:00.000Z", base_seq: null } as Op,
  enqueuedAt: 1,
  attempts: 0,
})

describe("journalChanges", () => {
  it("records new and rewritten operations, and the ones that left the queue", () => {
    const a = entry("a", true)
    const b = entry("b", true)
    const c = entry("c", false)
    const b2 = { ...b, op: { ...b.op } }
    expect(journalChanges([a, b], [b2, c], 7)).toEqual([
      { opId: "b", t: 7, q: b2 },
      { opId: "c", t: 7, q: c },
      { opId: "a", t: 7, q: null },
    ])
  })

  it("records nothing when the queue did not change", () => {
    const a = entry("a", true)
    expect(journalChanges([a], [a], 1)).toEqual([])
  })
})

describe("recoverQueue", () => {
  it("adds what never reached the device copy, oldest first", () => {
    const a = entry("a", true)
    const b = entry("b", true, "2026-11-10")
    const c = entry("c", true, "2026-11-09")
    const r = recoverQueue([a], [{ opId: "c", t: 3, q: c }, { opId: "b", t: 2, q: b }], new Set())
    expect(r.queue.map((q) => q.op.op_id)).toEqual(["a", "b", "c"])
    expect(r.recovered).toBe(2)
  })

  it("does not duplicate an operation the copy already holds, and takes the journal's newer version", () => {
    const a = entry("a", true)
    const newer = entry("a", false)
    expect(recoverQueue([a], [{ opId: "a", t: 1, q: a }], new Set())).toEqual({ queue: [a], recovered: 0 })
    expect(recoverQueue([a], [{ opId: "a", t: 1, q: newer }], new Set())).toEqual({ queue: [newer], recovered: 1 })
    // A retry count is not a new version.
    expect(recoverQueue([{ ...a, attempts: 3 }], [{ opId: "a", t: 1, q: a }], new Set()).recovered).toBe(0)
  })

  it("drops an operation that left the queue unsent, and never revives one another tab removed", () => {
    const a = entry("a", true)
    const b = entry("b", true)
    const r = recoverQueue([a], [{ opId: "a", t: 1, q: null }, { opId: "b", t: 2, q: b }], new Set(["b"]))
    expect(r.queue).toEqual([])
  })
})

describe("parseJournalEntry", () => {
  it("reads entries back and refuses anything else", () => {
    const a = entry("a", true)
    const ok: JournalEntry = { opId: "a", t: 5, q: a }
    expect(parseJournalEntry("a", JSON.parse(JSON.stringify(ok)))).toEqual(ok)
    expect(parseJournalEntry("a", { t: 5, q: null })).toEqual({ opId: "a", t: 5, q: null })
    expect(parseJournalEntry("a", { t: 5, q: { ...a, op: { ...a.op, op_id: "other" } } })).toBeNull()
    expect(parseJournalEntry("a", { q: a })).toBeNull()
    expect(parseJournalEntry("a", "basura")).toBeNull()
  })
})
