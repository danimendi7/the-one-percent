import { addDays } from "@/features/habits/domain/dates"
import { habitOpportunities, type DayOpportunity, type EvalContext } from "@/features/habits/domain/metrics"
import type { Habit } from "@/features/habits/domain/types"

/**
 * F1 · What the Command Center says about today (Plan §5.1). It must tell apart four things that
 * can all look like «nothing done»: no data yet, a planned rest, something left undone, and a sync
 * error (the last one is the engine's status, shown by the view). Only fixed-schedule days count
 * here, as in `todayProgress`: weekly targets are judged by the week, not by one day.
 *
 * - no_habits: nothing to measure yet (no active habit).
 * - rest: today is a planned rest day; its habits do not count, and it is never a failure.
 * - nothing_today: there are habits, but none is due today.
 * - active: habits due today, done or still pending.
 * `missedYesterday` is what was due yesterday and was not done (a rest day yesterday gives 0).
 */
export type DayKind = "no_habits" | "rest" | "nothing_today" | "active"

export interface DaySummary {
  kind: DayKind
  done: number
  pending: number
  /** Habits due today that rest because today is a planned rest day. */
  rests: number
  missedYesterday: number
}

function dayOpportunities(habits: Habit[], date: string, ctx: EvalContext): DayOpportunity[] {
  return habits.flatMap((h) => habitOpportunities(h, { from: date, to: date }, ctx)).filter((o): o is DayOpportunity => o.kind === "day")
}

export function daySummary(active: Habit[], all: Habit[], ctx: EvalContext): DaySummary {
  const today = dayOpportunities(active, ctx.today, ctx)
  const done = today.filter((o) => o.status === "fulfilled").length
  const pending = today.filter((o) => o.status === "pending").length
  const rests = today.filter((o) => o.status === "exempt").length
  const missedYesterday = dayOpportunities(all, addDays(ctx.today, -1), ctx).filter((o) => o.status === "missed").length
  const kind: DayKind = active.length === 0 ? "no_habits" : ctx.restDays.has(ctx.today) ? "rest" : done + pending === 0 ? "nothing_today" : "active"
  return { kind, done, pending, rests, missedYesterday }
}
