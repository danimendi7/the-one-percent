import { parseJournalEntry, type JournalEntry } from "./domain/journal"

/**
 * Synchronous, durable record of the operation queue (Orden 2 §1). The device copy in IndexedDB
 * is asynchronous: a change shown on screen took a few milliseconds to reach it, and closing the
 * app in between lost it (PR #27). Each change is written here first, before it is shown.
 */
export interface OpJournal {
  /**
   * Writes the entries in order and returns how many were stored: fewer than given when the browser
   * refused (no storage, quota). The device copy still follows, as before the journal existed.
   */
  write(entries: readonly JournalEntry[]): number
  read(): JournalEntry[]
  /** Forgets each entry whose version is still `t` (it is in the device copy now). */
  release(entries: readonly { opId: string; t: number }[]): void
  clear(): void
}

/** Minimal synchronous key-value store (`localStorage`, or a stand-in in tests). */
export interface KeyValue {
  readonly length: number
  key(i: number): string | null
  getItem(k: string): string | null
  setItem(k: string, v: string): void
  removeItem(k: string): void
}

/**
 * One `localStorage` key per operation: a tab only ever writes its own operations' keys, so two
 * tabs of the same user never overwrite each other's entries (no read-modify-write of a list).
 */
export function keyValueJournal(userId: string, kv: KeyValue | null): OpJournal {
  const prefix = `the-one-percent:queue:v1:${userId}:`
  const keys = () => {
    const out: string[] = []
    if (!kv) return out
    for (let i = 0; i < kv.length; i++) {
      const k = kv.key(i)
      if (k?.startsWith(prefix)) out.push(k)
    }
    return out
  }
  const readOne = (k: string): JournalEntry | null => {
    try {
      return parseJournalEntry(k.slice(prefix.length), JSON.parse(kv?.getItem(k) ?? "null"))
    } catch {
      return null
    }
  }
  return {
    write(entries) {
      if (!kv) return 0
      let stored = 0
      try {
        for (const e of entries) {
          kv.setItem(prefix + e.opId, JSON.stringify({ t: e.t, q: e.q }))
          stored++
        }
      } catch {
        // Storage refused the rest.
      }
      return stored
    },
    read() {
      return keys().map(readOne).filter((e): e is JournalEntry => e !== null)
    },
    release(entries) {
      if (!kv) return
      for (const { opId, t } of entries) {
        const current = readOne(prefix + opId)
        try {
          if (!current || current.t === t) kv.removeItem(prefix + opId)
        } catch {
          // Left behind: the next start-up finds it already in the device copy and adds nothing.
        }
      }
    },
    clear() {
      if (!kv) return
      for (const k of keys()) kv.removeItem(k)
    },
  }
}

/** The browser's `localStorage`, or null where it is unavailable (private mode, server). */
export function browserKeyValue(): KeyValue | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

/** In-memory stand-in for tests: a `Map` behind the `KeyValue` interface. */
export function memoryKeyValue(): KeyValue & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}
