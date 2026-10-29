import { addDays, localDateInZone, maxDate, minDate, startOfWeek, type LocalDate, type Weekday } from "@/features/habits/domain/dates"
import {
  byDimension,
  completion,
  currentStreak,
  dailyRates,
  perfectDays,
  weekdayConsistency,
  type CompletionSummary,
  type DateRange,
  type EvalContext,
  type Streak,
} from "@/features/habits/domain/metrics"
import type { DimensionId, EntryMap, HabitsState } from "@/features/habits/domain/types"
import { evaluateGoals, type DataLevel, type StatusBasis, type StatusId } from "@/features/goals/domain/progress"
import type { Goal, GoalKind, GoalState, MeasurementMap } from "@/features/goals/domain/types"
import { sessionsIn, summarizeSessions } from "@/features/focus/domain/metrics"
import { average, changeVsPrevious, completionBySleep, coverage, energyByFocus, mindDataLevel, series, type Comparison, type MindDataLevel } from "@/features/mind/domain/metrics"
import { INDICATORS, type CheckinMap, type Indicator } from "@/features/mind/domain/types"
import { METRICS_VERSION } from "@/features/analytics/domain/catalog"
import { isAvailable, periodFromStart, previousPeriod, type Period } from "./periods"
import { LIMITS, type ReviewKind } from "./types"

/**
 * Frozen figures of a review (plan §3.1). Every number comes from the same pure functions as
 * Life Analytics, Goals, Focus and Mind & Energy: this module only chooses ranges and «as of»
 * dates, it defines no formula of its own. Rules that make the snapshot deterministic:
 *
 * - Input is the synced state plus «today» (profile timezone) and the close instant; nothing reads
 *   the device clock.
 * - Habits: records after the end of the last week the period touches are ignored and «today» is
 *   capped right after it. The figures equal Analytics for the same range, and closing late gives
 *   exactly the same snapshot as closing on time unless the period's own data changed.
 * - Goals are evaluated «as of» the end of the period (or today on its last day) without any
 *   record, measurement, milestone or state change dated after that day.
 * - Mind & Energy contributes numbers only: reflections are removed before any metric runs.
 */
export const SNAPSHOT_VERSION = 1

export interface HabitRow {
  id: string
  /** Name when the review was closed (kept if the habit is renamed or archived later). */
  name: string
  dimension: DimensionId
  rate: number | null
  fulfilled: number
  applicable: number
  exempt: number
  inProgress: number
  /** Monthly reviews: streak at the end of the period. */
  streak?: Streak
}

export interface DimensionRow {
  id: DimensionId
  name: string
  rate: number | null
  fulfilled: number
  applicable: number
}

export interface GoalRow {
  id: string
  title: string
  kind: GoalKind
  parentId: string | null
  status: StatusId
  basis: StatusBasis
  /** Outcome 0–1, or null (N/D) with `reason`. */
  progress: number | null
  reason: string | null
  /** Weighted completion of the linked habits and its denominator (applicable opportunities). */
  effort: number | null
  effortApplicable: number | null
  dataLevel: DataLevel
  /** Achieved or abandoned inside the period. */
  closedInPeriod: Exclude<GoalState, "active"> | null
  /** Monthly reviews: outcome on the day before the month started (null if the goal did not exist yet). */
  progressAtStart?: number | null
}

export interface FocusFigures {
  minutes: number
  sessions: number
  complete: number
  completeRate: number | null
  rated: number
  avgRating: number | null
  days: number
  topProjects: { project: string; minutes: number; sessions: number }[]
}

export interface MindFigures {
  coverage: { days: number; total: number }
  level: MindDataLevel
  averages: Record<Indicator, { value: number | null; n: number }>
  /** Change vs. the previous period; null unless both periods have ≥ 7 days with data (catalog rule). */
  change: Record<Indicator, number | null>
  energyByFocus: Comparison
  completionBySleep: Comparison
}

export interface WeekRow {
  /** Monday of the week; the figures cover its days inside the month. */
  week: LocalDate
  range: DateRange
  completion: number | null
  applicable: number
  focusMinutes: number
  energy: { value: number | null; n: number }
  mood: { value: number | null; n: number }
}

export interface ReviewSnapshot {
  v: typeof SNAPSHOT_VERSION
  metricsVersion: number
  kind: ReviewKind
  period: DateRange
  previous: DateRange
  /** Last day the figures can include: the period end, or today while it is the period's last day. */
  asOf: LocalDate
  timezone: string
  /** Hybrid, server-corrected instant of the close (ISO). Not part of the figures. */
  computedAt: string
  /** First day with any data (habit start, focus session or check-in); null if there is none. */
  historyStart: LocalDate | null
  habits: {
    current: CompletionSummary
    previous: CompletionSummary
    perfectDays: { perfect: number; withData: number }
    byDimension: DimensionRow[]
    rows: HabitRow[]
    /** Monthly reviews only. */
    weekday?: { weekday: Weekday; rate: number | null; applicable: number }[]
  }
  goals: GoalRow[]
  focus: { current: FocusFigures; previous: FocusFigures }
  mind: MindFigures & { previous: { averages: Record<Indicator, { value: number | null; n: number }> } }
  /** Monthly reviews only. */
  weekly?: WeekRow[]
}

export interface SnapshotInput {
  state: HabitsState
  kind: ReviewKind
  periodStart: LocalDate
  /** Today in the profile timezone. */
  today: LocalDate
  /** Hybrid instant of the close (ISO). */
  computedAt: string
}

export class SnapshotError extends Error {
  constructor(public code: "invalid_period" | "not_available" | "too_large") {
    super(code)
    this.name = "SnapshotError"
  }
}

// ── «as of» views of the state ───────────────────────────────────────────

function entriesUntil(entries: EntryMap, last: LocalDate): EntryMap {
  return Object.fromEntries(Object.entries(entries).filter(([, e]) => e.date <= last))
}

function measurementsUntil(measurements: MeasurementMap, last: LocalDate): MeasurementMap {
  return Object.fromEntries(Object.entries(measurements).filter(([, m]) => m.date <= last))
}

/** Evaluation context for a period's habits (see the module rules). Also valid for earlier periods. */
export function habitContext(state: Pick<HabitsState, "entries" | "restDays">, period: DateRange, today: LocalDate): EvalContext {
  const horizon = addDays(startOfWeek(period.to), 6)
  return {
    entries: entriesUntil(state.entries, horizon),
    restDays: new Set(state.restDays.filter((d) => d <= horizon)),
    today: minDate(today, addDays(horizon, 1)),
  }
}

function createdOn(g: Goal, timezone: string): LocalDate {
  const t = Date.parse(g.createdAt)
  return Number.isNaN(t) ? g.startDate : localDateInZone(new Date(t), timezone)
}

/**
 * Goals as they were at the end of `date`: created by then, not archived yet, and without any
 * state change or milestone dated after it (a goal achieved later was still active that day).
 */
export function goalsAsOf(goals: readonly Goal[], date: LocalDate, timezone: string): Goal[] {
  return goals
    .filter((g) => createdOn(g, timezone) <= date && (!g.archivedOn || g.archivedOn > date))
    .map((g) => {
      const reopened = g.state !== "active" && g.closedOn && g.closedOn > date ? { state: "active" as const, closedOn: null } : {}
      return {
        ...g,
        ...reopened,
        checkpoints: g.checkpoints.map((c) => (c.doneOn && c.doneOn > date ? { ...c, doneOn: null } : c)),
      }
    })
}

/** Check-ins without their reflection: the only Mind & Energy data a review ever reads. */
export function withoutNotes(checkins: CheckinMap): CheckinMap {
  return Object.fromEntries(Object.entries(checkins).map(([k, c]) => [k, { ...c, note: null, stamps: {}, noteSeq: null }]))
}

// ── figures ──────────────────────────────────────────────────────────────

function habitFigures(state: HabitsState, period: Period, prev: Period, today: LocalDate): ReviewSnapshot["habits"] {
  const ctx = habitContext(state, period, today)
  const habits = state.habits
  const rows: HabitRow[] = habits
    .map((h) => ({ h, s: completion([h], period, ctx) }))
    .filter(({ s }) => s.applicable + s.exempt + s.inProgress > 0)
    .map(({ h, s }) => ({
      id: h.id,
      name: h.name,
      dimension: h.dimensionId,
      rate: s.rate,
      fulfilled: s.fulfilled,
      applicable: s.applicable,
      exempt: s.exempt,
      inProgress: s.inProgress,
    }))
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || a.name.localeCompare(b.name, "es") || a.id.localeCompare(b.id))
  const dims = byDimension(habits, period, ctx)
  const out: ReviewSnapshot["habits"] = {
    current: completion(habits, period, ctx),
    previous: completion(habits, prev, ctx),
    perfectDays: perfectDays(dailyRates(habits, period, ctx)),
    byDimension: state.dimensions
      .map((d) => ({ d, s: dims.get(d.id) }))
      .filter(({ s }) => s && s.applicable + s.exempt > 0)
      .map(({ d, s }) => ({ id: d.id, name: d.name, rate: s!.rate, fulfilled: s!.fulfilled, applicable: s!.applicable })),
    rows,
  }
  if (period.kind === "month") {
    // Streak at the end of the period: nothing after its last day.
    const endCtx: EvalContext = { entries: entriesUntil(state.entries, period.to), restDays: ctx.restDays, today: minDate(today, addDays(period.to, 1)) }
    for (const row of rows) row.streak = currentStreak(habits.find((h) => h.id === row.id)!, endCtx)
    out.weekday = weekdayConsistency(habits, period, ctx)
  }
  return out
}

function goalFigures(state: HabitsState, period: Period, today: LocalDate): GoalRow[] {
  const asOf = minDate(today, period.to)
  const at = (date: LocalDate) => {
    const goals = goalsAsOf(state.goals, date, state.timezone)
    const ctx: EvalContext = { entries: entriesUntil(state.entries, date), restDays: new Set(state.restDays.filter((d) => d <= date)), today: date }
    return { goals, evals: evaluateGoals(goals, { habits: state.habits, ctx, measurements: measurementsUntil(state.measurements, date) }) }
  }
  const end = at(asOf)
  const start = period.kind === "month" ? at(addDays(period.from, -1)) : null
  return end.goals
    // Part of the period: started by its end and not closed before it began.
    .filter((g) => g.startDate <= asOf && (g.state === "active" || (g.closedOn ?? asOf) >= period.from))
    .map((g) => {
      const ev = end.evals.get(g.id)!
      const row: GoalRow = {
        id: g.id,
        title: g.title,
        kind: g.kind,
        parentId: g.parentId ?? null,
        status: ev.status.id,
        basis: ev.status.basis,
        progress: ev.outcome.progress,
        reason: ev.outcome.reason,
        effort: ev.effort?.rate ?? null,
        effortApplicable: ev.effort?.summary.applicable ?? null,
        dataLevel: ev.dataLevel,
        closedInPeriod: g.state !== "active" && g.closedOn && g.closedOn >= period.from ? g.state : null,
      }
      if (start) row.progressAtStart = start.evals.get(g.id)?.outcome.progress ?? null
      return row
    })
    .sort((a, b) => a.title.localeCompare(b.title, "es") || a.id.localeCompare(b.id))
}

function focusFigures(state: Pick<HabitsState, "focusSessions">, range: DateRange): FocusFigures {
  const s = summarizeSessions(sessionsIn(state, { range, project: "all" }))
  return {
    minutes: s.minutes,
    sessions: s.sessions,
    complete: s.complete,
    completeRate: s.completeRate,
    rated: s.rated,
    avgRating: s.avgRating,
    days: s.days,
    topProjects: s.byProject.slice(0, 3).map((r) => ({ project: r.project, minutes: r.minutes, sessions: r.sessions })),
  }
}

function averages(state: Pick<HabitsState, "checkins">, range: DateRange): Record<Indicator, { value: number | null; n: number }> {
  return Object.fromEntries(INDICATORS.map((i) => [i, average(series(state, range, i, "both"))])) as Record<Indicator, { value: number | null; n: number }>
}

function mindFigures(state: HabitsState, period: Period, prev: Period, today: LocalDate): ReviewSnapshot["mind"] {
  const s: HabitsState = { ...state, checkins: withoutNotes(state.checkins) }
  const cov = coverage(s, period)
  return {
    coverage: { days: cov.days, total: cov.total },
    level: mindDataLevel(s, period),
    averages: averages(s, period),
    change: Object.fromEntries(INDICATORS.map((i) => [i, changeVsPrevious(s, period, i, "both", prev)?.delta ?? null])) as Record<Indicator, number | null>,
    energyByFocus: energyByFocus(s, period),
    // Only closed days: «today» right after the period, so every day of it counts once.
    completionBySleep: completionBySleep(s, period, minDate(today, addDays(period.to, 1))),
    previous: { averages: averages(s, prev) },
  }
}

function weeklyRows(state: HabitsState, period: Period, ctx: EvalContext): WeekRow[] {
  const rows: WeekRow[] = []
  const s = { checkins: withoutNotes(state.checkins) }
  for (let week = startOfWeek(period.from); week <= period.to; week = addDays(week, 7)) {
    const range = { from: maxDate(week, period.from), to: minDate(addDays(week, 6), period.to) }
    const c = completion(state.habits, range, ctx)
    rows.push({
      week,
      range,
      completion: c.rate,
      applicable: c.applicable,
      focusMinutes: focusFigures(state, range).minutes,
      energy: average(series(s, range, "energy", "both")),
      mood: average(series(s, range, "mood", "both")),
    })
  }
  return rows
}

/** First day with any data (habit start, finished focus session or check-in). */
export function historyStart(state: Pick<HabitsState, "habits" | "focusSessions" | "checkins">): LocalDate | null {
  const dates = [
    ...state.habits.map((h) => h.startDate),
    ...state.focusSessions.filter((f) => f.state === "finished").map((f) => f.localDate),
    ...Object.values(state.checkins).map((c) => c.date),
  ]
  return dates.length ? dates.reduce((a, b) => (b < a ? b : a)) : null
}

/** Builds the snapshot that a close freezes. Throws SnapshotError for an invalid or unavailable period. */
export function buildReviewSnapshot({ state, kind, periodStart, today, computedAt }: SnapshotInput): ReviewSnapshot {
  const period = periodFromStart(kind, periodStart)
  if (!period) throw new SnapshotError("invalid_period")
  if (!isAvailable(period, today)) throw new SnapshotError("not_available")
  const prev = previousPeriod(period)
  const snapshot: ReviewSnapshot = {
    v: SNAPSHOT_VERSION,
    metricsVersion: METRICS_VERSION,
    kind,
    period: { from: period.from, to: period.to },
    previous: { from: prev.from, to: prev.to },
    asOf: minDate(today, period.to),
    timezone: state.timezone,
    computedAt,
    historyStart: historyStart(state),
    habits: habitFigures(state, period, prev, today),
    goals: goalFigures(state, period, today),
    focus: { current: focusFigures(state, period), previous: focusFigures(state, prev) },
    mind: mindFigures(state, period, prev, today),
  }
  if (kind === "month") snapshot.weekly = weeklyRows(state, period, habitContext(state, period, today))
  if (snapshotBytes(snapshot) > LIMITS.snapshotBytes) throw new SnapshotError("too_large")
  return snapshot
}

export function snapshotBytes(s: ReviewSnapshot): number {
  return new TextEncoder().encode(JSON.stringify(s)).length
}

/** Same figures (everything but the close instant): the basis of «closing late changes nothing». */
export function sameFigures(a: ReviewSnapshot, b: ReviewSnapshot): boolean {
  return JSON.stringify({ ...a, computedAt: "" }) === JSON.stringify({ ...b, computedAt: "" })
}

export interface FigureChange {
  /** Human path, e.g. «habits.current», «goal:<id>». */
  figure: string
  frozen: unknown
  live: unknown
}

export type SnapshotComparison = { comparable: false; reason: "metrics_version" | "snapshot_version" } | { comparable: true; changes: FigureChange[] }

/**
 * Frozen vs. live figures of a closed review (plan §4.4): informative only, the snapshot never
 * changes. Only comparable with the same snapshot shape and metrics version.
 */
export function compareSnapshot(frozen: ReviewSnapshot, live: ReviewSnapshot): SnapshotComparison {
  if (frozen.v !== live.v) return { comparable: false, reason: "snapshot_version" }
  if (frozen.metricsVersion !== live.metricsVersion) return { comparable: false, reason: "metrics_version" }
  const changes: FigureChange[] = []
  const check = (figure: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ figure, frozen: a, live: b })
  }
  const pick = (c: CompletionSummary) => ({ fulfilled: c.fulfilled, applicable: c.applicable, rate: c.rate })
  check("habits.current", pick(frozen.habits.current), pick(live.habits.current))
  check("habits.perfectDays", frozen.habits.perfectDays, live.habits.perfectDays)
  const focus = (f: FocusFigures) => ({ minutes: f.minutes, sessions: f.sessions, completeRate: f.completeRate, avgRating: f.avgRating })
  check("focus.current", focus(frozen.focus.current), focus(live.focus.current))
  check("mind.coverage", frozen.mind.coverage, live.mind.coverage)
  check("mind.averages", frozen.mind.averages, live.mind.averages)
  const goals = (rows: GoalRow[]) => new Map(rows.map((g) => [g.id, { status: g.status, progress: g.progress, effort: g.effort }]))
  const fg = goals(frozen.goals)
  const lg = goals(live.goals)
  for (const id of new Set([...fg.keys(), ...lg.keys()])) check(`goal:${id}`, fg.get(id) ?? null, lg.get(id) ?? null)
  return { comparable: true, changes }
}
