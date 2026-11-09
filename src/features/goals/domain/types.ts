import type { LocalDate } from "@/features/habits/domain/dates"
import type { DimensionId } from "@/features/habits/domain/types"

/**
 * Goals (docs/m3.1-goals-plan.md). A goal never stores progress: progress is always
 * derived from real records (habit entries, measurements, checkpoints) by pure
 * functions, so the same numbers appear on every screen and in frozen reviews.
 */
export type GoalKind = "habits" | "numeric" | "milestones"
/** Where a numeric goal's value comes from. "habit" reads an existing habit's entries: no duplicate logging. */
export type NumericSource = "manual" | "habit"
/** "last": the latest value counts (weight, 10 km time). "sum": values accumulate (km this year). */
export type Aggregation = "last" | "sum"
export type GoalDirection = "up" | "down"
export type Horizon = "short" | "medium" | "long"
export type GoalPriority = "primary" | "secondary"
export type GoalState = "active" | "achieved" | "abandoned"

export type GoalLogKind = "obstacle" | "adjustment"

/** One note on how the process is going: what got in the way, or what was changed because of it. */
export interface GoalLogEntry {
  id: string
  kind: GoalLogKind
  text: string
  on: LocalDate
}

export interface GoalHabitLink {
  habitId: string
  /** 1–3: how much this habit counts in the effort figure. */
  weight: number
}

/**
 * Intermediate milestone. Flat list, no dependencies between milestones.
 * On numeric goals a milestone may carry a `value`: it is reached automatically
 * the first day real data crosses it. Otherwise it is marked by hand (`doneOn`).
 */
export interface Checkpoint {
  id: string
  title: string
  dueOn?: LocalDate | null
  value?: number | null
  doneOn?: LocalDate | null
}

export interface NumericSpec {
  source: NumericSource
  /** Required when source = "habit": a numeric or duration habit. */
  habitId?: string | null
  aggregation: Aggregation
  unit: string
  baseline: number
  target: number
  direction: GoalDirection
}

export interface Goal {
  id: string
  title: string
  /** Why it matters (optional, one line). */
  why?: string | null
  dimensionId?: DimensionId | null
  parentId?: string | null
  kind: GoalKind
  /** kind = numeric */
  numeric?: NumericSpec | null
  /** kind = habits: completion needed, 0–1 (default 0.85). */
  threshold?: number | null
  startDate: LocalDate
  dueDate: LocalDate
  /** null = derived from the dates. */
  horizonOverride?: Horizon | null
  priority: GoalPriority
  /** Parent progress = mean of the children's outcome, only when asked for. */
  aggregateChildren?: boolean
  state: GoalState
  /** Day the state became achieved/abandoned. */
  closedOn?: LocalDate | null
  archivedOn?: LocalDate | null
  /** Day it was put in review. Still measured and still active: a flag to rethink it, not a closure. */
  reviewSince?: LocalDate | null
  /** Obstacles met and process adjustments made, oldest first. Absent on goals saved before it existed. */
  processLog?: GoalLogEntry[]
  habits: GoalHabitLink[]
  checkpoints: Checkpoint[]
  version?: number
  createdAt: string
  updatedAt: string
}

/** One manual measurement per goal and day (desired state: a new value replaces the old one). */
export interface Measurement {
  goalId: string
  date: LocalDate
  value: number
  note?: string | null
  opId: string
  updatedAt: string
}

export type MeasurementMap = Record<string, Measurement>

export function measurementKey(goalId: string, date: LocalDate): string {
  return `${goalId}:${date}`
}

export const DEFAULT_THRESHOLD = 0.85
/** Soft limit: more primary goals than this and the dashboard stops being focused. */
export const MAX_PRIMARY = 3
