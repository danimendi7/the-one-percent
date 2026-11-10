import type { ExperimentMap } from "@/features/intelligence/domain/experiments"
import type { DiscoveryState } from "@/features/discover/domain/types"
import type { RecallState } from "@/features/recall/domain/types"
import type { LocalDate, Weekday } from "./dates"
import type { Goal, MeasurementMap } from "@/features/goals/domain/types"
import type { FocusSession } from "@/features/focus/domain/types"
import type { CheckinConfig, CheckinMap } from "@/features/mind/domain/types"
import type { ReviewMap } from "@/features/reviews/domain/types"

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
  /**
   * Duration habits only (M3.2). "focus": from `activitySourceFrom` on, the day's value is the
   * sum of the linked focus sessions and cannot be logged by hand. Earlier entries stay as history.
   */
  activitySource?: "focus" | null
  activitySourceFrom?: LocalDate | null
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
  /** Deep Work sessions (M3.2). Discarded sessions are removed. */
  focusSessions: FocusSession[]
  /** Mind & Energy check-ins (M3.3), keyed `date:phase`. */
  checkins: CheckinMap
  /** Indicators shown per phase (profile setting, synced). */
  checkinConfig: CheckinConfig
  /** Life Review (M3.4), keyed `kind:periodStart`. Metrics never read it. */
  reviews: ReviewMap
  /** Active Recall (D2): cards and the history of their answers. */
  recall: RecallState
  /** Daily Discovery (D4): topics written by the user and what they thought of each topic. */
  discovery: DiscoveryState
  /** Improvement experiments (E3), keyed by id. */
  experiments: ExperimentMap
}

export function entryKey(habitId: string, date: LocalDate): string {
  return `${habitId}:${date}`
}
