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
import { uuidv4 } from "@/lib/ids"
import { habitsStateSchema } from "./schema"
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
    return parsed.success ? (parsed.data as HabitsState) : null
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
