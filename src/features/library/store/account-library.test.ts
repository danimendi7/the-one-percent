import { describe, expect, it, vi } from "vitest"
import { demoLibrary } from "@/features/knowledge/demo"
import type { SyncEngine } from "@/features/sync/engine"
import { accountLibrary } from "./account-library"

/** Only what accountLibrary touches: the view, the clock and the library writes. */
function fakeEngine(confirmed: Set<string>) {
  const library = demoLibrary("2026-10-21")
  const snapshot = { ready: true, librarySync: { ready: true }, library, today: "2026-10-21", notices: [], persisted: true }
  const engine = {
    getSnapshot: () => snapshot,
    clientTime: () => "2026-10-21T18:30:00.000Z",
    libraryIsConfirmed: (entity: string, id: string) => confirmed.has(`${entity}:${id}`),
    libraryDelete: vi.fn(() => ({ ok: true })),
    libraryRestore: vi.fn(),
    libraryCreate: vi.fn(),
    libraryUpdate: vi.fn(),
    librarySetLink: vi.fn(),
  }
  return { engine, lib: accountLibrary(engine as unknown as SyncEngine) }
}

describe("accountLibrary · «Deshacer» (P14)", () => {
  it("restores what the server had when it was deleted, even if the confirmed delete has since left the device copy", () => {
    const confirmed = new Set(["note:demo-note-1"])
    const { engine, lib } = fakeEngine(confirmed)
    const r = lib.actions.deleteNote("demo-note-1")
    expect(r.ok).toBe(true)
    // the delete is confirmed and pulled: the row is no longer in the device copy
    confirmed.clear()
    if (r.ok) lib.actions.undo(r.undo)
    expect(engine.libraryRestore).toHaveBeenCalledWith("note", "demo-note-1", expect.any(Object), undefined)
    expect(engine.libraryCreate).not.toHaveBeenCalled()
  })

  it("creates again, with the same id, what never reached the server", () => {
    const { engine, lib } = fakeEngine(new Set())
    const r = lib.actions.deleteNote("demo-note-1")
    if (r.ok) lib.actions.undo(r.undo)
    expect(engine.libraryCreate).toHaveBeenCalledWith("note", expect.any(Object), expect.objectContaining({ id: "demo-note-1" }))
    expect(engine.libraryRestore).not.toHaveBeenCalled()
  })

  it("a book and its notes: each one restored or created by what the server had at delete time", () => {
    const confirmed = new Set(["item:demo-book-outlive", "note:demo-note-1", "note:demo-note-2"])
    const { engine, lib } = fakeEngine(confirmed)
    const r = lib.actions.deleteItem("demo-book-outlive")
    confirmed.clear()
    if (r.ok) lib.actions.undo(r.undo)
    expect(engine.libraryRestore.mock.calls.map((c) => `${c[0]}:${c[1]}`).sort()).toEqual(["item:demo-book-outlive", "note:demo-note-1", "note:demo-note-2"])
    expect(engine.libraryCreate.mock.calls.map((c) => (c[2] as { id: string }).id)).toEqual(["demo-note-3"])
  })

  it("a refused delete gives no undo", () => {
    const { engine, lib } = fakeEngine(new Set())
    engine.libraryDelete.mockReturnValueOnce({ ok: false, reason: "pending" } as never)
    expect(lib.actions.deleteItem("demo-book-outlive")).toEqual({ ok: false, error: { code: "pending", detail: "demo-book-outlive" } })
  })
})
