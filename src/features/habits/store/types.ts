import type { MotivationSettings } from "@/features/notifications/domain/motivation"
import type { ExperimentDays, ExperimentMetric, ExperimentValidation } from "@/features/intelligence/domain/experiments"
import type { OwnTopicInput, OwnTopicResult } from "@/features/discover/domain/ops"
import type { FeedbackFields } from "@/features/discover/domain/types"
import type { Grade } from "@/features/recall/domain/schedule"
import type { AuditRow } from "@/features/habits/domain/history"
import type { LocalDate } from "../domain/dates"
import type { HabitInput, SetEntryResult } from "../domain/ops"
import type { HabitsState } from "../domain/types"
import type { GoalInput, MeasureResult } from "@/features/goals/domain/ops"
import type { GoalLogKind, GoalState } from "@/features/goals/domain/types"
import type { CloseIntent, Op, ReviewSyncState, SyncNotice, SyncStatus } from "@/features/sync/domain/types"
import type { CloseRequest } from "@/features/sync/engine"
import type { ReviewFields } from "@/features/reviews/domain/sync"
import type { ReviewField, ReviewKind } from "@/features/reviews/domain/types"
import type { EditInput, FocusRejection } from "@/features/focus/domain/ops"
import type { CheckinRejection } from "@/features/mind/domain/ops"
import type { CheckinConfig, CheckinPhase, CheckinValues } from "@/features/mind/domain/types"
import type { LibraryBackend } from "@/features/library/store/types"

export type DataSource = "demo" | "account"

export interface SyncInfo {
  status: SyncStatus
  pending: number
  lastSyncedAt: number | null
  lastError: string | null
  notices: SyncNotice[]
  /** Review closes waiting to run or needing a new decision (M3.4c). */
  closeIntents?: CloseIntent[]
  /** Reviews (`kind:periodStart`) with writes still queued. */
  pendingReviews?: string[]
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
  /** False while the account's server lacks the check-ins migration (M3.3): nothing can be saved. */
  checkins?: boolean
  /** False while the account's server lacks the reviews migration (M3.4): drafts stay on the device and cannot close. */
  reviews?: boolean
  /** False: the server lacks the daily reviews migration (C5). Their drafts stay on the device. */
  dailyReviews?: boolean
  /** False: the server lacks the Active Recall migration (D2). Cards stay on the device. */
  recall?: boolean
  /** False: the server lacks the Daily Discovery migration (D4). Feedback stays on the device. */
  discovery?: boolean
  /** False: the server lacks the experiments migration (E3). They stay on the device. */
  experiments?: boolean
  /** False: the server lacks the notification settings migration (E6). They stay on the device. */
  motivation?: boolean
  account?: { userId: string; email: string | null }
}

/** Goals (M3.1). Optional on a backend until it supports them; screens check `goalsEnabled()`. */
export interface GoalActions {
  addGoal(input: GoalInput): string
  updateGoal(id: string, input: GoalInput): void
  setGoalState(id: string, state: GoalState): void
  archiveGoal(id: string): void
  restoreGoal(id: string): void
  setGoalReview(id: string, review: boolean): void
  setGoalBook(goalId: string, itemId: string, linked: boolean): void
  addGoalLog(goalId: string, kind: GoalLogKind, text: string): void
  removeGoalLog(goalId: string, entryId: string): void
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
  finishFocus(id: string, input: { trimTo?: string | null; actualOutput?: string | null; rating?: number | null; interruptions?: number | null }): FocusOutcome
  editFocus(id: string, input: EditInput): FocusOutcome
  discardFocus(id: string): void
  setHabitSource(habitId: string, source: "focus" | null): void
  clockNow(): number
}

export type CheckinOutcome = { ok: true } | { ok: false; reason: CheckinRejection }

/** Mind & Energy (M3.3). Every call is one desired state per field, saved at once (no «Guardar»). */
export interface MindActions {
  setCheckin(date: LocalDate, phase: CheckinPhase, values: CheckinValues): CheckinOutcome
  setCheckinConfig(config: CheckinConfig): CheckinOutcome
}

export type ReviewSaveOutcome =
  | { ok: true }
  | { ok: false; reason: "invalid_period" | "not_available" | "closed" | "closing" | "conflict" | "invalid" }
export type ReviewDeleteOutcome = { ok: true } | { ok: false; reason: "confirmation_required" | "not_synced" | "pending" | "closing" }

/**
 * Life Review (M3.4c). Edits are desired states per section, saved at once (debounced by the UI).
 * A section waiting for a decision (conflict) cannot be edited until the user decides.
 */
export interface ReviewActions {
  saveReview(kind: ReviewKind, periodStart: LocalDate, fields: ReviewFields): ReviewSaveOutcome
  closeReview(kind: ReviewKind, periodStart: LocalDate): CloseRequest
  cancelReviewClose(kind: ReviewKind, periodStart: LocalDate): boolean
  /** Exceptional: explicit confirmation, on the exact version this device synced. */
  deleteReview(kind: ReviewKind, periodStart: LocalDate, confirm: "delete"): ReviewDeleteOutcome
  /** «Aplicar la mía» / «Mantener la otra» for one kept section. */
  resolveReviewText(noticeId: string, field: ReviewField, choice: "mine" | "theirs"): boolean
  reviewSyncState(kind: ReviewKind, periodStart: LocalDate): ReviewSyncState
}

export type AddRecallCardResult = { ok: true; id: string } | { ok: false; field: "question" | "answer"; reason: "empty" | "too_long" }

/** Active Recall (D3). Times and «today» come from the backend (server-corrected in account mode). */
export interface RecallActions {
  addRecallCard(input: { question: string; answer: string; sourceNoteId: string | null }): AddRecallCardResult
  /** False if the card no longer exists. */
  answerRecallCard(cardId: string, grade: Grade): boolean
  suspendRecallCard(cardId: string, suspended: boolean): void
  deleteRecallCard(cardId: string): void
}

export type AddDiscoveryTopicResult = { ok: true; id: string } | Extract<OwnTopicResult, { ok: false }>

/** Daily Discovery (D4). */
export interface DiscoveryActions {
  addDiscoveryTopic(input: OwnTopicInput): AddDiscoveryTopicResult
  removeDiscoveryTopic(id: string): void
  setTopicFeedback(topicKey: string, fields: FeedbackFields): void
}

export type StartExperimentResult = { ok: true; id: string } | Extract<ExperimentValidation, { ok: false }> | { ok: false; field: "active"; reason: "too_many" }

/** Improvement experiments (E3). They start today and close today, in the profile timezone. */
export interface ExperimentActions {
  startExperiment(input: { title: string; metric: ExperimentMetric; days: ExperimentDays }): StartExperimentResult
  closeExperiment(id: string, status: "finished" | "abandoned", note: string | null): void
  deleteExperiment(id: string): void
}

/** Notification settings (E6): the whole settings, saved at once. */
export interface MotivationActions {
  setMotivationSettings(settings: MotivationSettings): void
}

export interface HabitActions extends Partial<MotivationActions>, Partial<ExperimentActions>, Partial<DiscoveryActions>, Partial<RecallActions>, Partial<GoalActions>, Partial<FocusActions>, Partial<MindActions>, Partial<ReviewActions> {
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
  /** The change history of a habit, read from the cloud (C6). */
  loadHabitHistory?(habitId: string): Promise<AuditRow[]>
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
  /** Knowledge OS (M4d): same change signal as the rest of the data source. */
  library?: LibraryBackend
  dispose?(): void
}
