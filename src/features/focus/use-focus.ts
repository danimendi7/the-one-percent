"use client"

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { localDateInZone, type LocalDate } from "@/features/habits/domain/dates"
import { focusEnabled, habitActions, useHabits } from "@/features/habits/store/habit-store"
import type { FocusActions, HabitsSnapshot } from "@/features/habits/store/types"
import type { HabitsState } from "@/features/habits/domain/types"
import { uuidv4 } from "@/lib/ids"
import { activeSession, discardSession, editSession, finishSession, pauseSession, resumeSession, startSession } from "./domain/ops"
import type { FocusSession } from "./domain/types"

/**
 * Deploy safeguard (plan §5): an account whose server lacks the focus migration still gets a
 * working timer, held only in memory and clearly marked as not saved. Never mixed with real data.
 */
let ephemeral: HabitsState | null = null
const ephemeralListeners = new Set<() => void>()
function setEphemeral(next: HabitsState) {
  ephemeral = next
  for (const l of ephemeralListeners) l()
}

function ephemeralActions(base: () => HabitsState): FocusActions {
  const cur = () => ephemeral ?? { ...base(), focusSessions: [] }
  const now = () => new Date().toISOString()
  return {
    startFocus(input) {
      const id = uuidv4()
      // Unsaved sessions never feed a habit: there is nothing on the server to derive from.
      const r = startSession(cur(), { id, ...input, habitId: null, at: now() })
      if (!r.ok) return { ok: false, reason: r.reason }
      setEphemeral(r.state)
      return { ok: true, id }
    },
    pauseFocus(id) {
      const r = pauseSession(cur(), id, now())
      if (r.ok) setEphemeral(r.state)
    },
    resumeFocus(id) {
      const r = resumeSession(cur(), id, now())
      if (r.ok) setEphemeral(r.state)
    },
    finishFocus(id, input) {
      const r = finishSession(cur(), id, { ...input, at: now() })
      if (!r.ok) return { ok: false, reason: r.reason }
      setEphemeral({ ...r.state, focusSessions: [] })
      return { ok: true }
    },
    editFocus(id, input) {
      const r = editSession(cur(), id, input, now())
      if (r.ok) setEphemeral(r.state)
      return r.ok ? { ok: true } : { ok: false, reason: r.reason }
    },
    discardFocus(id) {
      setEphemeral(discardSession(cur(), id, now()))
    },
    setHabitSource() {},
    clockNow: () => Date.now(),
  }
}

export interface FocusModel {
  snap: HabitsSnapshot
  state: HabitsState
  today: LocalDate
  timezone: string
  active: FocusSession | null
  /** False: account server without the focus migration — the session will not be saved. */
  saved: boolean
  api: FocusActions
}

export function useFocusModel(): FocusModel | null {
  const snap = useHabits()
  const eph = useSyncExternalStore(
    (l) => {
      ephemeralListeners.add(l)
      return () => ephemeralListeners.delete(l)
    },
    () => ephemeral,
    () => null
  )
  return useMemo(() => {
    if (!snap) return null
    const saved = snap.source === "demo" || focusEnabled()
    const state = saved ? snap.state : { ...snap.state, focusSessions: eph?.focusSessions ?? [] }
    return {
      snap,
      state,
      today: snap.today,
      timezone: snap.state.timezone,
      active: activeSession(state),
      saved,
      api: saved ? habitActions : ephemeralActions(() => snap.state),
    }
  }, [snap, eph])
}

/**
 * Re-render clock for a running timer. It only triggers renders: every figure is computed
 * from the session's timestamps, so throttled or skipped ticks never lose time.
 */
export function useNow(running: boolean, clockNow: () => number, every = 250): number {
  // 0 until mounted: the clock is never read while prerendering.
  const [now, setNow] = useState(0)
  useEffect(() => {
    const tick = () => setNow(clockNow())
    const id = window.setInterval(tick, running ? every : 30_000)
    document.addEventListener("visibilitychange", tick)
    window.addEventListener("focus", tick)
    const first = window.setTimeout(tick, 0)
    return () => {
      window.clearInterval(id)
      window.clearTimeout(first)
      document.removeEventListener("visibilitychange", tick)
      window.removeEventListener("focus", tick)
    }
  }, [running, clockNow, every])
  return now || (typeof window === "undefined" ? 0 : clockNow())
}

/** Today in the profile timezone at an instant (for date pickers in the edit sheet). */
export function dayOf(t: number, timezone: string): LocalDate {
  return localDateInZone(new Date(t), timezone)
}
