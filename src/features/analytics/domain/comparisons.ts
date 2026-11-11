import type { LocalDate } from "@/features/habits/domain/dates"
import { completion, type DateRange, type EvalContext } from "@/features/habits/domain/metrics"
import type { HabitsState } from "@/features/habits/domain/types"
import { summarizeSessions, sessionsIn } from "@/features/focus/domain/metrics"
import { average, series } from "@/features/mind/domain/metrics"
import type { Indicator } from "@/features/mind/domain/types"
import { periodOf, previousPeriod, type Period } from "@/features/reviews/domain/periods"

/**
 * Week against week and month against month (Plan Maestro §5.3). Only closed periods are compared,
 * Monday to Sunday and calendar months like the reviews: an open week would set a few days against
 * seven. A figure is N/D when either side lacks the data for it, never 0.
 */

export type ComparisonUnit = "week" | "month"
export type ComparisonMetric = "completion" | "focus" | Indicator

/** Check-in days each side needs for its mean to be compared. */
export const COMPARISON_MIN_CHECKINS: Record<ComparisonUnit, number> = { week: 3, month: 7 }

export const COMPARISON_LABEL: Record<ComparisonMetric, string> = {
  completion: "Cumplimiento de hábitos",
  focus: "Minutos de enfoque",
  sleep: "Sueño",
  energy: "Energía",
  mood: "Ánimo",
  stress: "Estrés",
}

export interface ComparisonRow {
  metric: ComparisonMetric
  label: string
  /** The older period. */
  before: number | null
  after: number | null
  /** after − before, null unless both exist. */
  delta: number | null
  /** Why there is no change to show. */
  reason: string | null
}

export interface PeriodComparison {
  unit: ComparisonUnit
  /** The last closed period. */
  after: Period
  before: Period
  rows: ComparisonRow[]
}

function row(metric: ComparisonMetric, before: number | null, after: number | null, reason: string): ComparisonRow {
  const both = before !== null && after !== null
  return { metric, label: COMPARISON_LABEL[metric], before, after, delta: both ? after - before : null, reason: both ? null : reason }
}

function completionRow(state: HabitsState, before: DateRange, after: DateRange, ctx: EvalContext): ComparisonRow {
  return row("completion", completion(state.habits, before, ctx).rate, completion(state.habits, after, ctx).rate, "Sin hábitos aplicables en alguno de los dos periodos.")
}

/** Minutes of a period; a period that ended before the first session ever is no data, not 0. */
function focusRow(state: HabitsState, before: DateRange, after: DateRange): ComparisonRow {
  const first = state.focusSessions.filter((s) => s.state === "finished").reduce<LocalDate | null>((min, s) => (min === null || s.localDate < min ? s.localDate : min), null)
  const minutes = (r: DateRange) => (first === null || first > r.to ? null : summarizeSessions(sessionsIn(state, { range: r, project: "all" })).minutes)
  return row("focus", minutes(before), minutes(after), "Aún no usabas Enfoque en alguno de los dos periodos.")
}

function checkinRow(state: HabitsState, indicator: Indicator, before: DateRange, after: DateRange, min: number): ComparisonRow {
  const mean = (r: DateRange) => {
    const a = average(series(state, r, indicator, "both"))
    return a.n >= min ? a.value : null
  }
  return row(indicator, mean(before), mean(after), `Hacen falta al menos ${min} días con dato en cada periodo.`)
}

/** The last closed week or month against the one before it. */
export function comparePeriods(state: HabitsState, unit: ComparisonUnit, today: LocalDate): PeriodComparison {
  const after = previousPeriod(periodOf(unit, today))
  const before = previousPeriod(after)
  const ctx: EvalContext = { today, entries: state.entries, restDays: new Set(state.restDays) }
  const min = COMPARISON_MIN_CHECKINS[unit]
  return {
    unit,
    after,
    before,
    rows: [
      completionRow(state, before, after, ctx),
      focusRow(state, before, after),
      ...(["sleep", "energy", "mood", "stress"] as const).map((i) => checkinRow(state, i, before, after, min)),
    ],
  }
}
