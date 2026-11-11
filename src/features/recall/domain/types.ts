import type { LocalDate } from "@/features/habits/domain/dates"
import type { Grade, QueueCard } from "./schedule"

/** Active Recall (docs/m4-knowledge-os-plan.md, M4i): cards written by the user, optionally from an idea. */
export interface RecallCard extends QueueCard {
  question: string
  answer: string
  /** The idea it came from. No foreign key: deleting an idea leaves the card, which then has no origin to show. */
  sourceType: "note" | null
  sourceId: string | null
  lastAnsweredAt: string | null
  algorithmVersion: number
}

/** One answer. Never changed or removed: the history survives even if the card is deleted. */
export interface RecallAttempt {
  id: string
  cardId: string
  grade: Grade
  respondedAt: string
  localDate: LocalDate
  dueOnBefore: LocalDate
  dueOnAfter: LocalDate
  intervalDays: number
  algorithmVersion: number
}

export interface RecallState {
  cards: Record<string, RecallCard>
  attempts: Record<string, RecallAttempt>
}
