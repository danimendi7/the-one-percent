"use client"

import { Info } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
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

interface Metric {
  key: string
  label: string
  short: string
  value: React.ReactNode
  detail: React.ReactNode
  how: string
  bar?: number | null
}

function buildMetrics(model: HabitsModel): { metrics: Metric[]; todayRing: number | null; todayLabel: string } {
  const { todayP, week, last30, prev30, best } = computeHeadline(model)
  const delta = last30.rate !== null && prev30.rate !== null ? Math.round((last30.rate - prev30.rate) * 100) : null
  const streakValue = best && best.streak.count > 0 ? `${best.streak.count} ${best.streak.unit === "week" ? "sem" : "d"}` : "N/D"
  return {
    todayRing: todayP.total ? todayP.done / todayP.total : null,
    todayLabel: `${todayP.done} de ${todayP.total} hábitos de hoy`,
    metrics: [
      {
        key: "today",
        label: "Hoy",
        short: "Hoy",
        value: (
          <>
            {todayP.done}
            <span className="text-text-tertiary">/{todayP.total}</span>
          </>
        ),
        detail: todayP.total === 0 ? "Nada programado" : todayP.done === todayP.total ? "Día completo" : `${todayP.total - todayP.done} pendientes`,
        how: "Hábitos programados para hoy completados. Los semanales y los días de descanso no cuentan aquí.",
      },
      {
        key: "week",
        label: "Plan semanal",
        short: "Semana",
        value: pct(week.ratio),
        detail: `${week.done} de ${week.planned} planificadas`,
        how: "Unidades completadas sobre todas las planificadas de lunes a domingo (incluye días futuros). Los objetivos semanales aportan tantas unidades como su meta.",
        bar: week.ratio,
      },
      {
        key: "30d",
        label: "Cumplimiento 30 d",
        short: "30 días",
        value: pct(last30.rate),
        detail: (
          <>
            <span className="num">
              {last30.fulfilled}/{last30.applicable}
            </span>
            {delta !== null && (
              <span className={cn("num ml-2", delta >= 0 ? "text-text-secondary" : "text-warning")}>
                {delta >= 0 ? "+" : ""}
                {delta} pts vs 30 d previos
              </span>
            )}
          </>
        ),
        how: "Oportunidades cumplidas / aplicables en los últimos 30 días. Hoy cuenta como pendiente; los días de descanso, los días no programados y las semanas en curso no cuentan.",
      },
      {
        key: "streak",
        label: "Mejor racha activa",
        short: "Racha",
        value: streakValue,
        detail: best && best.streak.count > 0 ? best.habit.name : "Sin rachas todavía",
        how: "Oportunidades consecutivas cumplidas. Los días no programados y de descanso se saltan; lo pendiente de hoy no la rompe.",
      },
    ],
  }
}

/**
 * Habit metrics. Mobile: one compact strip so the checklist stays above the
 * fold, with a sheet that explains every number. Desktop: cards. Explanations
 * open on tap (popover/sheet), never hover-only tooltips.
 */
export function HabitMetrics({ model, className }: { model: HabitsModel; className?: string }) {
  const { metrics, todayRing, todayLabel } = buildMetrics(model)

  return (
    <div className={className}>
      {/* Mobile strip */}
      <div className="panel flex items-stretch rounded-2xl md:hidden">
        <div className="grid flex-1 grid-cols-[1.3fr_1fr_1fr_1fr] divide-x divide-border/70">
          {metrics.map((m) => (
            <div key={m.key} className="min-w-0 px-2 py-3 first:pl-3">
              <p className="truncate text-[0.6875rem] text-text-tertiary">{m.short}</p>
              <div className="mt-1 flex items-center gap-1.5">
                {m.key === "today" && <ProgressRing value={todayRing} size={18} stroke={3} label={todayLabel} />}
                <p className="num truncate text-lg leading-none font-semibold">{m.value}</p>
              </div>
            </div>
          ))}
        </div>
        <Sheet>
          <SheetTrigger
            className="grid w-11 shrink-0 place-items-center border-l border-border/70 text-text-tertiary active:bg-surface-raised"
            aria-label="Detalle de métricas y cómo se calculan"
          >
            <Info className="size-4" />
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-3xl p-0">
            <SheetHeader className="border-b border-border px-5 pt-5 pb-4">
              <SheetTitle>Cómo se calcula</SheetTitle>
              <SheetDescription>Todas las cifras salen de tus registros, sin puntuaciones opacas.</SheetDescription>
            </SheetHeader>
            <ul className="pb-safe divide-y divide-border/70">
              {metrics.map((m) => (
                <li key={m.key} className="px-5 py-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-semibold">{m.label}</p>
                    <p className="num text-lg font-semibold">{m.value}</p>
                  </div>
                  <p className="mt-0.5 text-xs text-text-tertiary">{m.detail}</p>
                  <p className="mt-2 text-sm leading-relaxed text-text-secondary">{m.how}</p>
                </li>
              ))}
            </ul>
          </SheetContent>
        </Sheet>
      </div>

      {/* Tablet/desktop cards */}
      <div className="hidden grid-cols-2 gap-3 md:grid lg:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.key} className="panel flex min-w-0 flex-col rounded-2xl p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="truncate text-xs font-medium text-text-secondary">{m.label}</p>
              <Popover>
                <PopoverTrigger
                  className="-m-2 grid size-9 shrink-0 place-items-center rounded-lg text-text-tertiary hover:text-text-secondary"
                  aria-label={`Cómo se calcula: ${m.label}`}
                >
                  <Info className="size-3.5" />
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 text-sm leading-relaxed text-text-secondary">
                  {m.how}
                </PopoverContent>
              </Popover>
            </div>
            <div className="num text-[1.75rem] leading-none font-semibold">
              {m.key === "today" ? (
                <span className="flex items-center gap-3">
                  <ProgressRing value={todayRing} size={40} stroke={4.5} label={todayLabel} />
                  <span>{m.value}</span>
                </span>
              ) : (
                m.value
              )}
            </div>
            {m.bar !== undefined && (
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-raised" aria-hidden>
                <div
                  className="h-full rounded-full bg-signal transition-[width] duration-300 ease-(--ease-out-quint)"
                  style={{ width: `${Math.round((m.bar ?? 0) * 100)}%` }}
                />
              </div>
            )}
            <p className="mt-2 truncate text-xs text-text-tertiary">{m.detail}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function MetricsSkeleton({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden>
      <div className="panel h-[66px] animate-pulse rounded-2xl md:hidden" />
      <div className="hidden grid-cols-2 gap-3 md:grid lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="panel h-[118px] animate-pulse rounded-2xl" />
        ))}
      </div>
    </div>
  )
}
