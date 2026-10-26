import type { LocalDate } from "../domain/dates"
import type { HabitInput, SetEntryResult } from "../domain/ops"
import type { HabitsState } from "../domain/types"
import type { Op, SyncNotice, SyncStatus } from "@/features/sync/domain/types"

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
  account?: { userId: string; email: string | null }
}

export interface HabitActions {
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
