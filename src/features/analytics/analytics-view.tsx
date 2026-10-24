"use client"

import { useMemo, useState } from "react"
import { Table2, LineChart as LineIcon } from "lucide-react"
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
import { DemoBadge } from "@/components/common/demo-note"
import { pct } from "@/components/common/format"
import { PageHeader } from "@/components/shell/page-header"
import { cn } from "@/lib/utils"
import {
  addDays,
  formatDate,

  startOfWeek,
  WEEKDAY_ABBR,
  type LocalDate,
} from "@/features/habits/domain/dates"
import {
  completion,
  currentStreak,
  dailyRates,
  weekdayConsistency,
  weeklySeries,
} from "@/features/habits/domain/metrics"
import type { Habit } from "@/features/habits/domain/types"
import { Segmented } from "@/features/habits/components/habit-form-sheet"
import { HabitIcon } from "@/features/habits/components/habit-icon"
import { describeRule } from "@/features/habits/components/today-checklist"
import { useHabitsModel, type HabitsModel } from "@/features/habits/components/use-habits-model"

type Period = "7" | "30" | "90"

export function AnalyticsView() {
  const model = useHabitsModel()
  const [period, setPeriod] = useState<Period>("30")
  const [habitId, setHabitId] = useState<string | "all">("all")

  return (
    <>
      <PageHeader
        title="Analítica"
        meta={<DemoBadge>Demo · calculado de tus registros locales</DemoBadge>}
        description="Estadística descriptiva calculada a partir de los registros. Sin puntuaciones opacas: cada cifra indica su base."
        actions={
          <Segmented
            label="Periodo"
            value={period}
            onChange={(v) => setPeriod(v as Period)}
            options={[
              { value: "7", label: "7 días" },
              { value: "30", label: "30 días" },
              { value: "90", label: "90 días" },
            ]}
            className="w-full md:w-72"
          />
        }
      />
      {!model ? (
        <div className="grid gap-4" aria-busy="true" aria-label="Cargando analítica">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="panel h-28 animate-pulse rounded-2xl" />
            ))}
          </div>
          <div className="panel h-80 animate-pulse rounded-2xl" />
        </div>
      ) : (
        <Content model={model} days={Number(period)} habitId={habitId} onHabit={setHabitId} />
      )}
    </>
  )
}

function Content({
  model,
  days,
  habitId,
  onHabit,
}: {
  model: HabitsModel
  days: number
  habitId: string
  onHabit: (id: string) => void
}) {
  const range = { from: addDays(model.today, -(days - 1)), to: model.today }
  const selected = habitId === "all" ? null : model.all.find((h) => h.id === habitId) ?? null
  const scope = selected ? [selected] : model.all

  const summary = completion(scope, range, model.ctx)
  const daily = dailyRates(scope, range, model.ctx)
  const perfectDays = daily.filter((d) => d.applicable > 0 && d.fulfilled === d.applicable).length
  const daysWithData = daily.filter((d) => d.applicable > 0).length

  return (
    <div className="space-y-6">
      {selected && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm">
          <HabitIcon icon={selected.icon} dimensionId={selected.dimensionId} size="sm" />
          <span className="flex-1">
            Filtrado por <strong className="font-semibold">{selected.name}</strong>
          </span>
          <button type="button" onClick={() => onHabit("all")} className="rounded-lg px-2 py-1 text-text-secondary hover:bg-surface-raised hover:text-foreground">
            Quitar filtro
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Cumplimiento" value={pct(summary.rate)} detail={`${summary.fulfilled} de ${summary.applicable} oportunidades`} />
        <Stat label="Días completos" value={`${perfectDays}`} detail={`de ${daysWithData} días con hábitos programados`} />
        <Stat label="Exentos" value={`${summary.exempt}`} detail="oportunidades en días de descanso" />
        <Stat
          label="Semanales en curso"
          value={`${summary.inProgress}`}
          detail="fuera del denominador hasta cerrar la semana"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <TrendPanel model={model} habits={scope} className="xl:col-span-3" />
        <WeekdayPanel model={model} habits={scope} range={range} className="xl:col-span-2" />
      </div>

      <Heatmap model={model} habits={scope} />

      <HabitTable model={model} range={range} selectedId={habitId} onSelect={onHabit} />

      <section className="panel rounded-2xl p-5" aria-labelledby="how-title">
        <h2 id="how-title" className="text-base font-semibold">
          Cómo se calcula
        </h2>
        <ul className="mt-3 grid gap-x-8 gap-y-2 text-sm leading-relaxed text-text-secondary md:grid-cols-2">
          <li>Cumplimiento = oportunidades cumplidas / oportunidades aplicables. Si no hay ninguna aplicable se muestra N/D, nunca 0% ni 100%.</li>
          <li>Solo cuentan los días programados según la versión de horario vigente ese día; cambiar un horario no recalcula el pasado.</li>
          <li>Los objetivos «N veces por semana» se evalúan por semana completa, no por día.</li>
          <li>Hoy cuenta como pendiente; los días de descanso y los días futuros no cuentan.</li>
          <li>Un hábito numérico solo se cumple con un valor registrado: la ausencia de dato nunca es éxito.</li>
          <li>Los hábitos archivados conservan su historial en estas cifras.</li>
        </ul>
      </section>
    </div>
  )
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="panel rounded-2xl p-4">
      <p className="text-xs font-medium text-text-secondary">{label}</p>
      <p className="num mt-3 text-[1.75rem] leading-none font-semibold">{value}</p>
      <p className="mt-2 text-xs leading-snug text-text-tertiary">{detail}</p>
    </div>
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

function TrendPanel({ model, habits, className }: { model: HabitsModel; habits: Habit[]; className?: string }) {
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
  return (
    <section className={cn("panel rounded-2xl p-4 sm:p-5", className)} aria-labelledby="trend-title">
      <PanelHeader title="Tendencia semanal" subtitle="Últimas 12 semanas · % de cumplimiento" showTable={table} onToggle={() => setTable(!table)} />
      <h2 id="trend-title" className="sr-only">
        Tendencia semanal
      </h2>
      {table ? (
        <DataTable
          caption="Cumplimiento por semana"
          head={["Semana del", "Cumplimiento", "Cumplidas / aplicables"]}
          rows={data.map((d) => [d.label, d.rate === null ? "N/D" : `${Math.round(d.rate)}%`, `${d.fulfilled}/${d.applicable}`])}
        />
      ) : (
        <div className="h-56" role="img" aria-label={`Tendencia semanal: ${data.map((d) => `${d.label} ${d.rate === null ? "N/D" : Math.round(d.rate) + "%"}`).join(", ")}`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
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
  className,
}: {
  model: HabitsModel
  habits: Habit[]
  range: { from: LocalDate; to: LocalDate }
  className?: string
}) {
  const [table, setTable] = useState(false)
  const data = weekdayConsistency(habits, range, model.ctx).map((r) => ({
    label: WEEKDAY_ABBR[r.weekday],
    rate: r.rate === null ? null : Math.round(r.rate * 1000) / 10,
    applicable: r.applicable,
  }))
  return (
    <section className={cn("panel rounded-2xl p-4 sm:p-5", className)} aria-label="Constancia por día de la semana">
      <PanelHeader title="Por día de la semana" subtitle="% de cumplimiento en el periodo" showTable={table} onToggle={() => setTable(!table)} />
      {table ? (
        <DataTable
          caption="Cumplimiento por día de la semana"
          head={["Día", "Cumplimiento", "Oportunidades"]}
          rows={data.map((d) => [d.label, d.rate === null ? "N/D" : `${Math.round(d.rate)}%`, String(d.applicable)])}
        />
      ) : (
        <div className="h-56" role="img" aria-label={`Por día: ${data.map((d) => `${d.label} ${d.rate === null ? "N/D" : Math.round(d.rate) + "%"}`).join(", ")}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -18 }} barCategoryGap="28%">
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

function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: string[][] }) {
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
          {rows.map((r) => (
            <tr key={r[0]} className="border-b border-border/50 last:border-0">
              {r.map((c, i) => (
                <td key={i} className={cn("py-1.5", i > 0 ? "num text-right text-text-secondary" : "")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

