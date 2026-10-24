"use client"

import { Check, Flag } from "lucide-react"
import { DemoBadge, DemoNote } from "@/components/common/demo-note"
import { EmptyState } from "@/components/common/empty-state"
import { pct } from "@/components/common/format"
import { PageHeader } from "@/components/shell/page-header"
import { cn } from "@/lib/utils"
import { addDays, formatDate } from "@/features/habits/domain/dates"
import { completion } from "@/features/habits/domain/metrics"
import { HabitIcon } from "@/features/habits/components/habit-icon"
import { useHabitsModel } from "@/features/habits/components/use-habits-model"
import { GOALS } from "./fixtures"

/** GoalProgress: effort (habits, computed) and outcome (measurements) are shown separately (PRD §3.4). */
export function GoalsView() {
  const model = useHabitsModel()
  if (model?.source === "account") {
    return (
      <>
        <PageHeader title="Objetivos" description="Visión → objetivo → sistema → hábitos, con esfuerzo y resultado medidos por separado." />
        <div className="panel rounded-2xl">
          <EmptyState
            icon={Flag}
            title="Los objetivos de tu cuenta llegan en M3"
            description="Podrás definir métricas, valores de partida, metas y fechas, y vincular hábitos sin registros duplicados. Mientras tanto, la demo muestra cómo se verán."
          />
        </div>
      </>
    )
  }
  return (
    <>
      <PageHeader
        title="Objetivos"
        meta={<DemoBadge />}
        description="Visión → objetivo → sistema → hábitos. El esfuerzo y el resultado se miden por separado: cumplir hábitos no mueve el resultado automáticamente."
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {GOALS.map((g) => {
          const habits = model ? model.all.filter((h) => g.habitIds.includes(h.id)) : []
          const effort = model
            ? completion(habits, { from: addDays(model.today, -29), to: model.today }, model.ctx)
            : null
          return (
            <article key={g.id} className="panel flex flex-col rounded-2xl p-5" aria-labelledby={`${g.id}-t`}>
              <p className="flex items-center gap-1.5 text-xs text-text-tertiary">
                <Flag className="size-3.5" aria-hidden />
                {g.vision}
              </p>
              <h2 id={`${g.id}-t`} className="mt-2 text-lg leading-snug font-semibold text-balance">
                {g.title}
              </h2>
              <p className="mt-1 text-xs text-text-tertiary">
                Fecha límite: {formatDate(g.due, { day: "numeric", month: "long", year: "numeric" })}
              </p>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border p-3">
                  <p className="text-xs text-text-secondary">Resultado</p>
                  <p className="num mt-1.5 text-xl font-semibold">{pct(g.outcome)}</p>
                  <p className="num mt-0.5 text-[0.6875rem] text-text-tertiary">
                    {g.baseline} → {g.current} / {g.target}
                  </p>
                </div>
                <div className="rounded-xl border border-border p-3">
                  <p className="text-xs text-text-secondary">Esfuerzo 30 d</p>
                  <p className="num mt-1.5 text-xl font-semibold">{effort ? pct(effort.rate) : "…"}</p>
                  <p className="num mt-0.5 text-[0.6875rem] text-text-tertiary">
                    {effort ? `${effort.fulfilled}/${effort.applicable} hábitos` : ""}
                  </p>
                </div>
              </div>

              <ol className="mt-5 space-y-2" aria-label="Hitos">
                {g.checkpoints.map((c) => (
                  <li key={c.label} className="flex items-center gap-2.5 text-sm">
                    <span
                      className={cn(
                        "grid size-5 place-items-center rounded-full border",
                        c.done ? "border-transparent bg-signal text-signal-foreground" : "border-border"
                      )}
                      aria-hidden
                    >
                      {c.done && <Check className="size-3" strokeWidth={3} />}
                    </span>
                    <span className={cn(c.done ? "text-text-secondary" : "text-foreground")}>
                      {c.label}
                      <span className="sr-only">{c.done ? " (completado)" : " (pendiente)"}</span>
                    </span>
                  </li>
                ))}
              </ol>

              <div className="mt-auto pt-5">
                <p className="mb-2 text-xs text-text-tertiary">Sistema: hábitos vinculados</p>
                <div className="flex flex-wrap gap-1.5">
                  {habits.map((h) => (
                    <span key={h.id} className="flex items-center gap-1.5 rounded-full border border-border py-1 pr-2.5 pl-1 text-xs">
                      <HabitIcon icon={h.icon} dimensionId={h.dimensionId} size="sm" className="size-5 rounded-full" />
                      {h.name}
                    </span>
                  ))}
                </div>
              </div>
            </article>
          )
        })}
      </div>
      <DemoNote className="mt-6">
        El resultado procede de mediciones de ejemplo. El esfuerzo se calcula con tus registros locales de hábitos. Crear y editar
        objetivos llega en M3.
      </DemoNote>
    </>
  )
}
