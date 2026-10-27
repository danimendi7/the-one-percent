import { addDays, type LocalDate } from "@/features/habits/domain/dates"
import type { DateRange } from "@/features/habits/domain/metrics"
import type { DimensionId, Habit } from "@/features/habits/domain/types"

export const PERIODS = [7, 30, 90, 365] as const
export type PeriodDays = (typeof PERIODS)[number]
const DIMENSIONS: readonly DimensionId[] = ["body", "mind", "learn", "work"]

export interface AnalyticsFilter {
  period: PeriodDays
  dimension: DimensionId | "all"
  habitId: string | "all"
}

export const DEFAULT_FILTER: AnalyticsFilter = { period: 30, dimension: "all", habitId: "all" }

type Params = { get(name: string): string | null }

/** Reads ?periodo=&dimension=&habito= defensively: anything unknown falls back to the default. */
export function parseFilter(params: Params): AnalyticsFilter {
  const period = Number(params.get("periodo"))
  const dimension = params.get("dimension")
  const habit = params.get("habito")
  return {
    period: (PERIODS as readonly number[]).includes(period) ? (period as PeriodDays) : DEFAULT_FILTER.period,
    dimension: DIMENSIONS.includes(dimension as DimensionId) ? (dimension as DimensionId) : "all",
    habitId: habit && /^[\w-]{1,64}$/.test(habit) ? habit : "all",
  }
}

/** Query string for a filter, omitting defaults (so the bare URL is the default view). */
export function serializeFilter(f: AnalyticsFilter): string {
  const q = new URLSearchParams()
  if (f.period !== DEFAULT_FILTER.period) q.set("periodo", String(f.period))
  if (f.dimension !== "all") q.set("dimension", f.dimension)
  if (f.habitId !== "all") q.set("habito", f.habitId)
  const s = q.toString()
  return s ? `?${s}` : ""
}

/**
 * Habits in scope. A habit filter is the narrowest and wins; an unknown habit id (deleted,
 * other account) is ignored rather than producing an empty, misleading page.
 */
export function scopeHabits(habits: Habit[], f: AnalyticsFilter): { scope: Habit[]; habit: Habit | null } {
  const habit = f.habitId === "all" ? null : habits.find((h) => h.id === f.habitId) ?? null
  if (habit) return { scope: [habit], habit }
  return { scope: f.dimension === "all" ? habits : habits.filter((h) => h.dimensionId === f.dimension), habit: null }
}

/** The last `days` days ending today, inclusive. */
export function periodRange(today: LocalDate, days: number): DateRange {
  return { from: addDays(today, -(days - 1)), to: today }
}
