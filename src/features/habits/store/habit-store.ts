"use client"

/**
 * M1 demo store: browser-only persistence (localStorage).
 *
 * This is intentionally NOT a sync engine. It stands in for the M2 offline
 * queue + Supabase backend, and the UI labels it as "local demo". The domain
 * reducers it calls are the same pure functions the real backend will mirror.
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
  type SetEntryResult,
} from "../domain/ops"
import type { HabitsState } from "../domain/types"
import { createDemoState } from "../fixtures/demo"
import { habitsStateSchema } from "./schema"

export const STORAGE_KEY = "the-one-percent:demo:habits:v1"
const DEFAULT_TZ = "Europe/Madrid"

export interface HabitsSnapshot {
  state: HabitsState
  today: LocalDate
  /** False when the browser refuses storage (private mode, quota). */
  persisted: boolean
}

let snapshot: HabitsSnapshot | null = null
const listeners = new Set<() => void>()

function computeToday(timezone: string): LocalDate {
  return localDateInZone(new Date(), timezone)
}

function readStorage(): HabitsState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = habitsStateSchema.safeParse(JSON.parse(raw))
    return parsed.success ? (parsed.data as HabitsState) : null
  } catch {
    return null
  }
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
  const stored = readStorage()
  const timezone = stored?.timezone ?? DEFAULT_TZ
  const today = computeToday(timezone)
  if (stored) return { state: stored, today, persisted: true }
  const state = createDemoState(today, timezone)
  return { state, today, persisted: writeStorage(state) }
}

function emit() {
  for (const l of listeners) l()
}

function commit(next: HabitsState) {
  if (!snapshot || next === snapshot.state) return
  snapshot = { ...snapshot, state: next, persisted: writeStorage(next) }
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

/** Another tab changed the demo data: adopt it (local cross-tab only). */
function onStorage(e: StorageEvent) {
  if (e.key !== STORAGE_KEY || !snapshot) return
  const next = readStorage()
  if (next) {
    snapshot = { ...snapshot, state: next }
    emit()
  }
}

function getSnapshot(): HabitsSnapshot {
  if (!snapshot) snapshot = init()
  return snapshot
}

function getServerSnapshot(): HabitsSnapshot | null {
  return null
}

/** Returns null during SSR / before hydration so the UI can render skeletons. */
export function useHabits(): HabitsSnapshot | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export const habitActions = {
  setEntry(habitId: string, date: LocalDate, value: boolean | number | null): SetEntryResult {
    const s = getSnapshot()
    const result = setEntry(s.state, {
      habitId,
      date,
      value,
      opId: newId(),
      now: new Date().toISOString(),
      today: s.today,
    })
    if (result.ok) commit(result.state)
    return result
  },
  addHabit(input: HabitInput): string {
    const s = getSnapshot()
    const id = newId()
    commit(addHabit(s.state, input, { id, today: s.today, now: new Date().toISOString() }))
    return id
  },
  updateHabit(id: string, input: HabitInput) {
    const s = getSnapshot()
    commit(updateHabit(s.state, id, input, s.today))
  },
  archiveHabit(id: string) {
    const s = getSnapshot()
    commit(archiveHabit(s.state, id, s.today))
  },
  restoreHabit(id: string) {
    commit(restoreHabit(getSnapshot().state, id))
  },
  setRestDay(date: LocalDate, rest: boolean) {
    commit(setRestDay(getSnapshot().state, date, rest))
  },
  resetDemo() {
    const s = getSnapshot()
    commit(createDemoState(s.today, s.state.timezone))
  },
  exportJson(): string {
    return JSON.stringify(getSnapshot().state, null, 2)
  },
}
