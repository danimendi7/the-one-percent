import { addDays, startOfWeek, type LocalDate } from "@/features/habits/domain/dates"
import { weeklySeries, type EvalContext } from "@/features/habits/domain/metrics"
import type { HabitsState } from "@/features/habits/domain/types"
import { sessionsIn, summarizeSessions } from "@/features/focus/domain/metrics"

/**
 * Prudent projections (Plan Maestro §5.3, «Predictivo»): what next week would look like if the
 * recent weeks simply went on. Only closed weeks count, a figure comes with its margin and its
 * limits, and with too few weeks there is a reason and no figure.
 */

/** Closed weeks looked at, and how many of them must have data. */
export const PROJECTION_WINDOW_WEEKS = 8
export const PROJECTION_MIN_WEEKS = 6

export interface WeekPoint {
  /** Position in time, in weeks; gaps keep their distance. */
  x: number
  y: number
}

export type Projection = { status: "few_weeks"; weeks: number; reason: string } | { status: "shown"; weeks: number; value: number; low: number; high: number; limitations: string[] }

const LIMITATIONS = ["Supone que las próximas semanas se parecen a las últimas: un cambio de rutina la invalida.", "Es una estimación con su margen, no un objetivo ni una predicción segura."]

/**
 * Straight line through the points, read one week after the last position. The margin is the
 * typical distance of the points from the line. Values are kept inside [min, max].
 */
export function projectNext(points: readonly WeekPoint[], at: number, bounds: { min: number; max: number }): { value: number; low: number; high: number } {
  const n = points.length
  const mx = points.reduce((s, p) => s + p.x, 0) / n
  const my = points.reduce((s, p) => s + p.y, 0) / n
  const sxx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0)
  const slope = sxx === 0 ? 0 : points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx
  const line = (x: number) => my + slope * (x - mx)
  const margin = Math.sqrt(points.reduce((s, p) => s + (p.y - line(p.x)) ** 2, 0) / Math.max(1, n - 2))
  const clamp = (v: number) => Math.min(bounds.max, Math.max(bounds.min, v))
  return { value: clamp(line(at)), low: clamp(line(at) - margin), high: clamp(line(at) + margin) }
}

function project(points: readonly WeekPoint[], bounds: { min: number; max: number }): Projection {
  if (points.length < PROJECTION_MIN_WEEKS) return { status: "few_weeks", weeks: points.length, reason: `Hacen falta al menos ${PROJECTION_MIN_WEEKS} semanas cerradas con datos de las últimas ${PROJECTION_WINDOW_WEEKS}; hay ${points.length}.` }
  return { status: "shown", weeks: points.length, ...projectNext(points, PROJECTION_WINDOW_WEEKS, bounds), limitations: LIMITATIONS }
}

/** Habit completion next week, from the last closed weeks that had something applicable. */
export function projectCompletion(state: Pick<HabitsState, "habits">, ctx: EvalContext): Projection {
  // One more than the window: the last one is the open week.
  const weeks = weeklySeries(state.habits, PROJECTION_WINDOW_WEEKS + 1, ctx).slice(0, -1)
  return project(weeks.flatMap((w, x) => (w.rate !== null && w.applicable > 0 ? [{ x, y: w.rate }] : [])), { min: 0, max: 1 })
}

/** Focus minutes next week; weeks before the first session are no data, later empty ones are 0. */
export function projectFocus(state: Pick<HabitsState, "focusSessions">, today: LocalDate): Projection {
  const thisWeek = startOfWeek(today)
  const first = state.focusSessions.filter((s) => s.state === "finished").reduce<LocalDate | null>((min, s) => (min === null || s.localDate < min ? s.localDate : min), null)
  const points = Array.from({ length: PROJECTION_WINDOW_WEEKS }, (_, x) => {
    const from = addDays(thisWeek, -7 * (PROJECTION_WINDOW_WEEKS - x))
    const to = addDays(from, 6)
    return first === null || first > to ? [] : [{ x, y: summarizeSessions(sessionsIn(state, { range: { from, to }, project: "all" })).minutes }]
  }).flat()
  return project(points, { min: 0, max: Number.POSITIVE_INFINITY })
}
