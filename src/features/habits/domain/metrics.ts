import {
  addDays,
  eachDay,
  isoWeekday,
  maxDate,
  minDate,
  startOfWeek,
  type LocalDate,
  type Weekday,
} from "./dates"
import { isEligibleDay, isFulfilled, ruleOn } from "./schedule"
import { entryKey, type DimensionId, type EntryMap, type Habit } from "./types"

/**
 * Opportunity status.
 * - fulfilled / missed: closed outcomes.
 * - pending: today's scheduled day, not done yet. Counts in the denominator so
 *   the rate is honest during the day.
 * - in_progress: a weekly target whose week is still open and not yet met.
 *   Excluded from the denominator until the week ends.
 * - exempt: planned rest. Never counts.
 * - future: not yet due. Never counts.
 */
export type OpportunityStatus =
  | "fulfilled"
  | "missed"
  | "pending"
  | "in_progress"
  | "exempt"
  | "future"

export interface DayOpportunity {
  kind: "day"
  habitId: string
  date: LocalDate
  status: OpportunityStatus
}

export interface WeekOpportunity {
  kind: "week"
  habitId: string
  weekStart: LocalDate
  /** Target after removing rest days (never above days available). */
  target: number
  achieved: number
  status: OpportunityStatus
}

export type Opportunity = DayOpportunity | WeekOpportunity

export interface EvalContext {
  entries: EntryMap
  restDays: ReadonlySet<LocalDate>
  today: LocalDate
}

export interface DateRange {
  from: LocalDate
  to: LocalDate
}

function dayStatus(
  habit: Habit,
  date: LocalDate,
  ctx: EvalContext
): OpportunityStatus {
  if (ctx.restDays.has(date)) return "exempt"
  if (date > ctx.today) return "future"
  if (isFulfilled(habit, ctx.entries[entryKey(habit.id, date)])) return "fulfilled"
  return date === ctx.today ? "pending" : "missed"
}

function evaluateWeek(
  habit: Habit,
  weekStart: LocalDate,
  timesPerWeek: number,
  ctx: EvalContext
): WeekOpportunity {
  const days = eachDay(weekStart, addDays(weekStart, 6))
  const available = days.filter(
    (d) => isEligibleDay(habit, d) && !ctx.restDays.has(d)
  )
  const achieved = available.filter((d) =>
    isFulfilled(habit, ctx.entries[entryKey(habit.id, d)])
  ).length
  const target = Math.min(timesPerWeek, available.length)
  const weekEnd = addDays(weekStart, 6)

  let status: OpportunityStatus
  if (target === 0) status = "exempt"
  else if (achieved >= target) status = weekStart > ctx.today ? "future" : "fulfilled"
  else if (weekStart > ctx.today) status = "future"
  else if (weekEnd < ctx.today) status = "missed"
  else status = "in_progress"

  return { kind: "week", habitId: habit.id, weekStart, target, achieved, status }
}

/**
 * All opportunities of one habit in a range. Fixed schedules produce one
 * opportunity per scheduled day; weekly-count schedules produce one per ISO
 * week (evaluated at period level, PRD §3.2) whose Monday falls in
 * [startOfWeek(from), to].
 */
export function habitOpportunities(
  habit: Habit,
  range: DateRange,
  ctx: EvalContext
): Opportunity[] {
  const out: Opportunity[] = []
  const seenWeeks = new Set<LocalDate>()
  for (const date of eachDay(range.from, range.to)) {
    const rule = ruleOn(habit, date)
    if (!rule) continue
    if (rule.kind === "weekly_count") {
      const ws = startOfWeek(date)
      if (seenWeeks.has(ws)) continue
      seenWeeks.add(ws)
      // The version in force when the habit's week starts governs that week.
      const governing = ruleOn(habit, maxDate(ws, habit.startDate)) ?? rule
      const times = governing.kind === "weekly_count" ? governing.timesPerWeek : rule.timesPerWeek
      out.push(evaluateWeek(habit, ws, times, ctx))
    } else if (isEligibleDay(habit, date)) {
      out.push({ kind: "day", habitId: habit.id, date, status: dayStatus(habit, date, ctx) })
    }
  }
  return out
}

export interface CompletionSummary {
  fulfilled: number
  /** Applicable opportunities: fulfilled + missed + pending. */
  applicable: number
  missed: number
  pending: number
  exempt: number
  inProgress: number
  /** fulfilled / applicable, or null (N/A) when nothing was applicable. */
  rate: number | null
}

export function summarize(opps: Opportunity[]): CompletionSummary {
  let fulfilled = 0
  let missed = 0
  let pending = 0
  let exempt = 0
  let inProgress = 0
  for (const o of opps) {
    if (o.status === "fulfilled") fulfilled++
    else if (o.status === "missed") missed++
    else if (o.status === "pending") pending++
    else if (o.status === "exempt") exempt++
    else if (o.status === "in_progress") inProgress++
  }
  const applicable = fulfilled + missed + pending
  return {
    fulfilled,
    applicable,
    missed,
    pending,
    exempt,
    inProgress,
    rate: applicable === 0 ? null : fulfilled / applicable,
  }
}

export function completion(
  habits: Habit[],
  range: DateRange,
  ctx: EvalContext
): CompletionSummary {
  return summarize(habits.flatMap((h) => habitOpportunities(h, range, ctx)))
}

/**
 * Plan progress for a period (typically the current week): planned units
 * include future ones, so the number only grows as work gets done.
 * Weekly targets contribute `target` units, capped achievement.
 */
export function planProgress(
  habits: Habit[],
  range: DateRange,
  ctx: EvalContext
): { done: number; planned: number; ratio: number | null } {
  let done = 0
  let planned = 0
  for (const o of habits.flatMap((h) => habitOpportunities(h, range, ctx))) {
    if (o.status === "exempt") continue
    if (o.kind === "day") {
      planned += 1
      if (o.status === "fulfilled") done += 1
    } else {
      planned += o.target
      done += Math.min(o.achieved, o.target)
    }
  }
  return { done, planned, ratio: planned === 0 ? null : done / planned }
}

/** Today's fixed-schedule checklist status. */
export function todayProgress(
  habits: Habit[],
  ctx: EvalContext
): { done: number; total: number } {
  const opps = habits
    .flatMap((h) => habitOpportunities(h, { from: ctx.today, to: ctx.today }, ctx))
    .filter((o): o is DayOpportunity => o.kind === "day")
    .filter((o) => o.status !== "exempt")
  return { done: opps.filter((o) => o.status === "fulfilled").length, total: opps.length }
}

/** Per-date rate for heatmaps (fixed-schedule days only; null = no data). */
export function dailyRates(
  habits: Habit[],
  range: DateRange,
  ctx: EvalContext
): { date: LocalDate; rate: number | null; fulfilled: number; applicable: number }[] {
  const byDate = new Map<LocalDate, { f: number; a: number }>()
  for (const d of eachDay(range.from, range.to)) byDate.set(d, { f: 0, a: 0 })
  for (const h of habits) {
    for (const o of habitOpportunities(h, range, ctx)) {
      if (o.kind !== "day") continue
      const slot = byDate.get(o.date)
      if (!slot) continue
      if (o.status === "fulfilled") slot.f++
      if (o.status === "fulfilled" || o.status === "missed" || o.status === "pending") slot.a++
    }
  }
  return [...byDate].map(([date, { f, a }]) => ({
    date,
    rate: a === 0 ? null : f / a,
    fulfilled: f,
    applicable: a,
  }))
}

/** «Días completos» (catalog `perfect_days`): days with scheduled habits where all were fulfilled. */
export function perfectDays(daily: readonly { applicable: number; fulfilled: number }[]): { perfect: number; withData: number } {
  return {
    perfect: daily.filter((d) => d.applicable > 0 && d.fulfilled === d.applicable).length,
    withData: daily.filter((d) => d.applicable > 0).length,
  }
}

export function weekdayConsistency(
  habits: Habit[],
  range: DateRange,
  ctx: EvalContext
): { weekday: Weekday; rate: number | null; applicable: number }[] {
  const acc = new Map<Weekday, { f: number; a: number }>()
  for (let i = 1 as Weekday; i <= 7; i = (i + 1) as Weekday) acc.set(i, { f: 0, a: 0 })
  for (const h of habits) {
    for (const o of habitOpportunities(h, range, ctx)) {
      if (o.kind !== "day") continue
      const slot = acc.get(isoWeekday(o.date))!
      if (o.status === "fulfilled") slot.f++
      if (o.status === "fulfilled" || o.status === "missed" || o.status === "pending") slot.a++
    }
  }
  return [...acc].map(([weekday, { f, a }]) => ({
    weekday,
    rate: a === 0 ? null : f / a,
    applicable: a,
  }))
}

export function byDimension(
  habits: Habit[],
  range: DateRange,
  ctx: EvalContext
): Map<DimensionId, CompletionSummary> {
  const groups = new Map<DimensionId, Habit[]>()
  for (const h of habits) groups.set(h.dimensionId, [...(groups.get(h.dimensionId) ?? []), h])
  const out = new Map<DimensionId, CompletionSummary>()
  for (const [dim, hs] of groups) out.set(dim, completion(hs, range, ctx))
  return out
}

/** Weekly completion series (Monday-keyed), oldest first. */
export function weeklySeries(
  habits: Habit[],
  weeks: number,
  ctx: EvalContext
): { weekStart: LocalDate; rate: number | null; applicable: number }[] {
  const current = startOfWeek(ctx.today)
  return Array.from({ length: weeks }, (_, i) => {
    const ws = addDays(current, -7 * (weeks - 1 - i))
    const s = completion(habits, { from: ws, to: minDate(addDays(ws, 6), ctx.today) }, ctx)
    return { weekStart: ws, rate: s.rate, applicable: s.applicable }
  })
}

export interface Streak {
  count: number
  unit: "day" | "week"
}

/**
 * Consecutive fulfilled opportunities ending at the latest closed one.
 * Today (pending) and the open week (in progress) do not break a streak;
 * rest days and unscheduled days are skipped.
 */
export function currentStreak(habit: Habit, ctx: EvalContext, lookbackDays = 370): Streak {
  const range = { from: maxDate(habit.startDate, addDays(ctx.today, -lookbackDays)), to: ctx.today }
  const opps = habitOpportunities(habit, range, ctx)
  const unit: Streak["unit"] = opps.some((o) => o.kind === "week") ? "week" : "day"
  let count = 0
  for (let i = opps.length - 1; i >= 0; i--) {
    const s = opps[i].status
    if (s === "fulfilled") count++
    else if (s === "pending" || s === "in_progress" || s === "exempt" || s === "future") continue
    else break
  }
  return { count, unit }
}
