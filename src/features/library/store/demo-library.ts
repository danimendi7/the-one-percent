import { uuidv4 } from "@/lib/ids"
import type { LocalDate } from "@/features/habits/domain/dates"
import { createItem, createNote, createShow, deleteItem, deleteNote, deleteShow, moveNote, restoreRemoved, setLink, updateItem, updateNote, updateShow, type BookInput, type Ctx, type EpisodeInput } from "@/features/knowledge/domain/ops"
import type { KnowledgeState } from "@/features/knowledge/domain/types"
import { demoLibrary } from "@/features/knowledge/demo"
import type { LibraryActions, LibraryBackend, LibrarySnapshot } from "./types"

/**
 * Demo Library (M4d): browser-only, labelled «Demo», never sent anywhere. Same reducers as an
 * account, so the demo refuses and accepts exactly the same things.
 */
export const LIBRARY_DEMO_KEY = "the-one-percent:demo:library:v1"

function read(): KnowledgeState | null {
  try {
    const raw = window.localStorage.getItem(LIBRARY_DEMO_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as KnowledgeState
    return v && typeof v === "object" && v.items && v.notes && v.shows && v.links ? v : null
  } catch {
    return null
  }
}

function write(state: KnowledgeState): boolean {
  try {
    window.localStorage.setItem(LIBRARY_DEMO_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export function clearDemoLibrary(): void {
  try {
    window.localStorage.removeItem(LIBRARY_DEMO_KEY)
  } catch {
    // Nothing stored.
  }
}

/** `today` and `notify` come from the demo store (one data source, one change signal). */
export function createDemoLibrary(today: () => LocalDate, notify: () => void): LibraryBackend & { reset(): void } {
  let snap: LibrarySnapshot | null = null
  let listening = false

  const ensure = (): LibrarySnapshot => {
    if (!listening && typeof window !== "undefined") {
      listening = true
      // Another tab changed the demo library: adopt it (same browser only).
      window.addEventListener("storage", (e) => {
        if (e.key !== LIBRARY_DEMO_KEY || !snap) return
        const next = read()
        if (next) {
          snap = { ...snap, state: next }
          notify()
        }
      })
    }
    const t = today()
    if (!snap) {
      const stored = read()
      const state = stored ?? demoLibrary(t)
      snap = { source: "demo", state, today: t, sync: null, notices: [], persisted: stored ? true : write(state) }
    } else if (snap.today !== t) snap = { ...snap, today: t }
    return snap
  }
  const ctx = (): Ctx => ({ now: new Date().toISOString(), today: ensure().today })
  const commit = (next: KnowledgeState) => {
    const s = ensure()
    if (next === s.state) return
    snap = { ...s, state: next, persisted: write(next) }
    notify()
  }
  /** Applies a reducer result (same state = nothing to save). */
  const run = <R extends { ok: boolean }>(r: R): R => {
    if (r.ok && "state" in r) commit((r as unknown as { state: KnowledgeState }).state)
    return r
  }

  const actions = {
    createItem(kind: "book" | "episode", input: BookInput & EpisodeInput) {
      const id = uuidv4()
      const r = run(createItem(ensure().state, kind as "book", id, input, ctx()))
      return r.ok ? { ok: true, id } : r
    },
    updateItem: (id, patch) => run(updateItem(ensure().state, id, patch, ctx())),
    deleteItem(id) {
      const r = run(deleteItem(ensure().state, id))
      return r.ok ? { ok: true, undo: r.removed } : r
    },
    createShow(input) {
      const id = uuidv4()
      const r = run(createShow(ensure().state, id, input, ctx()))
      return r.ok ? { ok: true, id } : r
    },
    updateShow: (id, patch) => run(updateShow(ensure().state, id, patch, ctx())),
    deleteShow(id) {
      const r = run(deleteShow(ensure().state, id, ctx()))
      return r.ok ? { ok: true, undo: r.removed } : r
    },
    createNote(input) {
      const id = uuidv4()
      const r = run(createNote(ensure().state, id, input, ctx()))
      return r.ok ? { ok: true, id } : r
    },
    updateNote: (id, patch) => run(updateNote(ensure().state, id, patch, ctx())),
    moveNote: (id, itemId) => run(moveNote(ensure().state, id, itemId, ctx())),
    deleteNote(id) {
      const r = run(deleteNote(ensure().state, id))
      return r.ok ? { ok: true, undo: r.removed } : r
    },
    setLink: (a, b, linked) => run(setLink(ensure().state, a, b, linked, ctx())),
    undo: (removed) => commit(restoreRemoved(ensure().state, removed)),
    syncStateOf: () => "demo",
    resolveText: () => false,
    // The demo writes localStorage synchronously, before the action returns; a refused write is tried again here.
    saved: async () => {
      const s = ensure()
      if (s.persisted) return true
      const persisted = write(s.state)
      if (persisted) snap = { ...s, persisted }
      return persisted
    },
  } as LibraryActions

  return {
    getSnapshot: () => (typeof window === "undefined" ? null : ensure()),
    actions,
    reset() {
      const t = today()
      const state = demoLibrary(t)
      snap = { source: "demo", state, today: t, sync: null, notices: [], persisted: write(state) }
      notify()
    },
  }
}
