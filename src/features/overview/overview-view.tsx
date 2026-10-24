"use client"

import Link from "next/link"
import { useState } from "react"
import { ArrowRight, Brain, Check, Compass, Timer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DemoBadge } from "@/components/common/demo-note"
import { pct } from "@/components/common/format"
import { ProgressRing } from "@/components/common/progress-ring"
import { PageHeader } from "@/components/shell/page-header"
import { cn } from "@/lib/utils"
import { addDays, capitalize, formatDate } from "@/features/habits/domain/dates"
import { byDimension, completion, weeklySeries } from "@/features/habits/domain/metrics"
import type { DimensionId } from "@/features/habits/domain/types"
import { DIMENSION_COLOR } from "@/features/habits/components/habit-icon"
import { computeHeadline } from "@/features/habits/components/habit-metrics"
import { TodayChecklist } from "@/features/habits/components/today-checklist"
import { useHabitsModel, type HabitsModel } from "@/features/habits/components/use-habits-model"
import { GOALS } from "@/features/goals/fixtures"
import { FEATURED_TOPIC } from "@/features/discover/fixtures"
import { RECALL_CARDS } from "@/features/brain/fixtures"

export function OverviewView() {
  const model = useHabitsModel()

  return (
    <>
      <PageHeader
        title="Resumen"
        meta={
          <span className="flex items-center gap-2">
            {model ? <span>{capitalize(formatDate(model.today, { weekday: "long", day: "numeric", month: "long" }))}</span> : <span>&nbsp;</span>}
            <DemoBadge />
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
        {/* Today */}
        <section aria-labelledby="today-title" className="lg:col-span-7 xl:col-span-8">
          <div className="panel rounded-2xl p-4 sm:p-5">
            {model ? <TodayHeader model={model} /> : <div className="h-[88px] animate-pulse rounded-xl bg-surface-raised/50" />}
          </div>
          <div className="mt-4">
            {model ? <TodayChecklist model={model} /> : <div className="panel h-80 animate-pulse rounded-2xl" />}
          </div>
        </section>

        {/* Side column */}
        <div className="grid min-w-0 grid-cols-1 content-start gap-4 lg:col-span-5 xl:col-span-4">
          <Priorities />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-1 xl:grid-cols-2">
            <FocusCta />
            <LearnCta />
          </div>
        </div>

        {/* Dimensions */}
        <section aria-labelledby="dims-title" className="lg:col-span-7 xl:col-span-8">
          <h2 id="dims-title" className="mb-3 text-base font-semibold">
            Dimensiones · 30 días
          </h2>
          {model ? <Dimensions model={model} /> : <div className="panel h-48 animate-pulse rounded-2xl" />}
        </section>

        {/* Goals */}
        <section aria-labelledby="goals-title" className="lg:col-span-5 xl:col-span-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="goals-title" className="text-base font-semibold">
              Objetivos activos
            </h2>
            <Link href="/goals" className="-mr-2 inline-flex min-h-11 items-center rounded-lg px-2 text-sm text-text-secondary hover:text-foreground">
              Ver todos
            </Link>
          </div>
          <ul className="panel divide-y divide-border/70 rounded-2xl">
            {GOALS.map((g) => (
              <li key={g.id} className="px-4 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-medium">{g.title}</p>
                  <span className="num shrink-0 text-xs text-text-secondary">{pct(g.outcome)}</span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-raised" aria-hidden>
                  <div className="h-full rounded-full bg-foreground/70" style={{ width: `${g.outcome * 100}%` }} />
                </div>
                <p className="mt-1.5 text-xs text-text-tertiary">
                  {g.current} de {g.target} · {g.metric.toLowerCase()}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  )
}

function TodayHeader({ model }: { model: HabitsModel }) {
  const { todayP, week, last30 } = computeHeadline(model)
  const ratio = todayP.total ? todayP.done / todayP.total : null
  const remaining = todayP.total - todayP.done
  return (
    <div className="flex items-center gap-4 sm:gap-6">
      <ProgressRing value={ratio} size={88} stroke={8} label={`Hoy: ${todayP.done} de ${todayP.total} hábitos`}>
        <span className="num text-xl font-semibold">{pct(ratio)}</span>
      </ProgressRing>
      <div className="min-w-0 flex-1">
        <h2 id="today-title" className="text-lg leading-snug font-semibold text-balance sm:text-xl">
          {todayP.total === 0
            ? "Hoy no hay hábitos programados"
            : remaining === 0
              ? "Todo lo de hoy está hecho"
              : `${remaining} ${remaining === 1 ? "hábito pendiente" : "hábitos pendientes"} hoy`}
        </h2>
        <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <div className="flex gap-1.5">
            <dt className="text-text-tertiary">Semana</dt>
            <dd className="num text-text-secondary">{pct(week.ratio)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-text-tertiary">30 días</dt>
            <dd className="num text-text-secondary">{pct(last30.rate)}</dd>
          </div>
        </dl>
      </div>
      <Button asChild variant="outline" className="hidden sm:inline-flex">
        <Link href="/habits">
          Matriz semanal
          <ArrowRight />
        </Link>
      </Button>
    </div>
  )
}

const INITIAL_PRIORITIES = [
  { id: "p1", title: "Cerrar la revisión de M1", done: false },
  { id: "p2", title: "90 min de escritura sin interrupciones", done: false },
  { id: "p3", title: "Llamar a mamá", done: true },
]

/** Top 3 priorities. In-memory demo until daily_priorities exists (M3). */
function Priorities() {
  const [items, setItems] = useState(INITIAL_PRIORITIES)
  return (
    <section aria-labelledby="prio-title" className="panel rounded-2xl p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="prio-title" className="text-base font-semibold">
          Top 3 de hoy
        </h2>
        <span className="num text-xs text-text-tertiary">
          {items.filter((i) => i.done).length}/{items.length}
        </span>
      </div>
      <ol className="space-y-1">
        {items.map((p, i) => (
          <li key={p.id}>
            <button
              type="button"
              aria-pressed={p.done}
              onClick={() => setItems(items.map((x) => (x.id === p.id ? { ...x, done: !x.done } : x)))}
              className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 text-left transition-colors hover:bg-surface-raised"
            >
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full border text-[0.6875rem] font-semibold transition-colors",
                  p.done ? "border-transparent bg-signal text-signal-foreground" : "border-text-tertiary/60 text-text-tertiary"
                )}
                aria-hidden
              >
                {p.done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn("text-sm", p.done && "text-text-tertiary line-through decoration-text-tertiary/60")}>
                {p.title}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

function FocusCta() {
  return (
    <Link
      href="/focus"
      className="panel group flex min-h-[132px] flex-col justify-between rounded-2xl p-4 transition-colors hover:bg-surface-raised"
    >
      <Timer className="size-5 text-signal" strokeWidth={1.75} aria-hidden />
      <div>
        <p className="text-sm font-semibold">Bloque de enfoque</p>
        <p className="mt-0.5 text-xs text-text-tertiary">25 · 50 · 90 min</p>
      </div>
    </Link>
  )
}

function LearnCta() {
  return (
    <div className="panel flex min-h-[132px] flex-col justify-between rounded-2xl p-2">
      <Link
        href="/knowledge/discover"
        className="flex flex-1 flex-col justify-between gap-3 rounded-xl p-2 transition-colors hover:bg-surface-raised"
      >
        <Compass className="size-5 text-dim-learn" strokeWidth={1.75} aria-hidden />
        <span className="line-clamp-2 text-sm font-semibold">{FEATURED_TOPIC.title}</span>
      </Link>
      <Link
        href="/knowledge/brain"
        className="flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-xs text-text-tertiary transition-colors hover:bg-surface-raised hover:text-text-secondary"
      >
        <Brain className="size-3.5" aria-hidden />
        {RECALL_CARDS.length} tarjetas por repasar
      </Link>
    </div>
  )
}

const DIM_NAMES: Record<DimensionId, string> = {
  body: "Cuerpo",
  mind: "Mente",
  learn: "Aprendizaje",
  work: "Trabajo profundo",
}

function Dimensions({ model }: { model: HabitsModel }) {
  const range = { from: addDays(model.today, -29), to: model.today }
  const dims = byDimension(model.all, range, model.ctx)
  const ids = (Object.keys(DIM_NAMES) as DimensionId[]).filter((d) => dims.has(d))
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {ids.map((id) => {
        const habits = model.all.filter((h) => h.dimensionId === id)
        const series = weeklySeries(habits, 8, model.ctx)
        const s = dims.get(id)!
        const prev = completion(habits, { from: addDays(model.today, -59), to: addDays(model.today, -30) }, model.ctx)
        const delta = s.rate !== null && prev.rate !== null ? Math.round((s.rate - prev.rate) * 100) : null
        return (
          <div key={id} className="panel flex items-end justify-between gap-4 rounded-2xl p-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm text-text-secondary">
                <span className="size-2 rounded-full" style={{ background: DIMENSION_COLOR[id] }} aria-hidden />
                {DIM_NAMES[id]}
              </p>
              <p className="num mt-2 text-2xl font-semibold">{pct(s.rate)}</p>
              <p className="num mt-0.5 text-xs text-text-tertiary">
                {s.fulfilled}/{s.applicable}
                {delta !== null && ` · ${delta >= 0 ? "+" : ""}${delta} pts`}
              </p>
            </div>
            <div
              className="flex h-12 items-end gap-1"
              role="img"
              aria-label={`Últimas 8 semanas: ${series.map((w) => pct(w.rate)).join(", ")}`}
            >
              {series.map((w, i) => (
                <span
                  key={w.weekStart}
                  className="w-2 rounded-sm"
                  style={{
                    height: `${Math.max(8, (w.rate ?? 0) * 100)}%`,
                    background: w.rate === null ? "var(--surface-raised)" : DIMENSION_COLOR[id],
                    opacity: i === series.length - 1 ? 1 : 0.35 + (i / series.length) * 0.45,
                  }}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
