"use client"

import Link from "next/link"
import { useState } from "react"
import { ArrowRight, BarChart3, Brain, CircleSlash, CloudUpload, Compass, Library as LibraryIcon, ListChecks, NotebookPen, Plus, RefreshCw, Timer, TriangleAlert } from "lucide-react"
import { EmptyState } from "@/components/common/empty-state"
import { useHasDemoData } from "@/features/habits/store/demo-store"
import { Button } from "@/components/ui/button"
import { SourceBadge } from "@/components/common/demo-note"
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
import { ActiveGoals } from "@/features/goals/components/active-goals"
import { todayTopic } from "@/features/discover/domain/feed"
import { habitActions, useHabits } from "@/features/habits/store/habit-store"
import { focusToday } from "@/features/focus/domain/metrics"
import { minutesLabel } from "@/features/focus/components/focus-ui"
import { useFocusModel } from "@/features/focus/use-focus"
import { useLibrary } from "@/features/library/store/use-library"
import { inProgress } from "@/features/knowledge/domain/library"
import { itemHref, LIBRARY_HREF } from "@/features/library/components/library-ui"
import { CheckinCard } from "@/features/mind/components/checkin-card"
import { ReviewCard } from "@/features/reviews/components/review-card"
import { RecallCount } from "@/features/recall/components/recall-count"
import { daySummary } from "./domain/day"

export function OverviewView() {
  const model = useHabitsModel()

  return (
    <>
      <PageHeader
        title="Resumen"
        meta={
          <span className="flex items-center gap-2">
            {model ? <span>{capitalize(formatDate(model.today, { weekday: "long", day: "numeric", month: "long" }))}</span> : <span>&nbsp;</span>}
            <SourceBadge source={model?.source} />
          </span>
        }
      />

      <SyncErrorAlert />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
        {/* Today */}
        <section aria-labelledby="today-title" className="lg:col-span-7 xl:col-span-8">
          {model && model.active.length === 0 ? (
            <div data-testid="overview-day" data-state="no_habits">
              <FirstHabitPanel source={model.source} />
            </div>
          ) : (
            <>
              <div className="panel rounded-2xl p-4 sm:p-5">
                {model ? <TodayHeader model={model} /> : <div className="h-[88px] animate-pulse rounded-xl bg-surface-raised/50" />}
              </div>
              <div className="mt-4">
                {model ? <TodayChecklist model={model} /> : <div className="panel h-80 animate-pulse rounded-2xl" />}
              </div>
            </>
          )}
        </section>

        {/* Side column */}
        <div className="grid min-w-0 grid-cols-1 content-start gap-4 lg:col-span-5 xl:col-span-4">
          <Shortcuts />
          <CheckinCard />
          <ReviewCard />
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
          <ActiveGoals />
        </section>
      </div>
    </>
  )
}

function TodayHeader({ model }: { model: HabitsModel }) {
  const { todayP, week, last30 } = computeHeadline(model)
  const day = daySummary(model.active, model.all, model.ctx)
  const ratio = todayP.total ? todayP.done / todayP.total : null
  return (
    <div data-testid="overview-day" data-state={day.kind}>
      <div className="flex items-center gap-4 sm:gap-6">
        <ProgressRing value={ratio} size={88} stroke={8} label={`Hoy: ${todayP.done} de ${todayP.total} hábitos`}>
          <span className="num text-xl font-semibold">{pct(ratio)}</span>
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <h2 id="today-title" className="text-lg leading-snug font-semibold text-balance sm:text-xl">
            {day.kind === "rest"
              ? "Hoy es día de descanso planificado"
              : day.kind === "nothing_today"
                ? "Hoy no hay hábitos programados"
                : day.pending === 0
                  ? "Todo lo de hoy está hecho"
                  : `${day.pending} ${day.pending === 1 ? "hábito pendiente" : "hábitos pendientes"} hoy`}
          </h2>
          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <div className="flex gap-1.5">
              <dt className="text-text-tertiary">Hechos</dt>
              <dd className="num text-text-secondary" data-testid="overview-done">
                {day.done}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-text-tertiary">Pendientes</dt>
              <dd className="num text-text-secondary" data-testid="overview-pending">
                {day.pending}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-text-tertiary">En descanso</dt>
              <dd className="num text-text-secondary" data-testid="overview-rests">
                {day.rests}
              </dd>
            </div>
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
      {day.kind === "rest" && <p className="mt-3 text-sm text-text-secondary">El descanso es parte del plan: no cuenta como incumplimiento.</p>}
      {day.missedYesterday > 0 && (
        <Link
          href="/habits"
          data-testid="overview-missed"
          className="mt-3 flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm text-text-secondary transition-colors hover:bg-surface-raised"
        >
          <CircleSlash className="size-4 shrink-0 text-text-tertiary" aria-hidden />
          <span className="flex-1">
            Ayer {day.missedYesterday === 1 ? "quedó 1 hábito" : `quedaron ${day.missedYesterday} hábitos`} sin hacer
          </span>
          <ArrowRight className="size-4 shrink-0 text-text-tertiary" aria-hidden />
        </Link>
      )}
    </div>
  )
}

/**
 * A sync error is not the same as «nothing done»: what is shown is this device's copy, which may
 * lack changes from other devices. Nothing is lost: changes made here wait and go when it works.
 */
function SyncErrorAlert() {
  const snap = useHabits()
  const status = snap?.source === "account" ? snap.sync?.status : undefined
  // The engine retries on its own («syncing» between attempts): the alert stays through those
  // attempts and goes only when a sync works (or the device is simply offline).
  const [failing, setFailing] = useState(false)
  const [seen, setSeen] = useState(status)
  if (status !== seen) {
    setSeen(status)
    if (status !== "syncing") setFailing(status === "error")
  }
  if (!snap?.sync || !(status === "error" || (status === "syncing" && failing))) return null
  const pending = snap.sync.pending
  return (
    <div role="alert" data-testid="overview-sync-error" className="panel mb-4 flex flex-col items-start gap-3 rounded-2xl border-warning/40 p-4 sm:flex-row sm:items-center">
      <TriangleAlert className="size-5 shrink-0 text-warning" aria-hidden />
      <p className="flex-1 text-sm leading-relaxed text-text-secondary">
        <strong className="font-semibold text-foreground">No se pudo sincronizar.</strong> Ves la copia de este dispositivo, que puede no incluir cambios hechos en otros.{" "}
        {pending > 0
          ? `${pending} ${pending === 1 ? "cambio espera" : "cambios esperan"} aquí y se ${pending === 1 ? "enviará" : "enviarán"} al reintentar.`
          : "Se reintentará solo."}
      </p>
      <Button variant="outline" size="touch-sm" onClick={() => habitActions.syncNow?.()}>
        <RefreshCw /> Reintentar
      </Button>
    </div>
  )
}

/** Shortcuts to the places a day usually needs (Plan §5.1). No placeholder content. */
function Shortcuts() {
  const links = [
    { href: "/habits", label: "Hábitos", icon: ListChecks },
    { href: "/knowledge/brain/repaso", label: "Repaso", icon: Brain, extra: <RecallCount /> },
    { href: "/reviews", label: "Revisiones", icon: NotebookPen },
    { href: "/analytics", label: "Analytics", icon: BarChart3 },
  ]
  return (
    <section aria-labelledby="shortcuts-title" className="panel rounded-2xl p-3 sm:p-4" data-testid="overview-shortcuts">
      <h2 id="shortcuts-title" className="px-1 pb-2 text-base font-semibold">
        Atajos
      </h2>
      <ul className="grid grid-cols-2 gap-1.5">
        {links.map(({ href, label, icon: Icon, extra }) => (
          <li key={href}>
            <Link href={href} className="flex min-h-11 items-center gap-2 rounded-xl px-2.5 text-sm transition-colors hover:bg-surface-raised">
              <Icon className="size-4 shrink-0 text-text-secondary" aria-hidden />
              <span className="flex-1 truncate">{label}</span>
              {extra}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** «Empezar bloque» (two taps to start: here, then Empezar) or «Volver al bloque» while one is active. */
function FocusCta() {
  const fm = useFocusModel()
  const active = fm?.active ?? null
  const today = fm ? focusToday(fm.state, fm.today).day : null
  return (
    <Link
      href="/focus"
      className={cn(
        "panel group flex min-h-[132px] flex-col justify-between rounded-2xl p-4 transition-colors hover:bg-surface-raised",
        active && "border-signal/40"
      )}
    >
      <Timer className="size-5 text-signal" strokeWidth={1.75} aria-hidden />
      <div>
        <p className="text-sm font-semibold">{active ? "Volver al bloque" : "Empezar bloque"}</p>
        <p className="num mt-0.5 text-xs text-text-tertiary">
          {active
            ? `${active.state === "running" ? "En foco" : "En pausa"}${active.project ? ` · ${active.project}` : ""}`
            : today && today.minutes > 0
              ? `Hoy ${minutesLabel(today.minutes)} de foco`
              : "25 · 50 · 90 min"}
        </p>
      </div>
    </Link>
  )
}

/** Discover, and the Library: what you are reading or listening to now (M4d), or the Library itself. */
function LearnCta() {
  const lib = useLibrary()
  const current = lib ? inProgress(lib.state, 1)[0] : undefined
  const snap = useHabits()
  const topic = snap ? todayTopic(snap.state.discovery, snap.today) : null
  return (
    <div className="panel flex min-h-[132px] flex-col justify-between rounded-2xl p-2">
      <Link
        href="/knowledge/discover"
        className="flex flex-1 flex-col justify-between gap-3 rounded-xl p-2 transition-colors hover:bg-surface-raised"
        data-testid="overview-topic"
      >
        <Compass className="size-5 text-dim-learn" strokeWidth={1.75} aria-hidden />
        <span className="line-clamp-2 text-sm font-semibold">{!snap ? "Descubrir" : (topic?.title ?? "Has visto todos los temas")}</span>
      </Link>
      <Link
        href={current ? itemHref(current.id) : LIBRARY_HREF}
        className="flex min-h-11 min-w-0 items-center gap-1.5 rounded-xl px-2 text-xs text-text-tertiary transition-colors hover:bg-surface-raised hover:text-text-secondary"
        data-testid="overview-library"
      >
        <LibraryIcon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{current ? `Sigue con «${current.title}»` : "Biblioteca"}</span>
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
  const ids = (Object.keys(DIM_NAMES) as DimensionId[]).filter((d) => dims.has(d) && dims.get(d)!.applicable > 0)
  if (ids.length === 0) {
    return (
      <div className="panel rounded-2xl">
        <EmptyState
          icon={BarChart3}
          title="Aún no hay datos de los últimos 30 días"
          description="Cada dimensión mostrará su cumplimiento y tendencia en cuanto registres hábitos en ella."
          className="py-8"
        />
      </div>
    )
  }
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

/** Empty account (or demo with everything archived): a clear first step instead of empty blocks. */
function FirstHabitPanel({ source }: { source: "demo" | "account" }) {
  const hasDemo = useHasDemoData()
  return (
    <div className="panel rounded-2xl">
      <EmptyState
        icon={ListChecks}
        title="Empieza por tu primer hábito"
        description="Tu progreso de hoy, la checklist y las tendencias aparecerán aquí en cuanto crees un hábito. Cuenta desde hoy y solo los días que programes."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/habits">
                <Plus /> Crear hábito
              </Link>
            </Button>
            {source === "account" && hasDemo && (
              <Button asChild variant="outline">
                <Link href="/settings">
                  <CloudUpload /> Importar desde la demo
                </Link>
              </Button>
            )}
          </div>
        }
      />
    </div>
  )
}
