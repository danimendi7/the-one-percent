import { describe, expect, it } from "vitest"
import { memoryLibraryStore, type LibraryStore } from "./library-store"
import type { WireChange } from "./domain/library-wire"

/**
 * Contract of the Library device copy (D72), run here on the memory store. The same contract runs in
 * Chromium on the IndexedDB store (tests/browser/library-store.spec.ts).
 */

const note = (id: string, seq: number, body = `v${seq}`, deleted = false): WireChange => ({ t: "note", seq, row: { id, server_seq: seq, deleted, body, item_id: null, note_type: "idea" } })
const meta = (cursor: number, complete = true) => ({ cursor, rebuildUpto: null, complete })

export async function storeContract(make: () => LibraryStore | Promise<LibraryStore>) {
  const s = await make()
  // A newer version is never replaced by an older one (two tabs storing pages out of order).
  await s.applyPage([note("a", 20, "nueva")], meta(20))
  await s.applyPage([note("a", 10, "vieja"), note("b", 11)], meta(11))
  let got = await s.load()
  expect(got.rows.note.get("a")!.body).toBe("nueva")
  expect(got.rows.note.get("b")!.body).toBe("v11")
  // The cursor only moves forward.
  expect(got.meta!.cursor).toBe(20)
  // A tombstone removes the row; an older tombstone does not remove a newer row.
  await s.applyPage([note("b", 30, "", true)], meta(30))
  await s.applyPage([note("a", 15, "", true)], meta(15))
  got = await s.load()
  expect(got.rows.note.has("b")).toBe(false)
  expect(got.rows.note.get("a")!.body).toBe("nueva")
  // Idempotent: the same page twice changes nothing.
  await s.applyPage([note("c", 40)], meta(40))
  await s.applyPage([note("c", 40)], meta(40))
  got = await s.load()
  expect(got.rows.note.size).toBe(2)
  await s.clear()
  got = await s.load()
  expect(got.rows.note.size).toBe(0)
  expect(got.meta).toBeNull()
}

describe("library device copy (memory store)", () => {
  it("keeps the newest version per row, a forward-only cursor, tombstones and idempotent pages", async () => {
    await storeContract(() => memoryLibraryStore())
  })

  it("a failure before the commit stores neither rows nor cursor; after the commit both are stored", async () => {
    const s = memoryLibraryStore(undefined, { failBeforeCommit: 1, failAfterCommit: 1 })
    await expect(s.applyPage([note("a", 5)], meta(5))).rejects.toThrow(/before_commit/)
    expect(await s.load()).toEqual({ rows: expect.anything(), meta: null })
    expect((await s.load()).rows.note.size).toBe(0)
    await expect(s.applyPage([note("a", 5)], meta(5))).rejects.toThrow(/after_commit/)
    const got = await s.load()
    expect(got.rows.note.get("a")!.body).toBe("v5")
    expect(got.meta!.cursor).toBe(5)
  })

  it("a rebuild in progress keeps its limit; completing it keeps it complete", async () => {
    const s = memoryLibraryStore()
    await s.applyPage([note("a", 5)], { cursor: 5, rebuildUpto: 99, complete: false })
    expect((await s.load()).meta).toEqual({ cursor: 5, rebuildUpto: 99, complete: false })
    await s.applyPage([note("b", 9)], { cursor: 9, rebuildUpto: null, complete: true })
    expect((await s.load()).meta).toEqual({ cursor: 9, rebuildUpto: null, complete: true })
  })
})
