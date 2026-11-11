import { addDays, capitalize, diffDays, formatDate, isLocalDate, startOfWeek, type LocalDate } from "@/features/habits/domain/dates"
import type { DateRange } from "@/features/habits/domain/metrics"
import type { ReviewKind } from "./types"

/**
 * Review periods in local dates of the profile timezone (like Analytics): a day is its own period;
 * a week runs Monday to Sunday and belongs to its Monday even when it spans two months; a month is
 * the calendar month.
 * «Today» always comes from the caller (profile timezone), never from the device clock here.
 */
export interface Period extends DateRange {
  kind: ReviewKind
}

function monthStart(date: LocalDate): LocalDate {
  return `${date.slice(0, 7)}-01`
}

function lastDayOfMonth(start: LocalDate): LocalDate {
  const [y, m] = start.split("-").map(Number)
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`
  return addDays(next, -1)
}

/** The period of `kind` that contains `date`. */
export function periodOf(kind: ReviewKind, date: LocalDate): Period {
  if (kind === "day") return { kind, from: date, to: date }
  if (kind === "week") {
    const from = startOfWeek(date)
    return { kind, from, to: addDays(from, 6) }
  }
  const from = monthStart(date)
  return { kind, from, to: lastDayOfMonth(from) }
}

/** A valid period start: any date for days, a Monday for weeks, the 1st for months. */
export function isPeriodStart(kind: ReviewKind, start: unknown): start is LocalDate {
  return isLocalDate(start) && periodOf(kind, start).from === start
}

/** The period that starts on `start`; null if `start` is not a valid period start. */
export function periodFromStart(kind: ReviewKind, start: unknown): Period | null {
  return isPeriodStart(kind, start) ? periodOf(kind, start) : null
}

export function previousPeriod(p: Period): Period {
  return periodOf(p.kind, addDays(p.from, -1))
}

export function nextPeriod(p: Period): Period {
  return periodOf(p.kind, addDays(p.to, 1))
}

export function periodDays(p: DateRange): number {
  return diffDays(p.from, p.to) + 1
}

/** A review can be created from the last day of its period on, for any past period (decision 2). */
export function isAvailable(p: Period, today: LocalDate): boolean {
  return p.to <= today
}

/** Today is still part of the period (its last day): today counts as pending, like Analytics. */
export function isOpen(p: Period, today: LocalDate): boolean {
  return today >= p.from && today <= p.to
}

/** The most recent period that is available for review: the current one on its last day, else the previous one. */
export function latestAvailable(kind: ReviewKind, today: LocalDate): Period {
  const current = periodOf(kind, today)
  return isAvailable(current, today) ? current : previousPeriod(current)
}

/** Closing more than LIMITS.lateCloseDays after the period ended (informative badge only). */
export function isLateClose(p: Period, closedOn: LocalDate, lateDays: number): boolean {
  return diffDays(p.to, closedOn) > lateDays
}

/** «Miércoles, 21 de octubre» / «Semana del 26 oct al 1 nov» / «Octubre de 2026». */
export function periodLabel(p: Period): string {
  if (p.kind === "day") return capitalize(formatDate(p.from, { weekday: "long", day: "numeric", month: "long" }))
  if (p.kind === "month") return capitalize(formatDate(p.from, { month: "long", year: "numeric" }))
  return `Semana del ${formatDate(p.from, { day: "numeric", month: "short" })} al ${formatDate(p.to, { day: "numeric", month: "short" })}`
}

/** Route segment parser (`/reviews/week/2026-10-26`): null for anything invalid or not yet available. */
export function parseRoute(kind: unknown, start: unknown, today: LocalDate): Period | null {
  if (kind !== "day" && kind !== "week" && kind !== "month") return null
  const p = periodFromStart(kind, start)
  return p && isAvailable(p, today) ? p : null
}
