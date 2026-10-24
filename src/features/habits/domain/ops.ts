import type { LocalDate } from "./dates"
import { changeSchedule, isEligibleDay, sameRule } from "./schedule"
import {
  entryKey,
  type DimensionId,
  type Habit,
  type HabitsState,
  type HabitType,
  type ScheduleRule,
  type TargetDirection,
} from "./types"

/**
 * Pure state transitions. Each returns the same reference when nothing
 * changes, which makes repeated operations idempotent and cheap to detect.
 */

export interface SetEntryOp {
  habitId: string
  date: LocalDate
  /** Desired state (not a toggle): null clears the entry. */
  value: boolean | number | null
  opId: string
  now: string
  today: LocalDate
}

export type SetEntryResult =
  | { ok: true; state: HabitsState; previous: boolean | number | null }
  | { ok: false; state: HabitsState; reason: "unknown_habit" | "future" | "not_eligible" | "rest_day" | "invalid_value" }

export function setEntry(state: HabitsState, op: SetEntryOp): SetEntryResult {
  const habit = state.habits.find((h) => h.id === op.habitId)
  if (!habit) return { ok: false, state, reason: "unknown_habit" }
  if (op.date > op.today) return { ok: false, state, reason: "future" }
  if (!isEligibleDay(habit, op.date)) return { ok: false, state, reason: "not_eligible" }
  if (state.restDays.includes(op.date)) return { ok: false, state, reason: "rest_day" }
  if (op.value !== null) {
    const numericHabit = habit.type !== "binary"
    if (numericHabit && (typeof op.value !== "number" || !Number.isFinite(op.value) || op.value < 0)) {
      return { ok: false, state, reason: "invalid_value" }
    }
    if (!numericHabit && typeof op.value !== "boolean") {
      return { ok: false, state, reason: "invalid_value" }
    }
  }

  const key = entryKey(op.habitId, op.date)
  const existing = state.entries[key]
  const previous = existing?.value ?? null
  // Binary "false" is stored as absence: one canonical representation.
  const desired = op.value === false ? null : op.value
  if (previous === desired) return { ok: true, state, previous }

  const entries = { ...state.entries }
  if (desired === null) delete entries[key]
  else entries[key] = { habitId: op.habitId, date: op.date, value: desired, opId: op.opId, updatedAt: op.now }
  return { ok: true, state: { ...state, entries }, previous }
}

export interface HabitInput {
  name: string
  icon: string
  dimensionId: DimensionId
  type: HabitType
  unit?: string
  target?: number
  direction?: TargetDirection
  rule: ScheduleRule
}

export function addHabit(
  state: HabitsState,
  input: HabitInput,
  ctx: { id: string; today: LocalDate; now: string }
): HabitsState {
  const habit: Habit = {
    id: ctx.id,
    name: input.name.trim(),
    icon: input.icon,
    dimensionId: input.dimensionId,
    type: input.type,
    ...(input.type !== "binary"
      ? { unit: input.unit, target: input.target, direction: input.direction ?? "at_least" }
      : {}),
    schedule: [{ validFrom: ctx.today, rule: input.rule }],
    startDate: ctx.today,
    archivedOn: null,
    createdAt: ctx.now,
  }
  return { ...state, habits: [...state.habits, habit] }
}

/**
 * Edit a habit. Name/icon/dimension changes are cosmetic and apply to all
 * history. A schedule change creates a new version from `today`, so past
 * denominators are not recalculated.
 */
export function updateHabit(
  state: HabitsState,
  id: string,
  input: HabitInput,
  today: LocalDate
): HabitsState {
  return {
    ...state,
    habits: state.habits.map((h) => {
      if (h.id !== id) return h
      let next: Habit = {
        ...h,
        name: input.name.trim(),
        icon: input.icon,
        dimensionId: input.dimensionId,
      }
      if (h.type !== "binary") {
        next = { ...next, unit: input.unit, target: input.target, direction: input.direction }
      }
      const current = h.schedule[h.schedule.length - 1]
      if (!current || !sameRule(current.rule, input.rule)) {
        next = changeSchedule(next, input.rule, today)
      }
      return next
    }),
  }
}

export function archiveHabit(state: HabitsState, id: string, today: LocalDate): HabitsState {
  return {
    ...state,
    habits: state.habits.map((h) => (h.id === id ? { ...h, archivedOn: today } : h)),
  }
}

export function restoreHabit(state: HabitsState, id: string): HabitsState {
  return {
    ...state,
    habits: state.habits.map((h) => (h.id === id ? { ...h, archivedOn: null } : h)),
  }
}

export function setRestDay(state: HabitsState, date: LocalDate, rest: boolean): HabitsState {
  const has = state.restDays.includes(date)
  if (has === rest) return state
  return {
    ...state,
    restDays: rest ? [...state.restDays, date].sort() : state.restDays.filter((d) => d !== date),
  }
}

export function activeHabits(state: HabitsState, today: LocalDate): Habit[] {
  return state.habits.filter((h) => !h.archivedOn || h.archivedOn > today)
}
