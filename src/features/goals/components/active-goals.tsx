"use client"

import Link from "next/link"
import { ChevronRight, Flag, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/common/empty-state"
import { pct } from "@/components/common/format"
import { goalsEnabled } from "@/features/habits/store/habit-store"
import { MAX_PRIMARY } from "../domain/types"
import { EffortBar, OutcomeBar, StatusChip, useGoalsModel } from "./goal-ui"

/** Overview widget: only active PRIMARY goals, the 3 nearest due, so the dashboard stays clean. */
export function ActiveGoals() {
  const gm = useGoalsModel()
  if (!gm) return <div className="panel h-48 animate-pulse rounded-2xl" />
  if (!goalsEnabled()) {
    return (
      <div className="panel rounded-2xl">
        <EmptyState icon={Flag} title="Objetivos en camino" description="Se activarán en tu cuenta con la sincronización, sin datos de ejemplo." className="py-8" />
      </div>
    )
  }
  const primary = gm.goals
    .filter((g) => g.priority === "primary" && g.state === "active" && !g.archivedOn)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
  if (primary.length === 0) {
    return (
      <div className="panel rounded-2xl">
        <EmptyState
          icon={Flag}
          title={gm.goals.length ? "Sin objetivos principales" : "Aún no hay objetivos"}
          description={gm.goals.length ? "Marca hasta 3 objetivos como principales para verlos aquí." : "Define qué quieres conseguir y vincúlalo a tus hábitos."}
          className="py-8"
          action={
            <Button asChild variant="outline">
              <Link href="/goals">
                <Plus />
                {gm.goals.length ? "Ver objetivos" : "Crear objetivo"}
              </Link>
            </Button>
          }
        />
      </div>
    )
  }
  return (
    <ul className="panel divide-y divide-border/70 rounded-2xl">
      {primary.slice(0, MAX_PRIMARY).map((g) => {
        const e = gm.evals.get(g.id)!
        return (
          <li key={g.id}>
            <Link href={`/goals/${g.id}`} className="block px-4 py-3.5 transition-colors hover:bg-surface-raised/40">
              <div className="flex items-center gap-3">
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{g.title}</p>
                <span className="num shrink-0 text-sm font-semibold">{pct(e.outcome.progress)}</span>
                <ChevronRight className="size-4 shrink-0 text-text-tertiary" aria-hidden />
              </div>
              <OutcomeBar value={e.outcome.progress} ideal={g.kind === "habits" ? null : e.timeShare} label={`Resultado ${pct(e.outcome.progress)}`} className="mt-2.5 h-1.5" />
              <div className="mt-2 flex items-center gap-2">
                <StatusChip evaluation={e} />
                {e.effort && g.kind !== "habits" && (
                  <span className="flex min-w-0 flex-1 items-center gap-2 text-xs text-text-tertiary">
                    <span className="shrink-0">Esfuerzo {pct(e.effort.rate)}</span>
                    <EffortBar value={e.effort.rate} label={`Esfuerzo ${pct(e.effort.rate)}`} className="flex-1" />
                  </span>
                )}
              </div>
            </Link>
          </li>
        )
      })}
      {primary.length > MAX_PRIMARY && (
        <li className="px-4 py-2.5 text-xs text-text-tertiary">
          {primary.length - MAX_PRIMARY} principales más en <Link href="/goals" className="underline underline-offset-4">Objetivos</Link>
        </li>
      )}
    </ul>
  )
}
