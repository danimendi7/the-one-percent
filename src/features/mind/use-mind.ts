"use client"

import { useMemo } from "react"
import type { LocalDate } from "@/features/habits/domain/dates"
import type { HabitsState } from "@/features/habits/domain/types"
import { checkinsEnabled, habitActions, useHabits } from "@/features/habits/store/habit-store"
import type { HabitsSnapshot, MindActions } from "@/features/habits/store/types"

export interface MindModel {
  snap: HabitsSnapshot
  state: HabitsState
  today: LocalDate
  timezone: string
  /** False: account server without the check-ins migration. Nothing is pretended to be saved. */
  saved: boolean
  api: MindActions
  /** Server-corrected clock in account mode (the day/phase of a check-in depends on it). */
  clockNow: () => number
}

export function useMindModel(): MindModel | null {
  const snap = useHabits()
  return useMemo(() => {
    if (!snap) return null
    return {
      snap,
      state: snap.state,
      today: snap.today,
      timezone: snap.state.timezone,
      saved: snap.source === "demo" || checkinsEnabled(),
      api: habitActions,
      clockNow: habitActions.clockNow,
    }
  }, [snap])
}

/** Text of the save status shown in the check-in sheet (aria-live). */
export function saveStatus(m: MindModel): string {
  if (m.snap.source === "demo") return "Guardado en este dispositivo"
  const sync = m.snap.sync
  if (!sync) return "Guardado"
  if (sync.status === "offline") return "Guardado en este dispositivo · se enviará al recuperar la conexión"
  if (sync.pending > 0) return "Guardado · sincronizando"
  return "Guardado y sincronizado"
}
