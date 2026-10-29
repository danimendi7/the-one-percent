"use client"

import { useMemo } from "react"
import { AlertTriangle, CheckCircle2, CircleDashed, CircleSlash, Clock, Gauge, TrendingUp, XCircle, type LucideIcon } from "lucide-react"
import { num, pct } from "@/components/common/format"
import { cn } from "@/lib/utils"
import { diffDays, formatDate, type LocalDate } from "@/features/habits/domain/dates"
import { useHabitsModel, type HabitsModel } from "@/features/habits/components/use-habits-model"
import { evaluateGoals, type GoalContext, type GoalEvaluation, type StatusBasis, type StatusId } from "../domain/progress"
import type { Goal, Horizon } from "../domain/types"

export interface GoalsModel {
  model: HabitsModel
  goals: Goal[]
  evals: Map<string, GoalEvaluation>
  gc: GoalContext
}

/** Every goal evaluated once per state change, with the same functions everywhere. */
export function useGoalsModel(): GoalsModel | null {
  const model = useHabitsModel()
  return useMemo(() => {
    if (!model) return null
    const gc: GoalContext = { habits: model.all, ctx: model.ctx, measurements: model.state.measurements }
    const goals = model.state.goals
    return { model, goals, evals: evaluateGoals(goals, gc), gc }
  }, [model])
}

export const HORIZON_LABEL: Record<Horizon, string> = { short: "Corto plazo", medium: "Medio plazo", long: "Largo plazo" }
export const HORIZON_HINT: Record<Horizon, string> = { short: "≤ 3 meses", medium: "≤ 12 meses", long: "> 12 meses" }

export const STATUS: Record<StatusId, { label: string; icon: LucideIcon; tone: string }> = {
  achieved: { label: "Conseguido", icon: CheckCircle2, tone: "text-signal border-signal/35 bg-signal/10" },
  ahead: { label: "Adelantado", icon: TrendingUp, tone: "text-signal border-signal/35 bg-signal/10" },
  on_track: { label: "En ritmo", icon: Gauge, tone: "text-signal border-signal/35 bg-signal/10" },
  behind: { label: "Por detrás", icon: AlertTriangle, tone: "text-warning border-warning/35 bg-warning/10" },
  overdue: { label: "Vencido", icon: XCircle, tone: "text-error border-error/35 bg-error/10" },
  no_data: { label: "Sin datos", icon: CircleDashed, tone: "text-text-secondary border-border bg-surface-raised/60" },
  not_started: { label: "Aún no empieza", icon: Clock, tone: "text-text-secondary border-border bg-surface-raised/60" },
  abandoned: { label: "Abandonado", icon: CircleSlash, tone: "text-text-secondary border-border bg-surface-raised/60" },
}

const BASIS: Record<Exclude<StatusBasis, null>, string> = {
  state: "marcado por ti",
  data: "los datos alcanzan la meta",
  dates: "según las fechas",
  projection: "según la tendencia real",
  ideal: "frente a la recta ideal (pocos datos para una tendencia)",
  threshold: "cumplimiento frente al umbral",
}

export function statusText(e: GoalEvaluation): string {
  const s = STATUS[e.status.id].label
  return e.status.basis ? `${s}: ${BASIS[e.status.basis]}` : s
}

/** Status is never colour alone: icon + text, with the basis available to screen readers and on demand. */
export function StatusChip({ evaluation, className, showBasis }: { evaluation: GoalEvaluation; className?: string; showBasis?: boolean }) {
  const s = STATUS[evaluation.status.id]
  const Icon = s.icon
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-[0.6875rem] font-medium", s.tone, className)}>
      <Icon className="size-3" aria-hidden />
      {s.label}
      {evaluation.status.basis && (showBasis ? <span className="font-normal opacity-80">· {BASIS[evaluation.status.basis]}</span> : <span className="sr-only">, {BASIS[evaluation.status.basis]}</span>)}
    </span>
  )
}

export function DataLevelNote({ evaluation }: { evaluation: GoalEvaluation }) {
  // Redundant next to a "Sin datos" status.
  if (evaluation.dataLevel === "enough" || evaluation.status.id === "no_data") return null
  return (
    <span className="inline-flex h-6 items-center rounded-full border border-dashed border-border px-2 text-[0.6875rem] text-text-tertiary">
      {evaluation.dataLevel === "empty" ? "Sin datos aún" : "Pocos datos"}
    </span>
  )
}

/**
 * Thick bar = outcome. The tick marks where a straight line from start to due date would be
 * today (time used), so "ahead/behind" is visible without colour.
 */
export function OutcomeBar({ value, ideal, label, className }: { value: number | null; ideal?: number | null; label: string; className?: string }) {
  return (
    <div className={cn("relative h-2 rounded-full bg-surface-raised", className)} role="img" aria-label={label}>
      {value !== null && <div className="h-full rounded-full bg-signal transition-[width] duration-300 ease-(--ease-out-quint)" style={{ width: `${Math.max(value * 100, value > 0 ? 3 : 0)}%` }} />}
      {ideal !== null && ideal !== undefined && ideal > 0 && ideal < 1 && (
        <span className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-foreground/70" style={{ left: `calc(${ideal * 100}% - 1px)` }} aria-hidden />
      )}
    </div>
  )
}

/** Thin neutral bar = effort (linked habits). Deliberately a different weight and tone from the outcome. */
export function EffortBar({ value, label, className }: { value: number | null; label: string; className?: string }) {
  return (
    <div className={cn("h-1 rounded-full bg-surface-raised", className)} role="img" aria-label={label}>
      {value !== null && <div className="h-full rounded-full bg-foreground/55" style={{ width: `${value * 100}%` }} />}
    </div>
  )
}

export function formatValue(value: number | null | undefined, unit?: string | null): string {
  if (value === null || value === undefined) return "N/D"
  const u = unit ? (unit === "%" ? unit : ` ${unit}`) : ""
  return `${num(Math.round(value * 10) / 10)}${u}`
}

/** A daily rate expressed in the most readable period. */
export function formatRate(perDay: number | null, unit: string): string {
  if (perDay === null) return "N/D"
  const v = Math.abs(perDay)
  if (v >= 1) return `${formatValue(v, unit)}/día`
  if (v * 7 >= 0.5) return `${formatValue(v * 7, unit)}/semana`
  return `${formatValue(v * 30, unit)}/mes`
}

export function outcomeLine(e: GoalEvaluation): string {
  const g = e.goal
  if (g.kind === "numeric" && g.numeric) {
    const n = g.numeric
    return `${formatValue(n.baseline, n.unit)} → ${formatValue(e.outcome.current, n.unit)} · meta ${formatValue(n.target, n.unit)}`
  }
  if (g.kind === "milestones") return `${e.outcome.current ?? 0} de ${g.checkpoints.length} hitos`
  return `${pct(e.outcome.current)} de cumplimiento · umbral ${pct(g.threshold ?? 0.85)}`
}

export function dueText(goal: Goal, today: LocalDate): string {
  const left = diffDays(today, goal.dueDate)
  const date = formatDate(goal.dueDate, { day: "numeric", month: "short", year: goal.dueDate.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric" })
  if (left < 0) return `Venció el ${date}`
  if (left === 0) return "Vence hoy"
  if (left <= 60) return `${left} ${left === 1 ? "día" : "días"} · ${date}`
  return date
}

/** Minimal line of the goal's own figure (no axes): orientation only, details live on the goal page. */
export function Sparkline({ e, className }: { e: GoalEvaluation; className?: string }) {
  const pts = e.series
  if (pts.length < 2) return null
  const w = 96
  const h = 28
  const t0 = Date.parse(e.goal.startDate)
  const t1 = Math.max(Date.parse(pts[pts.length - 1].date), t0 + 1)
  const vs = pts.map((p) => p.value)
  const lo = Math.min(...vs)
  const hi = Math.max(...vs)
  const x = (d: string) => ((Date.parse(d) - t0) / (t1 - t0)) * (w - 4) + 2
  const y = (v: number) => (hi === lo ? h / 2 : h - 3 - ((v - lo) / (hi - lo)) * (h - 6))
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join("")
  const last = pts[pts.length - 1]
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={cn("shrink-0 overflow-visible", className)} aria-hidden>
      <path d={path} fill="none" stroke="var(--text-secondary)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.date)} cy={y(last.value)} r={2.5} fill="var(--signal)" stroke="var(--surface)" strokeWidth={1.5} />
    </svg>
  )
}
