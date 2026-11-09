import type { LocalDate } from "@/features/habits/domain/dates"
import { ALGORITHM_VERSION, newSchedule, nextSchedule, type Grade, type Schedule } from "./schedule"
import type { RecallCard, RecallState } from "./types"

/** Mirrored by the checks of supabase/migrations/*_recall.sql. */
export const LIMITS = { question: 500, answer: 2000 } as const

export function emptyRecall(): RecallState {
  return { cards: {}, attempts: {} }
}

export type CardTextResult = { ok: true; question: string; answer: string } | { ok: false; field: "question" | "answer"; reason: "empty" | "too_long" }

export function validateCardText(question: string, answer: string): CardTextResult {
  const q = question.trim()
  const a = answer.trim()
  if (!q) return { ok: false, field: "question", reason: "empty" }
  if (q.length > LIMITS.question) return { ok: false, field: "question", reason: "too_long" }
  if (!a) return { ok: false, field: "answer", reason: "empty" }
  if (a.length > LIMITS.answer) return { ok: false, field: "answer", reason: "too_long" }
  return { ok: true, question: q, answer: a }
}

export interface NewCard {
  id: string
  question: string
  answer: string
  sourceType: "note" | null
  sourceId: string | null
  today: LocalDate
  at: string
}

/** Text that fails validation is refused before this point; the same id twice is the same card. */
export function addCard(recall: RecallState, c: NewCard): RecallState {
  if (recall.cards[c.id]) return recall
  const text = validateCardText(c.question, c.answer)
  if (!text.ok) return recall
  const card: RecallCard = {
    id: c.id,
    question: text.question,
    answer: text.answer,
    sourceType: c.sourceType,
    sourceId: c.sourceId,
    schedule: newSchedule(c.today),
    suspendedOn: null,
    firstAnsweredOn: null,
    lastAnsweredAt: null,
    algorithmVersion: ALGORITHM_VERSION,
    createdAt: c.at,
  }
  return { ...recall, cards: { ...recall.cards, [c.id]: card } }
}

export interface AnswerOutcome {
  cardId: string
  attemptId: string
  grade: Grade
  respondedAt: string
  localDate: LocalDate
  dueOnBefore: LocalDate
  algorithmVersion: number
  schedule: Schedule
}

/** What answering a card now gives: computed once, so every device stores the same result. */
export function answerOutcome(card: RecallCard, a: { attemptId: string; grade: Grade; respondedAt: string; today: LocalDate }): AnswerOutcome {
  return {
    cardId: card.id,
    attemptId: a.attemptId,
    grade: a.grade,
    respondedAt: a.respondedAt,
    localDate: a.today,
    dueOnBefore: card.schedule.dueOn,
    algorithmVersion: ALGORITHM_VERSION,
    schedule: nextSchedule(card.schedule, a.grade, a.today),
  }
}

/**
 * Stores an answer. Every attempt is kept; the card follows the most recent answer, so the same
 * card answered on two devices ends the same on both whichever arrives first.
 */
export function recordAnswer(recall: RecallState, o: AnswerOutcome): RecallState {
  const card = recall.cards[o.cardId]
  if (!card || recall.attempts[o.attemptId]) return recall
  const isLatest = card.lastAnsweredAt === null || Date.parse(o.respondedAt) >= Date.parse(card.lastAnsweredAt)
  const firstAnsweredOn = card.firstAnsweredOn === null || o.localDate < card.firstAnsweredOn ? o.localDate : card.firstAnsweredOn
  const next: RecallCard = isLatest ? { ...card, schedule: o.schedule, lastAnsweredAt: o.respondedAt, firstAnsweredOn, algorithmVersion: o.algorithmVersion } : { ...card, firstAnsweredOn }
  return {
    cards: { ...recall.cards, [o.cardId]: next },
    attempts: {
      ...recall.attempts,
      [o.attemptId]: { id: o.attemptId, cardId: o.cardId, grade: o.grade, respondedAt: o.respondedAt, localDate: o.localDate, dueOnBefore: o.dueOnBefore, dueOnAfter: o.schedule.dueOn, intervalDays: o.schedule.intervalDays, algorithmVersion: o.algorithmVersion },
    },
  }
}

/** Desired state: suspended since that day, or `null` to resume. The schedule is not touched. */
export function setSuspended(recall: RecallState, cardId: string, suspendedOn: LocalDate | null): RecallState {
  const card = recall.cards[cardId]
  if (!card) return recall
  return { ...recall, cards: { ...recall.cards, [cardId]: { ...card, suspendedOn } } }
}

/** The card goes; its attempts stay (the history is kept). */
export function removeCard(recall: RecallState, cardId: string): RecallState {
  if (!recall.cards[cardId]) return recall
  const cards = { ...recall.cards }
  delete cards[cardId]
  return { ...recall, cards }
}
