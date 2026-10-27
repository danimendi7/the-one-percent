"use client"

import { useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { ChevronDown, Flag, Gauge, ListChecks, Plus, Target } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SourceBadge } from "@/components/common/demo-note"
import { EmptyState } from "@/components/common/empty-state"
import { PageHeader } from "@/components/shell/page-header"
import { Segmented } from "@/features/habits/components/habit-form-sheet"
import { goalsEnabled } from "@/features/habits/store/habit-store"
import type { GoalEvaluation } from "./domain/progress"
import { MAX_PRIMARY, type Goal, type Horizon } from "./domain/types"
import { GoalCard } from "./components/goal-card"
import { GoalFormSheet } from "./components/goal-form-sheet"
import { HORIZON_HINT, useGoalsModel } from "./components/goal-ui"
import { MeasureSheet } from "./components/measure-sheet"

type HorizonFilter = Horizon | "all"
const HORIZONS: HorizonFilter[] = ["all", "short", "medium", "long"]

/** ?plazo= in the URL, like the Analytics filters: survives a reload and the back button. */
function useHorizonFilter(): [HorizonFilter, (h: HorizonFilter) => void] {
  const params = useSearchParams()
  const pathname = usePathname()
  const raw = params.get("plazo")
  const value = (HORIZONS as string[]).includes(raw ?? "") ? (raw as HorizonFilter) : "all"
  return [value, (h) => window.history.replaceState(null, "", h === "all" ? pathname : `${pathname}?plazo=${h}`)]
}

export function GoalsView() {
  const gm = useGoalsModel()
  const [horizon, setHorizon] = useHorizonFilter()
  const [formOpen, setFormOpen] = useState(false)
  const [measureId, setMeasureId] = useState<string | null>(null)
  const enabled = gm ? goalsEnabled() : false

  return (
    <>
      <PageHeader
        title="Objetivos"
        meta={<SourceBadge source={gm?.model.source}>Demo · objetivos y mediciones de ejemplo</SourceBadge>}
        description="Resultado y esfuerzo por separado, calculados con tus registros reales."
        actions={
          enabled && gm && gm.goals.length > 0 ? (
            <Button onClick={() => setFormOpen(true)}>
              <Plus />
              Nuevo objetivo
            </Button>
          ) : null
        }
      />

      {!gm ? (
        <GoalsSkeleton />
      ) : !enabled ? (
        <div className="panel rounded-2xl">
          <EmptyState
            icon={Flag}
            title="Los objetivos de tu cuenta se activan con la sincronización"
            description="Ya funcionan en la demo. En tu cuenta llegarán cuando se sincronicen entre dispositivos, sin datos de ejemplo."
          />
        </div>
      ) : gm.goals.length === 0 ? (
        <FirstGoal onCreate={() => setFormOpen(true)} />
      ) : (
        <GoalList gm={gm} horizon={horizon} setHorizon={setHorizon} onMeasure={setMeasureId} />
      )}

      {gm && enabled && (
        <>
          <GoalFormSheet open={formOpen} onOpenChange={setFormOpen} />
          <MeasureSheet
            goal={gm.goals.find((g) => g.id === measureId) ?? null}
            today={gm.model.today}
            measurements={gm.model.state.measurements}
            onOpenChange={(o) => !o && setMeasureId(null)}
          />
        </>
      )}
    </>
  )
}

export function GoalsSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Cargando objetivos">
      <div className="panel h-12 animate-pulse rounded-2xl" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="panel h-52 animate-pulse rounded-2xl" />
        ))}
      </div>
    </div>
  )
}

function FirstGoal({ onCreate }: { onCreate: () => void }) {
  const kinds = [
    { icon: Gauge, title: "Numérico", text: "Una cifra que mover: peso, tiempo, km del año. Puede alimentarse de un hábito." },
    { icon: ListChecks, title: "Por hitos", text: "Un proyecto dividido en pasos que marcas al cumplirlos." },
    { icon: Target, title: "Por hábitos", text: "Sostener un sistema: cumplir tus hábitos por encima de un umbral." },
  ]
  return (
    <div className="panel rounded-2xl">
      <EmptyState
        icon={Flag}
        title="Define tu primer objetivo"
        description="Elige qué quieres conseguir y cómo se mide. El progreso se calcula solo a partir de tus registros: nada que teclear dos veces."
        action={
          <Button onClick={onCreate}>
            <Plus />
            Crear objetivo
          </Button>
        }
      />
      <ul className="grid gap-px border-t border-border sm:grid-cols-3">
        {kinds.map((k) => (
          <li key={k.title} className="flex gap-3 px-5 py-4">
            <k.icon className="mt-0.5 size-4 shrink-0 text-text-tertiary" aria-hidden />
            <div>
              <p className="text-sm font-medium">{k.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">{k.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function byDue(a: GoalEvaluation, b: GoalEvaluation) {
  return a.goal.dueDate < b.goal.dueDate ? -1 : a.goal.dueDate > b.goal.dueDate ? 1 : 0
}

function GoalList({
  gm,
  horizon,
  setHorizon,
  onMeasure,
}: {
  gm: NonNullable<ReturnType<typeof useGoalsModel>>
  horizon: HorizonFilter
  setHorizon: (h: HorizonFilter) => void
  onMeasure: (id: string) => void
}) {
  const all = gm.goals.map((g) => gm.evals.get(g.id)!).filter(Boolean)
  const open = (g: Goal) => g.state === "active" && !g.archivedOn
  const inScope = all.filter((e) => open(e.goal) && (horizon === "all" || e.horizon === horizon)).sort(byDue)
  const primary = inScope.filter((e) => e.goal.priority === "primary")
  const secondary = inScope.filter((e) => e.goal.priority === "secondary")
  const closed = all.filter((e) => !open(e.goal)).sort(byDue)
  const totalPrimary = all.filter((e) => open(e.goal) && e.goal.priority === "primary").length
  const today = gm.model.today

  return (
    <div className="space-y-7">
      <Segmented
        label="Plazo"
        value={horizon}
        onChange={(v) => setHorizon(v as HorizonFilter)}
        options={[
          { value: "all", label: "Todos" },
          { value: "short", label: "Corto" },
          { value: "medium", label: "Medio" },
          { value: "long", label: "Largo" },
        ]}
        className="w-full sm:w-96"
      />

      {inScope.length === 0 && (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-secondary">
          No hay objetivos activos a {horizon === "short" ? "corto" : horizon === "medium" ? "medio" : "largo"} plazo ({horizon !== "all" && HORIZON_HINT[horizon]}).
        </p>
      )}

      {primary.length > 0 && (
        <Section title="Principales" hint={totalPrimary > MAX_PRIMARY ? `Tienes ${totalPrimary}: el Resumen muestra los ${MAX_PRIMARY} más próximos.` : "Los que ves en el Resumen."}>
          {primary.map((e) => (
            <GoalCard key={e.goal.id} e={e} today={today} onMeasure={onMeasure} />
          ))}
        </Section>
      )}
      {secondary.length > 0 && (
        <Section title="Secundarios" hint="Siguen midiéndose, sin ocupar el Resumen.">
          {secondary.map((e) => (
            <GoalCard key={e.goal.id} e={e} today={today} onMeasure={onMeasure} />
          ))}
        </Section>
      )}

      {closed.length > 0 && (
        <details className="group panel rounded-2xl">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between rounded-2xl px-4 text-sm font-medium sm:px-5 [&::-webkit-details-marker]:hidden">
            Cerrados y archivados ({closed.length})
            <ChevronDown className="size-4 text-text-tertiary transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="grid grid-cols-1 gap-3 border-t border-border p-3 md:grid-cols-2 xl:grid-cols-3">
            {closed.map((e) => (
              <GoalCard key={e.goal.id} e={e} today={today} compact />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-right text-xs text-text-tertiary">{hint}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  )
}
