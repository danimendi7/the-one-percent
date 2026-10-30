import { applyChanges, emptyRows, LIB_TABLES, type LibraryMeta, type LibraryRows, type LibTable } from "./domain/library-sync"
import type { WireChange, WireRow } from "./domain/library-wire"

/**
 * Device copy of the Library (N1, D72): one entry per show, content, note and link in a database of
 * its own, so saving a habit never rewrites thousands of notes and saving a page only writes the
 * rows that changed. Holds only what the server confirmed: the user's pending edits live in the
 * operation queue of the main record (`v1:<user>`), like every other module.
 *
 * Atomicity: a page's rows and the new cursor are written in ONE IndexedDB transaction. If it
 * aborts, neither the rows nor the cursor move, and the next pull starts again from the last page
 * that was stored.
 */
export interface StoredLibrary {
  rows: LibraryRows
  meta: LibraryMeta | null
}

export interface LibraryStore {
  load(): Promise<StoredLibrary>
  /** Rows of one page and the cursor after it, atomically. Rejects (and stores nothing) on failure. */
  applyPage(changes: readonly WireChange[], meta: LibraryMeta): Promise<void>
  /** Removes this user's copy (sign-out «borrar este dispositivo»). */
  clear(): Promise<void>
}

/** Test hooks: make the next page fail before its transaction commits, or after it committed. */
export interface StoreFaults {
  failBeforeCommit?: number
  failAfterCommit?: number
}

const DB_NAME = "the-one-percent-library"
const DB_VERSION = 1
const STORES = ["show", "item", "note", "link", "meta"] as const

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error("library_db_blocked"))
  })
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error("library_tx_aborted"))
    tx.onerror = () => reject(tx.error ?? new Error("library_tx_error"))
  })

/** IndexedDB store of one user. Keys are `<userId>:<rowId>`, so accounts never share entries. */
export function idbLibraryStore(userId: string, faults: StoreFaults = {}): LibraryStore {
  let db: Promise<IDBDatabase> | null = null
  const conn = () => (db ??= openDb())
  const prefix = `${userId}:`
  const range = () => IDBKeyRange.bound(prefix, `${prefix}￿`)

  return {
    async load() {
      const d = await conn()
      const tx = d.transaction([...STORES], "readonly")
      const rows = emptyRows()
      const reads = LIB_TABLES.map(
        (t) =>
          new Promise<void>((resolve, reject) => {
            const req = tx.objectStore(t).getAll(range())
            req.onsuccess = () => {
              for (const r of req.result as WireRow[]) rows[t].set(r.id, r)
              resolve()
            }
            req.onerror = () => reject(req.error)
          })
      )
      const meta = new Promise<LibraryMeta | null>((resolve, reject) => {
        const req = tx.objectStore("meta").get(userId)
        req.onsuccess = () => resolve((req.result as LibraryMeta | undefined) ?? null)
        req.onerror = () => reject(req.error)
      })
      await Promise.all([...reads, done(tx)])
      return { rows, meta: await meta }
    },

    async applyPage(changes, meta) {
      const d = await conn()
      const tx = d.transaction([...STORES], "readwrite")
      const finished = done(tx)
      // Per row, only a newer server_seq replaces the stored one (another tab may have written it).
      for (const c of changes) {
        const store = tx.objectStore(c.t as LibTable)
        const key = prefix + c.row.id
        const get = store.get(key)
        get.onsuccess = () => {
          const prev = get.result as WireRow | undefined
          if (prev && Number(prev.server_seq) >= c.seq) return
          if (c.row.deleted) store.delete(key)
          else store.put(c.row, key)
        }
      }
      // The cursor only moves forward, also when two tabs store pages at once.
      const metaStore = tx.objectStore("meta")
      const cur = metaStore.get(userId)
      cur.onsuccess = () => {
        const prev = cur.result as LibraryMeta | undefined
        const next: LibraryMeta = prev && prev.cursor > meta.cursor ? { ...meta, cursor: prev.cursor, complete: prev.complete || meta.complete } : meta
        metaStore.put(next, userId)
        if (faults.failBeforeCommit && faults.failBeforeCommit-- > 0) tx.abort()
      }
      await finished
      if (faults.failAfterCommit && faults.failAfterCommit-- > 0) throw new Error("library_fault_after_commit")
    },

    async clear() {
      const d = await conn()
      const tx = d.transaction([...STORES], "readwrite")
      for (const t of LIB_TABLES) tx.objectStore(t).delete(range())
      tx.objectStore("meta").delete(userId)
      await done(tx)
    },
  }
}

/** In-memory store with the same contract (tests, or a browser without IndexedDB). */
export function memoryLibraryStore(initial?: StoredLibrary, faults: StoreFaults = {}): LibraryStore & { data: StoredLibrary; writes: number } {
  const s = {
    data: initial ?? { rows: emptyRows(), meta: null },
    writes: 0,
    async load() {
      return { rows: cloneRows(s.data.rows), meta: s.data.meta ? { ...s.data.meta } : null }
    },
    async applyPage(changes: readonly WireChange[], meta: LibraryMeta) {
      if (faults.failBeforeCommit && faults.failBeforeCommit-- > 0) throw new Error("library_fault_before_commit")
      const rows = cloneRows(s.data.rows)
      s.writes += changes.length
      applyChanges(rows, structuredClone(changes))
      const prev = s.data.meta
      s.data = { rows, meta: prev && prev.cursor > meta.cursor ? { ...meta, cursor: prev.cursor, complete: prev.complete || meta.complete } : { ...meta } }
      if (faults.failAfterCommit && faults.failAfterCommit-- > 0) throw new Error("library_fault_after_commit")
    },
    async clear() {
      s.data = { rows: emptyRows(), meta: null }
    },
  }
  return s
}

function cloneRows(rows: LibraryRows): LibraryRows {
  const out = emptyRows()
  for (const t of LIB_TABLES) for (const [k, v] of rows[t]) out[t].set(k, v)
  return out
}
