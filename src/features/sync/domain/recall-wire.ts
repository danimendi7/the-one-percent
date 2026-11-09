import type { RecallAttempt, RecallCard } from "@/features/recall/domain/types"
import type { Schedule } from "@/features/recall/domain/schedule"
import type { WireRecallAttempt, WireRecallCard, WireRecallSchedule } from "./types"

export function toWireSchedule(s: Schedule): WireRecallSchedule {
  return { state: s.state, reps: s.reps, lapses: s.lapses, ease_factor: s.easeFactor, interval_days: s.intervalDays, due_on: s.dueOn }
}

export function fromWireSchedule(w: WireRecallSchedule): Schedule {
  return { state: w.state, reps: w.reps, lapses: w.lapses, easeFactor: Number(w.ease_factor), intervalDays: w.interval_days, dueOn: w.due_on }
}

export function toRecallCard(w: WireRecallCard): RecallCard {
  return {
    id: w.id,
    question: w.question,
    answer: w.answer,
    sourceType: w.source_type,
    sourceId: w.source_id,
    schedule: fromWireSchedule(w),
    suspendedOn: w.suspended_on,
    firstAnsweredOn: w.first_answered_on,
    lastAnsweredAt: w.last_answered_at,
    algorithmVersion: w.algorithm_version,
    createdAt: w.created_at,
  }
}

export function toRecallAttempt(w: WireRecallAttempt): RecallAttempt {
  return { id: w.id, cardId: w.card_id, grade: w.grade, respondedAt: w.responded_at, localDate: w.local_date, dueOnBefore: w.due_on_before, dueOnAfter: w.due_on_after, intervalDays: w.interval_days, algorithmVersion: w.algorithm_version }
}
