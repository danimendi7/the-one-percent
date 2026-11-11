/**
 * What was being written in a search assistant (M4g.5, D102), so a reload does not lose it. It lives
 * only in this tab's sessionStorage: never on the server, in IndexedDB or in the service worker.
 * Every access tolerates a browser that refuses the storage (private browsing): a draft is a
 * convenience and never gets in the way of adding something.
 */
export type AssistantKind = "book" | "podcast"

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">

export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000

const VERSION = 1
const PREFIX = "top:draft:"
const KINDS: readonly AssistantKind[] = ["book", "podcast"]

export const draftKey = (kind: AssistantKind, userId: string) => `${PREFIX}${kind}:${userId}`

/** This tab's storage, or null where even touching it is refused. */
export function draftStorage(): DraftStorage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function writeAssistantDraft<T>(storage: DraftStorage | null, kind: AssistantKind, userId: string, data: T, now: number): boolean {
  if (!storage) return false
  try {
    storage.setItem(draftKey(kind, userId), JSON.stringify({ v: VERSION, savedAt: now, data }))
    return true
  } catch {
    return false
  }
}

function readable(value: unknown, now: number): value is { data: unknown } {
  if (typeof value !== "object" || value === null) return false
  const { v, savedAt, data } = value as { v?: unknown; savedAt?: unknown; data?: unknown }
  if (v !== VERSION || typeof savedAt !== "number" || typeof data !== "object" || data === null) return false
  const age = now - savedAt
  return age >= 0 && age < DRAFT_MAX_AGE_MS
}

/** The draft, or null; one that expired or cannot be read is removed. */
export function readAssistantDraft<T>(storage: DraftStorage | null, kind: AssistantKind, userId: string, now: number): T | null {
  if (!storage) return null
  const key = draftKey(kind, userId)
  try {
    const raw = storage.getItem(key)
    if (raw === null) return null
    let parsed: unknown = null
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
    if (readable(parsed, now)) return parsed.data as T
    storage.removeItem(key)
    return null
  } catch {
    return null
  }
}

export function clearAssistantDraft(storage: DraftStorage | null, kind: AssistantKind, userId: string): void {
  if (!storage) return
  try {
    storage.removeItem(draftKey(kind, userId))
  } catch {
    // Nothing to do: it caducates with the tab or at 24 hours.
  }
}

/** Removes every draft in this tab, except those of `keepUserId` when given (changing account). */
export function clearAssistantDrafts(storage: DraftStorage | null, keepUserId?: string): void {
  if (!storage) return
  try {
    const kept = new Set(keepUserId === undefined ? [] : KINDS.map((k) => draftKey(k, keepUserId)))
    const doomed: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key?.startsWith(PREFIX) && !kept.has(key)) doomed.push(key)
    }
    for (const key of doomed) storage.removeItem(key)
  } catch {
    // Same as above.
  }
}
