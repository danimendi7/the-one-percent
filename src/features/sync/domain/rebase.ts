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
import { wireToInput } from "./goal-wire"
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
  }
}

export function rebase(server: HabitsState, queue: readonly QueuedOp[], today: LocalDate): HabitsState {
  return queue.reduce((s, q) => applyOp(s, q.op, today), server)
}

/**
 * Enqueue with compaction: a newer desired state for the same habit/day (or
 * rest day) replaces older ones that have not been sent yet. Ops already sent
 * (in flight) are never touched.
 */
export function enqueue(queue: readonly QueuedOp[], op: Op, now: number, inFlight: ReadonlySet<string>): QueuedOp[] {
  const sameTarget = (q: QueuedOp) => {
    if (inFlight.has(q.op.op_id)) return false
    if (op.type === "entry.set" && q.op.type === "entry.set")
      return q.op.habit_id === op.habit_id && q.op.local_date === op.local_date
    if (op.type === "rest_day.set" && q.op.type === "rest_day.set") return q.op.local_date === op.local_date
    if (op.type === "goal.measure" && q.op.type === "goal.measure")
      return q.op.goal_id === op.goal_id && q.op.observed_on === op.observed_on
    if (op.type === "goal.checkpoint.set" && q.op.type === "goal.checkpoint.set")
      return q.op.goal_id === op.goal_id && q.op.checkpoint_id === op.checkpoint_id
    return false
  }
  return [...queue.filter((q) => !sameTarget(q)), { op, enqueuedAt: now, attempts: 0 }]
}
