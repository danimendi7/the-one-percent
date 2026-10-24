"use client"

import { toast } from "sonner"
import { num } from "@/components/common/format"
import { formatDate, type LocalDate } from "../domain/dates"
import type { Habit } from "../domain/types"
import { habitActions } from "../store/habit-store"

const REASON: Record<string, string> = {
  future: "No se pueden registrar días futuros.",
  not_eligible: "Ese día no está programado para este hábito.",
  rest_day: "Es un día de descanso planificado.",
  invalid_value: "Valor no válido.",
  unknown_habit: "El hábito ya no existe.",
}

/**
 * Optimistic write with undo. In M1 the write is local and synchronous, so a
 * failure is a validation rejection and is shown as such (never a fake success).
 */
export function recordEntry(habit: Habit, date: LocalDate, value: boolean | number | null, today: LocalDate) {
  const result = habitActions.setEntry(habit.id, date, value)
  const toastId = `${habit.id}:${date}`
  if (!result.ok) {
    toast.error(REASON[result.reason] ?? "No se pudo guardar.", { id: toastId })
    return
  }
  if (result.previous === (value === false ? null : value)) return
  haptic(value !== null && value !== false ? 12 : 6)

  const when = date === today ? "hoy" : formatDate(date, { weekday: "short", day: "numeric" })
  const what =
    value === null || value === false
      ? "desmarcado"
      : value === true
        ? "hecho"
        : `${num(value)} ${habit.unit ?? ""}`.trim()

  toast(`${habit.name} · ${what}`, {
    id: toastId,
    description: date === today ? undefined : `Registro retroactivo (${when})`,
    duration: 2600,
    action: {
      label: "Deshacer",
      onClick: () => habitActions.setEntry(habit.id, date, result.previous),
    },
  })
}

/** Subtle tactile confirmation where supported (Android); a no-op elsewhere and under reduced motion. */
function haptic(ms: number) {
  try {
    if (typeof navigator === "undefined" || !("vibrate" in navigator)) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    navigator.vibrate(ms)
  } catch {
    // ignore: haptics are best-effort
  }
}
