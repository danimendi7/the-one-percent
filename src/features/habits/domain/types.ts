import type { LocalDate, Weekday } from "./dates"
import type { Goal, MeasurementMap } from "@/features/goals/domain/types"

export type HabitType = "binary" | "numeric" | "duration"
export type TargetDirection = "at_least" | "at_most"
export type DimensionId = "body" | "mind" | "learn" | "work"

export type ScheduleRule =
  | { kind: "daily" }
  | { kind: "weekdays"; weekdays: Weekday[] }
  | { kind: "weekly_count"; timesPerWeek: number }

/**
 * A schedule version applies from `validFrom` until the day before the next
 * version's `validFrom`. Versions are never rewritten retroactively, so past
 * denominators stay stable when a schedule changes (PRD §3.2).
 */
export interface ScheduleVersion {
  validFrom: LocalDate
  rule: ScheduleRule
}

export interface Habit {
  id: string
  name: string
  icon: string
  dimensionId: DimensionId
  type: HabitType
  /** Numeric/duration only */
  unit?: string
  target?: number
  direction?: TargetDirection
  /** Sorted ascending by validFrom; first entry's validFrom = startDate */
  schedule: ScheduleVersion[]
  startDate: LocalDate
  /** Inactive from this date onward; history before it is preserved. */
  archivedOn?: LocalDate | null
  createdAt: string
}

export interface HabitEntry {
  habitId: string
  date: LocalDate
  /** Exact recorded value; numeric amounts are kept even beyond the target. */
  value: boolean | number
  /** Client operation id (idempotency key once a backend exists). */
  opId: string
  updatedAt: string
}

export type EntryMap = Record<string, HabitEntry>

export interface Dimension {
  id: DimensionId
  name: string
}

export interface HabitsState {
  version: 1
  timezone: string
  dimensions: Dimension[]
  habits: Habit[]
  entries: EntryMap
  /** Global planned rest days: exempt from every denominator. */
  restDays: LocalDate[]
  seededOn: LocalDate
  /** Goals live in the same dataset as habits (one authoritative dataset, PRD §1). */
  goals: Goal[]
  measurements: MeasurementMap
}

export function entryKey(habitId: string, date: LocalDate): string {
  return `${habitId}:${date}`
}
