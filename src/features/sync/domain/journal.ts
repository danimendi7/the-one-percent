import type { QueuedOp } from "./types"

/**
 * One entry of the queue journal (Orden 2 §1): the latest state of one queued operation, written
 * synchronously before the change is shown, so closing the app before the device copy
 * (IndexedDB, asynchronous) holds it loses nothing. `q: null` records that the operation left the
 * queue unsent (folded into a newer write, or a never-sent creation deleted). `t` orders the entries
 * and versions each one: a tab only releases an entry whose `t` is still the one it saved.
 */
export interface JournalEntry {
  opId: string
  t: number
  q: QueuedOp | null
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** A stored value read back as an entry, or null when it is not one (another version, damaged). */
export function parseJournalEntry(opId: string, raw: unknown): JournalEntry | null {
  if (!isObject(raw) || typeof raw.t !== "number") return null
  if (raw.q === null) return { opId, t: raw.t, q: null }
  const q = raw.q
  if (!isObject(q) || !isObject(q.op) || q.op.op_id !== opId || typeof q.enqueuedAt !== "number") return null
  return { opId, t: raw.t, q: { op: q.op, enqueuedAt: q.enqueuedAt, attempts: typeof q.attempts === "number" ? q.attempts : 0 } as QueuedOp }
}

/**
 * What changed in the queue between two moments, as journal entries: operations that are new or
 * were rewritten (merged with a newer write of the same target), and operations that left it.
 */
export function journalChanges(before: readonly QueuedOp[], after: readonly QueuedOp[], t: number): JournalEntry[] {
  const kept = new Set(before)
  const afterIds = new Set(after.map((q) => q.op.op_id))
  const written = after.filter((q) => !kept.has(q)).map((q) => ({ opId: q.op.op_id, t, q }))
  const removed = before.filter((q) => !afterIds.has(q.op.op_id)).map((q) => ({ opId: q.op.op_id, t, q: null }))
  // New versions first: if storage fills up half-way, the removal of the old version is what is
  // missing, and both come back (the newer one wins on the server), never neither.
  return [...written, ...removed]
}

/**
 * The queue to resume with: the device copy's queue with the journal applied on top, oldest entry
 * first. An operation another tab already removed from the shared queue (`gone`: sent, or folded)
 * does not come back. Anything the journal holds twice over is harmless: the server applies each
 * op_id once.
 */
export function recoverQueue(
  stored: readonly QueuedOp[],
  entries: readonly JournalEntry[],
  gone: ReadonlySet<string>
): { queue: QueuedOp[]; recovered: number } {
  let queue = [...stored]
  let recovered = 0
  for (const e of [...entries].sort((a, b) => a.t - b.t)) {
    const i = queue.findIndex((q) => q.op.op_id === e.opId)
    if (e.q === null) {
      if (i >= 0) {
        queue = queue.filter((_, j) => j !== i)
        recovered++
      }
      continue
    }
    if (gone.has(e.opId)) continue
    if (i >= 0) {
      // Only the operation counts: `attempts` changes in place while retrying and is not journaled.
      if (JSON.stringify(queue[i].op) !== JSON.stringify(e.q.op)) {
        queue[i] = e.q
        recovered++
      }
    } else {
      queue.push(e.q)
      recovered++
    }
  }
  return { queue, recovered }
}
