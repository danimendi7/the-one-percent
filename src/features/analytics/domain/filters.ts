import { addDays, type LocalDate } from "@/features/habits/domain/dates"
import type { DateRange } from "@/features/habits/domain/metrics"
import type { DimensionId, Habit } from "@/features/habits/domain/types"
import type { Goal } from "@/features/goals/domain/types"

export const PERIODS = [7, 30, 90, 365] as const
export type PeriodDays = (typeof PERIODS)[number]
const DIMENSIONS: readonly DimensionId[] = ["body", "mind", "learn", "work"]

export interface AnalyticsFilter {
  period: PeriodDays
  dimension: DimensionId | "all"
  habitId: string | "all"
  /** ?objetivo= : the habits linked to a goal (effort links + numeric source). */
  goalId: string | "all"
  /** ?proyecto= : focus sessions of one project ("" = without project). Focus figures only. */
  project: string | "all"
}

export const DEFAULT_FILTER: AnalyticsFilter = { period: 30, dimension: "all", habitId: "all", goalId: "all", project: "all" }

type Params = { get(name: string): string | null }

const ID = /^[\w-]{1,64}$/

/** Reads ?periodo=&dimension=&habito=&objetivo=&proyecto= defensively: anything unknown falls back to the default. */
export function parseFilter(params: Params): AnalyticsFilter {
  const period = Number(params.get("periodo"))
  const dimension = params.get("dimension")
  const habit = params.get("habito")
  const goal = params.get("objetivo")
  const project = params.get("proyecto")
  return {
    period: (PERIODS as readonly number[]).includes(period) ? (period as PeriodDays) : DEFAULT_FILTER.period,
    dimension: DIMENSIONS.includes(dimension as DimensionId) ? (dimension as DimensionId) : "all",
    habitId: habit && ID.test(habit) ? habit : "all",
    goalId: goal && ID.test(goal) ? goal : "all",
    project: project !== null && project.length <= 60 ? project.trim() : "all",
  }
}

/** Query string for a filter, omitting defaults (so the bare URL is the default view). */
export function serializeFilter(f: AnalyticsFilter): string {
  const q = new URLSearchParams()
  if (f.period !== DEFAULT_FILTER.period) q.set("periodo", String(f.period))
  if (f.dimension !== "all") q.set("dimension", f.dimension)
  if (f.habitId !== "all") q.set("habito", f.habitId)
  if (f.goalId !== "all") q.set("objetivo", f.goalId)
  if (f.project !== "all") q.set("proyecto", f.project)
  const s = q.toString()
  return s ? `?${s}` : ""
}

/**
 * Habits in scope. Narrowest wins: habit, then goal, then dimension. An unknown habit or goal id
 * (deleted, other account) is ignored rather than producing an empty, misleading page.
 */
export function scopeHabits(
  habits: Habit[],
  f: AnalyticsFilter,
  goals: readonly Goal[] = []
): { scope: Habit[]; habit: Habit | null; goal: Goal | null } {
  const habit = f.habitId === "all" ? null : habits.find((h) => h.id === f.habitId) ?? null
  if (habit) return { scope: [habit], habit, goal: null }
  const goal = f.goalId === "all" ? null : goals.find((g) => g.id === f.goalId) ?? null
  if (goal) {
    const ids = new Set([...goal.habits.map((l) => l.habitId), ...(goal.numeric?.habitId ? [goal.numeric.habitId] : [])])
    return { scope: habits.filter((h) => ids.has(h.id)), habit: null, goal }
  }
  return { scope: f.dimension === "all" ? habits : habits.filter((h) => h.dimensionId === f.dimension), habit: null, goal: null }
}

/** The last `days` days ending today, inclusive. */
export function periodRange(today: LocalDate, days: number): DateRange {
  return { from: addDays(today, -(days - 1)), to: today }
}
