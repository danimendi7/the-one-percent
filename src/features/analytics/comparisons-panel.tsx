"use client"

import { useState } from "react"
import { pct } from "@/components/common/format"
import { formatDate, type LocalDate } from "@/features/habits/domain/dates"
import { Segmented } from "@/features/habits/components/habit-form-sheet"
import type { HabitsState } from "@/features/habits/domain/types"
import { comparePeriods, type ComparisonMetric, type ComparisonRow, type ComparisonUnit } from "./domain/comparisons"

const UNITS = [
  { value: "week", label: "Semana" },
  { value: "month", label: "Mes" },
]

const decimal = (v: number) => v.toFixed(1).replace(".", ",")

function value(metric: ComparisonMetric, v: number | null): string {
  if (v === null) return "N/D"
  if (metric === "completion") return pct(v)
  if (metric === "focus") return `${Math.round(v)} min`
  return metric === "sleep" ? `${decimal(v)} h` : decimal(v)
}

function change(metric: ComparisonMetric, delta: number | null): string {
  if (delta === null) return "—"
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : ""
  const abs = Math.abs(delta)
  if (metric === "completion") return `${sign}${Math.round(abs * 100)} pts`
  if (metric === "focus") return `${sign}${Math.round(abs)} min`
  return `${sign}${decimal(abs)}${metric === "sleep" ? " h" : ""}`
}

function Row({ row }: { row: ComparisonRow }) {
  return (
    <tr className="border-t border-border/70 align-top" data-testid={`comparison-${row.metric}`}>
      <th scope="row" className="py-2 pr-2 text-left font-normal">
        {row.label}
        {row.reason && <span className="mt-0.5 block text-xs leading-snug text-text-tertiary">{row.reason}</span>}
      </th>
      <td className="num py-2 pl-2 text-right whitespace-nowrap text-text-secondary">{value(row.metric, row.before)}</td>
      <td className="num py-2 pl-2 text-right whitespace-nowrap">{value(row.metric, row.after)}</td>
      <td className="num py-2 pl-2 text-right whitespace-nowrap text-text-secondary">{change(row.metric, row.delta)}</td>
    </tr>
  )
}

/** The last closed week or month against the one before it (Plan Maestro §5.3). */
export function ComparisonsPanel({ state, today }: { state: HabitsState; today: LocalDate }) {
  const [unit, setUnit] = useState<ComparisonUnit>("week")
  const c = comparePeriods(state, unit, today)
  const date: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }
  const name = (p: { from: LocalDate; to: LocalDate }) => (unit === "week" ? `${formatDate(p.from, date)} – ${formatDate(p.to, date)}` : formatDate(p.from, { month: "long", year: "numeric" }))
  return (
    <section className="panel rounded-2xl p-4 sm:p-5" aria-labelledby="comparisons-title" data-testid="comparisons">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="comparisons-title" className="text-base font-semibold">
          Comparativas
        </h2>
        <Segmented label="Comparar por" value={unit} onChange={(v) => setUnit(v as ComparisonUnit)} options={UNITS} className="w-44" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Comparación entre el último periodo cerrado y el anterior</caption>
          <thead>
            <tr className="text-xs text-text-tertiary">
              <th scope="col" className="pb-2 text-left font-normal">
                Indicador
              </th>
              <th scope="col" className="pb-2 pl-2 text-right font-normal" data-testid="comparison-before">
                {name(c.before)}
              </th>
              <th scope="col" className="pb-2 pl-2 text-right font-normal" data-testid="comparison-after">
                {name(c.after)}
              </th>
              <th scope="col" className="pb-2 pl-2 text-right font-normal">
                Cambio
              </th>
            </tr>
          </thead>
          <tbody>
            {c.rows.map((r) => (
              <Row key={r.metric} row={r} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-text-tertiary">Solo se comparan periodos cerrados. Sin datos en alguno de los dos se muestra N/D, nunca 0. En estrés, un valor más alto significa más estrés.</p>
    </section>
  )
}
