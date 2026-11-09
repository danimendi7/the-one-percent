"use client"

import { pct } from "@/components/common/format"
import type { LocalDate } from "@/features/habits/domain/dates"
import type { EvalContext } from "@/features/habits/domain/metrics"
import type { HabitsState } from "@/features/habits/domain/types"
import { projectCompletion, projectFocus, type Projection } from "./domain/projections"

function Item({ title, projection: p, fmt }: { title: string; projection: Projection; fmt: (v: number) => string }) {
  return (
    <div data-testid="projection">
      <h3 className="text-sm font-medium">{title}</h3>
      {p.status === "shown" ? (
        <>
          <p className="mt-1 text-sm text-text-secondary">
            Si sigue como hasta ahora, rondaría <span className="num text-foreground">{fmt(p.value)}</span> (entre <span className="num">{fmt(p.low)}</span> y <span className="num">{fmt(p.high)}</span>).
          </p>
          <p className="mt-1 text-xs text-text-tertiary">Basado en {p.weeks} semanas cerradas.</p>
        </>
      ) : (
        <p className="mt-1 text-sm text-text-secondary">{p.reason}</p>
      )}
    </div>
  )
}

/** Next week if the last ones simply went on (Plan Maestro §5.3, «Predictivo»). */
export function ForecastPanel({ state, ctx, today }: { state: HabitsState; ctx: EvalContext; today: LocalDate }) {
  const completion = projectCompletion(state, ctx)
  const focus = projectFocus(state, today)
  const limitations = completion.status === "shown" ? completion.limitations : focus.status === "shown" ? focus.limitations : null
  return (
    <section className="panel rounded-2xl p-4 sm:p-5" aria-labelledby="forecast-title" data-testid="forecast">
      <h2 id="forecast-title" className="mb-3 text-base font-semibold">
        La próxima semana
      </h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Item title="Cumplimiento de hábitos" projection={completion} fmt={(v) => pct(v)} />
        <Item title="Minutos de enfoque" projection={focus} fmt={(v) => `${Math.round(v)} min`} />
      </div>
      {limitations && <ul className="mt-3 space-y-0.5 border-t border-border/70 pt-3 text-xs leading-relaxed text-text-tertiary">{limitations.map((l) => <li key={l}>{l}</li>)}</ul>}
    </section>
  )
}
