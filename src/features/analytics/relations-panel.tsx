"use client"

import { formatDate, type LocalDate } from "@/features/habits/domain/dates"
import type { DateRange } from "@/features/habits/domain/metrics"
import type { HabitsState } from "@/features/habits/domain/types"
import { RELATION_RULES } from "./domain/catalog"
import { RELATION_MIN_DAYS, RELATION_VARIABLES, relations, type Relation, type RelationStrength } from "./domain/relations"

const STRENGTH_LABEL: Record<RelationStrength, string> = {
  unclear: "Sin patrón claro",
  weak: "Coincidencia débil",
  moderate: "Coincidencia moderada",
  strong: "Coincidencia fuerte",
}

/** Spanish decimals, one sign: «+0,62», «−0,31». */
const coefficient = (rho: number) => `${rho >= 0 ? "+" : "−"}${Math.abs(rho).toFixed(2).replace(".", ",")}`

function RelationRow({ relation: r, periodText }: { relation: Relation; periodText: string }) {
  return (
    <li className="space-y-1.5 border-t border-border/70 py-3 first:border-t-0 first:pt-0 last:pb-0" data-testid="relation-row">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-medium">
          {RELATION_VARIABLES[r.a].label} y {RELATION_VARIABLES[r.b].label.toLowerCase()}
        </h3>
        {r.strength && r.rho !== null && (
          <span className="text-xs text-text-tertiary">
            {STRENGTH_LABEL[r.strength]} · <span className="num">{coefficient(r.rho)}</span>
          </span>
        )}
      </div>
      <p className="text-sm leading-relaxed text-text-secondary">{r.sentence}</p>
      <p className="text-xs text-text-tertiary">
        {periodText} · <span className="num">{r.n}</span> {r.n === 1 ? "día" : "días"} con ambos datos
      </p>
      <ul className="space-y-0.5 text-xs leading-relaxed text-text-tertiary">
        {r.limitations.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </li>
  )
}

/**
 * «Relaciones» in Life Analytics (Plan Maestro §5.3, «Diagnóstico»): what coincides across habits,
 * sleep, energy, mood, stress and focus. Period only; the habit filters do not apply.
 */
export function RelationsPanel({ state, today, range }: { state: HabitsState; today: LocalDate; range: DateRange }) {
  const all = relations(state, range, today)
  const clear = all.filter((r) => r.strength !== null && r.strength !== "unclear")
  const rest = all.filter((r) => r.strength === null || r.strength === "unclear")
  const day: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }
  const periodText = `${formatDate(range.from, day)} – ${formatDate(range.to, day)}`

  return (
    <section className="panel rounded-2xl p-4 sm:p-5" aria-labelledby="relations-title" data-testid="relations">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="relations-title" className="text-base font-semibold">
          Relaciones
        </h2>
        <span className="rounded-full border border-border px-2 py-0.5 text-[0.6875rem] text-text-tertiary">Descriptivo, no causal</span>
      </div>

      {clear.length > 0 ? (
        <ul>
          {clear.map((r) => (
            <RelationRow key={`${r.a}-${r.b}`} relation={r} periodText={periodText} />
          ))}
        </ul>
      ) : (
        <p className="text-sm leading-relaxed text-text-secondary" role="note" data-testid="relations-empty">
          Todavía no aparece ninguna relación clara en este periodo. Cada cruce necesita al menos {RELATION_MIN_DAYS} días con los dos datos.
        </p>
      )}

      {rest.length > 0 && (
        <details className="group mt-3 border-t border-border/70 pt-1">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-text-secondary hover:text-foreground">
            {rest.length === 1 ? "Ver el otro cruce" : `Ver los otros ${rest.length} cruces`}
          </summary>
          <ul className="pt-2">
            {rest.map((r) => (
              <RelationRow key={`${r.a}-${r.b}`} relation={r} periodText={periodText} />
            ))}
          </ul>
        </details>
      )}

      <ul className="mt-3 space-y-1 border-t border-border/70 pt-3 text-xs leading-relaxed text-text-tertiary">
        {RELATION_RULES.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
    </section>
  )
}
