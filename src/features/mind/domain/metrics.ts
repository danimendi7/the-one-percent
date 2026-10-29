import { addDays, diffDays, eachDay, type LocalDate } from "@/features/habits/domain/dates"
import { dailyRates, type DateRange } from "@/features/habits/domain/metrics"
import type { HabitsState } from "@/features/habits/domain/types"
import { activeSeconds } from "@/features/focus/domain/time"
import { checkinFor } from "./ops"
import type { CheckinPhase, Indicator } from "./types"

/**
 * Mind & Energy metrics (catalog v4, docs/m3.3-mind-energy-plan.md §6). Descriptive only:
 * averages ignore missing days (no data is N/A, never 0), every figure carries its sample
 * size, and comparisons between groups are exploratory and never causal (decision 5).
 */

export type PhaseFilter = CheckinPhase | "both"
export interface DayPoint {
  date: LocalDate
  value: number | null
}
export interface Average {
  value: number | null
  /** Days with a value. */
  n: number
}

/** Below this many days with a check-in a period has «pocos datos»; trends need it. */
export const ENOUGH_DAYS = 7
/** Each group of an exploratory comparison needs at least this many days (decision 5). */
export const GROUP_MIN_DAYS = 5
export const ROLLING_WINDOW = 7
/** A rolling mean point needs this many values in its window. */
export const ROLLING_MIN = 3
/** Comparison thresholds (shown in «Cómo se calcula»). */
export const FOCUS_DAY_MINUTES = 60
export const SLEEP_GOOD_HOURS = 7

type State = Pick<HabitsState, "checkins">

/** Value of one indicator on one day: one phase, or the mean of both phases that have it. */
export function dayValue(state: State, date: LocalDate, indicator: Indicator, phase: PhaseFilter): number | null {
  const phases: CheckinPhase[] = phase === "both" ? ["am", "pm"] : [phase]
  const vals = phases.map((p) => checkinFor(state, date, p)?.[indicator] ?? null).filter((v): v is number => v !== null)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

export function series(state: State, range: DateRange, indicator: Indicator, phase: PhaseFilter): DayPoint[] {
  return eachDay(range.from, range.to).map((date) => ({ date, value: dayValue(state, date, indicator, phase) }))
}

export function average(points: readonly DayPoint[]): Average {
  const vals = points.map((p) => p.value).filter((v): v is number => v !== null)
  return { value: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, n: vals.length }
}

/** Trailing mean over the window; null where the window has too few values (no interpolation). */
export function rollingMean(points: readonly DayPoint[], window = ROLLING_WINDOW, min = ROLLING_MIN): DayPoint[] {
  return points.map((p, i) => {
    const avg = average(points.slice(Math.max(0, i - window + 1), i + 1))
    return { date: p.date, value: avg.n >= min ? avg.value : null }
  })
}

/** Days of the range with at least one check-in (any phase, any field). */
export function checkinDays(state: State, range: DateRange, phase: PhaseFilter = "both"): LocalDate[] {
  const phases: CheckinPhase[] = phase === "both" ? ["am", "pm"] : [phase]
  return eachDay(range.from, range.to).filter((d) => phases.some((p) => checkinFor(state, d, p) !== null))
}

export function coverage(state: State, range: DateRange, phase: PhaseFilter = "both"): { days: number; total: number; rate: number | null } {
  const total = diffDays(range.from, range.to) + 1
  const days = checkinDays(state, range, phase).length
  return { days, total, rate: total > 0 ? days / total : null }
}

export type MindDataLevel = "none" | "few" | "enough"
export function mindDataLevel(state: State, range: DateRange): MindDataLevel {
  const days = checkinDays(state, range).length
  return days === 0 ? "none" : days < ENOUGH_DAYS ? "few" : "enough"
}

/** The same-length period right before `range`. */
export function previousRange(range: DateRange): DateRange {
  const len = diffDays(range.from, range.to) + 1
  return { from: addDays(range.from, -len), to: addDays(range.from, -1) }
}

/**
 * Change of an indicator's mean vs. the previous period, only when both have ≥ 7 days of data.
 * The previous period defaults to the same-length one right before; a monthly review passes the
 * previous calendar month instead (M3.4), with the same rule.
 */
export function changeVsPrevious(
  state: State,
  range: DateRange,
  indicator: Indicator,
  phase: PhaseFilter,
  previousPeriod: DateRange = previousRange(range)
): { current: Average; previous: Average; delta: number } | null {
  const current = average(series(state, range, indicator, phase))
  const previous = average(series(state, previousPeriod, indicator, phase))
  if (current.n < ENOUGH_DAYS || previous.n < ENOUGH_DAYS || current.value === null || previous.value === null) return null
  return { current, previous, delta: current.value - previous.value }
}

// ── Exploratory comparisons (decision 5) ─────────────────────────────────
export interface GroupStat {
  /** Mean of the group (or pooled rate for completion), null when empty. */
  value: number | null
  /** Days in the group. */
  n: number
}
export interface Comparison {
  a: GroupStat
  b: GroupStat
  /** Both groups reach GROUP_MIN_DAYS; otherwise the UI shows nothing but the reason. */
  shown: boolean
}

function compare(a: GroupStat, b: GroupStat): Comparison {
  return { a, b, shown: a.n >= GROUP_MIN_DAYS && b.n >= GROUP_MIN_DAYS }
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

/** Finished focus minutes per day (the day a session started, like Analytics). */
export function focusMinutesByDay(state: Pick<HabitsState, "focusSessions">, range: DateRange): Map<LocalDate, number> {
  const out = new Map<LocalDate, number>()
  for (const s of state.focusSessions) {
    if (s.state !== "finished" || s.localDate < range.from || s.localDate > range.to) continue
    out.set(s.localDate, (out.get(s.localDate) ?? 0) + activeSeconds(s.segments) / 60)
  }
  return out
}

/** Energy on days with ≥ 60 min of Deep Work (a) vs. days with less (b). */
export function energyByFocus(state: Pick<HabitsState, "checkins" | "focusSessions">, range: DateRange): Comparison {
  const minutes = focusMinutesByDay(state, range)
  const a: number[] = []
  const b: number[] = []
  for (const p of series(state, range, "energy", "both")) {
    if (p.value === null) continue
    ;((minutes.get(p.date) ?? 0) >= FOCUS_DAY_MINUTES ? a : b).push(p.value)
  }
  return compare({ value: mean(a), n: a.length }, { value: mean(b), n: b.length })
}

/**
 * Habit completion on days after sleeping ≥ 7 h (a) vs. < 7 h (b). The sleep reported in a
 * day's check-ins is the night before it. Only closed days count (today is still pending),
 * and only days with applicable habits; the figure is the pooled rate of each group.
 */
export function completionBySleep(state: HabitsState, range: DateRange, today: LocalDate): Comparison {
  const to = range.to >= today ? addDays(today, -1) : range.to
  if (to < range.from) return compare({ value: null, n: 0 }, { value: null, n: 0 })
  const rates = dailyRates(state.habits, { from: range.from, to }, { entries: state.entries, restDays: new Set(state.restDays), today })
  const acc = { a: { f: 0, ap: 0, n: 0 }, b: { f: 0, ap: 0, n: 0 } }
  for (const r of rates) {
    const sleep = dayValue(state, r.date, "sleep", "both")
    if (sleep === null || r.applicable === 0) continue
    const g = sleep >= SLEEP_GOOD_HOURS ? acc.a : acc.b
    g.f += r.fulfilled
    g.ap += r.applicable
    g.n++
  }
  const stat = (g: { f: number; ap: number; n: number }): GroupStat => ({ value: g.ap ? g.f / g.ap : null, n: g.n })
  return compare(stat(acc.a), stat(acc.b))
}

/** Every check-in in a range, newest first (history list and drilldown). */
export function checkinsIn(state: State, range: DateRange): { date: LocalDate; am: ReturnType<typeof checkinFor>; pm: ReturnType<typeof checkinFor> }[] {
  return eachDay(range.from, range.to)
    .reverse()
    .map((date) => ({ date, am: checkinFor(state, date, "am"), pm: checkinFor(state, date, "pm") }))
    .filter((d) => d.am || d.pm)
}
