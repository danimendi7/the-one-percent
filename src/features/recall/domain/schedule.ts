import { addDays, isLocalDate, type LocalDate } from "@/features/habits/domain/dates"

/**
 * Spaced repetition (docs/m4-knowledge-os-plan.md, M4i): a simplified, versioned SM-2 in local dates
 * of the profile timezone. Pure and deterministic: the same card, grade and day always give the
 * same result, and «today» always comes from the caller, never from the device clock.
 *
 * Bump ALGORITHM_VERSION if a formula changes: each card and attempt records the version it used.
 */
export const ALGORITHM_VERSION = 1

export type Grade = "again" | "hard" | "good" | "easy"
export const GRADES: readonly Grade[] = ["again", "hard", "good", "easy"]

/** new: never answered. learning: failed, to be answered again. review: remembered at least once. */
export type CardState = "new" | "learning" | "review"

export interface Schedule {
  state: CardState
  /** Correct answers in a row; a lapse sets it back to 0. */
  reps: number
  /** Times a card under review was forgotten. */
  lapses: number
  easeFactor: number
  intervalDays: number
  dueOn: LocalDate
}

export const INITIAL_EASE = 2.5
export const MIN_EASE = 1.3
export const MAX_INTERVAL_DAYS = 365
export const DEFAULT_NEW_PER_DAY = 10

const EASE_CHANGE: Record<Grade, number> = { again: -0.2, hard: -0.15, good: 0, easy: 0.15 }
/** Decimals are rounded at every step, so a long history cannot drift between devices. */
const round2 = (n: number) => Math.round(n * 100) / 100

export function newSchedule(today: LocalDate): Schedule {
  return { state: "new", reps: 0, lapses: 0, easeFactor: INITIAL_EASE, intervalDays: 0, dueOn: today }
}

/** Days until the next review for each grade: strictly ordered unless the one-year cap is reached. */
export function previewIntervals(s: Pick<Schedule, "reps" | "intervalDays" | "easeFactor">): Record<Grade, number> {
  if (s.reps === 0) return { again: 0, hard: 1, good: 1, easy: 4 }
  const hard = Math.max(s.intervalDays + 1, Math.round(s.intervalDays * 1.2))
  const good = Math.max(hard + 1, s.reps === 1 ? 6 : Math.round(s.intervalDays * s.easeFactor))
  const easy = Math.max(good + 1, Math.round(good * 1.3))
  return { again: 0, hard: Math.min(hard, MAX_INTERVAL_DAYS), good: Math.min(good, MAX_INTERVAL_DAYS), easy: Math.min(easy, MAX_INTERVAL_DAYS) }
}

/** The card's schedule after answering it on `today`. */
export function nextSchedule(s: Schedule, grade: Grade, today: LocalDate): Schedule {
  if (!isLocalDate(today)) throw new Error("invalid_date")
  const intervalDays = previewIntervals(s)[grade]
  // Only a card already remembered changes its ease: a first answer says little about it.
  const easeFactor = s.state === "review" ? Math.max(MIN_EASE, round2(s.easeFactor + EASE_CHANGE[grade])) : s.easeFactor
  const dueOn = addDays(today, intervalDays)
  if (grade === "again") return { state: "learning", reps: 0, lapses: s.lapses + (s.state === "review" ? 1 : 0), easeFactor, intervalDays, dueOn }
  return { state: "review", reps: s.reps + 1, lapses: s.lapses, easeFactor, intervalDays, dueOn }
}

export interface QueueCard {
  id: string
  schedule: Schedule
  suspendedOn: LocalDate | null
  /** The day of its first answer: what the daily limit of new cards counts. */
  firstAnsweredOn: LocalDate | null
  createdAt: string
}

export function isDue(card: Pick<QueueCard, "schedule" | "suspendedOn">, today: LocalDate): boolean {
  return card.suspendedOn === null && card.schedule.dueOn <= today
}

const byId = (a: QueueCard, b: QueueCard) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const text = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export interface DailyQueue<T> {
  /** Reviews first, the most overdue on top; then the new cards allowed today, the oldest first. */
  queue: T[]
  /** Reviews due today. Never limited: postponing them only makes them pile up. */
  due: number
  /** New cards in the queue today. */
  newToday: number
  /** New cards left for another day by the limit. */
  heldBack: number
}

/** Only new cards are limited (M4i risk: a queue fed without control). */
export function dailyQueue<T extends QueueCard>(cards: readonly T[], today: LocalDate, limits: { newPerDay: number } = { newPerDay: DEFAULT_NEW_PER_DAY }): DailyQueue<T> {
  const active = cards.filter((c) => isDue(c, today))
  const reviews = active.filter((c) => c.schedule.state !== "new").sort((a, b) => text(a.schedule.dueOn, b.schedule.dueOn) || byId(a, b))
  const fresh = active.filter((c) => c.schedule.state === "new").sort((a, b) => text(a.createdAt, b.createdAt) || byId(a, b))
  const started = cards.filter((c) => c.firstAnsweredOn === today).length
  const allowed = fresh.slice(0, Math.max(0, limits.newPerDay - started))
  return { queue: [...reviews, ...allowed], due: reviews.length, newToday: allowed.length, heldBack: fresh.length - allowed.length }
}

/** Reviews scheduled for each of the next `days` days; whatever is overdue counts today. */
export function forecast(cards: readonly QueueCard[], today: LocalDate, days: number): { date: LocalDate; count: number }[] {
  const scheduled = cards.filter((c) => c.suspendedOn === null && c.schedule.state !== "new")
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i)
    return { date, count: scheduled.filter((c) => (i === 0 ? c.schedule.dueOn <= date : c.schedule.dueOn === date)).length }
  })
}
