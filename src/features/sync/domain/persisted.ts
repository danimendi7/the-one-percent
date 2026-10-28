import type { LocalDate } from "@/features/habits/domain/dates"
import type { PersistedSync } from "../engine"
import { emptyCache } from "./merge"
import { normalizeConfig } from "@/features/mind/domain/ops"
import type { QueuedOp, SyncNotice } from "./types"

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * Bring a copy persisted by an older app version up to the current shape.
 *
 * Additive only: fields a newer version introduced get their empty default (e.g. M3.1 `goals`
 * and `measurements` on an M3.0 copy, M3.2 `focusSessions` on an M3.1 copy, M3.3 `checkins` and `checkinConfig` on an M3.2 copy); nothing that is present is dropped or rewritten, and
 * every queued operation is kept, so pending offline work always reaches the server.
 * Returns null only when there is nothing usable at all.
 */
export function upgradePersisted(raw: unknown, today: LocalDate): PersistedSync | null {
  if (!isObject(raw)) return null
  const queue = Array.isArray(raw.queue) ? (raw.queue.filter((q) => isObject(q) && isObject(q.op) && typeof q.op.op_id === "string") as QueuedOp[]) : []
  // Reflections waiting for the user's decision (M3.3): kept whatever else the copy lacks.
  const pendingNotes = Array.isArray(raw.pendingNotes)
    ? (raw.pendingNotes.filter((n) => isObject(n) && typeof n.id === "string" && isObject(n.op) && n.op.type === "checkin.set") as SyncNotice[])
    : []
  const resolvedNotes = Array.isArray(raw.resolvedNotes) ? raw.resolvedNotes.filter((r): r is string => typeof r === "string") : []
  const notes = { pendingNotes, resolvedNotes }
  if (!isObject(raw.cache) || !isObject(raw.cache.state)) {
    return queue.length || pendingNotes.length ? { cache: emptyCache(today), queue, ...notes } : null
  }
  const base = emptyCache(today, typeof raw.cache.state.timezone === "string" ? raw.cache.state.timezone : undefined)
  const s = raw.cache.state
  const c = raw.cache
  return {
    cache: {
      ...base,
      ...c,
      state: {
        ...base.state,
        ...s,
        habits: Array.isArray(s.habits) ? s.habits : [],
        entries: isObject(s.entries) ? s.entries : {},
        restDays: Array.isArray(s.restDays) ? s.restDays : [],
        dimensions: Array.isArray(s.dimensions) && s.dimensions.length ? s.dimensions : base.state.dimensions,
        goals: Array.isArray(s.goals) ? s.goals : [],
        measurements: isObject(s.measurements) ? s.measurements : {},
        focusSessions: Array.isArray(s.focusSessions) ? s.focusSessions : [],
        checkins: isObject(s.checkins) ? s.checkins : {},
        checkinConfig: normalizeConfig(s.checkinConfig),
      } as PersistedSync["cache"]["state"],
      habitVersion: isObject(c.habitVersion) ? (c.habitVersion as Record<string, number>) : {},
      rowSeq: isObject(c.rowSeq) ? (c.rowSeq as Record<string, number>) : {},
      cursor: typeof c.cursor === "number" ? c.cursor : 0,
      serverToday: typeof c.serverToday === "string" ? c.serverToday : today,
    },
    queue,
    ...notes,
  }
}
