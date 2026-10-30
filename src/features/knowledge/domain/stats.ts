import { cmp } from "./text"
import type { ContentKind, KnowledgeState, NoteType } from "./types"

/**
 * First, simple Library figures (plan §4.3). Counted from the records only, like Analytics:
 * a ratio with nothing to count is null (N/D), never 0 %.
 */

/** Finished content per year of `finishedOn` (only items still marked finished). */
export function finishedByYear(state: KnowledgeState, kind: ContentKind): { year: number; count: number }[] {
  const counts = new Map<number, number>()
  for (const i of Object.values(state.items)) {
    if (i.kind !== kind || i.status !== "done" || !i.finishedOn) continue
    const y = Number(i.finishedOn.slice(0, 4))
    counts.set(y, (counts.get(y) ?? 0) + 1)
  }
  return [...counts].map(([year, count]) => ({ year, count })).sort((a, b) => a.year - b.year)
}

/** Notes created per month (`YYYY-MM` of the creation instant in UTC), optionally of some types. */
export function notesByMonth(state: KnowledgeState, types?: readonly NoteType[]): { month: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const n of Object.values(state.notes)) {
    if (types && !types.includes(n.type)) continue
    const m = n.createdAt.slice(0, 7)
    counts.set(m, (counts.get(m) ?? 0) + 1)
  }
  return [...counts].map(([month, count]) => ({ month, count })).sort((a, b) => cmp(a.month, b.month))
}

export interface ApplicationSummary {
  open: number
  doing: number
  done: number
  dropped: number
  /** Done over the ones still meant to happen (dropped ones leave the denominator); null with none. */
  doneRatio: number | null
}

export function applicationSummary(state: KnowledgeState): ApplicationSummary {
  const s = { open: 0, doing: 0, done: 0, dropped: 0 }
  for (const n of Object.values(state.notes)) if (n.type === "application" && n.applicationStatus) s[n.applicationStatus]++
  const meant = s.open + s.doing + s.done
  return { ...s, doneRatio: meant ? s.done / meant : null }
}

/** How many notes of each type a set of notes holds (section counters). */
export function countByType(state: KnowledgeState, itemId?: string | null): Record<NoteType, number> {
  const out: Record<NoteType, number> = { idea: 0, learning: 0, quote: 0, application: 0, note: 0, question: 0 }
  for (const n of Object.values(state.notes)) if (itemId === undefined || n.itemId === itemId) out[n.type]++
  return out
}
