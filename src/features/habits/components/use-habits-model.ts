"use client"

import { useMemo } from "react"
import { useHabits } from "../store/habit-store"
import { activeHabits } from "../domain/ops"
import type { EvalContext } from "../domain/metrics"
import type { Habit, HabitsState } from "../domain/types"
import type { LocalDate } from "../domain/dates"

export interface HabitsModel {
  state: HabitsState
  today: LocalDate
  /** Habits active today (archived excluded) */
  active: Habit[]
  /** All habits, archived included: history stays in analytics */
  all: Habit[]
  ctx: EvalContext
  persisted: boolean
}

export function useHabitsModel(): HabitsModel | null {
  const snap = useHabits()
  return useMemo(() => {
    if (!snap) return null
    const { state, today } = snap
    return {
      state,
      today,
      active: activeHabits(state, today),
      all: state.habits,
      ctx: { entries: state.entries, restDays: new Set(state.restDays), today },
      persisted: snap.persisted,
    }
  }, [snap])
}
