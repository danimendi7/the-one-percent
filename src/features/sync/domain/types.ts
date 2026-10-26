import type { LocalDate } from "@/features/habits/domain/dates"
import type { DimensionId, HabitsState, HabitType, ScheduleRule, TargetDirection } from "@/features/habits/domain/types"

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

export type OpType = Op["type"]

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
  profile: { timezone: string; locale: string; server_seq: number } | null
  dimensions: { slug: DimensionId; name: string }[]
  habits: WireHabit[]
  entries: WireEntry[]
  rest_days: WireRestDay[]
  cursor: number
}

/** Last state confirmed by the server, plus per-row metadata for merging. */
export interface ServerCache {
  state: HabitsState
  habitVersion: Record<string, number>
  rowSeq: Record<string, number>
  cursor: number
  serverToday: LocalDate
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
}
