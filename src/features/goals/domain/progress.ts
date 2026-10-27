import { addDays, diffDays, minDate, type LocalDate } from "@/features/habits/domain/dates"
import { habitOpportunities, summarize, type CompletionSummary, type DateRange, type EvalContext } from "@/features/habits/domain/metrics"
import { entryKey, type Habit } from "@/features/habits/domain/types"
import {
  DEFAULT_THRESHOLD,
  type Checkpoint,
  type Goal,
  type Horizon,
  type MeasurementMap,
  type NumericSpec,
} from "./types"

/**
 * Goal evaluation. Everything is derived from real records, never stored:
 * - outcome: how far the goal's own figure has moved (measurements, a habit's values, milestones);
 * - effort: completion of the linked habits (the "system"), always shown apart from the outcome;
 * - pace, projection and status: descriptive, with the rule that produced them.
 * Not enough data → null (rendered N/A) together with the reason.
 */

export interface GoalContext {
  habits: Habit[]
  ctx: EvalContext
  measurements: MeasurementMap
}

/** Thresholds for "enough history" (also shown in the UI). */
export const MIN_POINTS = 3
export const MIN_SPAN_DAYS = 14
const AHEAD_MARGIN = 0.1
const BEHIND_MARGIN = 0.05
const RECENT_DAYS = 28

export type DataLevel = "empty" | "few" | "enough"
export type StatusId = "achieved" | "abandoned" | "not_started" | "overdue" | "no_data" | "ahead" | "on_track" | "behind"
/** What a status was derived from, so the UI can say it. */
export type StatusBasis = "state" | "data" | "dates" | "projection" | "ideal" | "threshold" | null

export interface SeriesPoint {
  date: LocalDate
  /** The goal's figure that day: the value (last) or the running total (sum, milestones). */
  value: number
}

export interface Effort {
  range: DateRange
  /** Unweighted counts: exactly the opportunities a drilldown lists. */
  summary: CompletionSummary
  /** Weighted completion: Σ weight·fulfilled / Σ weight·applicable. Null when nothing was applicable. */
  rate: number | null
  weighted: boolean
  perHabit: { habit: Habit; weight: number; summary: CompletionSummary }[]
  /** Same, last 28 days of the window (so a long goal still shows a recent slump). */
  recent: { range: DateRange; summary: CompletionSummary; rate: number | null }
}

export interface CheckpointStatus {
  checkpoint: Checkpoint
  doneOn: LocalDate | null
  /** Reached automatically from data (numeric milestone with a value). */
  auto: boolean
}

export interface GoalEvaluation {
  goal: Goal
  horizon: Horizon
  /** start … min(today, due). Null before the start date. */
  window: DateRange | null
  daysTotal: number
  daysElapsed: number
  /** Days after today up to the due date (0 on or after it). */
  daysLeft: number
  /** Linear share of the time already used, 0–1. */
  timeShare: number
  outcome: {
    /** 0–1, clamped. Null = N/A. */
    progress: number | null
    /** Unclamped, for status (may be < 0 or > 1). */
    raw: number | null
    /** Current figure in the goal's unit (numeric), the weighted rate (habits) or milestones done. */
    current: number | null
    reason: string | null
  }
  effort: Effort | null
  series: SeriesPoint[]
  checkpoints: CheckpointStatus[]
  pace: {
    /** Units per day still needed to finish on time. */
    required: number | null
    /** Units per day observed so far. */
    actual: number | null
    reason: string | null
  }
  projection: {
    /** Expected figure on the due date. */
    value: number | null
    progress: number | null
    /** Day the target would be reached at the current pace (within 5 years). */
    reachOn: LocalDate | null
    reason: string | null
  }
  status: { id: StatusId; basis: StatusBasis }
  dataLevel: DataLevel
}

// ── helpers ─────────────────────────────────────────────────────────────

export function horizonOf(goal: Pick<Goal, "dueDate" | "horizonOverride">, today: LocalDate): Horizon {
  if (goal.horizonOverride) return goal.horizonOverride
  const left = diffDays(today, goal.dueDate)
  return left <= 92 ? "short" : left <= 365 ? "medium" : "long"
}

/** Progress of a value between baseline and target, unclamped. Null when baseline = target. */
export function numericProgress(spec: Pick<NumericSpec, "baseline" | "target" | "direction" | "aggregation">, value: number): number | null {
  const span = spec.direction === "up" ? spec.target - spec.baseline : spec.baseline - spec.target
  if (span <= 0) return null
  const moved = spec.direction === "up" ? value - spec.baseline : spec.baseline - value
  return moved / span
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

function reached(spec: NumericSpec, value: number, threshold: number): boolean {
  return spec.direction === "up" ? value >= threshold : value <= threshold
}

/** Least squares over (day index, value). */
function linearFit(points: SeriesPoint[], origin: LocalDate): { slope: number; intercept: number } | null {
  const xs = points.map((p) => diffDays(origin, p.date))
  const n = points.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = points.reduce((a, p) => a + p.value, 0) / n
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2
    sxy += (xs[i] - mx) * (points[i].value - my)
  }
  if (sxx === 0) return null
  const slope = sxy / sxx
  return { slope, intercept: my - slope * mx }
}

/** Observed values for a numeric goal inside its window, oldest first. */
export function numericSeries(goal: Goal, gc: GoalContext, window: DateRange | null): SeriesPoint[] {
  const spec = goal.numeric
  if (!spec || !window) return []
  const raw: SeriesPoint[] = []
  if (spec.source === "habit") {
    for (const e of Object.values(gc.ctx.entries)) {
      if (e.habitId !== spec.habitId || typeof e.value !== "number") continue
      if (e.date < window.from || e.date > window.to) continue
      raw.push({ date: e.date, value: e.value })
    }
  } else {
    for (const m of Object.values(gc.measurements)) {
      if (m.goalId !== goal.id || m.date < window.from || m.date > window.to) continue
      raw.push({ date: m.date, value: m.value })
    }
  }
  raw.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  if (spec.aggregation === "last") return raw
  let total = spec.baseline
  return raw.map((p) => ({ date: p.date, value: (total += p.value) }))
}

export function goalEffort(goal: Goal, gc: GoalContext, window: DateRange | null): Effort | null {
  if (!window) return null
  const linked = goal.habits
    .map((l) => ({ habit: gc.habits.find((h) => h.id === l.habitId), weight: l.weight }))
    .filter((l): l is { habit: Habit; weight: number } => !!l.habit)
  if (linked.length === 0) return null
  const recentRange = { from: maxOf(window.from, addDays(window.to, -(RECENT_DAYS - 1))), to: window.to }
  const measure = (range: DateRange) => {
    const per = linked.map((l) => ({ ...l, summary: summarize(habitOpportunities(l.habit, range, gc.ctx)) }))
    const all = summarize(linked.flatMap((l) => habitOpportunities(l.habit, range, gc.ctx)))
    let num = 0
    let den = 0
    for (const p of per) {
      num += p.weight * p.summary.fulfilled
      den += p.weight * p.summary.applicable
    }
    return { per, all, rate: den === 0 ? null : num / den }
  }
  const full = measure(window)
  const recent = measure(recentRange)
  return {
    range: window,
    summary: full.all,
    rate: full.rate,
    weighted: new Set(linked.map((l) => l.weight)).size > 1,
    perHabit: full.per,
    recent: { range: recentRange, summary: recent.all, rate: recent.rate },
  }
}

function maxOf(a: LocalDate, b: LocalDate): LocalDate {
  return a > b ? a : b
}

export function checkpointStatuses(goal: Goal, series: SeriesPoint[]): CheckpointStatus[] {
  const spec = goal.numeric
  return goal.checkpoints.map((cp) => {
    if (goal.kind === "numeric" && spec && cp.value !== null && cp.value !== undefined) {
      const hit = series.find((p) => reached(spec, p.value, cp.value!))
      return { checkpoint: cp, doneOn: hit?.date ?? null, auto: true }
    }
    return { checkpoint: cp, doneOn: cp.doneOn ?? null, auto: false }
  })
}

// ── main ────────────────────────────────────────────────────────────────

export function evaluateGoal(goal: Goal, gc: GoalContext): GoalEvaluation {
  const today = gc.ctx.today
  const daysTotal = diffDays(goal.startDate, goal.dueDate) + 1
  const started = today >= goal.startDate
  const window: DateRange | null = started ? { from: goal.startDate, to: minDate(today, goal.dueDate) } : null
  const daysElapsed = window ? diffDays(window.from, window.to) + 1 : 0
  const daysLeft = Math.max(0, diffDays(today, goal.dueDate))
  const timeShare = daysTotal > 0 ? clamp01(daysElapsed / daysTotal) : 1

  const effort = goalEffort(goal, gc, window)
  let series: SeriesPoint[] = []
  let progress: number | null = null
  let raw: number | null = null
  let current: number | null = null
  let reason: string | null = null
  let required: number | null = null
  let actual: number | null = null
  let paceReason: string | null = null
  let projValue: number | null = null
  let projProgress: number | null = null
  let reachOn: LocalDate | null = null
  let projReason: string | null = null
  let dataLevel: DataLevel = "empty"
  let checkpoints: CheckpointStatus[] = []

  if (goal.kind === "habits") {
    const threshold = goal.threshold ?? DEFAULT_THRESHOLD
    checkpoints = checkpointStatuses(goal, [])
    if (!effort) reason = "No hay hábitos vinculados."
    else if (effort.rate === null) reason = started ? "Aún no hay oportunidades aplicables." : "El objetivo aún no ha empezado."
    else {
      current = effort.rate
      raw = threshold > 0 ? effort.rate / threshold : 1
      progress = clamp01(raw)
      dataLevel = effort.summary.applicable >= MIN_SPAN_DAYS && daysElapsed >= MIN_SPAN_DAYS ? "enough" : "few"
    }
    projReason = "No aplica: el objetivo se mide como porcentaje de cumplimiento."
    paceReason = projReason
  } else if (goal.kind === "milestones") {
    const total = goal.checkpoints.length
    checkpoints = checkpointStatuses(goal, [])
    const done = checkpoints.filter((c) => c.doneOn && c.doneOn <= today)
    let n = 0
    series = done
      .map((c) => c.doneOn!)
      .sort()
      .map((date) => ({ date, value: ++n }))
    if (total === 0) reason = "Añade hitos para medir el progreso."
    else {
      current = done.length
      raw = done.length / total
      progress = clamp01(raw)
      const remaining = total - done.length
      if (remaining > 0 && daysLeft > 0) required = remaining / daysLeft
      if (done.length >= 2 && daysElapsed >= MIN_SPAN_DAYS) {
        actual = done.length / daysElapsed
        projValue = Math.min(total, done.length + actual * daysLeft)
        projProgress = projValue / total
        reachOn = remaining === 0 ? null : withinYears(today, Math.ceil(remaining / actual))
        dataLevel = "enough"
      } else {
        projReason = `Hacen falta al menos 2 hitos cumplidos y ${MIN_SPAN_DAYS} días de recorrido.`
        paceReason = projReason
        dataLevel = done.length > 0 ? "few" : "empty"
      }
    }
  } else {
    const spec = goal.numeric
    if (!spec) reason = "Falta la definición de la medida."
    else {
      series = numericSeries(goal, gc, window)
      checkpoints = checkpointStatuses(goal, series)
      if (series.length === 0) {
        // No records → N/A, even for a running total: "0 %" would read as a measured result.
        reason = spec.source === "habit" ? "El hábito aún no tiene registros en el periodo del objetivo." : "Aún no hay mediciones."
      } else {
        current = series[series.length - 1].value
        raw = numericProgress(spec, current)
        if (raw === null) reason = "La meta es igual al punto de partida."
        progress = raw === null ? null : clamp01(raw)
      }
      if (current !== null && raw !== null && raw < 1 && daysLeft > 0) {
        required = Math.abs(spec.target - current) / daysLeft
      }
      const span = series.length ? diffDays(series[0].date, series[series.length - 1].date) : 0
      const enoughSum = spec.aggregation === "sum" && series.length >= MIN_POINTS && daysElapsed >= MIN_SPAN_DAYS
      const enoughLast = spec.aggregation === "last" && series.length >= MIN_POINTS && span >= MIN_SPAN_DAYS
      if (raw !== null && (enoughSum || enoughLast)) {
        dataLevel = "enough"
        if (spec.aggregation === "sum") {
          actual = (current! - spec.baseline) / daysElapsed
          projValue = current! + actual * daysLeft
          if (raw < 1 && actual > 0) reachOn = withinYears(today, Math.ceil((spec.target - current!) / actual))
        } else {
          const fit = linearFit(series, goal.startDate)
          if (fit) {
            actual = spec.direction === "up" ? fit.slope : -fit.slope
            projValue = fit.intercept + fit.slope * diffDays(goal.startDate, goal.dueDate)
            if (raw < 1 && actual > 0) {
              const at = (spec.target - fit.intercept) / fit.slope
              reachOn = withinYears(goal.startDate, Math.ceil(at), today)
            }
          } else projReason = "Todas las mediciones son del mismo día."
        }
        if (projValue !== null) projProgress = numericProgress(spec, projValue)
      } else {
        dataLevel = series.length > 0 ? "few" : "empty"
        projReason =
          spec.aggregation === "sum"
            ? `Hacen falta al menos ${MIN_POINTS} registros y ${MIN_SPAN_DAYS} días de recorrido.`
            : `Hacen falta al menos ${MIN_POINTS} mediciones que abarquen ${MIN_SPAN_DAYS} días.`
        paceReason = projReason
      }
    }
  }

  return {
    goal,
    horizon: horizonOf(goal, today),
    window,
    daysTotal,
    daysElapsed,
    daysLeft,
    timeShare,
    outcome: { progress, raw, current, reason },
    effort,
    series,
    checkpoints,
    pace: { required, actual, reason: required === null && actual === null ? paceReason : null },
    projection: { value: projValue, progress: projProgress, reachOn, reason: projValue === null ? (projReason ?? "Sin datos suficientes.") : null },
    status: statusOf(goal, { raw, projProgress, timeShare, today, dataLevel }),
    dataLevel,
  }
}

function withinYears(from: LocalDate, days: number, notBefore?: LocalDate): LocalDate | null {
  if (!Number.isFinite(days) || days > 5 * 366) return null
  const d = addDays(from, Math.max(0, days))
  return notBefore && d < notBefore ? notBefore : d
}

function statusOf(
  goal: Goal,
  e: { raw: number | null; projProgress: number | null; timeShare: number; today: LocalDate; dataLevel: DataLevel }
): { id: StatusId; basis: StatusBasis } {
  if (goal.state === "abandoned") return { id: "abandoned", basis: "state" }
  if (goal.state === "achieved") return { id: "achieved", basis: "state" }
  if (e.today < goal.startDate) return { id: "not_started", basis: "dates" }
  if (goal.kind !== "habits" && e.raw !== null && e.raw >= 1) return { id: "achieved", basis: "data" }
  if (e.raw === null) return { id: "no_data", basis: null }
  if (goal.kind === "habits") {
    if (e.today > goal.dueDate) return e.raw >= 1 ? { id: "achieved", basis: "data" } : { id: "overdue", basis: "dates" }
    return { id: e.raw >= 1 ? "on_track" : "behind", basis: "threshold" }
  }
  if (e.today > goal.dueDate) return { id: "overdue", basis: "dates" }
  if (e.projProgress !== null) {
    if (e.projProgress < 1) return { id: "behind", basis: "projection" }
    return { id: e.raw >= e.timeShare + AHEAD_MARGIN ? "ahead" : "on_track", basis: "projection" }
  }
  if (e.raw >= e.timeShare + AHEAD_MARGIN) return { id: "ahead", basis: "ideal" }
  if (e.raw >= e.timeShare - BEHIND_MARGIN) return { id: "on_track", basis: "ideal" }
  return { id: "behind", basis: "ideal" }
}

/**
 * Evaluates every goal; a parent with `aggregateChildren` replaces its outcome by the
 * mean of its active children's outcome (only those with data), with the formula shown.
 */
export function evaluateGoals(goals: Goal[], gc: GoalContext): Map<string, GoalEvaluation> {
  const out = new Map<string, GoalEvaluation>()
  for (const g of goals) out.set(g.id, evaluateGoal(g, gc))
  const resolving = new Set<string>()
  const resolve = (id: string): GoalEvaluation | undefined => {
    const ev = out.get(id)
    if (!ev || !ev.goal.aggregateChildren || resolving.has(id)) return ev
    resolving.add(id)
    const kids = goals.filter((c) => c.parentId === id && c.state !== "abandoned" && !c.archivedOn)
    const vals = kids.map((k) => resolve(k.id)?.outcome.progress).filter((v): v is number => v !== null && v !== undefined)
    const progress = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    const agg: GoalEvaluation = {
      ...ev,
      outcome: {
        progress,
        raw: progress,
        current: progress,
        reason: progress === null ? "Ningún subobjetivo tiene datos todavía." : null,
      },
    }
    agg.status = progress === null ? { id: "no_data", basis: null } : statusOf(ev.goal, { raw: progress, projProgress: null, timeShare: ev.timeShare, today: gc.ctx.today, dataLevel: ev.dataLevel })
    out.set(id, agg)
    resolving.delete(id)
    return agg
  }
  for (const g of goals) resolve(g.id)
  return out
}

/** Ideal straight line from the baseline on the start date to the target on the due date. */
export function idealAt(goal: Goal, date: LocalDate): number | null {
  const spec = goal.numeric
  if (!spec) return null
  const total = diffDays(goal.startDate, goal.dueDate)
  if (total <= 0) return spec.target
  const share = clamp01(diffDays(goal.startDate, date) / total)
  return spec.baseline + (spec.target - spec.baseline) * share
}

/** Value recorded for a habit-sourced goal on a date (for drilldowns of the series). */
export function habitValueOn(gc: GoalContext, habitId: string, date: LocalDate): number | null {
  const v = gc.ctx.entries[entryKey(habitId, date)]?.value
  return typeof v === "number" ? v : null
}
