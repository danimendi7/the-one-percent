import type { LocalDate } from "../domain/dates"
import type { HabitInput, SetEntryResult } from "../domain/ops"
import type { HabitsState } from "../domain/types"
import type { GoalInput, MeasureResult } from "@/features/goals/domain/ops"
import type { GoalState } from "@/features/goals/domain/types"
import type { Op, SyncNotice, SyncStatus } from "@/features/sync/domain/types"
import type { EditInput, FocusRejection } from "@/features/focus/domain/ops"

export type DataSource = "demo" | "account"

export interface SyncInfo {
  status: SyncStatus
  pending: number
  lastSyncedAt: number | null
  lastError: string | null
  notices: SyncNotice[]
}

export interface HabitsSnapshot {
  state: HabitsState
  today: LocalDate
  /** False when the browser refuses local storage (private mode, quota). */
  persisted: boolean
  source: DataSource
  /** Account mode only. */
  sync?: SyncInfo
  /** False while the account's server lacks the goals migration; demo: always true. */
  goals?: boolean
  /** False while the account's server lacks the focus migration (M3.2): the timer runs but nothing is saved. */
  focus?: boolean
  account?: { userId: string; email: string | null }
}

/** Goals (M3.1). Optional on a backend until it supports them; screens check `goalsEnabled()`. */
export interface GoalActions {
  addGoal(input: GoalInput): string
  updateGoal(id: string, input: GoalInput): void
  setGoalState(id: string, state: GoalState): void
  archiveGoal(id: string): void
  restoreGoal(id: string): void
  setMeasurement(goalId: string, date: LocalDate, value: number | null, note?: string | null): MeasureResult
  setCheckpoint(goalId: string, checkpointId: string, doneOn: LocalDate | null): void
}

export interface FocusStartInput {
  habitId: string | null
  project: string | null
  plannedOutput: string | null
  plannedMinutes: number
}

export type FocusOutcome = { ok: true } | { ok: false; reason: FocusRejection }

/** Deep Work (M3.2). Times come from `clockNow()`: the server-corrected clock in account mode. */
export interface FocusActions {
  startFocus(input: FocusStartInput): ({ ok: true; id: string }) | { ok: false; reason: FocusRejection }
  pauseFocus(id: string): void
  resumeFocus(id: string): void
  finishFocus(id: string, input: { trimTo?: string | null; actualOutput?: string | null; rating?: number | null }): FocusOutcome
  editFocus(id: string, input: EditInput): FocusOutcome
  discardFocus(id: string): void
  setHabitSource(habitId: string, source: "focus" | null): void
  clockNow(): number
}

export interface HabitActions extends Partial<GoalActions>, Partial<FocusActions> {
  setEntry(habitId: string, date: LocalDate, value: boolean | number | null): SetEntryResult
  addHabit(input: HabitInput): string
  updateHabit(id: string, input: HabitInput): void
  archiveHabit(id: string): void
  restoreHabit(id: string): void
  setRestDay(date: LocalDate, rest: boolean): void
  exportJson(): string
  /** Demo only */
  resetDemo?(): void
  /** Account only */
  syncNow?(): void
  setTimezone?(timezone: string): void
  dismissNotice?(id: string): void
  reapplyNotice?(id: string): void
  /** Queue prepared operations (demo import). */
  submitOps?(ops: Op[]): void
  /** Delete this device's cached copy and queue (cloud data untouched). */
  clearLocalCopy?(): Promise<void>
  /** Sync diagnostics for real-device validation. */
  diagnostics?(): { clockOffsetMs: number; cursor: number; deviceId: string; failures: number }
}

export interface Backend {
  source: DataSource
  subscribe(listener: () => void): () => void
  getSnapshot(): HabitsSnapshot | null
  actions: HabitActions
  dispose?(): void
}
