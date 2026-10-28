"use client"

import Link from "next/link"
import { useState } from "react"
import { Activity, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { EmptyState } from "@/components/common/empty-state"
import { pct } from "@/components/common/format"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import { formatDate, type LocalDate } from "@/features/habits/domain/dates"
import type { DateRange } from "@/features/habits/domain/metrics"
import type { HabitsState } from "@/features/habits/domain/types"
import { MIND_METRICS, MIND_RULES } from "@/features/analytics/domain/catalog"
import {
  average,
  changeVsPrevious,
  checkinDays,
  completionBySleep,
  coverage,
  energyByFocus,
  FOCUS_DAY_MINUTES,
  GROUP_MIN_DAYS,
  mindDataLevel,
  series,
  SLEEP_GOOD_HOURS,
  type Comparison,
  type PhaseFilter,
} from "../domain/metrics"
import { checkinFor } from "../domain/ops"
import { INDICATOR_LABEL, type Indicator } from "../domain/types"
import { checkinSummary, INDICATOR_COLOR } from "./mind-ui"
import { fmtValue, indicatorsToShow } from "./mind-trends"

interface Drill {
  title: string
  formula: string
  rows: { date: LocalDate; text: string }[]
}

const PHASE_TEXT: Record<PhaseFilter, string> = { both: "Mañana y noche", am: "Solo mañana", pm: "Solo noche" }

/**
 * Mind & Energy in Life Analytics (catalog v4). Period, indicator and phase live in the URL with the
 * other filters; habit, dimension and goal filters do not apply. Every figure opens its days.
 */
export function MindAnalytics({
  state,
  today,
  range,
  periodLabel,
  indicator,
  phase,
  onIndicator,
  onPhase,
}: {
  state: HabitsState
  today: LocalDate
  range: DateRange
  periodLabel: string
  indicator: Indicator | "all"
  phase: PhaseFilter
  onIndicator: (i: Indicator | "all") => void
  onPhase: (p: PhaseFilter) => void
}) {
  const [drill, setDrill] = useState<Drill | null>(null)
  const level = mindDataLevel(state, range)
  const indicators = indicatorsToShow(state, range).filter((i) => indicator === "all" || i === indicator)
  const cov = coverage(state, range, phase)
  const anyEver = Object.keys(state.checkins).length > 0

  function openIndicator(i: Indicator) {
    const pts = series(state, range, i, phase).filter((p) => p.value !== null)
    setDrill({
      title: `${INDICATOR_LABEL[i]} · ${PHASE_TEXT[phase].toLocaleLowerCase("es-ES")}`,
      formula: MIND_METRICS.mind_average.formula,
      rows: pts.reverse().map((p) => ({ date: p.date, text: fmtValue(i, p.value) })),
    })
  }

  return (
    <section id="mente" className="scroll-mt-20 space-y-4" aria-labelledby="mind-analytics-title">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 id="mind-analytics-title" className="flex items-center gap-2 text-lg font-semibold">
            Mente y energía
            {level === "few" && <span className="rounded-full border border-border px-2 py-0.5 text-[0.6875rem] font-normal text-text-tertiary">Pocos datos</span>}
          </h2>
          <p className="mt-0.5 text-xs text-text-tertiary">Check-ins en {periodLabel}. Los filtros de hábito y dimensión no se aplican aquí.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Select value={indicator} onValueChange={(v) => onIndicator(v as Indicator | "all")}>
            <SelectTrigger className="h-11! w-full sm:w-44" aria-label="Indicador">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los indicadores</SelectItem>
              {(["sleep", "energy", "mood", "stress"] as const).map((i) => (
                <SelectItem key={i} value={i}>
                  {INDICATOR_LABEL[i]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={phase} onValueChange={(v) => onPhase(v as PhaseFilter)}>
            <SelectTrigger className="h-11! w-full sm:w-40" aria-label="Momento del día">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["both", "am", "pm"] as const).map((p) => (
                <SelectItem key={p} value={p}>
                  {PHASE_TEXT[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {level === "none" ? (
        <div className="panel rounded-2xl">
          <EmptyState
            icon={Activity}
            title={anyEver ? "Sin check-ins en este periodo" : "Aún no hay check-ins"}
            description={anyEver ? "Amplía el periodo para ver tus medias." : "Las medias de sueño, energía, ánimo y estrés aparecerán aquí con tus primeros check-ins."}
            className="py-8"
            action={
              !anyEver ? (
                <Button asChild variant="outline">
                  <Link href="/mind">Ir a Mente y energía</Link>
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <MindStat
              label={MIND_METRICS.mind_coverage.label}
              value={pct(cov.rate)}
              detail={`${cov.days} de ${cov.total} días`}
              onOpen={() =>
                setDrill({
                  title: `Días con check-in en ${periodLabel}`,
                  formula: MIND_METRICS.mind_coverage.formula,
                  rows: checkinDays(state, range, phase)
                    .reverse()
                    .map((d) => ({ date: d, text: [checkinFor(state, d, "am"), checkinFor(state, d, "pm")].filter(Boolean).map((c) => checkinSummary(c)).join(" / ") })),
                })
              }
            />
            {indicators.map((i) => {
              const avg = average(series(state, range, i, phase))
              const change = level === "enough" ? changeVsPrevious(state, range, i, phase) : null
              return (
                <MindStat
                  key={i}
                  label={INDICATOR_LABEL[i]}
                  dot={INDICATOR_COLOR[i]}
                  value={fmtValue(i, avg.value)}
                  detail={`media · n = ${avg.n}${change ? ` · ${change.delta === 0 ? "igual" : `${change.delta > 0 ? "+" : "−"}${fmtValue(i, Math.abs(change.delta))}`} vs. anterior` : ""}`}
                  onOpen={avg.n ? () => openIndicator(i) : undefined}
                />
              )
            })}
          </div>

          {level === "few" ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm leading-relaxed text-text-secondary" role="note">
              Pocos datos: con menos de 7 días con check-in no se muestran cambios ni comparaciones.
            </p>
          ) : (
            <div className="panel rounded-2xl p-4 sm:p-5" data-testid="mind-comparisons">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-base font-semibold">Comparaciones</h3>
                <span className="rounded-full border border-border px-2 py-0.5 text-[0.6875rem] text-text-tertiary">Descriptivo, no causal</span>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <ComparisonRow
                  title={MIND_METRICS.mind_energy_focus.label}
                  question={`Energía media en días con ${FOCUS_DAY_MINUTES} min o más de enfoque frente al resto`}
                  labels={[`Con ≥ ${FOCUS_DAY_MINUTES} min`, `Con menos`]}
                  c={energyByFocus(state, range)}
                  fmt={(v) => fmtValue("energy", v)}
                />
                <ComparisonRow
                  title={MIND_METRICS.mind_sleep_completion.label}
                  question={`Cumplimiento de hábitos tras dormir ${SLEEP_GOOD_HOURS} h o más frente a menos`}
                  labels={[`≥ ${SLEEP_GOOD_HOURS} h`, `< ${SLEEP_GOOD_HOURS} h`]}
                  c={completionBySleep(state, range, today)}
                  fmt={(v) => pct(v)}
                />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-text-tertiary">
                Coincidencias en tus datos, no relaciones de causa y efecto: otros factores pueden explicar la diferencia.
              </p>
            </div>
          )}
        </>
      )}

      <details className="panel group rounded-2xl p-5">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-base font-semibold">
          Cómo se calcula mente y energía
          <ChevronRight className="size-4 text-text-tertiary transition-transform group-open:rotate-90" aria-hidden />
        </summary>
        <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm leading-relaxed md:grid-cols-2">
          {Object.values(MIND_METRICS).map((m) => (
            <div key={m.id}>
              <dt className="font-medium text-foreground">{m.label}</dt>
              <dd className="text-text-secondary">{m.formula}</dd>
            </div>
          ))}
        </dl>
        <ul className="mt-4 grid gap-x-8 gap-y-2 border-t border-border/70 pt-4 text-sm leading-relaxed text-text-secondary md:grid-cols-2">
          {MIND_RULES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </details>

      <DrillSheet drill={drill} onOpenChange={(o) => !o && setDrill(null)} />
    </section>
  )
}

function ComparisonRow({ title, question, labels, c, fmt }: { title: string; question: string; labels: [string, string]; c: Comparison; fmt: (v: number | null) => string }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-0.5 text-xs text-text-tertiary">{question}</p>
      {c.shown ? (
        <dl className="mt-3 grid grid-cols-2 gap-3">
          {[c.a, c.b].map((g, i) => (
            <div key={i}>
              <dt className="text-xs text-text-secondary">{labels[i]}</dt>
              <dd className="num mt-1 text-lg font-semibold">
                {fmt(g.value)}
                <span className="ml-1.5 text-xs font-normal text-text-tertiary">n = {g.n} días</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-3 text-sm text-text-secondary">
          Aún no: hacen falta {GROUP_MIN_DAYS} días en cada grupo (ahora {c.a.n} y {c.b.n}).
        </p>
      )}
    </div>
  )
}

function MindStat({ label, value, detail, onOpen, dot }: { label: string; value: string; detail: string; onOpen?: () => void; dot?: string }) {
  const body = (
    <>
      <p className="flex items-center justify-between text-xs font-medium text-text-secondary">
        <span className="flex items-center gap-2">
          {dot && <span className="size-2 rounded-full" style={{ background: dot }} aria-hidden />}
          {label}
        </span>
        {onOpen && <ChevronRight className="size-3.5 text-text-tertiary" aria-hidden />}
      </p>
      <p className="num mt-3 text-[1.5rem] leading-none font-semibold">{value}</p>
      <p className="mt-2 text-xs leading-snug text-text-tertiary">
        {detail}
        {onOpen && <span className="sr-only">. Ver detalle</span>}
      </p>
    </>
  )
  if (!onOpen) return <div className="panel rounded-2xl p-4">{body}</div>
  return (
    <button
      type="button"
      onClick={onOpen}
      className="panel rounded-2xl p-4 text-left transition-colors hover:bg-surface-raised/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.99]"
    >
      {body}
    </button>
  )
}

function DrillSheet({ drill, onOpenChange }: { drill: Drill | null; onOpenChange: (open: boolean) => void }) {
  const desktop = useMediaQuery("(min-width: 768px)")
  return (
    <Sheet open={drill !== null} onOpenChange={onOpenChange}>
      <SheetContent side={desktop ? "right" : "bottom"} className={cn("gap-0 p-0", desktop ? "w-full sm:max-w-md" : "max-h-[85dvh] rounded-t-3xl border-x-0")}>
        {drill && (
          <>
            <SheetHeader className="border-b border-border/70 px-5 pt-5 pb-4">
              <SheetTitle>{drill.title}</SheetTitle>
              <SheetDescription>{drill.formula}</SheetDescription>
            </SheetHeader>
            <ul className="divide-y divide-border/60 overflow-y-auto px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {drill.rows.map((r) => (
                <li key={r.date} className="flex min-h-11 items-center justify-between gap-4 py-2 text-sm">
                  <span className="text-text-secondary">{formatDate(r.date, { weekday: "short", day: "numeric", month: "short" })}</span>
                  <span className="num text-right">{r.text}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
