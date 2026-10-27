"use client"

/**
 * Data facade. Screens read with `useHabits()` and write with `habitActions`;
 * the active backend is either the local demo or the signed-in account (sync
 * engine + Supabase). The backend is chosen by <DataSourceProvider>.
 */
import { useSyncExternalStore } from "react"
import type { Backend, GoalActions, HabitActions, HabitsSnapshot } from "./types"

export type { HabitsSnapshot, DataSource, SyncInfo } from "./types"

let backend: Backend | null = null
let detach: (() => void) | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function activateBackend(next: Backend | null) {
  if (next === backend) return
  detach?.()
  backend = next
  detach = next ? next.subscribe(emit) : null
  emit()
}

export function getActiveBackend(): Backend | null {
  return backend
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Null while the data source is resolving (SSR, first paint): render skeletons. */
export function useHabits(): HabitsSnapshot | null {
  return useSyncExternalStore(
    subscribe,
    () => backend?.getSnapshot() ?? null,
    () => null
  )
}

/** True when the active data source can store goals (and, for an account, its server has them). */
export function goalsEnabled(): boolean {
  return !!backend?.actions.addGoal && backend.getSnapshot()?.goals !== false
}

function need<T>(fn: T | undefined): T {
  if (!fn) throw new Error("This data source does not support goals yet")
  return fn
}

function active(): HabitActions {
  if (!backend) throw new Error("No data source is active yet")
  return backend.actions
}

export const habitActions: HabitActions & GoalActions = {
  setEntry: (...a) => active().setEntry(...a),
  addHabit: (...a) => active().addHabit(...a),
  updateHabit: (...a) => active().updateHabit(...a),
  archiveHabit: (...a) => active().archiveHabit(...a),
  restoreHabit: (...a) => active().restoreHabit(...a),
  setRestDay: (...a) => active().setRestDay(...a),
  exportJson: () => active().exportJson(),
  addGoal: (input) => need(active().addGoal)(input),
  updateGoal: (...a) => need(active().updateGoal)(...a),
  setGoalState: (...a) => need(active().setGoalState)(...a),
  archiveGoal: (...a) => need(active().archiveGoal)(...a),
  restoreGoal: (...a) => need(active().restoreGoal)(...a),
  setMeasurement: (...a) => need(active().setMeasurement)(...a),
  setCheckpoint: (...a) => need(active().setCheckpoint)(...a),
  resetDemo: () => active().resetDemo?.(),
  syncNow: () => active().syncNow?.(),
  setTimezone: (tz) => active().setTimezone?.(tz),
  dismissNotice: (id) => active().dismissNotice?.(id),
  reapplyNotice: (id) => active().reapplyNotice?.(id),
  submitOps: (ops) => active().submitOps?.(ops),
  clearLocalCopy: async () => active().clearLocalCopy?.(),
  diagnostics: () => active().diagnostics?.() ?? { clockOffsetMs: 0, cursor: 0, deviceId: "", failures: 0 },
}
