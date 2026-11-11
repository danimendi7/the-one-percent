import type { HabitsState, HabitType } from "@/features/habits/domain/types"
import { isFulfilled } from "@/features/habits/domain/schedule"
import { activeSeconds, endedAt, minutesOf, startedAt } from "@/features/focus/domain/time"

/**
 * F7 · CSV export of the records (PRD §7: «Export JSON and CSV»). RFC 4180: comma separator,
 * double quotes around any field with a comma, quote or line break, CRLF line ends. A UTF-8 byte
 * order mark first, so a spreadsheet reads the accents. Dates are the user's local days; instants
 * are ISO 8601 in UTC; decimals use a point. Pure: the view only downloads the text.
 */
type Cell = string | number | boolean | null | undefined

const BOM = "﻿"

/** A field that a spreadsheet would run as a formula is kept as text (CSV injection). */
function cell(v: Cell): string {
  if (v === null || v === undefined) return ""
  let s = typeof v === "boolean" ? (v ? "sí" : "no") : String(v)
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: Cell[][]): string {
  return BOM + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n"
}

const TYPE: Record<HabitType, string> = { binary: "binario", numeric: "numérico", duration: "duración" }

/** One row per recorded value, oldest first: what was recorded and whether it met the target. */
export function habitsCsv(state: HabitsState): string {
  const habits = new Map(state.habits.map((h) => [h.id, h]))
  const dims = new Map(state.dimensions.map((d) => [d.id, d.name]))
  const rows = Object.values(state.entries)
    .filter((e) => habits.has(e.habitId))
    .sort((a, b) => a.date.localeCompare(b.date) || habits.get(a.habitId)!.name.localeCompare(habits.get(b.habitId)!.name, "es"))
    .map((e) => {
      const h = habits.get(e.habitId)!
      return [
        e.date,
        h.name,
        dims.get(h.dimensionId) ?? h.dimensionId,
        TYPE[h.type],
        e.value,
        h.unit ?? null,
        h.type === "binary" ? null : (h.target ?? null),
        h.type === "binary" || h.target === undefined ? null : h.direction === "at_most" ? "como máximo" : "al menos",
        isFulfilled(h, e),
      ]
    })
  return toCsv([["fecha", "hábito", "dimensión", "tipo", "valor", "unidad", "objetivo", "sentido", "cumplido"], ...rows])
}

/** One row per check-in, oldest first. Empty cells are values not recorded (never 0). */
export function checkinsCsv(state: HabitsState): string {
  const rows = Object.values(state.checkins)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.phase === b.phase ? 0 : a.phase === "am" ? -1 : 1))
    .map((c) => [c.date, c.phase === "am" ? "mañana" : "noche", c.sleep, c.energy, c.mood, c.stress, c.note])
  return toCsv([["fecha", "momento", "sueño_horas", "energía_1_5", "ánimo_1_5", "estrés_1_5", "nota"], ...rows])
}

/**
 * One row per focus session, oldest first. Minutes are rounded per session; the exact active
 * seconds go alongside, since day totals round once over the sum. Interruptions are left empty
 * when they were not noted.
 */
export function focusCsv(state: HabitsState): string {
  const rows = [...state.focusSessions]
    .sort((a, b) => startedAt(a).localeCompare(startedAt(b)))
    .map((s) => [
      s.localDate,
      startedAt(s),
      endedAt(s),
      s.state === "finished" ? minutesOf(activeSeconds(s.segments)) : null,
      s.state === "finished" ? activeSeconds(s.segments) : null,
      s.plannedMinutes,
      s.project,
      s.interruptions ?? null,
      s.rating,
      s.state === "finished" ? "terminada" : s.state === "paused" ? "en pausa" : "en curso",
    ])
  return toCsv([["fecha", "inicio_utc", "fin_utc", "minutos", "segundos_activos", "minutos_previstos", "proyecto", "interrupciones", "valoración", "estado"], ...rows])
}
