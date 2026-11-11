import { addDays, diffDays, type LocalDate } from "@/features/habits/domain/dates"
import type { DateRange } from "@/features/habits/domain/metrics"
import { dailyQueue } from "./schedule"
import type { RecallState } from "./types"

/** A full download brings this many days of attempts (pull_changes, D2). */
export const RECALL_HISTORY_DAYS = 90

export interface RecallStats {
  answers: number
  /** Answered with anything but «Otra vez». */
  remembered: number
  /** remembered / answers, or null with nothing answered: never a made-up 0 %. */
  retention: number | null
  cardsDue: number
  /** Cards in use (suspended ones do not count). */
  cards: number
  /** The period reaches further back than a device is guaranteed to hold. */
  historyLimited: boolean
}

export function recallStats(recall: RecallState, range: DateRange, today: LocalDate): RecallStats {
  const attempts = Object.values(recall.attempts).filter((a) => a.localDate >= range.from && a.localDate <= range.to)
  const remembered = attempts.filter((a) => a.grade !== "again").length
  const cards = Object.values(recall.cards)
  return {
    answers: attempts.length,
    remembered,
    retention: attempts.length ? remembered / attempts.length : null,
    cardsDue: dailyQueue(cards, today).queue.length,
    cards: cards.filter((c) => c.suspendedOn === null).length,
    historyLimited: range.from < addDays(today, -RECALL_HISTORY_DAYS),
  }
}

export interface NoteRecallSummary {
  cards: number
  nextDue: LocalDate
  dueNow: boolean
  daysToNext: number
}

/** The active cards made from an idea, and when the soonest comes back. */
export function noteRecallSummary(recall: RecallState, noteId: string, today: LocalDate): NoteRecallSummary | null {
  const cards = Object.values(recall.cards).filter((c) => c.sourceType === "note" && c.sourceId === noteId && c.suspendedOn === null)
  if (cards.length === 0) return null
  const nextDue = cards.map((c) => c.schedule.dueOn).reduce((a, b) => (b < a ? b : a))
  return { cards: cards.length, nextDue, dueNow: nextDue <= today, daysToNext: Math.max(0, diffDays(today, nextDue)) }
}
