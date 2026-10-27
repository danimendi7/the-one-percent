"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { ChevronRight, Flag, Gauge, LineChart as LineIcon, Table2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EmptyState } from "@/components/common/empty-state"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { SourceBadge } from "@/components/common/demo-note"
import { pct } from "@/components/common/format"
import { PageHeader } from "@/components/shell/page-header"
import { cn } from "@/lib/utils"
import {
  addDays,
  formatDate,
  startOfWeek,
  WEEKDAY_ABBR,
  WEEKDAY_LONG,
  type LocalDate,
  type Weekday,
} from "@/features/habits/domain/dates"
import {
  completion,
  currentStreak,
  dailyRates,
  weekdayConsistency,
  weeklySeries,
} from "@/features/habits/domain/metrics"
import type { DimensionId, Habit } from "@/features/habits/domain/types"
import { Segmented } from "@/features/habits/components/habit-form-sheet"
import { HabitIcon } from "@/features/habits/components/habit-icon"
import { describeRule } from "@/features/habits/components/today-checklist"
import { useHabitsModel, type HabitsModel } from "@/features/habits/components/use-habits-model"
import { GENERAL_RULES, METRICS } from "./domain/catalog"
import { parseFilter, periodRange, scopeHabits, serializeFilter, type AnalyticsFilter, type PeriodDays } from "./domain/filters"
import { DrillSheet, type DrillRequest } from "./drill-sheet"

const DIMENSION_OPTIONS: { value: DimensionId | "all"; label: string }[] = [
  { value: "all", label: "Todas las dimensiones" },
  { value: "body", label: "Cuerpo" },
  { value: "mind", label: "Mente" },
  { value: "learn", label: "Aprendizaje" },
  { value: "work", label: "Trabajo" },
]

type SetFilter = (patch: Partial<AnalyticsFilter>) => void

/** Filters live in the URL (?periodo=&dimension=&habito=) so a view survives a reload and can be shared. */
function useAnalyticsFilter(): [AnalyticsFilter, SetFilter] {
  const params = useSearchParams()
  const pathname = usePathname()
  const filter = parseFilter(params)
  const update: SetFilter = (patch) => window.history.replaceState(null, "", pathname + serializeFilter({ ...filter, ...patch }))
  return [filter, update]
}

export function AnalyticsView() {
  const model = useHabitsModel()
  const [filter, setFilter] = useAnalyticsFilter()

  return (
    <>
      <PageHeader
        title="Analítica"
        meta={<SourceBadge source={model?.source}>Demo · calculado de los registros de ejemplo</SourceBadge>}
        description="Estadística descriptiva calculada a partir de los registros. Sin puntuaciones opacas: cada cifra indica su base y se puede abrir para ver los registros que la componen."
      />
      {!model ? <AnalyticsSkeleton /> : <Content model={model} filter={filter} setFilter={setFilter} />}
    </>
  )
}

export function AnalyticsSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Cargando analítica">
      <div className="panel h-12 animate-pulse rounded-2xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="panel h-28 animate-pulse rounded-2xl" />
        ))}
      </div>
      <div className="panel h-80 animate-pulse rounded-2xl" />
    </div>
  )
}

function FilterBar({
  model,
  filter,
  setFilter,
  habit,
  goalTitle,
}: {
  model: HabitsModel
  filter: AnalyticsFilter
  setFilter: SetFilter
  habit: Habit | null
  goalTitle: string | null
}) {
  return (
    <div className="space-y-3" role="group" aria-label="Filtros de analítica">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Segmented
          label="Periodo"
          value={String(filter.period)}
          onChange={(v) => setFilter({ period: Number(v) as PeriodDays })}
          options={[
            { value: "7", label: "7 días" },
            { value: "30", label: "30 días" },
            { value: "90", label: "90 días" },
            { value: "365", label: "1 año" },
          ]}
          className="w-full sm:w-80"
        />
        <Select value={habit ? habit.dimensionId : filter.dimension} onValueChange={(v) => setFilter({ dimension: v as DimensionId | "all", habitId: "all", goalId: "all" })}>
          <SelectTrigger className="h-11! w-full sm:w-56" aria-label="Dimensión">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DIMENSION_OPTIONS.filter((o) => o.value === "all" || model.all.some((h) => h.dimensionId === o.value)).map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {habit && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-1.5 text-sm">
          <HabitIcon icon={habit.icon} dimensionId={habit.dimensionId} size="sm" />
          <span className="flex-1">
            Filtrado por <strong className="font-semibold">{habit.name}</strong>
          </span>
          <button type="button" onClick={() => setFilter({ habitId: "all" })} className="h-10 rounded-lg px-3 text-text-secondary hover:bg-surface-raised hover:text-foreground">
            Quitar filtro
          </button>
        </div>
      )}
      {!habit && goalTitle && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-1.5 text-sm">
          <Flag className="size-4 shrink-0 text-text-tertiary" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            Hábitos del objetivo <strong className="font-semibold">{goalTitle}</strong>
          </span>
          <button type="button" onClick={() => setFilter({ goalId: "all" })} className="h-10 shrink-0 rounded-lg px-3 text-text-secondary hover:bg-surface-raised hover:text-foreground">
            Quitar filtro
          </button>
        </div>
      )}
    </div>
  )
}

function Content({ model, filter, setFilter }: { model: HabitsModel; filter: AnalyticsFilter; setFilter: SetFilter }) {
  const [drill, setDrill] = useState<DrillRequest | null>(null)
  const range = periodRange(model.today, filter.period)
  if (model.all.length === 0) {
    return (
      <div className="panel rounded-2xl">
        <EmptyState
          icon={Gauge}
          title="Todavía no hay nada que analizar"
          description="La analítica se calcula a partir de tus registros. Crea un hábito y marca tus días: las cifras aparecerán aquí con su base de cálculo."
          action={
            <Button asChild>
              <Link href="/habits">Ir a Hábitos</Link>
            </Button>
          }
        />
      </div>
    )
  }
  const { scope, habit, goal } = scopeHabits(model.all, filter, model.state.goals)
  const summary = completion(scope, range, model.ctx)
  const daily = dailyRates(scope, range, model.ctx)
  const perfectDays = daily.filter((d) => d.applicable > 0 && d.fulfilled === d.applicable).length
  const daysWithData = daily.filter((d) => d.applicable > 0).length
  const periodLabel = filter.period === 365 ? "el último año" : `los últimos ${filter.period} días`

  return (
    <div className="space-y-6">
      <FilterBar model={model} filter={filter} setFilter={setFilter} habit={habit} goalTitle={goal?.title ?? null} />

      {scope.length === 0 ? (
        <div className="panel rounded-2xl">
          {goal ? (
            <EmptyState icon={Gauge} title="Este objetivo no tiene hábitos vinculados" description="Vincula hábitos al objetivo para ver aquí su esfuerzo." />
          ) : (
            <EmptyState icon={Gauge} title="Sin hábitos en esta dimensión" description="Elige otra dimensión o vuelve a «Todas las dimensiones»." />
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label={METRICS.completion.label}
              value={pct(summary.rate)}
              detail={`${summary.fulfilled} de ${summary.applicable} oportunidades`}
              onOpen={() => setDrill({ title: `Cumplimiento en ${periodLabel}`, metric: "completion", target: { kind: "range", range } })}
            />
            <Stat label={METRICS.perfect_days.label} value={`${perfectDays}`} detail={`de ${daysWithData} días con hábitos programados`} />
            <Stat
              label={METRICS.exempt.label}
              value={`${summary.exempt}`}
              detail="oportunidades en días de descanso"
              onOpen={summary.exempt > 0 ? () => setDrill({ title: "Oportunidades exentas", metric: "exempt", target: { kind: "range", range }, only: ["exempt"] }) : undefined}
            />
            <Stat
              label={METRICS.in_progress.label}
              value={`${summary.inProgress}`}
              detail="fuera del denominador hasta cerrar la semana"
              onOpen={
                summary.inProgress > 0
                  ? () => setDrill({ title: "Objetivos semanales en curso", metric: "in_progress", target: { kind: "range", range }, only: ["in_progress"] })
                  : undefined
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <TrendPanel model={model} habits={scope} onDrill={setDrill} className="xl:col-span-3" />
            <WeekdayPanel model={model} habits={scope} range={range} onDrill={setDrill} className="xl:col-span-2" />
          </div>

          <Heatmap model={model} habits={scope} />
        </>
      )}

      <HabitTable model={model} range={range} selectedId={filter.habitId} onSelect={(id) => setFilter({ habitId: id })} />

      <section className="panel rounded-2xl p-5" aria-labelledby="how-title">
        <h2 id="how-title" className="text-base font-semibold">
          Cómo se calcula
        </h2>
        <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm leading-relaxed md:grid-cols-2">
          {Object.values(METRICS).map((m) => (
            <div key={m.id}>
              <dt className="font-medium text-foreground">{m.label}</dt>
              <dd className="text-text-secondary">{m.formula}</dd>
            </div>
          ))}
        </dl>
        <ul className="mt-4 grid gap-x-8 gap-y-2 border-t border-border/70 pt-4 text-sm leading-relaxed text-text-secondary md:grid-cols-2">
          {GENERAL_RULES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>

      <DrillSheet request={drill} habits={scope} ctx={model.ctx} onOpenChange={(o) => !o && setDrill(null)} />
    </div>
  )
}

function Stat({ label, value, detail, onOpen }: { label: string; value: string; detail: string; onOpen?: () => void }) {
  const body = (
    <>
      <p className="flex items-center justify-between text-xs font-medium text-text-secondary">
        {label}
        {onOpen && <ChevronRight className="size-3.5 text-text-tertiary" aria-hidden />}
      </p>
      <p className="num mt-3 text-[1.75rem] leading-none font-semibold">{value}</p>
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

function PanelHeader({
  title,
  subtitle,
  showTable,
  onToggle,
}: {
  title: string
  subtitle?: string
  showTable: boolean
  onToggle: () => void
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-text-tertiary">{subtitle}</p>}
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={showTable}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs text-text-secondary hover:bg-surface-raised hover:text-foreground"
      >
        {showTable ? <LineIcon className="size-3.5" aria-hidden /> : <Table2 className="size-3.5" aria-hidden />}
        {showTable ? "Gráfico" : "Tabla"}
      </button>
    </div>
  )
}

const axisTick = { fill: "var(--text-tertiary)", fontSize: 11 }

function ChartTooltip({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean
  payload?: { value: number | null; payload: Record<string, unknown> }[]
  label?: string | number
  format: (label: string | number | undefined, row: Record<string, unknown>) => string
}) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="text-text-secondary">{format(label, row)}</p>
      <p className="num mt-0.5 text-sm font-semibold text-foreground">
        {pct(payload[0].value)}
        <span className="ml-1.5 font-normal text-text-tertiary">
          {String(row.fulfilled ?? "")}
          {row.applicable !== undefined ? `/${row.applicable}` : ""}
        </span>
      </p>
    </div>
  )
}

/** Recharts reports the hovered/clicked category index; map it back to our row. */
function indexOf(state: { activeIndex?: number | string | null | undefined } | null | undefined): number | null {
  const i = Number(state?.activeIndex)
  return Number.isInteger(i) && i >= 0 ? i : null
}

function TrendPanel({ model, habits, onDrill, className }: { model: HabitsModel; habits: Habit[]; onDrill: (r: DrillRequest) => void; className?: string }) {
  const [table, setTable] = useState(false)
  const data = useMemo(
    () =>
      weeklySeries(habits, 12, model.ctx).map((w) => {
        const s = completion(habits, { from: w.weekStart, to: addDays(w.weekStart, 6) < model.today ? addDays(w.weekStart, 6) : model.today }, model.ctx)
        return {
          week: w.weekStart,
          label: formatDate(w.weekStart, { day: "numeric", month: "short" }),
          rate: w.rate === null ? null : Math.round(w.rate * 1000) / 10,
          fulfilled: s.fulfilled,
          applicable: s.applicable,
        }
      }),
    [habits, model]
  )
  const drillWeek = (i: number | null) => {
    const d = i === null ? undefined : data[i]
    if (d && d.rate !== null) onDrill({ title: `Semana del ${d.label}`, metric: "weekly_trend", target: { kind: "week", weekStart: d.week } })
  }
  return (
    <section className={cn("panel rounded-2xl p-4 sm:p-5", className)} aria-labelledby="trend-title">
      <PanelHeader title="Tendencia semanal" subtitle="Últimas 12 semanas · % de cumplimiento" showTable={table} onToggle={() => setTable(!table)} />
      <h2 id="trend-title" className="sr-only">
        Tendencia semanal
      </h2>
      {data.every((d) => d.rate === null) ? (
        <NoData />
      ) : table ? (
        <DataTable
          caption="Cumplimiento por semana"
          head={["Semana del", "Cumplimiento", "Cumplidas / aplicables"]}
          rows={data.map((d) => [d.label, d.rate === null ? "N/D" : `${Math.round(d.rate)}%`, `${d.fulfilled}/${d.applicable}`])}
          onRow={(i) => (data[i].rate === null ? undefined : () => drillWeek(i))}
        />
      ) : (
        <div className="h-56 cursor-pointer" role="img" aria-label={`Tendencia semanal: ${data.map((d) => `${d.label} ${d.rate === null ? "N/D" : Math.round(d.rate) + "%"}`).join(", ")}. Usa la vista de tabla para abrir el detalle de una semana.`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} onClick={(s) => drillWeek(indexOf(s))}>
              <defs>
                <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--signal)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="var(--signal)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
              <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={axisTick} tickLine={false} axisLine={false} unit="%" />
              <Tooltip
                cursor={{ stroke: "var(--text-tertiary)", strokeDasharray: "3 3" }}
                content={<ChartTooltip format={(l) => `Semana del ${l}`} />}
              />
              <Area
                type="monotone"
                dataKey="rate"
                stroke="var(--signal)"
                strokeWidth={2}
                fill="url(#trendFill)"
                connectNulls={false}
                dot={false}
                activeDot={{ r: 4, fill: "var(--signal)", stroke: "var(--surface)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  )
}

function WeekdayPanel({
  model,
  habits,
  range,
  onDrill,
  className,
}: {
  model: HabitsModel
  habits: Habit[]
  range: { from: LocalDate; to: LocalDate }
  onDrill: (r: DrillRequest) => void
  className?: string
}) {
  const [table, setTable] = useState(false)
  const data = weekdayConsistency(habits, range, model.ctx).map((r) => ({
    weekday: r.weekday,
    label: WEEKDAY_ABBR[r.weekday],
    rate: r.rate === null ? null : Math.round(r.rate * 1000) / 10,
    applicable: r.applicable,
  }))
  const drillDay = (i: number | null) => {
    const d = i === null ? undefined : data[i]
    if (d && d.rate !== null)
      onDrill({ title: `Los ${WEEKDAY_LONG[d.weekday as Weekday].toLowerCase()} del periodo`, metric: "weekday", target: { kind: "weekday", weekday: d.weekday as Weekday, range } })
  }
  return (
    <section className={cn("panel rounded-2xl p-4 sm:p-5", className)} aria-label="Constancia por día de la semana">
      <PanelHeader title="Por día de la semana" subtitle="% de cumplimiento en el periodo" showTable={table} onToggle={() => setTable(!table)} />
      {data.every((d) => d.rate === null) ? (
        <NoData />
      ) : table ? (
        <DataTable
          caption="Cumplimiento por día de la semana"
          head={["Día", "Cumplimiento", "Oportunidades"]}
          rows={data.map((d) => [d.label, d.rate === null ? "N/D" : `${Math.round(d.rate)}%`, String(d.applicable)])}
          onRow={(i) => (data[i].rate === null ? undefined : () => drillDay(i))}
        />
      ) : (
        <div className="h-56 cursor-pointer" role="img" aria-label={`Por día: ${data.map((d) => `${d.label} ${d.rate === null ? "N/D" : Math.round(d.rate) + "%"}`).join(", ")}. Usa la vista de tabla para abrir el detalle de un día.`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -18 }} barCategoryGap="28%" onClick={(s) => drillDay(indexOf(s))}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={axisTick} tickLine={false} axisLine={false} unit="%" />
              <Tooltip cursor={{ fill: "var(--surface-raised)", opacity: 0.5 }} content={<ChartTooltip format={(l) => String(l)} />} />
              <Bar dataKey="rate" fill="var(--signal)" fillOpacity={0.85} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  )
}

const HEAT_WEEKS = 17

/** Calendar heatmap: one hue (signal), opacity encodes rate; N/A and rest have distinct non-colour cues. */
function Heatmap({ model, habits }: { model: HabitsModel; habits: Habit[] }) {
  const end = addDays(startOfWeek(model.today), 6)
  const start = addDays(startOfWeek(model.today), -7 * (HEAT_WEEKS - 1))
  const rates = new Map(dailyRates(habits, { from: start, to: end }, model.ctx).map((d) => [d.date, d]))
  const weeks = Array.from({ length: HEAT_WEEKS }, (_, w) => addDays(start, w * 7))

  const level = (r: number) => (r >= 0.999 ? 1 : r >= 0.75 ? 0.72 : r >= 0.5 ? 0.48 : r > 0 ? 0.26 : 0)

  return (
    <section className="panel rounded-2xl p-4 sm:p-5" aria-labelledby="heat-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="heat-title" className="text-base font-semibold">
            Calendario
          </h2>
          <p className="mt-0.5 text-xs text-text-tertiary">Últimas {HEAT_WEEKS} semanas · cada celda es un día</p>
        </div>
        <div className="flex items-center gap-1.5 text-[0.6875rem] text-text-tertiary" aria-hidden>
          <span>0%</span>
          {[0.26, 0.48, 0.72, 1].map((o) => (
            <span key={o} className="size-3 rounded-[3px]" style={{ background: `color-mix(in oklab, var(--signal) ${o * 100}%, var(--surface-raised))` }} />
          ))}
          <span>100%</span>
          <span className="hatch ml-2 size-3 rounded-[3px] border border-border" />
          <span>descanso</span>
        </div>
      </div>
      <div
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: `1.25rem repeat(${HEAT_WEEKS}, minmax(0, 1.5rem))` }}
        role="grid"
        aria-label="Calendario de cumplimiento diario"
      >
        {[1, 2, 3, 4, 5, 6, 7].map((wd) => (
          <div key={wd} role="row" className="contents">
            <span className="self-center text-[0.625rem] text-text-tertiary" role="rowheader">
              {wd % 2 === 1 ? WEEKDAY_ABBR[wd as 1].charAt(0) : ""}
            </span>
            {weeks.map((ws) => {
              const date = addDays(ws, wd - 1)
              const d = rates.get(date)
              const rest = model.ctx.restDays.has(date)
              const future = date > model.today
              const text = future
                ? "futuro"
                : rest
                  ? "descanso"
                  : d && d.rate !== null
                    ? `${pct(d.rate)} (${d.fulfilled}/${d.applicable})`
                    : "sin hábitos programados"
              const label = `${formatDate(date, { weekday: "long", day: "numeric", month: "long" })}: ${text}`
              return (
                <span
                  key={date}
                  role="gridcell"
                  aria-label={label}
                  title={label}
                  className={cn(
                    "aspect-square rounded-[3px]",
                    rest && "hatch border border-border/70",
                    future && "opacity-0",
                    date === model.today && "ring-1 ring-foreground/60"
                  )}
                  style={
                    rest || future
                      ? undefined
                      : {
                          background:
                            d && d.rate !== null
                              ? `color-mix(in oklab, var(--signal) ${level(d.rate) * 100}%, var(--surface-raised))`
                              : "color-mix(in oklab, var(--surface-raised) 45%, transparent)",
                        }
                  }
                />
              )
            })}
          </div>
        ))}
      </div>
      <p className="sr-only">Usa la vista de tabla de la tendencia semanal para un resumen accesible por semanas.</p>
    </section>
  )
}

function HabitTable({
  model,
  range,
  selectedId,
  onSelect,
}: {
  model: HabitsModel
  range: { from: LocalDate; to: LocalDate }
  selectedId: string
  onSelect: (id: string) => void
}) {
  const rows = model.all
    .map((h) => ({ h, s: completion([h], range, model.ctx), streak: currentStreak(h, model.ctx) }))
    .filter((r) => r.s.applicable > 0 || r.s.inProgress > 0 || !r.h.archivedOn)
  return (
    <section className="panel overflow-hidden rounded-2xl" aria-labelledby="per-habit-title">
      <div className="px-4 pt-4 pb-3 sm:px-5">
        <h2 id="per-habit-title" className="text-base font-semibold">
          Por hábito
        </h2>
        <p className="mt-0.5 text-xs text-text-tertiary">Pulsa un hábito para filtrar toda la página.</p>
      </div>
      <ul className="divide-y divide-border/70 border-t border-border">
        {rows.map(({ h, s, streak }) => {
          const rule = h.schedule[h.schedule.length - 1].rule
          const active = selectedId === h.id
          return (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => onSelect(active ? "all" : h.id)}
                aria-pressed={active}
                className={cn(
                  "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-raised/50 sm:grid-cols-[auto_minmax(0,1fr)_120px_90px_80px] sm:px-5",
                  active && "bg-surface-raised/70"
                )}
              >
                <HabitIcon icon={h.icon} dimensionId={h.dimensionId} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {h.name}
                    {h.archivedOn && <span className="ml-2 text-xs font-normal text-text-tertiary">archivado</span>}
                  </span>
                  <span className="block truncate text-xs text-text-tertiary">{describeRule(rule)}</span>
                </span>
                <span className="hidden items-center gap-2 sm:flex" aria-hidden>
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-raised">
                    <span className="block h-full rounded-full bg-signal" style={{ width: `${(s.rate ?? 0) * 100}%` }} />
                  </span>
                </span>
                <span className="num text-right text-sm">
                  {pct(s.rate)}
                  <span className="block text-[0.6875rem] text-text-tertiary sm:hidden">
                    {s.fulfilled}/{s.applicable}
                  </span>
                </span>
                <span className="num hidden text-right text-xs text-text-tertiary sm:block">
                  {s.fulfilled}/{s.applicable}
                  <span className="block">
                    racha {streak.count}
                    {streak.unit === "week" ? " sem" : " d"}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Accessible data view; when `onRow` returns a handler the row's first cell becomes a ≥44 px button that opens the drilldown. */
function DataTable({
  caption,
  head,
  rows,
  onRow,
}: {
  caption: string
  head: string[]
  rows: string[][]
  onRow?: (index: number) => (() => void) | undefined
}) {
  return (
    <div className="max-h-56 overflow-y-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-border text-left text-xs text-text-tertiary">
            {head.map((h, i) => (
              <th key={h} scope="col" className={cn("py-2 font-medium", i > 0 && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, rowIndex) => {
            const open = onRow?.(rowIndex)
            return (
              <tr key={r[0]} className="border-b border-border/50 last:border-0">
                {r.map((c, i) => (
                  <td key={i} className={cn(open ? "py-0" : "py-1.5", i > 0 ? "num text-right text-text-secondary" : "")}>
                    {i === 0 && open ? (
                      <button type="button" onClick={open} className="flex min-h-11 w-full items-center gap-1 text-left font-medium text-foreground underline-offset-4 hover:underline">
                        {c}
                        <ChevronRight className="size-3.5 text-text-tertiary" aria-hidden />
                        <span className="sr-only">: ver detalle</span>
                      </button>
                    ) : (
                      c
                    )}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}


function NoData() {
  return (
    <div className="grid h-56 place-items-center rounded-xl border border-dashed border-border px-6 text-center">
      <div>
        <p className="text-sm font-medium">Sin datos en este periodo</p>
        <p className="mt-1 text-xs leading-relaxed text-text-tertiary">
          No hubo oportunidades programadas. Se muestra N/D en lugar de 0% para no falsear la tendencia.
        </p>
      </div>
    </div>
  )
}
