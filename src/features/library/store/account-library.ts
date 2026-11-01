import { uuidv4 } from "@/lib/ids"
import { createItem, createNote, createShow, deleteItem, deleteNote, deleteShow, moveNote, setLink, updateItem, updateNote, updateShow, type BookInput, type Ctx, type EpisodeInput, type KnowledgeError, type Removed } from "@/features/knowledge/domain/ops"
import type { ContentItem, KnowledgeState } from "@/features/knowledge/domain/types"
import { changedFields, itemFields, noteFields, showFields } from "@/features/sync/domain/library-wire"
import { isLibraryText } from "@/features/sync/domain/library-sync"
import type { SyncEngine } from "@/features/sync/engine"
import type { LibraryActions, LibraryBackend, LibraryResult, LibrarySnapshot } from "./types"

/**
 * The Library of a signed-in account (M4d) over the M4c engine. Every action runs the domain
 * reducer on the view the user sees first (same validation as the demo), then hands the engine only
 * what changed: the engine queues it durably, sends it and keeps any text the server refuses.
 */
export function accountLibrary(engine: SyncEngine): LibraryBackend {
  let last: ReturnType<SyncEngine["getSnapshot"]> | null = null
  let snap: LibrarySnapshot | null = null

  const view = () => engine.getSnapshot()
  const ctx = (): Ctx => ({ now: engine.clientTime(), today: view().today })
  const state = (): KnowledgeState => view().library

  function getSnapshot(): LibrarySnapshot | null {
    const e = view()
    if (!e.ready || !e.librarySync.ready) return null
    if (e !== last) {
      last = e
      snap = { source: "account", state: e.library, today: e.today, sync: e.librarySync, notices: e.notices.filter(isLibraryText), persisted: e.persisted }
    }
    return snap
  }

  const refused = (r: { ok: false; error: KnowledgeError }): LibraryResult<never> => ({ ok: false, error: r.error })

  // Which removed rows the server had when they were deleted. Decided at delete time, not at undo
  // time: by then the delete may be confirmed and the row gone from the device copy, and only a
  // restore revives a tombstone (D70); a create with that id would be refused.
  const confirmedAtDelete = new WeakMap<Removed, Set<string>>()
  function removedOk(removed: Removed): { ok: true; undo: Removed } {
    const ids = new Set<string>()
    const mark = (entity: "show" | "item" | "note", id: string) => engine.libraryIsConfirmed(entity, id) && ids.add(`${entity}:${id}`)
    for (const x of removed.shows) mark("show", x.id)
    for (const x of removed.items) mark("item", x.id)
    for (const x of removed.notes) mark("note", x.id)
    confirmedAtDelete.set(removed, ids)
    return { ok: true, undo: removed }
  }

  const actions: LibraryActions = {
    createItem(kind: "book" | "episode", input: BookInput & EpisodeInput) {
      const id = uuidv4()
      const r = createItem(state(), kind as "book", id, input, ctx())
      if (!r.ok) return refused(r)
      engine.libraryCreate("item", itemFields(r.item), { id, kind })
      return { ok: true, id }
    },
    updateItem(id, patch) {
      const prev = state().items[id]
      const r = updateItem(state(), id, patch, ctx())
      if (!r.ok) return refused(r)
      if (prev && r.item !== prev) engine.libraryUpdate("item", id, changedFields(itemFields(prev), itemFields(r.item)))
      return { ok: true }
    },
    deleteItem(id) {
      const r = deleteItem(state(), id)
      if (!r.ok) return refused(r)
      const confirmed = removedOk(r.removed)
      const d = engine.libraryDelete("item", id)
      if (!d.ok) return { ok: false, error: { code: d.reason, detail: id } }
      return confirmed
    },
    createShow(input) {
      const id = uuidv4()
      const r = createShow(state(), id, input, ctx())
      if (!r.ok) return refused(r)
      engine.libraryCreate("show", showFields(r.show), { id })
      return { ok: true, id }
    },
    updateShow(id, patch) {
      const prev = state().shows[id]
      const r = updateShow(state(), id, patch, ctx())
      if (!r.ok) return refused(r)
      if (prev && r.show !== prev) engine.libraryUpdate("show", id, changedFields(showFields(prev), showFields(r.show)))
      return { ok: true }
    },
    deleteShow(id) {
      const r = deleteShow(state(), id, ctx())
      if (!r.ok) return refused(r)
      const confirmed = removedOk(r.removed)
      const d = engine.libraryDelete("show", id)
      if (!d.ok) return { ok: false, error: { code: d.reason, detail: id } }
      return confirmed
    },
    createNote(input) {
      const id = uuidv4()
      const r = createNote(state(), id, input, ctx())
      if (!r.ok) return refused(r)
      engine.libraryCreate("note", noteFields(r.note), { id, capturedAt: r.note.createdAt })
      return { ok: true, id }
    },
    updateNote(id, patch) {
      const prev = state().notes[id]
      const r = updateNote(state(), id, patch, ctx())
      if (!r.ok) return refused(r)
      if (prev && r.note !== prev) engine.libraryUpdate("note", id, changedFields(noteFields(prev), noteFields(r.note)))
      return { ok: true }
    },
    moveNote(id, itemId) {
      const prev = state().notes[id]
      const r = moveNote(state(), id, itemId, ctx())
      if (!r.ok) return refused(r)
      if (prev && r.note !== prev) engine.libraryUpdate("note", id, changedFields(noteFields(prev), noteFields(r.note)))
      return { ok: true }
    },
    deleteNote(id) {
      const r = deleteNote(state(), id)
      if (!r.ok) return refused(r)
      const confirmed = removedOk(r.removed)
      const d = engine.libraryDelete("note", id)
      if (!d.ok) return { ok: false, error: { code: d.reason, detail: id } }
      return confirmed
    },
    setLink(a, b, linked) {
      const r = setLink(state(), a, b, linked, ctx())
      if (!r.ok) return refused(r)
      if (r.state !== state()) engine.librarySetLink(a, b, linked)
      return { ok: true }
    },
    undo(removed: Removed) {
      // What reached the server is restored explicitly (the only way to revive a tombstone, D70);
      // what never reached it is simply created again with the same id.
      const confirmed = confirmedAtDelete.get(removed)
      const put = (entity: "show" | "item" | "note", id: string, fields: Record<string, unknown>, kind?: ContentItem["kind"], capturedAt?: string) => {
        if (confirmed?.has(`${entity}:${id}`) || engine.libraryIsConfirmed(entity, id)) engine.libraryRestore(entity, id, fields, kind)
        else engine.libraryCreate(entity, fields, { id, kind, capturedAt })
      }
      for (const s of removed.shows) put("show", s.id, showFields(s))
      for (const i of removed.items) put("item", i.id, itemFields(i), i.kind)
      for (const d of removed.detached) engine.libraryUpdate("item", d.itemId, { show_id: d.showId })
      for (const n of removed.notes) put("note", n.id, noteFields(n), undefined, n.createdAt)
      for (const l of removed.links) engine.librarySetLink(l.a, l.b, true)
    },
    syncStateOf(entity, id) {
      return engine.librarySyncStateOf(entity, id)
    },
    resolveText(noticeId, choice) {
      return engine.resolveLibraryText(noticeId, choice)
    },
    saved() {
      return engine.whenSaved()
    },
  } as LibraryActions

  return { getSnapshot, actions }
}
