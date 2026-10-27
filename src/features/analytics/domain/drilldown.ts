import { addDays, isoWeekday, minDate, type LocalDate, type Weekday } from "@/features/habits/domain/dates"
import {
  habitOpportunities,
  summarize,
  type CompletionSummary,
  type DateRange,
  type EvalContext,
  type Opportunity,
  type OpportunityStatus,
} from "@/features/habits/domain/metrics"
import type { Habit } from "@/features/habits/domain/types"

/** What was tapped: the whole period, one calendar day, one weekday column or one trend week. */
export type DrillTarget =
  | { kind: "range"; range: DateRange }
  | { kind: "day"; date: LocalDate }
  | { kind: "weekday"; weekday: Weekday; range: DateRange }
  | { kind: "week"; weekStart: LocalDate }

export interface DrillRow {
  habitId: string
  habitName: string
  kind: "day" | "week"
  /** The day, or the Monday of a weekly target. */
  date: LocalDate
  status: Exclude<OpportunityStatus, "future">
  achieved?: number
  target?: number
}

export interface Drilldown {
  rows: DrillRow[]
  /** Computed from exactly these rows, so it always equals the figure that was tapped. */
  summary: CompletionSummary
}

const ORDER: Record<DrillRow["status"], number> = { missed: 0, pending: 1, in_progress: 2, fulfilled: 3, exempt: 4 }

function opportunitiesFor(habit: Habit, target: DrillTarget, ctx: EvalContext): Opportunity[] {
  switch (target.kind) {
    case "range":
      return habitOpportunities(habit, target.range, ctx)
    case "day":
      // Same basis as the calendar: fixed-schedule days only.
      return habitOpportunities(habit, { from: target.date, to: target.date }, ctx).filter((o) => o.kind === "day")
    case "weekday":
      return habitOpportunities(habit, target.range, ctx).filter((o) => o.kind === "day" && isoWeekday(o.date) === target.weekday)
    case "week":
      // Same basis as the weekly trend: Monday to Sunday, cut at today.
      return habitOpportunities(habit, { from: target.weekStart, to: minDate(addDays(target.weekStart, 6), ctx.today) }, ctx)
  }
}

/** The exact opportunities behind a figure, worst first, plus their summary. */
export function drilldown(habits: Habit[], target: DrillTarget, ctx: EvalContext): Drilldown {
  const opps: Opportunity[] = []
  const rows: DrillRow[] = []
  for (const h of habits) {
    for (const o of opportunitiesFor(h, target, ctx)) {
      opps.push(o)
      if (o.status === "future") continue
      rows.push(
        o.kind === "day"
          ? { habitId: h.id, habitName: h.name, kind: "day", date: o.date, status: o.status }
          : { habitId: h.id, habitName: h.name, kind: "week", date: o.weekStart, status: o.status, achieved: o.achieved, target: o.target }
      )
    }
  }
  rows.sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.date.localeCompare(a.date) || a.habitName.localeCompare(b.habitName, "es"))
  return { rows, summary: summarize(opps) }
}
