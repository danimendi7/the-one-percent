import { formatDate, type LocalDate } from "../domain/dates"
import { isEligibleDay, isFulfilled, ruleOn } from "../domain/schedule"
import type { EvalContext } from "../domain/metrics"
import { entryKey, type Habit, type HabitEntry } from "../domain/types"
import { num } from "@/components/common/format"

/**
 * Visual state of one habit/day cell. Weekly-count habits never show a daily
 * "missed" (no penalty per day: the target is evaluated per week).
 */
export type CellState =
  | "inactive" // not scheduled / not active that day
  | "rest" // planned rest: exempt
  | "future"
  | "done"
  | "partial" // numeric value recorded, target not met
  | "todo" // today, not done
  | "missed" // past scheduled day, not done
  | "open" // weekly-count day without record

export interface CellInfo {
  state: CellState
  entry?: HabitEntry
  interactive: boolean
}

export function cellInfo(habit: Habit, date: LocalDate, ctx: EvalContext): CellInfo {
  if (!isEligibleDay(habit, date)) return { state: "inactive", interactive: false }
  if (ctx.restDays.has(date)) return { state: "rest", interactive: false }
  if (date > ctx.today) return { state: "future", interactive: false }
  const entry = ctx.entries[entryKey(habit.id, date)]
  if (isFulfilled(habit, entry)) return { state: "done", entry, interactive: true }
  if (entry) return { state: "partial", entry, interactive: true }
  if (ruleOn(habit, date)?.kind === "weekly_count") return { state: "open", interactive: true }
  return { state: date === ctx.today ? "todo" : "missed", interactive: true }
}

const STATE_LABEL: Record<CellState, string> = {
  inactive: "no programado",
  rest: "día de descanso",
  future: "pendiente (futuro)",
  done: "hecho",
  partial: "registrado, sin alcanzar el objetivo",
  todo: "pendiente hoy",
  missed: "no hecho",
  open: "sin registro",
}

export function cellAriaLabel(habit: Habit, date: LocalDate, info: CellInfo): string {
  const day = formatDate(date, { weekday: "long", day: "numeric", month: "long" })
  const value =
    info.entry && typeof info.entry.value === "number" ? `, ${num(info.entry.value)} ${habit.unit ?? ""}`.trimEnd() : ""
  return `${habit.name}, ${day}: ${STATE_LABEL[info.state]}${value}`
}

export function targetLabel(habit: Habit): string | null {
  if (habit.type === "binary" || habit.target === undefined) return null
  const op = habit.direction === "at_most" ? "≤" : "≥"
  return `${op} ${num(habit.target)} ${habit.unit ?? ""}`.trim()
}
