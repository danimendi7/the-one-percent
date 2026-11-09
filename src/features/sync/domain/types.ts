import type { LocalDate } from "@/features/habits/domain/dates"
import type { DimensionId, HabitsState, HabitType, ScheduleRule, TargetDirection } from "@/features/habits/domain/types"
import type { Aggregation, GoalDirection, GoalKind, GoalLogEntry, GoalPriority, GoalState, Horizon, NumericSource } from "@/features/goals/domain/types"
import type { CheckinField, CheckinPhase } from "@/features/mind/domain/types"
import type { Decision, Evaluation, ReviewKind, ReviewStatus } from "@/features/reviews/domain/types"
import type { ReviewSnapshot } from "@/features/reviews/domain/snapshot"
import type { ReviewFields } from "@/features/reviews/domain/sync"

/**
 * Client → server operations. The wire format is exactly what `public.apply_ops`
 * accepts (supabase/migrations/*_sync.sql). Every op carries a unique `op_id`
 * that the server applies at most once (idempotency ledger).
 */
export type Op =
  | {
      type: "entry.set"
      op_id: string
      habit_id: string
      local_date: LocalDate
      /** Desired state, never a toggle. null/false clears. */
      value: boolean | number | null
      /** Hybrid, server-corrected time of the intent (tie-breaker for concurrent edits). ISO. */
      client_updated_at: string
      /** server_seq of the row as this device last saw it (null if unseen). Sequential edits win. */
      base_seq: number | null
    }
  | {
      type: "habit.create"
      op_id: string
      habit: {
        id: string
        title: string
        icon: string
        dimension: DimensionId
        habit_type: HabitType
        unit: string | null
        target_value: number | null
        target_direction: TargetDirection | null
        start_date: LocalDate
      }
      versions: { valid_from: LocalDate; rule: ScheduleRule }[]
    }
  | {
      type: "habit.update"
      op_id: string
      habit_id: string
      /** Server version this edit was based on; mismatch → conflict. */
      base_version: number
      patch: {
        title?: string
        icon?: string
        dimension?: DimensionId
        unit?: string | null
        target_value?: number | null
        target_direction?: TargetDirection | null
      }
      schedule?: { effective_from: LocalDate; rule: ScheduleRule }
    }
  | { type: "habit.archive"; op_id: string; habit_id: string; archived_on: LocalDate }
  | { type: "habit.restore"; op_id: string; habit_id: string }
  | { type: "rest_day.set"; op_id: string; local_date: LocalDate; rest: boolean; client_updated_at: string; base_seq: number | null }
  | { type: "profile.update"; op_id: string; timezone: string }
  // ── Goals (M3.1): links and milestone definitions travel with the goal ──
  | { type: "goal.create"; op_id: string; goal: WireGoalFields & { id: string }; habits: WireGoalLink[]; checkpoints: WireCheckpoint[] }
  | {
      type: "goal.update"
      op_id: string
      goal_id: string
      /** Server version this edit was based on; mismatch → conflict. */
      base_version: number
      goal: WireGoalFields
      habits: WireGoalLink[]
      checkpoints: WireCheckpoint[]
    }
  | { type: "goal.set_state"; op_id: string; goal_id: string; state: GoalState; on: LocalDate }
  | { type: "goal.archive"; op_id: string; goal_id: string; archived_on: LocalDate }
  | { type: "goal.restore"; op_id: string; goal_id: string }
  | { type: "goal.set_review"; op_id: string; goal_id: string; review_since: LocalDate | null }
  | { type: "goal.log_add"; op_id: string; goal_id: string; entry: GoalLogEntry }
  | { type: "goal.log_remove"; op_id: string; goal_id: string; entry_id: string }
  | { type: "goal.book_set"; op_id: string; goal_id: string; item_id: string; linked: boolean }
  | { type: "goal.checkpoint.set"; op_id: string; goal_id: string; checkpoint_id: string; done_on: LocalDate | null }
  | {
      type: "goal.measure"
      op_id: string
      goal_id: string
      observed_on: LocalDate
      /** Desired state; null clears the day. */
      value: number | null
      note: string | null
      client_updated_at: string
      base_seq: number | null
    }
  // ── Deep Work (M3.2): action times are hybrid, server-corrected instants (ISO) ──
  | {
      type: "focus.start"
      op_id: string
      session: { id: string; habit_id: string | null; project: string | null; planned_output: string | null; planned_minutes: number; started_at: string }
    }
  | { type: "focus.pause"; op_id: string; session_id: string; at: string }
  | { type: "focus.resume"; op_id: string; session_id: string; at: string }
  | { type: "focus.finish"; op_id: string; session_id: string; at: string; trim_to: string | null; actual_output: string | null; rating: number | null; interruptions?: number | null }
  | {
      type: "focus.edit"
      op_id: string
      session_id: string
      /** Server version this edit was based on; mismatch → conflict. */
      base_version: number
      segments: WireSegment[]
      habit_id: string | null
      project: string | null
      planned_output: string | null
      actual_output: string | null
      rating: number | null
      /** Absent in operations queued by an older version: the server then keeps what was noted. */
      interruptions?: number | null
      /** Device time of the edit (validation of the optimistic copy only; the server uses its clock). */
      at: string
    }
  | { type: "focus.discard"; op_id: string; session_id: string }
  | { type: "habit.set_source"; op_id: string; habit_id: string; source: "focus" | null; from: LocalDate }
  // ── Mind & Energy (M3.3) ──
  | {
      type: "checkin.set"
      op_id: string
      local_date: LocalDate
      phase: CheckinPhase
      /** Only the fields being set; null clears one. Each field is last-writer-wins on `at`. */
      fields: WireCheckinFields
      /** Hybrid, server-corrected time of the intent (ISO). */
      at: string
      /**
       * Only with `note`: note_seq of the reflection as this device last saw it (null if unseen).
       * A different reflection written meanwhile → conflict, never a silent overwrite.
       */
      base_note_seq: number | null
    }
  | { type: "profile.checkin_fields"; op_id: string; am: CheckinField[]; pm: CheckinField[] }
  // ── Life Review (M3.4): addressed by kind + period start (one review per period) ──
  | {
      type: "review.save"
      op_id: string
      kind: ReviewKind
      period_start: LocalDate
      /** Desired state of the sections being written. */
      fields: ReviewFields
      /** Per section: server_seq it was written on (0: review seen, section unwritten; null: review unseen). */
      base_seqs: Record<string, number | null>
    }
  | {
      type: "review.close"
      op_id: string
      kind: ReviewKind
      period_start: LocalDate
      snapshot: ReviewSnapshot
      /** Pull cursor the snapshot was computed after: newer data on the server → stale_snapshot. */
      based_on_cursor: number
      /** server_seq of the review being closed, or null if the server had none. */
      base_seq: number | null
    }
  | { type: "review.delete"; op_id: string; kind: ReviewKind; period_start: LocalDate; confirm: "delete"; base_seq: number }
  // ── Library (M4b wire, M4c client): field names are column names (library-wire.ts) ──
  | LibraryOp

export type OpType = Op["type"]

export type LibraryEntity = "show" | "item" | "note"
/** Whole entity: a create, or the explicit restore of a tombstone («Deshacer»). */
export interface LibraryWriteOp {
  type: `library.${LibraryEntity}.${"create" | "restore"}`
  op_id: string
  id: string
  fields: Record<string, unknown>
  /** Hybrid, server-corrected time of the intent (D26/D42): stamps every field it writes. */
  at: string
  /** Books and episodes. */
  kind?: "book" | "episode"
  /** Notes: when the user wrote it. */
  captured_at?: string
}
/** Only the changed fields, each with the version this device saw (D68). */
export interface LibraryUpdateOp {
  type: `library.${LibraryEntity}.update`
  op_id: string
  id: string
  fields: Record<string, unknown>
  base_seqs: Record<string, number | null>
  at: string
}
/** Only the version this device saw; a content also names the newest of its notes it saw. */
export interface LibraryDeleteOp {
  type: `library.${LibraryEntity}.delete`
  op_id: string
  id: string
  base_seq: number
  notes_seq?: number
}
export interface LibraryLinkOp {
  type: "library.link.set"
  op_id: string
  a_type: "item" | "show" | "note"
  a_id: string
  b_type: "item" | "show" | "note"
  b_id: string
  linked: boolean
}
export type LibraryOp = LibraryWriteOp | LibraryUpdateOp | LibraryDeleteOp | LibraryLinkOp
export const isLibraryOp = (op: Op): op is LibraryOp => op.type.startsWith("library.")

export interface WireCheckinFields {
  sleep_hours?: number | null
  energy?: number | null
  mood?: number | null
  stress?: number | null
  note?: string | null
}

export interface WireCheckin {
  local_date: LocalDate
  phase: CheckinPhase
  sleep_hours: number | null
  energy: number | null
  mood: number | null
  stress: number | null
  note: string | null
  /** Per-field instant of the last write (keys: sleep_hours, energy, mood, stress, note). */
  field_stamps: Record<string, string>
  note_seq: number | null
  updated_at: string
  deleted: boolean
  server_seq: number
}

export interface WireReview {
  kind: ReviewKind
  period_start: LocalDate
  period_end: LocalDate
  status: ReviewStatus
  content: Record<string, string>
  decisions: Decision[]
  evaluations: Evaluation[]
  field_seqs: Record<string, number>
  snapshot: ReviewSnapshot | null
  metrics_version: number | null
  snapshot_version: number | null
  timezone: string | null
  closed_at: string | null
  version: number
  updated_at: string
  deleted: boolean
  server_seq: number
}

export interface WireSegment {
  start: string
  end: string | null
}

export interface WireFocusSession {
  id: string
  habit_id: string | null
  project: string | null
  planned_output: string | null
  actual_output: string | null
  planned_minutes: number
  segments: WireSegment[]
  state: "running" | "paused" | "finished"
  active_seconds: number
  local_date: LocalDate
  rating: number | null
  interruptions?: number | null
  version: number
  created_at: string
  updated_at: string
  deleted: boolean
  server_seq: number
}

/** Goal definition on the wire (what apply_goal_op reads; see *_goals.sql). */
export interface WireGoalFields {
  title: string
  why: string | null
  parent_id: string | null
  dimension: DimensionId | null
  metric_type: GoalKind
  source: NumericSource | null
  source_habit_id: string | null
  aggregation: Aggregation | null
  unit: string | null
  baseline: number | null
  target: number | null
  direction: GoalDirection | null
  threshold: number | null
  start_date: LocalDate
  due_date: LocalDate
  horizon_override: Horizon | null
  priority: GoalPriority
  aggregate_children: boolean
}
export interface WireGoalLink {
  habit_id: string
  weight: number
}
export interface WireCheckpoint {
  id: string
  title: string
  due_on?: LocalDate | null
  value?: number | null
  done_on?: LocalDate | null
}
export interface WireGoal extends WireGoalFields {
  id: string
  state: GoalState
  closed_on: LocalDate | null
  archived_on: LocalDate | null
  /** Absent in payloads stored before the column existed. */
  review_since?: LocalDate | null
  process_log?: GoalLogEntry[]
  book_ids?: string[]
  version: number
  created_at: string
  updated_at: string
  server_seq: number
  habits: WireGoalLink[]
  checkpoints: WireCheckpoint[]
}
export interface WireMeasurement {
  goal_id: string
  observed_on: LocalDate
  value: number | null
  note: string | null
  deleted: boolean
  client_op_id: string
  client_updated_at: string
  server_seq: number
}

export interface QueuedOp {
  op: Op
  enqueuedAt: number
  attempts: number
}

/** Server answer per operation. */
export type OpStatus = "applied" | "duplicate" | "superseded" | "conflict" | "rejected"
export interface OpResult {
  op_id: string
  status: OpStatus
  /** For duplicates: the stored outcome. */
  outcome?: Exclude<OpStatus, "duplicate">
  code?: string | null
  /** review.save (M3.4) and library update (M4b) conflicts: the sections or fields that changed meanwhile elsewhere. */
  fields?: string[]
  /** Library writes (M4b): the row's server_seq after the write, the base of this device's next edit. */
  seq?: number
}

// ── pull_changes payload ────────────────────────────────────────────────
export interface WireVersion {
  valid_from: LocalDate
  kind: ScheduleRule["kind"]
  weekdays: number[] | null
  target_count: number | null
}

export interface WireHabit {
  id: string
  title: string
  icon: string
  dimension: DimensionId
  habit_type: HabitType
  unit: string | null
  target_value: number | null
  target_direction: TargetDirection | null
  start_date: LocalDate
  archived_on: LocalDate | null
  version: number
  created_at: string
  server_seq: number
  versions: WireVersion[]
  /** M3.2. Absent from servers without the focus migration. */
  activity_source?: "focus" | null
  activity_source_from?: LocalDate | null
}

export interface WireEntry {
  habit_id: string
  local_date: LocalDate
  value_bool: boolean | null
  value_numeric: number | null
  deleted: boolean
  client_op_id: string
  client_updated_at: string
  server_seq: number
}

export interface WireRestDay {
  local_date: LocalDate
  rest: boolean
  client_updated_at: string
  server_seq: number
}

export interface PullPayload {
  server_today: LocalDate
  /** Server clock (ISO), used to correct the device clock. */
  server_time?: string
  full: boolean
  /** checkin_fields: M3.3, absent from servers without the check-ins migration. */
  profile: { timezone: string; locale: string; server_seq: number; checkin_fields?: { am: CheckinField[]; pm: CheckinField[] } | null } | null
  dimensions: { slug: DimensionId; name: string }[]
  habits: WireHabit[]
  entries: WireEntry[]
  rest_days: WireRestDay[]
  /** M3.1. Absent from servers without the goals migration: treated as empty. */
  goals?: WireGoal[]
  measurements?: WireMeasurement[]
  /** M3.2. Absent from servers without the focus migration: focus stays local-only. */
  focus_sessions?: WireFocusSession[]
  /** M3.3. Absent from servers without the check-ins migration: check-ins cannot be saved. */
  daily_checkins?: WireCheckin[]
  /** M3.4. Absent from servers without the reviews migration: reviews stay on the device. */
  reviews?: WireReview[]
  /** M4b. The library travels through pull_library; this only says the server stores it and its newest change. */
  library?: { head: number }
  cursor: number
}

/** Last state confirmed by the server, plus per-row metadata for merging. */
export interface ServerCache {
  state: HabitsState
  habitVersion: Record<string, number>
  rowSeq: Record<string, number>
  cursor: number
  serverToday: LocalDate
  /** Server capabilities seen in the last pull (a deploy may precede its migration). */
  features?: { goals: boolean; focus?: boolean; checkins?: boolean; reviews?: boolean; library?: boolean }
}

export type SyncStatus = "synced" | "syncing" | "pending" | "offline" | "error"

export interface SyncNotice {
  id: string
  kind: "conflict" | "rejected"
  opType: OpType
  /** Human context, e.g. the habit title */
  subject?: string
  code?: string | null
  /** For conflicts: the edit that lost, so the user can re-apply it. */
  op?: Op
  /**
   * Library writes on something deleted elsewhere (M4c): what this device last saw of it, so
   * «Restaurar» can send the whole entity back with the user's text on top.
   */
  library?: { fields: Record<string, unknown>; kind?: "book" | "episode" }
}

/**
 * A close the user asked for (M3.4c). Kept durably until it is applied, superseded by another
 * device's close or cancelled. The close itself runs only after a successful push and pull with an
 * empty queue, so the frozen figures include everything this device and the server know.
 */
export interface CloseIntent {
  id: string
  kind: ReviewKind
  periodStart: LocalDate
  /** reviewFingerprint() of what the user saw when asking: a different review is not closed. */
  fingerprint: string
  requestedAt: number
  /** The review.close op queued for this intent (null while waiting for the conditions). */
  opId: string | null
  /** Closes answered `stale_snapshot` (data changed between the pull and the close). */
  attempts: number
  /**
   * waiting: closes as soon as it can. needs_confirmation: the review or its data changed since
   * the user asked; it is not closed without asking again. failed: refused (`code`).
   */
  state: "waiting" | "needs_confirmation" | "failed"
  code?: string | null
}

/** What the UI says about a review's texts (M3.4c): never «synced» for a write only on this device. */
export type ReviewSyncState = "local" | "pending" | "synced" | "conflict" | "error"
