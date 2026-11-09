import { localDateInZone, type LocalDate } from "@/features/habits/domain/dates"
import type { DateRange } from "@/features/habits/domain/metrics"
import { inProgress } from "@/features/knowledge/domain/library"
import type { KnowledgeState } from "@/features/knowledge/domain/types"

/**
 * Learning in Life Analytics (Plan Maestro §5.3, dimension «aprendizaje»). Counts of what the
 * Library holds: an item counts in the period of its finish date, and one finished without a date
 * is reported apart rather than guessed. Listening time adds only the durations that are known.
 */
export interface LearningMetrics {
  booksFinished: number
  episodesFinished: number
  /** Finished items without a date: outside the period's counts. */
  finishedWithoutDate: number
  listenedSeconds: number
  /** Finished episodes of the period whose duration is unknown. */
  episodesWithoutDuration: number
  notesAdded: number
  /** Notes of the period that are practical applications. */
  applicationsAdded: number
  /** Being read or listened to now, whatever the period. */
  inProgress: number
}

export function learningMetrics(state: KnowledgeState, range: DateRange, timeZone: string): LearningMetrics {
  const inRange = (d: LocalDate) => d >= range.from && d <= range.to
  const out: LearningMetrics = {
    booksFinished: 0,
    episodesFinished: 0,
    finishedWithoutDate: 0,
    listenedSeconds: 0,
    episodesWithoutDuration: 0,
    notesAdded: 0,
    applicationsAdded: 0,
    inProgress: inProgress(state, Number.MAX_SAFE_INTEGER).length,
  }
  for (const item of Object.values(state.items)) {
    if (item.status !== "done") continue
    if (item.finishedOn === null) {
      out.finishedWithoutDate++
      continue
    }
    if (!inRange(item.finishedOn)) continue
    if (item.kind === "book") {
      out.booksFinished++
    } else {
      out.episodesFinished++
      if (item.episode.durationSeconds === null) out.episodesWithoutDuration++
      else out.listenedSeconds += item.episode.durationSeconds
    }
  }
  for (const note of Object.values(state.notes)) {
    if (!inRange(localDateInZone(new Date(note.createdAt), timeZone))) continue
    out.notesAdded++
    if (note.type === "application") out.applicationsAdded++
  }
  return out
}
