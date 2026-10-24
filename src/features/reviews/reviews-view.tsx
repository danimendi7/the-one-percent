"use client"

import { useId, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DemoBadge } from "@/components/common/demo-note"
import { pct } from "@/components/common/format"
import { PageHeader } from "@/components/shell/page-header"
import { addDays, formatDate, startOfWeek } from "@/features/habits/domain/dates"
import { completion } from "@/features/habits/domain/metrics"
import { Segmented } from "@/features/habits/components/habit-form-sheet"
import { HabitIcon } from "@/features/habits/components/habit-icon"
import { useHabitsModel, type HabitsModel } from "@/features/habits/components/use-habits-model"

/** Weekly review: factual aggregates first, decisions second. No AI needed (PRD §3.7). */
export function ReviewsView() {
  const model = useHabitsModel()
  return (
    <>
      <PageHeader
        title="Revisión semanal"
        meta={<DemoBadge>Demo · cifras reales de tus registros locales</DemoBadge>}
        description="Cifras calculadas sin IA, decisiones tuyas: mantener, cambiar o quitar."
      />
      {model ? <Review model={model} /> : <div className="panel h-96 animate-pulse rounded-2xl" />}
    </>
  )
}

type Decision = "keep" | "change" | "drop"

function Review({ model }: { model: HabitsModel }) {
  const reflId = useId()
  const ws = addDays(startOfWeek(model.today), -7)
  const we = addDays(ws, 6)
  const range = { from: ws, to: we }
  const total = completion(model.all, range, model.ctx)
  const prev = completion(model.all, { from: addDays(ws, -7), to: addDays(ws, -1) }, model.ctx)
  const rows = model.active
    .map((h) => ({ h, s: completion([h], range, model.ctx) }))
    .filter((r) => r.s.applicable > 0)
    .sort((a, b) => (b.s.rate ?? -1) - (a.s.rate ?? -1))
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const delta = total.rate !== null && prev.rate !== null ? Math.round((total.rate - prev.rate) * 100) : null

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="panel rounded-2xl" aria-labelledby="rev-habits">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border p-5">
          <div>
            <p className="text-xs text-text-tertiary">
              Semana del {formatDate(ws, { day: "numeric", month: "long" })} al {formatDate(we, { day: "numeric", month: "long" })}
            </p>
            <h2 id="rev-habits" className="mt-1 text-base font-semibold">
              Hábitos
            </h2>
          </div>
          <div className="text-right">
            <p className="num text-2xl font-semibold">{pct(total.rate)}</p>
            <p className="num text-xs text-text-tertiary">
              {total.fulfilled}/{total.applicable}
              {delta !== null && ` · ${delta >= 0 ? "+" : ""}${delta} pts vs semana anterior`}
            </p>
          </div>
        </div>
        <ul className="divide-y divide-border/70">
          {rows.map(({ h, s }) => (
            <li key={h.id} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <HabitIcon icon={h.icon} dimensionId={h.dimensionId} size="sm" />
                <span className="flex-1 truncate text-sm font-medium">{h.name}</span>
                <span className="num text-sm text-text-secondary">
                  {pct(s.rate)} <span className="text-xs text-text-tertiary">{s.fulfilled}/{s.applicable}</span>
                </span>
              </div>
              <Segmented
                label={`Decisión para ${h.name}`}
                value={decisions[h.id] ?? "keep"}
                onChange={(v) => setDecisions({ ...decisions, [h.id]: v as Decision })}
                options={[
                  { value: "keep", label: "Mantener" },
                  { value: "change", label: "Cambiar" },
                  { value: "drop", label: "Quitar" },
                ]}
                className="sm:w-64"
              />
            </li>
          ))}
        </ul>
      </section>

      <form
        className="panel space-y-4 rounded-2xl p-5"
        onSubmit={(e) => {
          e.preventDefault()
          toast("Revisión no guardada", { description: "Demo: el guardado de revisiones llega en M6." })
        }}
      >
        <div className="space-y-2">
          <Label htmlFor={reflId}>Reflexión</Label>
          <Textarea id={reflId} rows={6} placeholder="¿Qué funcionó? ¿Qué te frenó? ¿Qué cambias la semana que viene?" />
        </div>
        <Button type="submit" className="w-full">
          Cerrar revisión
        </Button>
        <p className="text-xs leading-relaxed text-text-tertiary">
          La ampliación con IA será opcional y nunca leerá tus check-ins ni notas privadas sin permiso explícito.
        </p>
      </form>
    </div>
  )
}
