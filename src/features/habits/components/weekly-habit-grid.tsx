"use client"

import { ChevronLeft, ChevronRight, Moon, MoreHorizontal, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import {
  addDays,
  capitalize,
  formatDate,
  isoWeekday,
  startOfWeek,
  weekDates,
  WEEKDAY_ABBR,
  WEEKDAY_SHORT,
  type LocalDate,
} from "../domain/dates"
import { habitOpportunities, planProgress } from "../domain/metrics"
import type { Habit } from "../domain/types"
import { habitActions } from "../store/habit-store"
import { HabitDayCell } from "./habit-day-cell"
import { HabitIcon } from "./habit-icon"
import { describeRule } from "./today-checklist"
import { ruleOn } from "../domain/schedule"
import type { HabitsModel } from "./use-habits-model"

function rowTally(habit: Habit, days: LocalDate[], model: HabitsModel) {
  const opps = habitOpportunities(habit, { from: days[0], to: days[6] }, model.ctx)
  let done = 0
  let planned = 0
  for (const o of opps) {
    if (o.status === "exempt") continue
    if (o.kind === "day") {
      planned++
      if (o.status === "fulfilled") done++
    } else {
      planned += o.target
      done += Math.min(o.achieved, o.target)
    }
  }
  return { done, planned }
}

/** WeeklyHabitGrid: table on ≥768px, stacked rows with a 7-day strip on mobile (no horizontal scroll). */
export function WeeklyHabitGrid({
  model,
  weekStart,
  onWeekChange,
  onEdit,
}: {
  model: HabitsModel
  weekStart: LocalDate
  onWeekChange: (ws: LocalDate) => void
  onEdit: (habit: Habit) => void
}) {
  const days = weekDates(weekStart)
  const currentWeek = startOfWeek(model.today)
  const isCurrent = weekStart === currentWeek
  const habits = model.all.filter((h) => days.some((d) => ruleOn(h, d)))
  const plan = planProgress(habits, { from: days[0], to: days[6] }, model.ctx)
  const range = `${formatDate(days[0], { day: "numeric", month: "short" })} - ${formatDate(days[6], { day: "numeric", month: "short" })}`

  return (
    <section aria-label="Matriz semanal" className="panel overflow-hidden rounded-2xl">
      {/* Week navigator */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-2 sm:px-3">
        <Button variant="ghost" size="icon" aria-label="Semana anterior" onClick={() => onWeekChange(addDays(weekStart, -7))}>
          <ChevronLeft />
        </Button>
        <div className="text-center">
          <p className="text-sm font-semibold">{isCurrent ? "Esta semana" : range}</p>
          <p className="num text-xs text-text-tertiary">
            {isCurrent ? range : ""}
            {isCurrent ? " · " : ""}
            {plan.planned > 0 ? `${plan.done}/${plan.planned} del plan` : "Sin plan"}
          </p>
        </div>
        <div className="flex items-center">
          {!isCurrent && (
            <Button variant="ghost" size="sm" onClick={() => onWeekChange(currentWeek)} className="hidden sm:inline-flex">
              Hoy
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Semana siguiente"
            disabled={isCurrent}
            onClick={() => onWeekChange(addDays(weekStart, 7))}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      {habits.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-text-secondary">No hay hábitos activos esta semana.</p>
      ) : (
        <>
          {/* Mobile: stacked */}
          <div className="md:hidden">
            <div className="sticky top-14 z-10 grid grid-cols-7 gap-1.5 border-b border-border bg-surface/95 px-3 py-2 backdrop-blur">
              {days.map((d) => (
                <DayHeader key={d} date={d} model={model} compact />
              ))}
            </div>
            <ul className="divide-y divide-border/70">
              {habits.map((h) => {
                const t = rowTally(h, days, model)
                return (
                  <li key={h.id} className="px-3 pt-3 pb-3.5">
                    <div className="mb-2.5 flex items-center gap-2.5">
                      <HabitIcon icon={h.icon} dimensionId={h.dimensionId} size="sm" />
                      <button
                        type="button"
                        onClick={() => onEdit(h)}
                        className="min-w-0 flex-1 truncate text-left text-sm font-medium"
                        aria-label={`Editar ${h.name}`}
                      >
                        {h.name}
                      </button>
                      <span className="num text-xs text-text-tertiary">
                        {t.done}/{t.planned}
                      </span>
                    </div>
                    <div className="grid grid-cols-7 gap-1.5">
                      {days.map((d) => (
                        <div key={d} className="flex justify-center">
                          <HabitDayCell habit={h} date={d} ctx={model.ctx} />
                        </div>
                      ))}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>

          {/* Tablet/desktop: table */}
          <div className="hidden md:block">
            <table className="w-full table-fixed border-collapse">
              <caption className="sr-only">Hábitos de la semana {range}</caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="w-auto px-4 py-2.5 text-left text-xs font-medium text-text-tertiary">
                    Hábito
                  </th>
                  {days.map((d) => (
                    <th key={d} scope="col" className={cn("w-[52px] px-0.5 py-2", d === model.today && "bg-signal/[0.04]")}>
                      <DayHeader date={d} model={model} />
                    </th>
                  ))}
                  <th scope="col" className="w-[72px] px-3 py-2.5 text-right text-xs font-medium text-text-tertiary">
                    Semana
                  </th>
                </tr>
              </thead>
              <tbody>
                {habits.map((h) => {
                  const t = rowTally(h, days, model)
                  const rule = ruleOn(h, days.find((d) => ruleOn(h, d)) ?? days[0])
                  return (
                    <tr key={h.id} className="group border-b border-border/60 last:border-0">
                      <th scope="row" className="py-2 pr-2 pl-3 text-left font-normal">
                        <button
                          type="button"
                          onClick={() => onEdit(h)}
                          className="flex w-full min-w-0 items-center gap-3 rounded-xl px-1 py-1 text-left transition-colors hover:bg-surface-raised/60"
                        >
                          <HabitIcon icon={h.icon} dimensionId={h.dimensionId} />
                          <span className="min-w-0 flex-1">
                            <span className="sr-only">Editar </span>
                            <span className="block truncate text-sm font-medium">{h.name}</span>
                            <span className="block truncate text-xs text-text-tertiary">{rule ? describeRule(rule) : ""}</span>
                          </span>
                          <Pencil className="size-3.5 shrink-0 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                        </button>
                      </th>
                      {days.map((d) => (
                        <td key={d} className={cn("px-0.5 py-2", d === model.today && "bg-signal/[0.04]")}>
                          <div className="flex justify-center">
                            <HabitDayCell habit={h} date={d} ctx={model.ctx} className="max-w-10" />
                          </div>
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right">
                        <span className={cn("num text-sm", t.planned > 0 && t.done >= t.planned ? "text-signal" : "text-text-secondary")}>
                          {t.done}/{t.planned}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

function DayHeader({ date, model, compact = false }: { date: LocalDate; model: HabitsModel; compact?: boolean }) {
  const wd = isoWeekday(date)
  const isToday = date === model.today
  const isRest = model.ctx.restDays.has(date)
  const label = formatDate(date, { weekday: "long", day: "numeric", month: "long" })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "mx-auto flex w-full max-w-11 flex-col items-center rounded-lg py-1 transition-colors hover:bg-surface-raised",
          isToday ? "text-signal" : "text-text-secondary"
        )}
      >
        <span className="sr-only">{`${label}${isToday ? ", hoy" : ""}${isRest ? ", descanso" : ""}. Opciones del día`}</span>
        <span aria-hidden className="text-[0.6875rem] font-medium">{compact ? WEEKDAY_SHORT[wd] : WEEKDAY_ABBR[wd]}</span>
        <span aria-hidden className={cn("num text-sm font-semibold", isToday ? "text-signal" : "text-foreground")}>
          {Number(date.slice(8))}
        </span>
        {isRest ? (
          <Moon className="mt-0.5 size-3 text-text-tertiary" aria-hidden />
        ) : (
          <MoreHorizontal className="mt-0.5 size-3 opacity-0" aria-hidden />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-56">
        <DropdownMenuLabel>{capitalize(label)}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => habitActions.setRestDay(date, !isRest)}>
          <Moon />
          {isRest ? "Quitar día de descanso" : "Marcar como descanso"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
