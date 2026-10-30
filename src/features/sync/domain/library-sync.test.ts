import { describe, expect, it } from "vitest"
import { applyChanges, applyLibraryOps, emptyRows, enqueueLibrary, isLibraryText, libraryBases, refreshBases, rowsToState } from "./library-sync"
import type { WireChange, WireRow } from "./library-wire"
import type { LibraryOp, LibraryUpdateOp, QueuedOp } from "./types"

const at = "2026-10-30T10:00:00.000Z"
const row = (id: string, seq: number, extra: Record<string, unknown> = {}): WireRow => ({ id, server_seq: seq, deleted: false, created_at: at, updated_at: at, ...extra })
const book = (id: string, seq: number) => row(id, seq, { kind: "book", title: "Libro", status: "planned", favorite: false, creators: [], topics: [], field_seqs: { title: seq } })
const note = (id: string, seq: number, itemId: string | null, body = "Idea") => row(id, seq, { item_id: itemId, note_type: "idea", body, captured_at: at, field_seqs: { body: seq } })
const ch = (t: WireChange["t"], r: WireRow): WireChange => ({ t, seq: Number(r.server_seq), row: r })
const q = (op: LibraryOp): QueuedOp => ({ op, enqueuedAt: 0, attempts: 0 })

describe("confirmed rows", () => {
  it("newest version per row wins, tombstones remove, the same page twice changes nothing", () => {
    const rows = emptyRows()
    expect(applyChanges(rows, [ch("item", book("b", 5)), ch("note", note("n", 6, "b"))])).toBe(2)
    expect(applyChanges(rows, [ch("note", note("n", 4, "b", "vieja"))])).toBe(0)
    expect(rows.note.get("n")!.body).toBe("Idea")
    expect(applyChanges(rows, [ch("note", { ...note("n", 9, "b"), deleted: true })])).toBe(1)
    expect(rows.note.has("n")).toBe(false)
    expect(applyChanges(rows, [ch("item", book("b", 5))])).toBe(0)
  })

  it("rows become domain entities, links under their canonical key", () => {
    const rows = emptyRows()
    applyChanges(rows, [ch("item", book("b", 5)), ch("note", note("n", 6, "b")), ch("link", row("l1", 7, { a_type: "item", a_id: "b", b_type: "note", b_id: "n" }))])
    const s = rowsToState(rows)
    expect(s.items.b).toMatchObject({ kind: "book", title: "Libro" })
    expect(s.notes.n).toMatchObject({ itemId: "b", body: "Idea" })
    expect(Object.keys(s.links)).toEqual(["item:b|note:n"])
  })
})

describe("optimistic view", () => {
  const base = () => {
    const rows = emptyRows()
    applyChanges(rows, [
      ch("item", book("b", 5)),
      ch("note", note("n1", 6, "b")),
      ch("note", note("n2", 7, null)),
      ch("show", row("s", 8, { title: "Programa", topics: [] })),
      ch("item", row("e", 9, { kind: "episode", title: "Ep", status: "planned", favorite: false, creators: [], topics: [], show_id: "s" })),
      ch("link", row("l", 10, { a_type: "item", a_id: "b", b_type: "note", b_id: "n2" })),
    ])
    return rowsToState(rows)
  }

  it("creates, edits and links show at once; untouched records keep their identity", () => {
    const s0 = base()
    const s = applyLibraryOps(s0, [
      { type: "library.note.create", op_id: "1", id: "n3", fields: { item_id: "b", note_type: "quote", body: "Cita", page: 4 }, at },
      { type: "library.note.update", op_id: "2", id: "n1", fields: { body: "Editada" }, base_seqs: { body: 6 }, at },
      { type: "library.link.set", op_id: "3", a_type: "note", a_id: "n3", b_type: "item", b_id: "e", linked: true },
    ])
    expect(s.notes.n3).toMatchObject({ type: "quote", body: "Cita", locator: { page: 4 } })
    expect(s.notes.n1.body).toBe("Editada")
    expect(s.links["item:e|note:n3"]).toBeDefined()
    expect(s.shows).toBe(s0.shows)
    expect(s.items).toBe(s0.items)
    expect(applyLibraryOps(s0, [])).toBe(s0)
  })

  it("deleting a content takes its notes and links; deleting a show only detaches its episodes", () => {
    const s = applyLibraryOps(base(), [
      { type: "library.item.delete", op_id: "1", id: "b", base_seq: 5, notes_seq: 6 },
      { type: "library.show.delete", op_id: "2", id: "s", base_seq: 8 },
    ])
    expect(s.items.b).toBeUndefined()
    expect(s.notes.n1).toBeUndefined()
    expect(s.notes.n2).toBeDefined()
    expect(s.links).toEqual({})
    expect(s.items.e.kind === "episode" && s.items.e.episode.showId).toBeNull()
  })

  it("an edit of something no longer there changes nothing", () => {
    const s0 = base()
    const s = applyLibraryOps(s0, [{ type: "library.note.update", op_id: "1", id: "gone", fields: { body: "x" }, base_seqs: {}, at }])
    expect(s.notes).toEqual(s0.notes)
  })
})

describe("queue compaction (unsent ops only)", () => {
  const create: LibraryOp = { type: "library.note.create", op_id: "c", id: "n", fields: { body: "v1", item_id: null, note_type: "idea" }, at }
  const upd = (op_id: string, fields: Record<string, unknown>, base_seqs: Record<string, number | null>): LibraryUpdateOp => ({ type: "library.note.update", op_id, id: "n", fields, base_seqs, at })

  it("an edit folds into an unsent create", () => {
    const out = enqueueLibrary([q(create)], upd("u", { body: "v2", starred: true }, { body: null }), 1, new Set())!
    expect(out).toHaveLength(1)
    expect(out[0].op).toMatchObject({ type: "library.note.create", fields: { body: "v2", starred: true } })
  })

  it("an edit folds into an unsent edit keeping the first base of each field", () => {
    const out = enqueueLibrary([q(upd("u1", { body: "a" }, { body: 6 }))], upd("u2", { body: "b", starred: true }, { body: 9, starred: 3 }), 1, new Set())!
    expect(out).toHaveLength(1)
    expect(out[0].op).toMatchObject({ fields: { body: "b", starred: true }, base_seqs: { body: 6, starred: 3 } })
  })

  it("nothing in flight is touched", () => {
    const out = enqueueLibrary([q(create)], upd("u", { body: "v2" }, {}), 1, new Set(["c"]))!
    expect(out).toHaveLength(2)
  })

  it("deleting something never sent drops it; deleting something sent keeps the delete", () => {
    const del: LibraryOp = { type: "library.note.delete", op_id: "d", id: "n", base_seq: 0 }
    expect(enqueueLibrary([q(create), q(upd("u", { body: "x" }, {}))], del, 1, new Set())).toEqual([])
    expect(enqueueLibrary([q(create)], del, 1, new Set(["c"]))!.map((x) => x.op.op_id)).toEqual(["c", "d"])
  })

  it("a link's desired state replaces the previous unsent one for the same pair (in either order)", () => {
    const l1: LibraryOp = { type: "library.link.set", op_id: "l1", a_type: "item", a_id: "b", b_type: "note", b_id: "n", linked: true }
    const l2: LibraryOp = { type: "library.link.set", op_id: "l2", a_type: "note", a_id: "n", b_type: "item", b_id: "b", linked: false }
    expect(enqueueLibrary([q(l1)], l2, 1, new Set())!.map((x) => x.op.op_id)).toEqual(["l2"])
  })

  it("other modules' ops are not handled here", () => {
    expect(enqueueLibrary([], { type: "profile.update", op_id: "p", timezone: "Europe/Madrid" }, 1, new Set())).toBeNull()
  })
})

describe("bases and durable texts", () => {
  it("bases come from the confirmed field versions; unseen fields have none", () => {
    expect(libraryBases(note("n", 6, null), ["body", "starred"])).toEqual({ body: 6, starred: null })
    expect(libraryBases(undefined, ["body"])).toEqual({ body: null })
  })

  it("a base moves up only to this device's own confirmed write", () => {
    const op: LibraryUpdateOp = { type: "library.note.update", op_id: "u", id: "n", fields: { body: "x" }, base_seqs: { body: 6 }, at }
    const r = { ...note("n", 9, null), field_seqs: { body: 9 } }
    expect(refreshBases(op, r, new Set([9])).base_seqs).toEqual({ body: 9 })
    expect(refreshBases(op, r, new Set([8]))).toBe(op)
  })

  it("texts of creates and edits are durable; deletes and links are not", () => {
    const n = (op: LibraryOp) => isLibraryText({ id: op.op_id, kind: "conflict", opType: op.type, op })
    expect(n({ type: "library.note.update", op_id: "1", id: "n", fields: {}, base_seqs: {}, at })).toBe(true)
    expect(n({ type: "library.item.create", op_id: "2", id: "b", fields: {}, at })).toBe(true)
    expect(n({ type: "library.note.delete", op_id: "3", id: "n", base_seq: 1 })).toBe(false)
    expect(n({ type: "library.link.set", op_id: "4", a_type: "item", a_id: "b", b_type: "note", b_id: "n", linked: true })).toBe(false)
  })
})
