import type { LocalDate } from "@/features/habits/domain/dates"
import {
  archiveHabit,
  insertHabit,
  restoreHabit,
  setEntry,
  setRestDay,
  setTimezone,
  updateHabit,
} from "@/features/habits/domain/ops"
import type { Habit, HabitsState } from "@/features/habits/domain/types"
import {
  archiveGoal,
  createGoal,
  restoreGoal,
  setCheckpointDone,
  setGoalState,
  setMeasurement,
  updateGoal,
} from "@/features/goals/domain/ops"
import { discardSession, editSession, finishSession, pauseSession, resumeSession, setHabitSource, startSession } from "@/features/focus/domain/ops"
import { setCheckin, setCheckinConfig } from "@/features/mind/domain/ops"
import { wireToInput } from "./goal-wire"
import { wireToValues } from "./checkin-wire"
import { applyCloseOp, applyDelete, applySave } from "@/features/reviews/domain/sync"
import type { Op, QueuedOp } from "./types"

/**
 * Optimistic view = server state + pending operations, applied with the same
 * pure reducers the demo uses. An op the reducers reject locally is skipped
 * (the server will reject it too and report it).
 */
export function applyOp(state: HabitsState, op: Op, today: LocalDate): HabitsState {
  switch (op.type) {
    case "entry.set": {
      const r = setEntry(state, {
        habitId: op.habit_id,
        date: op.local_date,
        value: op.value,
        opId: op.op_id,
        now: op.client_updated_at,
        today,
      })
      return r.state
    }
    case "habit.create": {
      const h = op.habit
      const habit: Habit = {
        id: h.id,
        name: h.title,
        icon: h.icon,
        dimensionId: h.dimension,
        type: h.habit_type,
        ...(h.habit_type !== "binary"
          ? { unit: h.unit ?? undefined, target: h.target_value ?? undefined, direction: h.target_direction ?? "at_least" }
          : {}),
        schedule: op.versions.map((v) => ({ validFrom: v.valid_from, rule: v.rule })),
        startDate: h.start_date,
        archivedOn: null,
        createdAt: new Date(0).toISOString(),
      }
      return insertHabit(state, habit)
    }
    case "habit.update": {
      const current = state.habits.find((h) => h.id === op.habit_id)
      if (!current) return state
      const rule = op.schedule?.rule ?? current.schedule[current.schedule.length - 1].rule
      return updateHabit(
        state,
        op.habit_id,
        {
          name: op.patch.title ?? current.name,
          icon: op.patch.icon ?? current.icon,
          dimensionId: op.patch.dimension ?? current.dimensionId,
          type: current.type,
          unit: "unit" in op.patch ? (op.patch.unit ?? undefined) : current.unit,
          target: "target_value" in op.patch ? (op.patch.target_value ?? undefined) : current.target,
          direction: "target_direction" in op.patch ? (op.patch.target_direction ?? undefined) : current.direction,
          rule,
        },
        op.schedule?.effective_from ?? today
      )
    }
    case "habit.archive":
      return archiveHabit(state, op.habit_id, op.archived_on)
    case "habit.restore":
      return restoreHabit(state, op.habit_id)
    case "rest_day.set":
      return setRestDay(state, op.local_date, op.rest)
    case "profile.update":
      return setTimezone(state, op.timezone)
    case "goal.create":
      return createGoal(state, wireToInput(op.goal, op.habits, op.checkpoints), { id: op.goal.id, now: new Date(0).toISOString() })
    case "goal.update":
      return updateGoal(state, op.goal_id, wireToInput(op.goal, op.habits, op.checkpoints), new Date(0).toISOString())
    case "goal.set_state":
      return setGoalState(state, op.goal_id, op.state, op.on, new Date(0).toISOString())
    case "goal.archive":
      return archiveGoal(state, op.goal_id, op.archived_on)
    case "goal.restore":
      return restoreGoal(state, op.goal_id)
    case "goal.checkpoint.set":
      return setCheckpointDone(state, op.goal_id, op.checkpoint_id, op.done_on, today)
    case "goal.measure":
      return setMeasurement(state, {
        goalId: op.goal_id,
        date: op.observed_on,
        value: op.value,
        note: op.note,
        opId: op.op_id,
        now: op.client_updated_at,
        today,
      }).state
    // ── Focus (M3.2): an op the reducers refuse (e.g. a second active session) changes nothing ──
    case "focus.start":
      return startSession(state, {
        id: op.session.id,
        habitId: op.session.habit_id,
        project: op.session.project,
        plannedOutput: op.session.planned_output,
        plannedMinutes: op.session.planned_minutes,
        at: op.session.started_at,
      }).state
    case "focus.pause":
      return pauseSession(state, op.session_id, op.at).state
    case "focus.resume":
      return resumeSession(state, op.session_id, op.at).state
    case "focus.finish":
      return finishSession(state, op.session_id, { at: op.at, trimTo: op.trim_to, actualOutput: op.actual_output, rating: op.rating }).state
    case "focus.edit":
      return editSession(
        state,
        op.session_id,
        { segments: op.segments, habitId: op.habit_id, project: op.project, plannedOutput: op.planned_output, actualOutput: op.actual_output, rating: op.rating },
        op.at
      ).state
    case "focus.discard":
      return discardSession(state, op.session_id, new Date(0).toISOString())
    case "habit.set_source":
      return setHabitSource(state, op.habit_id, op.source, op.from)
    // ── Mind & Energy (M3.3) ──
    case "checkin.set":
      return setCheckin(state, { date: op.local_date, phase: op.phase, values: wireToValues(op.fields), at: op.at, today }).state
    case "profile.checkin_fields":
      return setCheckinConfig(state, { am: op.am, pm: op.pm }).state
    // ── Life Review (M3.4): a closed review refuses edits here exactly as on the server ──
    case "review.save":
      return { ...state, reviews: applySave(state.reviews, op.kind, op.period_start, op.fields, new Date(0).toISOString()) }
    case "review.close":
      return { ...state, reviews: applyCloseOp(state.reviews, op.kind, op.period_start, op.snapshot) }
    case "review.delete":
      return { ...state, reviews: applyDelete(state.reviews, op.kind, op.period_start) }
    default:
      // An operation this version does not know (written by a newer one): no optimistic effect, still sent.
      return state
  }
}

export function rebase(server: HabitsState, queue: readonly QueuedOp[], today: LocalDate): HabitsState {
  return queue.reduce((s, q) => applyOp(s, q.op, today), server)
}

/**
 * Enqueue with compaction: a newer desired state for the same habit/day (or
 * rest day) replaces older ones that have not been sent yet. Ops already sent
 * (in flight) are never touched. Unsent check-in writes for the same day and phase
 * are folded into one (the newer values win field by field).
 */
export function enqueue(queue: readonly QueuedOp[], op: Op, now: number, inFlight: ReadonlySet<string>): QueuedOp[] {
  if (op.type === "review.save") {
    const prev = queue.find(
      (q) => !inFlight.has(q.op.op_id) && q.op.type === "review.save" && q.op.kind === op.kind && q.op.period_start === op.period_start
    )
    if (prev && prev.op.type === "review.save") {
      // One write per review while unsent: the newest value of each section, with the base of the
      // first unsent write of that section (what the user started from), so a section changed
      // meanwhile on another device still conflicts instead of being overwritten.
      const base_seqs = { ...op.base_seqs }
      for (const f of Object.keys(prev.op.fields)) if (f in prev.op.base_seqs) base_seqs[f] = prev.op.base_seqs[f]
      const merged: Op = { ...op, fields: { ...prev.op.fields, ...op.fields }, base_seqs }
      return [...queue.filter((q) => q !== prev), { op: merged, enqueuedAt: prev.enqueuedAt, attempts: 0 }]
    }
  }
  if (op.type === "checkin.set") {
    const prev = queue.find((q) => !inFlight.has(q.op.op_id) && q.op.type === "checkin.set" && q.op.local_date === op.local_date && q.op.phase === op.phase)
    if (prev && prev.op.type === "checkin.set") {
      const merged: Op = {
        ...op,
        fields: { ...prev.op.fields, ...op.fields },
        // The reflection's conflict base is the one the reflection was written against.
        base_note_seq: "note" in op.fields ? op.base_note_seq : prev.op.base_note_seq,
      }
      return [...queue.filter((q) => q !== prev), { op: merged, enqueuedAt: now, attempts: 0 }]
    }
  }
  const sameTarget = (q: QueuedOp) => {
    if (inFlight.has(q.op.op_id)) return false
    if (op.type === "entry.set" && q.op.type === "entry.set")
      return q.op.habit_id === op.habit_id && q.op.local_date === op.local_date
    if (op.type === "rest_day.set" && q.op.type === "rest_day.set") return q.op.local_date === op.local_date
    if (op.type === "goal.measure" && q.op.type === "goal.measure")
      return q.op.goal_id === op.goal_id && q.op.observed_on === op.observed_on
    if (op.type === "goal.checkpoint.set" && q.op.type === "goal.checkpoint.set")
      return q.op.goal_id === op.goal_id && q.op.checkpoint_id === op.checkpoint_id
    if (op.type === "profile.checkin_fields" && q.op.type === "profile.checkin_fields") return true
    return false
  }
  return [...queue.filter((q) => !sameTarget(q)), { op, enqueuedAt: now, attempts: 0 }]
}
