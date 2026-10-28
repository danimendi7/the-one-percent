"use client"

import { CalendarCheck, Moon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { WEEKDAY_SHORT, startOfWeek, addDays } from "../domain/dates"
import { currentStreak, habitOpportunities, type WeekOpportunity } from "../domain/metrics"
import { isEligibleDay, ruleOn } from "../domain/schedule"
import { isFocusFed } from "../domain/ops"
import { num } from "@/components/common/format"
import type { Habit, ScheduleRule } from "../domain/types"
import { habitActions } from "../store/habit-store"
import { cellInfo, targetLabel } from "./cell-state"
import { HabitDayCell } from "./habit-day-cell"
import { HabitIcon } from "./habit-icon"
import type { HabitsModel } from "./use-habits-model"

export function describeRule(rule: ScheduleRule): string {
  switch (rule.kind) {
    case "daily":
      return "Cada día"
    case "weekdays":
      return rule.weekdays.length === 5 && !rule.weekdays.some((d) => d > 5)
        ? "Lunes a viernes"
        : [...rule.weekdays].sort().map((d) => WEEKDAY_SHORT[d]).join(" · ")
    case "weekly_count":
      return `${rule.timesPerWeek}× por semana`
  }
}

function weekOpp(habit: Habit, model: HabitsModel): WeekOpportunity | undefined {
  const ws = startOfWeek(model.today)
  return habitOpportunities(habit, { from: ws, to: addDays(ws, 6) }, model.ctx).find(
    (o): o is WeekOpportunity => o.kind === "week"
  )
}

/** One-tap checklist for today (Overview + Habits "Hoy" view). */
export function TodayChecklist({ model, className }: { model: HabitsModel; className?: string }) {
  const { today, ctx } = model
  const isRest = ctx.restDays.has(today)
  const due = model.active.filter((h) => isEligibleDay(h, today))
  const daily = due.filter((h) => ruleOn(h, today)?.kind !== "weekly_count")
  const weekly = due.filter((h) => ruleOn(h, today)?.kind === "weekly_count")

  if (isRest) {
    return (
      <div className={cn("panel flex flex-col items-start gap-4 rounded-2xl p-5 sm:flex-row sm:items-center", className)}>
        <div className="grid size-11 place-items-center rounded-xl bg-surface-raised">
          <Moon className="size-5 text-text-secondary" aria-hidden />
        </div>
        <div className="flex-1">
          <p className="font-semibold">Hoy es día de descanso</p>
          <p className="text-sm text-text-secondary">No cuenta en ninguna métrica. El descanso es parte del plan.</p>
        </div>
        <Button variant="outline" onClick={() => habitActions.setRestDay(today, false)}>
          Quitar descanso
        </Button>
      </div>
    )
  }

  if (daily.length === 0 && weekly.length === 0) {
    return (
      <div className={cn("panel flex items-start gap-4 rounded-2xl p-5", className)} role="status">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-raised">
          <CalendarCheck className="size-5 text-text-secondary" aria-hidden />
        </div>
        <div>
          <p className="font-semibold">Nada programado para hoy</p>
          <p className="mt-1 text-sm leading-relaxed text-text-secondary">
            Ninguno de tus hábitos activos toca hoy. Los días no programados no cuentan en ningún porcentaje.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={cn("space-y-6", className)}>
      <ChecklistGroup title="Hoy" habits={daily} model={model} />
      {weekly.length > 0 && <ChecklistGroup title="Objetivos semanales" habits={weekly} model={model} weeklyGroup />}
    </div>
  )
}

function ChecklistGroup({
  title,
  habits,
  model,
  weeklyGroup = false,
}: {
  title: string
  habits: Habit[]
  model: HabitsModel
  weeklyGroup?: boolean
}) {
  if (habits.length === 0) return null
  return (
    <section aria-label={title}>
      <h3 className="mb-2 px-1 text-xs font-medium text-text-tertiary">{title}</h3>
      <ul className="panel divide-y divide-border/70 overflow-hidden rounded-2xl">
        {habits.map((h) => (
          <HabitRow key={h.id} habit={h} model={model} weekly={weeklyGroup} />
        ))}
      </ul>
    </section>
  )
}

function HabitRow({ habit, model, weekly }: { habit: Habit; model: HabitsModel; weekly: boolean }) {
  const { today, ctx } = model
  const info = cellInfo(habit, today, ctx)
  const rule = ruleOn(habit, today)!
  const streak = currentStreak(habit, ctx)
  const wk = weekly ? weekOpp(habit, model) : undefined
  const target = targetLabel(habit)
  const done = info.state === "done"
  const fed = isFocusFed(habit, today)
  const fedValue = info.entry && typeof info.entry.value === "number" ? info.entry.value : 0

  return (
    <li className={cn("flex items-center gap-3 px-3 py-2.5 transition-colors sm:px-4", done && "bg-signal/[0.035]")}>
      <HabitIcon icon={habit.icon} dimensionId={habit.dimensionId} />
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-[0.9375rem] font-medium", done && "text-text-secondary")}>{habit.name}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-text-tertiary">
          {fed ? (
            <span className="num">
              Se alimenta de Enfoque · {num(fedValue)} de {num(habit.target ?? 0)} {habit.unit ?? "min"}
            </span>
          ) : (
            target && <span className="num">{target}</span>
          )}
          {fed ? null : wk ? (
            <span className={cn("num", wk.achieved >= wk.target && "text-signal")}>
              {wk.achieved}/{wk.target} esta semana
            </span>
          ) : (
            <span>{describeRule(rule)}</span>
          )}
          {streak.count >= 2 && (
            <span className="num text-text-secondary">
              racha {streak.count} {streak.unit === "week" ? "sem" : "d"}
            </span>
          )}
        </p>
      </div>
      <HabitDayCell habit={habit} date={today} ctx={ctx} className="size-11 max-w-none rounded-xl text-xs" />
    </li>
  )
}
