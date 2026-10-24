"use client"

import { Info } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ProgressRing } from "@/components/common/progress-ring"
import { pct } from "@/components/common/format"
import { cn } from "@/lib/utils"
import { addDays, startOfWeek } from "../domain/dates"
import { completion, currentStreak, planProgress, todayProgress } from "../domain/metrics"
import type { HabitsModel } from "./use-habits-model"

export function computeHeadline(model: HabitsModel) {
  const { today, ctx } = model
  const ws = startOfWeek(today)
  const todayP = todayProgress(model.active, ctx)
  const week = planProgress(model.all, { from: ws, to: addDays(ws, 6) }, ctx)
  const last30 = completion(model.all, { from: addDays(today, -29), to: today }, ctx)
  const prev30 = completion(model.all, { from: addDays(today, -59), to: addDays(today, -30) }, ctx)
  const streaks = model.active
    .map((h) => ({ habit: h, streak: currentStreak(h, ctx) }))
    .sort((a, b) => b.streak.count - a.streak.count)
  return { todayP, week, last30, prev30, best: streaks[0] }
}

/** MetricCard row. Every number explains how it is computed (DESIGN_SYSTEM §Analytics). */
export function HabitMetrics({ model, className }: { model: HabitsModel; className?: string }) {
  const { todayP, week, last30, prev30, best } = computeHeadline(model)
  const delta =
    last30.rate !== null && prev30.rate !== null ? Math.round((last30.rate - prev30.rate) * 100) : null

  return (
    <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>
      <MetricCard
        label="Hoy"
        how="Hábitos programados para hoy completados. Los semanales y los días de descanso no cuentan aquí."
        value={
          <span className="flex items-center gap-3">
            <ProgressRing
              value={todayP.total ? todayP.done / todayP.total : null}
              size={40}
              stroke={4.5}
              label={`${todayP.done} de ${todayP.total} hábitos de hoy`}
            />
            <span>
              {todayP.done}
              <span className="text-text-tertiary">/{todayP.total}</span>
            </span>
          </span>
        }
        detail={todayP.total === 0 ? "Nada programado" : todayP.done === todayP.total ? "Día completo" : `${todayP.total - todayP.done} pendientes`}
      />
      <MetricCard
        label="Plan semanal"
        how="Unidades completadas sobre todas las planificadas de lunes a domingo (incluye días futuros). Los objetivos semanales aportan tantas unidades como su meta."
        value={pct(week.ratio)}
        detail={`${week.done} de ${week.planned} planificadas`}
        bar={week.ratio}
      />
      <MetricCard
        label="Cumplimiento 30 d"
        how="Oportunidades cumplidas / aplicables en los últimos 30 días. Hoy cuenta como pendiente; los días de descanso, los días no programados y las semanas en curso no cuentan."
        value={pct(last30.rate)}
        detail={
          <>
            <span className="num">{last30.fulfilled}/{last30.applicable}</span>
            {delta !== null && (
              <span className={cn("num ml-2", delta >= 0 ? "text-text-secondary" : "text-warning")}>
                {delta >= 0 ? "+" : ""}
                {delta} pts vs 30 d previos
              </span>
            )}
          </>
        }
      />
      <MetricCard
        label="Mejor racha activa"
        how="Oportunidades consecutivas cumplidas. Los días no programados y de descanso se saltan; lo pendiente de hoy no la rompe."
        value={best && best.streak.count > 0 ? `${best.streak.count} ${best.streak.unit === "week" ? "sem" : "d"}` : "N/D"}
        detail={best && best.streak.count > 0 ? best.habit.name : "Sin rachas todavía"}
      />
    </div>
  )
}

function MetricCard({
  label,
  value,
  detail,
  how,
  bar,
}: {
  label: string
  value: React.ReactNode
  detail?: React.ReactNode
  how: string
  bar?: number | null
}) {
  return (
    <div className="panel flex min-w-0 flex-col rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-text-secondary">{label}</p>
        <Tooltip>
          <TooltipTrigger
            className="-m-2 grid size-8 shrink-0 place-items-center rounded-lg text-text-tertiary hover:text-text-secondary"
            aria-label={`Cómo se calcula: ${label}`}
          >
            <Info className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent className="max-w-64 text-pretty">{how}</TooltipContent>
        </Tooltip>
      </div>
      <div className="num text-[1.625rem] leading-none font-semibold md:text-[1.75rem]">{value}</div>
      {bar !== undefined && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-raised" aria-hidden>
          <div
            className="h-full rounded-full bg-signal transition-[width] duration-300 ease-(--ease-out-quint)"
            style={{ width: `${Math.round((bar ?? 0) * 100)}%` }}
          />
        </div>
      )}
      {detail && <p className="mt-2 truncate text-xs text-text-tertiary">{detail}</p>}
    </div>
  )
}

export function MetricsSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)} aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="panel h-[118px] animate-pulse rounded-2xl" />
      ))}
    </div>
  )
}
