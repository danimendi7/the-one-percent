"use client"

import { useState } from "react"
import { Activity, LineChart as LineIcon, Table2 } from "lucide-react"
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/common/empty-state"
import { cn } from "@/lib/utils"
import { addDays, formatDate, type LocalDate } from "@/features/habits/domain/dates"
import type { DateRange } from "@/features/habits/domain/metrics"
import type { HabitsState } from "@/features/habits/domain/types"
import { Segmented } from "@/features/habits/components/habit-form-sheet"
import { average, changeVsPrevious, mindDataLevel, rollingMean, series, type PhaseFilter } from "../domain/metrics"
import { checkinFor } from "../domain/ops"
import { INDICATOR_LABEL, INDICATORS, type Indicator } from "../domain/types"
import { INDICATOR_COLOR, sleepLabel } from "./mind-ui"

export const TREND_PERIODS = [7, 30, 90] as const
export type TrendPeriod = (typeof TREND_PERIODS)[number]

const axisTick = { fill: "var(--text-tertiary)", fontSize: 11 }

export function fmtValue(indicator: Indicator, v: number | null, digits = 1): string {
  if (v === null) return "N/D"
  if (indicator === "sleep") return sleepLabel(Math.round(v * 4) / 4)
  return v.toLocaleString("es-ES", { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

/** Indicators that are configured in some phase or have data in the period (hidden ones keep their history). */
export function indicatorsToShow(state: HabitsState, range: DateRange): Indicator[] {
  return INDICATORS.filter(
    (i) => state.checkinConfig.am.includes(i) || state.checkinConfig.pm.includes(i) || average(series(state, range, i, "both")).n > 0
  )
}

/**
 * Trends in /mind: small multiples, one indicator per chart and one axis each. Days without data
 * are gaps (never interpolated). Three data states (plan §2.2).
 */
export function MindTrends({
  state,
  today,
  period,
  onPeriod,
  onCheckin,
}: {
  state: HabitsState
  today: LocalDate
  period: TrendPeriod
  onPeriod: (p: TrendPeriod) => void
  onCheckin: () => void
}) {
  const [table, setTable] = useState(false)
  const range = { from: addDays(today, -(period - 1)), to: today }
  const level = mindDataLevel(state, range)
  const shown = indicatorsToShow(state, range)

  return (
    <section aria-labelledby="mind-trends-title" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h2 id="mind-trends-title" className="flex items-center gap-2 text-base font-semibold">
          Tendencias
          {level === "few" && <span className="rounded-full border border-border px-2 py-0.5 text-[0.6875rem] font-normal text-text-tertiary">Pocos datos</span>}
        </h2>
        <Segmented
          label="Periodo"
          value={String(period)}
          onChange={(v) => onPeriod(Number(v) as TrendPeriod)}
          options={TREND_PERIODS.map((p) => ({ value: String(p), label: `${p} días` }))}
          className="w-full sm:w-72"
        />
      </div>

      {level === "none" ? (
        <div className="panel rounded-2xl" data-testid="mind-state-none">
          <EmptyState
            icon={Activity}
            title="Aún no hay check-ins en este periodo"
            description="Tus medias y tendencias aparecerán aquí. Un check-in son tres toques: sueño, energía y ánimo."
            className="py-8"
            action={<Button onClick={onCheckin}>Hacer el check-in de ahora</Button>}
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid={`mind-state-${level}`}>
            {shown.map((i) => (
              <AverageCard key={i} state={state} range={range} indicator={i} level={level} />
            ))}
          </div>
          {level === "few" ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm leading-relaxed text-text-secondary" role="note">
              Pocos datos: con menos de 7 días con check-in la tendencia aún no es fiable. Se muestran las medias con su número de días.
            </p>
          ) : (
            <div className="panel rounded-2xl p-4 sm:p-5">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Día a día y media de 7 días</h3>
                  <p className="mt-0.5 text-xs text-text-tertiary">Los huecos son días sin dato. Las líneas verticales marcan días de descanso; el anillo, días con reflexión.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setTable(!table)}
                  aria-pressed={table}
                  className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs text-text-secondary hover:bg-surface-raised hover:text-foreground"
                >
                  {table ? <LineIcon className="size-3.5" aria-hidden /> : <Table2 className="size-3.5" aria-hidden />}
                  {table ? "Gráfico" : "Tabla"}
                </button>
              </div>
              {table ? (
                <TrendTable state={state} range={range} indicators={shown} />
              ) : (
                <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
                  {shown.map((i) => (
                    <SmallMultiple key={i} state={state} range={range} indicator={i} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}

export function AverageCard({ state, range, indicator, level, phase = "both" }: { state: HabitsState; range: DateRange; indicator: Indicator; level: "few" | "enough"; phase?: PhaseFilter }) {
  const avg = average(series(state, range, indicator, phase))
  const change = level === "enough" ? changeVsPrevious(state, range, indicator, phase) : null
  return (
    <div className="panel rounded-2xl p-4" data-testid={`mind-avg-${indicator}`}>
      <p className="flex items-center gap-2 text-xs font-medium text-text-secondary">
        <span className="size-2 rounded-full" style={{ background: INDICATOR_COLOR[indicator] }} aria-hidden />
        {INDICATOR_LABEL[indicator]}
      </p>
      <p className="num mt-3 text-[1.5rem] leading-none font-semibold">
        {fmtValue(indicator, avg.value)}
        {indicator !== "sleep" && avg.value !== null && <span className="ml-1 text-sm font-normal text-text-tertiary">/ 5</span>}
      </p>
      <p className="mt-2 text-xs leading-snug text-text-tertiary">
        media · n = {avg.n} {avg.n === 1 ? "día" : "días"}
        {change && (
          <span className="block">
            {change.delta === 0 ? "igual" : `${change.delta > 0 ? "+" : "−"}${fmtValue(indicator, Math.abs(change.delta))}`} vs. periodo anterior
          </span>
        )}
      </p>
    </div>
  )
}

function SmallMultiple({ state, range, indicator }: { state: HabitsState; range: DateRange; indicator: Indicator }) {
  const daily = series(state, range, indicator, "both")
  const rolling = rollingMean(daily)
  const rest = new Set(state.restDays)
  const data = daily.map((p, i) => ({
    date: p.date,
    label: formatDate(p.date, { day: "numeric", month: "short" }),
    value: p.value,
    avg: rolling[i].value,
    note: !!(checkinFor(state, p.date, "am")?.note || checkinFor(state, p.date, "pm")?.note),
  }))
  const scale = indicator !== "sleep"
  const color = INDICATOR_COLOR[indicator]
  const summary = data
    .filter((d) => d.value !== null)
    .map((d) => `${d.label} ${fmtValue(indicator, d.value)}`)
    .join(", ")
  return (
    <figure>
      <figcaption className="mb-1 flex items-center gap-2 text-xs font-medium text-text-secondary">
        <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />
        {INDICATOR_LABEL[indicator]}
        {indicator === "stress" && <span className="font-normal text-text-tertiary">· 5 = mucho</span>}
      </figcaption>
      <div className="h-36" role="img" aria-label={`${INDICATOR_LABEL[indicator]} por día: ${summary || "sin datos"}. Usa la vista de tabla para ver los valores.`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -22 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
            <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} domain={scale ? [1, 5] : [0, (max: number) => Math.max(10, Math.ceil(max))]} ticks={scale ? [1, 3, 5] : undefined} allowDecimals={false} />
            {data
              .filter((d) => rest.has(d.date))
              .map((d) => (
                <ReferenceLine key={d.date} x={d.label} stroke="var(--border)" strokeDasharray="3 3" />
              ))}
            <Tooltip
              cursor={{ stroke: "var(--border)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0].payload as (typeof data)[number]
                return (
                  <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
                    <p className="text-text-secondary">{formatDate(d.date, { weekday: "short", day: "numeric", month: "short" })}</p>
                    <p className="num mt-0.5 text-sm font-semibold text-foreground">{fmtValue(indicator, d.value)}</p>
                    {d.avg !== null && <p className="text-text-tertiary">Media 7 d: {fmtValue(indicator, d.avg)}</p>}
                    {rest.has(d.date) && <p className="text-text-tertiary">Día de descanso</p>}
                    {d.note && <p className="text-text-tertiary">Con reflexión</p>}
                  </div>
                )
              }}
            />
            <Line dataKey="avg" stroke={color} strokeOpacity={0.45} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
            <Line
              dataKey="value"
              stroke={color}
              strokeWidth={0}
              isAnimationActive={false}
              connectNulls={false}
              dot={(props: { cx?: number; cy?: number; payload?: (typeof data)[number]; index?: number }) => {
                const { cx, cy, payload, index } = props
                if (cx === undefined || cy === undefined || payload?.value === null || payload?.value === undefined) return <g key={index} />
                return (
                  <g key={index}>
                    {payload.note && <circle cx={cx} cy={cy} r={6} fill="none" stroke={color} strokeOpacity={0.6} strokeWidth={1.5} />}
                    <circle cx={cx} cy={cy} r={3} fill={color} stroke="var(--surface)" strokeWidth={1.5} />
                  </g>
                )
              }}
              activeDot={{ r: 5, fill: color, stroke: "var(--surface)", strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

function TrendTable({ state, range, indicators }: { state: HabitsState; range: DateRange; indicators: Indicator[] }) {
  const rows = series(state, range, "energy", "both")
    .map((p) => p.date)
    .reverse()
    .filter((d) => checkinFor(state, d, "am") || checkinFor(state, d, "pm"))
  return (
    <div className="max-h-72 overflow-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Valores diarios por indicador</caption>
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-border text-left text-xs text-text-tertiary">
            <th scope="col" className="py-2 font-medium">
              Día
            </th>
            {indicators.map((i) => (
              <th key={i} scope="col" className="py-2 text-right font-medium">
                {INDICATOR_LABEL[i]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d} className="border-b border-border/50">
              <th scope="row" className="py-2 text-left font-normal text-text-secondary">
                {formatDate(d, { weekday: "short", day: "numeric", month: "short" })}
              </th>
              {indicators.map((i) => {
                const v = series(state, { from: d, to: d }, i, "both")[0].value
                return (
                  <td key={i} className={cn("num py-2 text-right", v === null && "text-text-tertiary")}>
                    {v === null ? "—" : fmtValue(i, v, i === "sleep" ? 0 : 1)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
