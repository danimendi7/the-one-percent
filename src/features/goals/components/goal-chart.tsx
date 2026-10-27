"use client"

import { useState } from "react"
import { LineChart as LineIcon, Pencil, Table2 } from "lucide-react"
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts"
import { cn } from "@/lib/utils"
import { formatDate, type LocalDate } from "@/features/habits/domain/dates"
import { idealAt, MIN_POINTS, MIN_SPAN_DAYS, type GoalEvaluation } from "../domain/progress"
import { formatValue } from "./goal-ui"

const axisTick = { fill: "var(--text-tertiary)", fontSize: 11 }
const ts = (d: LocalDate) => Date.parse(`${d}T00:00:00Z`)
const short = (t: number) => formatDate(new Date(t).toISOString().slice(0, 10), { day: "numeric", month: "short" })

/**
 * The goal's own figure over time, on ONE axis: recorded values (dots + 2 px line), the ideal
 * straight line from baseline to target (dashed, neutral) and, only with enough history, the
 * projection to the due date (dotted). Table view lists the exact records; manual ones are editable.
 */
export function GoalChart({ e, onEdit }: { e: GoalEvaluation; onEdit?: (date: LocalDate) => void }) {
  const [table, setTable] = useState(false)
  const g = e.goal
  const unit = g.kind === "numeric" ? (g.numeric?.unit ?? "") : "hitos"
  const isMilestones = g.kind === "milestones"
  const target = isMilestones ? g.checkpoints.length : g.numeric?.target
  const baseline = isMilestones ? 0 : g.numeric?.baseline

  const lastPoint = e.series[e.series.length - 1]
  const projectionStart = lastPoint ? ts(lastPoint.date) : null
  const idealPoint = (d: LocalDate) => (isMilestones ? (target ?? 0) * Math.min(1, Math.max(0, (ts(d) - ts(g.startDate)) / Math.max(1, ts(g.dueDate) - ts(g.startDate)))) : idealAt(g, d))

  const points = [
    { t: ts(g.startDate), ideal: idealPoint(g.startDate) },
    ...e.series.map((p) => ({ t: ts(p.date), value: p.value, line: p.value })),
    { t: ts(g.dueDate), ideal: idealPoint(g.dueDate) },
  ]
  if (e.projection.value !== null && projectionStart !== null && lastPoint) {
    points.push({ t: projectionStart, projection: lastPoint.value } as never, { t: ts(g.dueDate), projection: e.projection.value } as never)
  }
  points.sort((a, b) => a.t - b.t)

  const values = [baseline, target, e.projection.value, ...e.series.map((p) => p.value)].filter((v): v is number => typeof v === "number")
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pad = (hi - lo) * 0.12 || 1

  const label =
    e.series.length === 0
      ? "Sin registros todavía."
      : `${e.series.length} registros. Último ${formatValue(lastPoint.value, unit)} el ${formatDate(lastPoint.date, { day: "numeric", month: "long" })}. Meta ${formatValue(target, unit)} el ${formatDate(g.dueDate, { day: "numeric", month: "long" })}.` +
        (e.projection.value !== null ? ` Proyección a la fecha límite: ${formatValue(e.projection.value, unit)}.` : "")

  return (
    <section className="panel rounded-2xl p-4 sm:p-5" aria-labelledby="goal-chart-title">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 id="goal-chart-title" className="text-base font-semibold">
            Evolución
          </h2>
          <p className="mt-0.5 text-xs text-text-tertiary">{isMilestones ? "Hitos cumplidos acumulados" : g.numeric?.aggregation === "sum" ? `Total acumulado (${unit})` : `Valor registrado (${unit})`}</p>
        </div>
        {e.series.length > 0 && (
          <button
            type="button"
            onClick={() => setTable(!table)}
            aria-pressed={table}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs text-text-secondary hover:bg-surface-raised hover:text-foreground"
          >
            {table ? <LineIcon className="size-3.5" aria-hidden /> : <Table2 className="size-3.5" aria-hidden />}
            {table ? "Gráfico" : "Tabla"}
          </button>
        )}
      </div>

      {e.series.length === 0 ? (
        <div className="grid h-40 place-items-center rounded-xl border border-dashed border-border px-6 text-center">
          <div>
            <p className="text-sm font-medium">Sin registros todavía</p>
            <p className="mt-1 text-xs leading-relaxed text-text-tertiary">
              {isMilestones
                ? "La línea aparece al cumplir el primer hito."
                : g.numeric?.source === "habit"
                  ? "Aparecerá con los registros del hábito vinculado."
                  : `Registra la primera medición. La tendencia necesita ${MIN_POINTS} en al menos ${MIN_SPAN_DAYS} días.`}
            </p>
          </div>
        </div>
      ) : table ? (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Registros del objetivo</caption>
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-border text-left text-xs text-text-tertiary">
                <th scope="col" className="py-2 font-medium">Fecha</th>
                <th scope="col" className="py-2 text-right font-medium">{isMilestones ? "Hitos" : g.numeric?.aggregation === "sum" ? "Total" : "Valor"}</th>
                {onEdit && <th scope="col" className="w-12 py-2"><span className="sr-only">Editar</span></th>}
              </tr>
            </thead>
            <tbody>
              {[...e.series].reverse().map((p) => (
                <tr key={p.date} className="border-b border-border/50 last:border-0">
                  <td className="py-2">{formatDate(p.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</td>
                  <td className="num py-2 text-right text-text-secondary">{formatValue(p.value, unit)}</td>
                  {onEdit && (
                    <td className="py-0 text-right">
                      <button type="button" onClick={() => onEdit(p.date)} className="inline-grid size-11 place-items-center rounded-lg text-text-tertiary hover:bg-surface-raised hover:text-foreground">
                        <Pencil className="size-4" aria-hidden />
                        <span className="sr-only">Editar la medición del {formatDate(p.date, { day: "numeric", month: "long" })}</span>
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="h-56" role="img" aria-label={label}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
                <XAxis dataKey="t" type="number" scale="time" domain={[ts(g.startDate), ts(g.dueDate)]} tickFormatter={short} tick={axisTick} tickLine={false} axisLine={false} minTickGap={28} />
                <YAxis domain={[lo - pad, hi + pad]} tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => formatValue(v)} />
                <Tooltip
                  cursor={{ stroke: "var(--text-tertiary)", strokeDasharray: "3 3" }}
                  content={({ active, payload }) => {
                    const row = payload?.[0]?.payload as { t: number; value?: number } | undefined
                    if (!active || !row || row.value === undefined) return null
                    return (
                      <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
                        <p className="text-text-secondary">{short(row.t)}</p>
                        <p className="num mt-0.5 text-sm font-semibold text-foreground">{formatValue(row.value, unit)}</p>
                      </div>
                    )
                  }}
                />
                <Line dataKey="ideal" stroke="var(--text-tertiary)" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
                <Line dataKey="projection" stroke="var(--signal)" strokeOpacity={0.7} strokeWidth={2} strokeDasharray="2 4" dot={false} connectNulls isAnimationActive={false} />
                <Line dataKey="line" stroke="var(--signal)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} type={isMilestones ? "stepAfter" : "linear"} />
                <Scatter dataKey="value" fill="var(--signal)" stroke="var(--surface)" strokeWidth={2} shape="circle" isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-text-secondary" aria-label="Leyenda">
            <li className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-signal" aria-hidden />
              Registrado
            </li>
            <li className="flex items-center gap-1.5">
              <span className="w-4 border-t-[1.5px] border-dashed border-text-tertiary" aria-hidden />
              Recta ideal
            </li>
            <li className={cn("flex items-center gap-1.5", e.projection.value === null && "text-text-tertiary")}>
              <span className="w-4 border-t-2 border-dotted border-signal/70" aria-hidden />
              {e.projection.value === null ? "Tendencia: N/D (pocos datos)" : "Tendencia"}
            </li>
          </ul>
        </>
      )}
    </section>
  )
}
