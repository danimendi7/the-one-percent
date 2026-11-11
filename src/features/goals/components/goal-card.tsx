"use client"

import Link from "next/link"
import { Plus } from "lucide-react"
import { pct } from "@/components/common/format"
import { cn } from "@/lib/utils"
import { DIMENSION_COLOR } from "@/features/habits/components/habit-icon"
import type { LocalDate } from "@/features/habits/domain/dates"
import type { GoalEvaluation } from "../domain/progress"
import { goalStatusView } from "../domain/ops"
import { DataLevelNote, dueText, EffortBar, HORIZON_LABEL, OutcomeBar, outcomeLine, Sparkline, StatusChip } from "./goal-ui"

/**
 * One goal at a glance: outcome (thick bar, with the ideal-pace tick) and effort (thin bar)
 * kept apart, status with icon and text, and a one-tap "Registrar" for manual goals.
 * The whole card opens the goal (stretched link); the button sits above it.
 */
export function GoalCard({
  e,
  today,
  onMeasure,
  compact,
}: {
  e: GoalEvaluation
  today: LocalDate
  onMeasure?: (goalId: string) => void
  compact?: boolean
}) {
  const g = e.goal
  const manual = g.kind === "numeric" && g.numeric?.source === "manual" && g.state === "active"
  const ideal = g.kind === "habits" || g.state !== "active" ? null : e.timeShare
  const effortHabits = e.effort?.perHabit.length ?? 0
  const titleId = `goal-${g.id}-t`

  return (
    <article
      aria-labelledby={titleId}
      className="panel relative flex flex-col rounded-2xl p-4 transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-surface-raised/40 sm:p-5"
    >
      <div className="flex items-center gap-2 text-xs text-text-tertiary">
        {g.dimensionId && <span className="size-2 shrink-0 rounded-full" style={{ background: DIMENSION_COLOR[g.dimensionId] }} aria-hidden />}
        <span className="truncate">
          {HORIZON_LABEL[e.horizon]} · {dueText(g, today)}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {goalStatusView(g) === "review" && <span className="rounded-full border border-border px-2 py-0.5 whitespace-nowrap text-text-secondary">En revisión</span>}
          <StatusChip evaluation={e} />
        </span>
      </div>

      <h3 id={titleId} className="mt-2.5 text-base leading-snug font-semibold text-balance">
        <Link href={`/goals/${g.id}`} className="outline-none after:absolute after:inset-0 after:rounded-2xl">
          {g.title}
        </Link>
      </h3>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="num text-[1.75rem] leading-none font-semibold">{pct(e.outcome.progress)}</p>
          <p className="num mt-1.5 truncate text-xs text-text-secondary">{e.outcome.progress === null ? e.outcome.reason : outcomeLine(e)}</p>
        </div>
        {!compact && <Sparkline e={e} className="mb-1" />}
      </div>

      <OutcomeBar
        value={e.outcome.progress}
        ideal={ideal}
        className="mt-3"
        label={`Resultado ${pct(e.outcome.progress)}${ideal !== null ? `; ritmo ideal a hoy ${pct(ideal)}` : ""}`}
      />

      {g.kind !== "habits" && (
        <div className="mt-3.5">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-text-secondary">
              Esfuerzo{effortHabits ? ` · ${effortHabits} ${effortHabits === 1 ? "hábito" : "hábitos"}` : ""}
            </span>
            <span className="num text-text-secondary">{e.effort ? pct(e.effort.rate) : "—"}</span>
          </div>
          {e.effort ? (
            <EffortBar value={e.effort.rate} label={`Esfuerzo ${pct(e.effort.rate)}: ${e.effort.summary.fulfilled} de ${e.effort.summary.applicable} oportunidades`} />
          ) : (
            <p className="text-xs text-text-tertiary">Sin hábitos vinculados</p>
          )}
        </div>
      )}
      {g.kind === "habits" && (
        <p className="mt-3 text-xs text-text-secondary">
          Sistema · {effortHabits} {effortHabits === 1 ? "hábito" : "hábitos"} · {e.effort?.summary.fulfilled ?? 0} de {e.effort?.summary.applicable ?? 0} oportunidades
        </p>
      )}

      {(manual && onMeasure) || e.dataLevel !== "enough" ? (
        <div className={cn("mt-4 flex items-center gap-2", !(manual && onMeasure) && "mt-3")}>
          <DataLevelNote evaluation={e} />
          {manual && onMeasure && (
            <button
              type="button"
              onClick={() => onMeasure(g.id)}
              className="relative z-10 ml-auto inline-flex h-11 items-center gap-1.5 rounded-xl border border-border px-3.5 text-sm font-medium transition-colors hover:bg-surface-raised active:scale-[0.98]"
            >
              <Plus className="size-4" aria-hidden />
              Registrar
              <span className="sr-only"> medición de «{g.title}»</span>
            </button>
          )}
        </div>
      ) : null}
    </article>
  )
}
