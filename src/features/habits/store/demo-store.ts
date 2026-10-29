"use client"

/**
 * Demo backend: browser-only persistence (localStorage) with generated example
 * data. Used when there is no account (explore mode) or Supabase is not
 * configured. Never synced, never imported automatically into an account.
 */
import { useSyncExternalStore } from "react"
import { localDateInZone, type LocalDate } from "../domain/dates"
import {
  addHabit,
  archiveHabit,
  restoreHabit,
  setEntry,
  setRestDay,
  updateHabit,
  type HabitInput,
} from "../domain/ops"
import type { HabitsState } from "../domain/types"
import { createDemoState } from "../fixtures/demo"
import { createDemoGoals } from "@/features/goals/fixtures"
import { withDemoFocus } from "@/features/focus/fixtures"
import { withDemoCheckins } from "@/features/mind/fixtures"
import { setCheckin, setCheckinConfig } from "@/features/mind/domain/ops"
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
import { uuidv4 } from "@/lib/ids"
import { habitsStateSchema } from "./schema"
import { DEFAULT_CHECKIN_CONFIG } from "@/features/mind/domain/types"
import type { Backend, HabitsSnapshot } from "./types"

export const STORAGE_KEY = "the-one-percent:demo:habits:v1"
const DEFAULT_TZ = "Europe/Madrid"

let snapshot: HabitsSnapshot | null = null
const listeners = new Set<() => void>()

function computeToday(timezone: string): LocalDate {
  return localDateInZone(new Date(), timezone)
}

/** Read demo data saved in this browser without creating any (used by the import flow). */
export function readDemoState(): HabitsState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = habitsStateSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return null
    const data = parsed.data as Omit<HabitsState, "goals" | "measurements" | "focusSessions" | "checkins" | "checkinConfig" | "reviews"> &
      Partial<Pick<HabitsState, "goals" | "measurements" | "focusSessions" | "checkins" | "checkinConfig" | "reviews">>
    // Before M3.4 there were no reviews.
    const reviews = data.reviews ?? {}
    // Demo saved by an older version: add what it lacks relative to when it was seeded, keeping
    // every record it has. Before M3.1 there were no goals; before M3.2 no focus sessions; before
    // M3.3 no check-ins.
    const withGoals = data.goals && data.measurements ? { ...(data as Omit<HabitsState, "focusSessions" | "checkins" | "checkinConfig" | "reviews">), reviews } : { ...data, ...createDemoGoals(data.seededOn), reviews }
    const withFocus = data.focusSessions
      ? { ...withGoals, focusSessions: data.focusSessions }
      : withDemoFocus({ ...withGoals, focusSessions: [], checkins: {}, checkinConfig: data.checkinConfig ?? DEFAULT_CHECKIN_CONFIG }, data.seededOn)
    if (data.checkins) return { ...withFocus, checkins: data.checkins, checkinConfig: data.checkinConfig ?? DEFAULT_CHECKIN_CONFIG }
    return withDemoCheckins(withFocus, data.seededOn)
  } catch {
    return null
  }
}

/** Delete this browser's demo data (callers must offer an export first). */
export function clearDemoState(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
  snapshot = null
  emit()
}

function writeStorage(state: HabitsState): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

function init(): HabitsSnapshot {
  const stored = readDemoState()
  const timezone = stored?.timezone ?? DEFAULT_TZ
  const today = computeToday(timezone)
  if (stored) return { state: stored, today, persisted: true, source: "demo" }
  const state = createDemoState(today, timezone)
  return { state, today, persisted: writeStorage(state), source: "demo" }
}

function emit() {
  for (const l of listeners) l()
}

function getSnapshot(): HabitsSnapshot {
  if (!snapshot) snapshot = init()
  return snapshot
}

function commit(next: HabitsState) {
  const s = getSnapshot()
  if (next === s.state) return
  snapshot = { ...s, state: next, persisted: writeStorage(next) }
  emit()
}

function refreshToday() {
  if (!snapshot) return
  const today = computeToday(snapshot.state.timezone)
  if (today !== snapshot.today) {
    snapshot = { ...snapshot, today }
    emit()
  }
}

/** Another tab changed the demo data: adopt it (same browser only). */
function onStorage(e: StorageEvent) {
  if (e.key !== STORAGE_KEY || !snapshot) return
  const next = readDemoState()
  if (next) {
    snapshot = { ...snapshot, state: next }
    emit()
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    window.addEventListener("storage", onStorage)
    document.addEventListener("visibilitychange", refreshToday)
    window.addEventListener("focus", refreshToday)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      window.removeEventListener("storage", onStorage)
      document.removeEventListener("visibilitychange", refreshToday)
      window.removeEventListener("focus", refreshToday)
    }
  }
}

export const demoBackend: Backend = {
  source: "demo",
  subscribe,
  getSnapshot,
  actions: {
    setEntry(habitId, date, value) {
      const s = getSnapshot()
      const result = setEntry(s.state, {
        habitId,
        date,
        value,
        opId: uuidv4(),
        now: new Date().toISOString(),
        today: s.today,
      })
      if (result.ok) commit(result.state)
      return result
    },
    addHabit(input: HabitInput) {
      const s = getSnapshot()
      const id = uuidv4()
      commit(addHabit(s.state, input, { id, today: s.today, now: new Date().toISOString() }))
      return id
    },
    updateHabit(id, input) {
      const s = getSnapshot()
      commit(updateHabit(s.state, id, input, s.today))
    },
    archiveHabit(id) {
      const s = getSnapshot()
      commit(archiveHabit(s.state, id, s.today))
    },
    restoreHabit(id) {
      commit(restoreHabit(getSnapshot().state, id))
    },
    setRestDay(date, rest) {
      commit(setRestDay(getSnapshot().state, date, rest))
    },
    addGoal(input) {
      const s = getSnapshot()
      const id = uuidv4()
      commit(createGoal(s.state, input, { id, now: new Date().toISOString() }))
      return id
    },
    updateGoal(id, input) {
      commit(updateGoal(getSnapshot().state, id, input, new Date().toISOString()))
    },
    setGoalState(id, goalState) {
      const s = getSnapshot()
      commit(setGoalState(s.state, id, goalState, s.today, new Date().toISOString()))
    },
    archiveGoal(id) {
      const s = getSnapshot()
      commit(archiveGoal(s.state, id, s.today))
    },
    restoreGoal(id) {
      commit(restoreGoal(getSnapshot().state, id))
    },
    setMeasurement(goalId, date, value, note) {
      const s = getSnapshot()
      const r = setMeasurement(s.state, { goalId, date, value, note, opId: uuidv4(), now: new Date().toISOString(), today: s.today })
      if (r.ok) commit(r.state)
      return r
    },
    setCheckpoint(goalId, checkpointId, doneOn) {
      const s = getSnapshot()
      commit(setCheckpointDone(s.state, goalId, checkpointId, doneOn, s.today))
    },
    // ── Focus (M3.2): the same reducers the account replays over server state ──
    startFocus(input) {
      const id = uuidv4()
      const r = startSession(getSnapshot().state, { id, ...input, at: new Date().toISOString() })
      if (!r.ok) return { ok: false, reason: r.reason }
      commit(r.state)
      return { ok: true, id }
    },
    pauseFocus(id) {
      const r = pauseSession(getSnapshot().state, id, new Date().toISOString())
      if (r.ok) commit(r.state)
    },
    resumeFocus(id) {
      const r = resumeSession(getSnapshot().state, id, new Date().toISOString())
      if (r.ok) commit(r.state)
    },
    finishFocus(id, input) {
      const r = finishSession(getSnapshot().state, id, { ...input, at: new Date().toISOString() })
      if (!r.ok) return { ok: false, reason: r.reason }
      commit(r.state)
      return { ok: true }
    },
    editFocus(id, input) {
      const r = editSession(getSnapshot().state, id, input, new Date().toISOString())
      if (!r.ok) return { ok: false, reason: r.reason }
      commit(r.state)
      return { ok: true }
    },
    discardFocus(id) {
      commit(discardSession(getSnapshot().state, id, new Date().toISOString()))
    },
    setHabitSource(habitId, source) {
      const s = getSnapshot()
      commit(setHabitSource(s.state, habitId, source, s.today))
    },
    clockNow: () => Date.now(),
    // ── Mind & Energy (M3.3): the same reducers the account replays over server state ──
    setCheckin(date, phase, values) {
      const s = getSnapshot()
      const r = setCheckin(s.state, { date, phase, values, at: new Date().toISOString(), today: s.today })
      if (!r.ok) return { ok: false, reason: r.reason }
      commit(r.state)
      return { ok: true }
    },
    setCheckinConfig(config) {
      const r = setCheckinConfig(getSnapshot().state, config)
      if (!r.ok) return { ok: false, reason: r.reason }
      commit(r.state)
      return { ok: true }
    },
    resetDemo() {
      const s = getSnapshot()
      commit(createDemoState(s.today, s.state.timezone))
    },
    exportJson() {
      return JSON.stringify(getSnapshot().state, null, 2)
    },
  },
}

/** True when this browser holds demo data (for import / cleanup prompts in account mode). */
export function useHasDemoData(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("storage", cb)
      return () => window.removeEventListener("storage", cb)
    },
    () => {
      try {
        return window.localStorage.getItem(STORAGE_KEY) !== null
      } catch {
        return false
      }
    },
    () => false
  )
}
