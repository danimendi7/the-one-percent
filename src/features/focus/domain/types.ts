import type { LocalDate } from "@/features/habits/domain/dates"

/**
 * Deep Work sessions (docs/m3.2-deep-work-plan.md). A session never stores a running
 * counter: its time is the sum of its segments, which are wall-clock instants in the
 * server-corrected hybrid clock (M2). Pausing closes the open segment, resuming opens
 * another, so backgrounding, closing the app or switching device never loses time.
 */
export interface Segment {
  /** ISO instant. */
  start: string
  /** ISO instant; null only for the last segment of a running session. */
  end: string | null
}

export type FocusState = "running" | "paused" | "finished"

export interface FocusSession {
  id: string
  /** Duration habit fed by this session (decision 1). */
  habitId: string | null
  /** Free text with suggestions from history (decision 4). */
  project: string | null
  plannedOutput: string | null
  actualOutput: string | null
  plannedMinutes: number
  segments: Segment[]
  state: FocusState
  /** Day (profile timezone) the session STARTED: it counts there even past midnight (decision 2). */
  localDate: LocalDate
  rating: number | null
  /** How many times it was interrupted. null or absent: not noted, which is not the same as 0. */
  interruptions?: number | null
  version?: number
  createdAt: string
  updatedAt: string
}

export const PRESET_MINUTES = [25, 50, 90] as const
export const MAX_PLANNED_MINUTES = 720
/** Sessions under one effective minute are not saved. */
export const MIN_ACTIVE_SECONDS = 60
/** A session lasts at most 12 effective hours. */
export const MAX_ACTIVE_SECONDS = 12 * 3600
/** Tolerance for device clocks slightly ahead of the server. */
export const FUTURE_TOLERANCE_MS = 60_000
/** «¿Sigue en curso?» once a running session exceeds its plan by this much. */
export const RECOVERY_GRACE_MS = 30 * 60_000
/** M3.3 decision 6: a paused session asks again after this long, or once the pause crosses midnight. */
export const PAUSE_RECOVERY_MS = 30 * 60_000
export const PROJECT_MAX = 60
export const PLANNED_OUTPUT_MAX = 200
export const ACTUAL_OUTPUT_MAX = 500
export const MAX_INTERRUPTIONS = 99
