"use client"

/**
 * Data facade. Screens read with `useHabits()` and write with `habitActions`;
 * the active backend is either the local demo or the signed-in account (sync
 * engine + Supabase). The backend is chosen by <DataSourceProvider>.
 */
import { useSyncExternalStore } from "react"
import type { Backend, FocusActions, GoalActions, HabitActions, HabitsSnapshot, MindActions, RecallActions, ReviewActions, DiscoveryActions } from "./types"
import type { ReviewKind } from "@/features/reviews/domain/types"

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

/** The data source's change signal (also the Library's, M4d). */
export function subscribeData(listener: () => void) {
  return subscribe(listener)
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

/** True when the active data source stores focus sessions (an account needs the M3.2 migration). */
export function focusEnabled(): boolean {
  return !!backend?.actions.startFocus && backend.getSnapshot()?.focus !== false
}

/** True when the active data source can close reviews (an account needs the M3.4 migration, and C5 for daily ones; drafts stay on the device until then). */
export function reviewsEnabled(kind?: ReviewKind): boolean {
  if (!backend?.actions.saveReview) return false
  const snap = backend.getSnapshot()
  return snap?.reviews !== false && (kind !== "day" || snap?.dailyReviews !== false)
}

/** False only for an account whose server lacks the Daily Discovery migration: it waits on the device. */
export function discoveryEnabled(): boolean {
  return backend?.getSnapshot()?.discovery !== false
}

/** False only for an account whose server lacks the Active Recall migration: cards then wait on the device. */
export function recallEnabled(): boolean {
  return backend?.getSnapshot()?.recall !== false
}

/** True when the active data source stores check-ins (an account needs the M3.3 migration). */
export function checkinsEnabled(): boolean {
  return !!backend?.actions.setCheckin && backend.getSnapshot()?.checkins !== false
}

function need<T>(fn: T | undefined): T {
  if (!fn) throw new Error("This data source does not support this feature yet")
  return fn
}

function active(): HabitActions {
  if (!backend) throw new Error("No data source is active yet")
  return backend.actions
}

export const habitActions: HabitActions & GoalActions & FocusActions & MindActions & ReviewActions & RecallActions & DiscoveryActions = {
  addDiscoveryTopic: (...a) => need(active().addDiscoveryTopic)(...a),
  removeDiscoveryTopic: (...a) => need(active().removeDiscoveryTopic)(...a),
  setTopicFeedback: (...a) => need(active().setTopicFeedback)(...a),
  addRecallCard: (...a) => need(active().addRecallCard)(...a),
  answerRecallCard: (...a) => need(active().answerRecallCard)(...a),
  suspendRecallCard: (...a) => need(active().suspendRecallCard)(...a),
  deleteRecallCard: (...a) => need(active().deleteRecallCard)(...a),
  setEntry: (...a) => active().setEntry(...a),
  addHabit: (...a) => active().addHabit(...a),
  updateHabit: (...a) => active().updateHabit(...a),
  archiveHabit: (...a) => active().archiveHabit(...a),
  restoreHabit: (...a) => active().restoreHabit(...a),
  setRestDay: (...a) => active().setRestDay(...a),
  exportJson: () => active().exportJson(),
  loadHabitHistory: (...a) => need(active().loadHabitHistory)(...a),
  addGoal: (input) => need(active().addGoal)(input),
  updateGoal: (...a) => need(active().updateGoal)(...a),
  setGoalState: (...a) => need(active().setGoalState)(...a),
  archiveGoal: (...a) => need(active().archiveGoal)(...a),
  restoreGoal: (...a) => need(active().restoreGoal)(...a),
  setGoalReview: (...a) => need(active().setGoalReview)(...a),
  setGoalBook: (...a) => need(active().setGoalBook)(...a),
  addGoalLog: (...a) => need(active().addGoalLog)(...a),
  removeGoalLog: (...a) => need(active().removeGoalLog)(...a),
  setMeasurement: (...a) => need(active().setMeasurement)(...a),
  setCheckpoint: (...a) => need(active().setCheckpoint)(...a),
  startFocus: (input) => need(active().startFocus)(input),
  pauseFocus: (id) => need(active().pauseFocus)(id),
  resumeFocus: (id) => need(active().resumeFocus)(id),
  finishFocus: (...a) => need(active().finishFocus)(...a),
  editFocus: (...a) => need(active().editFocus)(...a),
  discardFocus: (id) => need(active().discardFocus)(id),
  setHabitSource: (...a) => need(active().setHabitSource)(...a),
  clockNow: () => active().clockNow?.() ?? Date.now(),
  setCheckin: (...a) => need(active().setCheckin)(...a),
  setCheckinConfig: (c) => need(active().setCheckinConfig)(c),
  saveReview: (...a) => need(active().saveReview)(...a),
  closeReview: (...a) => need(active().closeReview)(...a),
  cancelReviewClose: (...a) => need(active().cancelReviewClose)(...a),
  deleteReview: (...a) => need(active().deleteReview)(...a),
  resolveReviewText: (...a) => need(active().resolveReviewText)(...a),
  reviewSyncState: (...a) => need(active().reviewSyncState)(...a),
  resetDemo: () => active().resetDemo?.(),
  syncNow: () => active().syncNow?.(),
  setTimezone: (tz) => active().setTimezone?.(tz),
  dismissNotice: (id) => active().dismissNotice?.(id),
  reapplyNotice: (id) => active().reapplyNotice?.(id),
  submitOps: (ops) => active().submitOps?.(ops),
  clearLocalCopy: async () => active().clearLocalCopy?.(),
  diagnostics: () => active().diagnostics?.() ?? { clockOffsetMs: 0, cursor: 0, deviceId: "", failures: 0 },
}
