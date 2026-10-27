import { describe, expect, it } from "vitest"
import { completion } from "@/features/habits/domain/metrics"
import { ctx, entries, makeHabit } from "@/features/habits/domain/test-helpers"
import type { EntryMap, Habit } from "@/features/habits/domain/types"
import { evaluateGoal, evaluateGoals, horizonOf, numericProgress, type GoalContext } from "./progress"
import { measurementKey, type Goal, type MeasurementMap } from "./types"

const TODAY = "2026-10-27"

function goal(p: Partial<Goal> = {}): Goal {
  return {
    id: "g1",
    title: "Objetivo",
    kind: "numeric",
    numeric: { source: "manual", habitId: null, aggregation: "last", unit: "kg", baseline: 82, target: 78, direction: "down" },
    threshold: null,
    startDate: "2026-09-01",
    dueDate: "2026-12-31",
    priority: "primary",
    state: "active",
    habits: [],
    checkpoints: [],
    createdAt: "",
    updatedAt: "",
    ...p,
  }
}

function measures(goalId: string, values: Record<string, number>): MeasurementMap {
  const out: MeasurementMap = {}
  for (const [date, value] of Object.entries(values)) out[measurementKey(goalId, date)] = { goalId, date, value, opId: date, updatedAt: "" }
  return out
}

function gc(p: { habits?: Habit[]; entries?: EntryMap; measurements?: MeasurementMap; today?: string; rest?: string[] } = {}): GoalContext {
  return { habits: p.habits ?? [], ctx: ctx(p.today ?? TODAY, p.entries ?? {}, p.rest ?? []), measurements: p.measurements ?? {} }
}

describe("numeric goals (manual measurements)", () => {
  it("is N/A with a reason when there are no measurements, never 0 %", () => {
    const e = evaluateGoal(goal(), gc())
    expect(e.outcome.progress).toBeNull()
    expect(e.outcome.reason).toMatch(/mediciones/)
    expect(e.status.id).toBe("no_data")
    expect(e.dataLevel).toBe("empty")
  })

  it("uses the latest measurement for 'last' and respects direction down", () => {
    const e = evaluateGoal(goal(), gc({ measurements: measures("g1", { "2026-09-05": 81, "2026-10-20": 80 }) }))
    expect(e.outcome.current).toBe(80)
    expect(e.outcome.progress).toBeCloseTo(0.5)
    expect(e.dataLevel).toBe("few")
    expect(e.projection.value).toBeNull()
    expect(e.projection.reason).toMatch(/al menos 3 mediciones/)
  })

  it("ignores measurements before the start date and of other goals", () => {
    const m = { ...measures("g1", { "2026-08-01": 70 }), ...measures("g2", { "2026-10-01": 70 }) }
    expect(evaluateGoal(goal(), gc({ measurements: m })).outcome.progress).toBeNull()
  })

  it("clamps progress to 0–1 but keeps the raw value for status", () => {
    const e = evaluateGoal(goal(), gc({ measurements: measures("g1", { "2026-10-01": 84 }) }))
    expect(e.outcome.progress).toBe(0)
    expect(e.outcome.raw).toBeCloseTo(-0.5)
  })

  it("treats a target equal to the baseline as N/A", () => {
    expect(numericProgress({ baseline: 5, target: 5, direction: "up", aggregation: "last" }, 7)).toBeNull()
  })

  it("projects with a least-squares line once there are ≥3 points over ≥14 days", () => {
    // −0.1 kg/day from 82 on Sep 1: reaches 78 on Oct 11 → already achieved by data.
    const onTrack = goal({ dueDate: "2027-03-01" })
    const m = measures("g1", { "2026-09-01": 82, "2026-09-11": 81.5, "2026-09-21": 81, "2026-10-01": 80.5 })
    const e = evaluateGoal(onTrack, gc({ measurements: m }))
    expect(e.dataLevel).toBe("enough")
    expect(e.pace.actual).toBeCloseTo(0.05)
    // 181 days from Sep 1 to Mar 1: 82 − 0.05·181 = 72.95 → beyond the target
    expect(e.projection.value).toBeCloseTo(72.95, 1)
    expect(e.projection.reachOn).toBe("2026-11-20")
    expect(["on_track", "ahead"]).toContain(e.status.id)
    expect(e.status.basis).toBe("projection")
    // Required pace: (80.5 − 78) / days left
    expect(e.pace.required).toBeCloseTo(2.5 / 125)
  })

  it("flags 'behind' when the projection misses the due date", () => {
    const m = measures("g1", { "2026-09-01": 82, "2026-09-21": 81.9, "2026-10-21": 81.8 })
    const e = evaluateGoal(goal(), gc({ measurements: m }))
    expect(e.status).toEqual({ id: "behind", basis: "projection" })
  })

  it("marks the goal achieved when real data reaches the target", () => {
    const e = evaluateGoal(goal(), gc({ measurements: measures("g1", { "2026-10-10": 77.8 }) }))
    expect(e.status).toEqual({ id: "achieved", basis: "data" })
  })

  it("reaches numeric milestones automatically from data", () => {
    const g = goal({ checkpoints: [{ id: "a", title: "81", value: 81 }, { id: "b", title: "79", value: 79 }] })
    const e = evaluateGoal(g, gc({ measurements: measures("g1", { "2026-09-10": 81.5, "2026-09-20": 80.9, "2026-10-20": 80 }) }))
    expect(e.checkpoints.map((c) => [c.doneOn, c.auto])).toEqual([["2026-09-20", true], [null, true]])
  })
})

describe("numeric goals fed by a habit (no duplicate logging)", () => {
  const habit = makeHabit({ id: "med", type: "duration", unit: "min", target: 10, direction: "at_least", startDate: "2026-08-01" })
  const sumGoal = goal({
    kind: "numeric",
    numeric: { source: "habit", habitId: "med", aggregation: "sum", unit: "min", baseline: 0, target: 300, direction: "up" },
    startDate: "2026-10-01",
    dueDate: "2026-10-31",
  })

  it("sums the habit's own records inside the goal window only", () => {
    const e = evaluateGoal(sumGoal, gc({ habits: [habit], entries: entries("med", { "2026-09-30": 50, "2026-10-01": 20, "2026-10-15": 30, "2026-10-27": 10 }) }))
    expect(e.outcome.current).toBe(60)
    expect(e.outcome.progress).toBeCloseTo(0.2)
    expect(e.series.map((p) => p.value)).toEqual([20, 50, 60])
  })

  it("ignores manual measurements for a habit-fed goal", () => {
    const e = evaluateGoal(sumGoal, gc({ habits: [habit], measurements: measures("g1", { "2026-10-10": 999 }) }))
    expect(e.outcome.current).toBeNull()
    expect(e.series).toEqual([])
  })

  it("a running total with no records is N/A, not 0 % and never 'on track'", () => {
    const e = evaluateGoal(sumGoal, gc({ habits: [habit] }))
    expect(e.outcome.progress).toBeNull()
    expect(e.outcome.reason).toMatch(/registros/)
    expect(e.status.id).toBe("no_data")
    expect(e.dataLevel).toBe("empty")
  })

  it("projects a total from the average daily pace", () => {
    const map = entries("med", Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`2026-10-${String(i + 1).padStart(2, "0")}`, 10])))
    const e = evaluateGoal(sumGoal, gc({ habits: [habit], entries: map }))
    // 200 min in 27 days → 7.41/day → +29.6 in the last 4 days
    expect(e.pace.actual).toBeCloseTo(200 / 27)
    expect(e.projection.value).toBeCloseTo(200 + (200 / 27) * 4)
    expect(e.status).toEqual({ id: "behind", basis: "projection" })
  })
})

describe("habit-based goals and effort", () => {
  const a = makeHabit({ id: "a", startDate: "2026-10-01" })
  const b = makeHabit({ id: "b", startDate: "2026-10-01", rule: { kind: "weekly_count", timesPerWeek: 2 } })
  const map = { ...entries("a", { "2026-10-20": true, "2026-10-21": true, "2026-10-22": true }), ...entries("b", { "2026-10-20": true }) }
  const g = goal({ kind: "habits", numeric: null, threshold: 0.8, startDate: "2026-10-20", dueDate: "2026-11-30", habits: [{ habitId: "a", weight: 1 }, { habitId: "b", weight: 1 }] })

  it("effort counts exactly the opportunities Analytics counts for the same habits and range", () => {
    const c = gc({ habits: [a, b], entries: map })
    const e = evaluateGoal(g, c)
    expect(e.effort!.summary).toEqual(completion([a, b], { from: "2026-10-20", to: TODAY }, c.ctx))
    // a: 3 of 8 (Oct 20–27, today pending); b: week of Oct 20 missed (1 of 2), current week in progress.
    expect(e.effort!.summary).toMatchObject({ fulfilled: 3, applicable: 9, inProgress: 1 })
  })

  it("progress is completion against the threshold", () => {
    const e = evaluateGoal(g, gc({ habits: [a, b], entries: map }))
    expect(e.outcome.current).toBeCloseTo(3 / 9)
    expect(e.outcome.progress).toBeCloseTo(3 / 9 / 0.8)
    expect(e.status).toEqual({ id: "behind", basis: "threshold" })
    expect(e.projection.value).toBeNull()
  })

  it("weights change the rate but never the counts", () => {
    const weighted = { ...g, habits: [{ habitId: "a", weight: 3 }, { habitId: "b", weight: 1 }] }
    const e = evaluateGoal(weighted, gc({ habits: [a, b], entries: map }))
    expect(e.effort!.weighted).toBe(true)
    expect(e.effort!.rate).toBeCloseTo((3 * 3 + 0) / (3 * 8 + 1))
    expect(e.effort!.summary.applicable).toBe(9)
  })

  it("is N/A before any applicable opportunity, and before the start date", () => {
    expect(evaluateGoal({ ...g, startDate: "2026-11-01" }, gc({ habits: [a, b] })).status.id).toBe("not_started")
    const rest = gc({ habits: [a], rest: ["2026-10-27"], today: TODAY })
    expect(evaluateGoal({ ...g, startDate: TODAY, habits: [{ habitId: "a", weight: 1 }] }, rest).outcome.progress).toBeNull()
  })

  it("keeps an archived habit's history inside the window", () => {
    const archived = { ...a, archivedOn: "2026-10-23" }
    const e = evaluateGoal(g, gc({ habits: [archived], entries: map }))
    expect(e.effort!.perHabit[0].summary).toMatchObject({ fulfilled: 3, applicable: 3 })
  })

  it("counts days correctly across the DST change (Oct 25)", () => {
    const e = evaluateGoal({ ...g, startDate: "2026-10-24" }, gc({ habits: [a], entries: map }))
    expect(e.daysElapsed).toBe(4)
    expect(e.effort!.perHabit[0].summary.applicable).toBe(4)
  })
})

describe("milestone goals", () => {
  const g = goal({
    kind: "milestones",
    numeric: null,
    startDate: "2026-09-01",
    dueDate: "2026-12-31",
    checkpoints: [
      { id: "1", title: "Uno", doneOn: "2026-09-10" },
      { id: "2", title: "Dos", doneOn: "2026-10-01" },
      { id: "3", title: "Tres", doneOn: null },
      { id: "4", title: "Cuatro", doneOn: "2026-12-01" },
    ],
  })

  it("progress is milestones done over total; a future date does not count", () => {
    const e = evaluateGoal(g, gc())
    expect(e.outcome.current).toBe(2)
    expect(e.outcome.progress).toBe(0.5)
    expect(e.series).toEqual([{ date: "2026-09-10", value: 1 }, { date: "2026-10-01", value: 2 }])
  })

  it("projects once 2 milestones are done over ≥14 days", () => {
    const e = evaluateGoal(g, gc())
    expect(e.dataLevel).toBe("enough")
    expect(e.pace.actual).toBeCloseTo(2 / 57)
    expect(e.projection.progress).toBeCloseTo(Math.min(4, 2 + (2 / 57) * 65) / 4)
  })

  it("with no milestones it is N/A", () => {
    expect(evaluateGoal({ ...g, checkpoints: [] }, gc()).outcome.reason).toMatch(/Añade hitos/)
  })
})

describe("horizon, state and hierarchy", () => {
  it("derives the horizon from the time left, unless overridden", () => {
    expect(horizonOf({ dueDate: "2026-12-31", horizonOverride: null }, TODAY)).toBe("short")
    expect(horizonOf({ dueDate: "2027-06-30", horizonOverride: null }, TODAY)).toBe("medium")
    expect(horizonOf({ dueDate: "2028-01-01", horizonOverride: null }, TODAY)).toBe("long")
    expect(horizonOf({ dueDate: "2028-01-01", horizonOverride: "short" }, TODAY)).toBe("short")
  })

  it("explicit states win; past the due date it is overdue", () => {
    const m = measures("g1", { "2026-09-05": 81 })
    expect(evaluateGoal(goal({ state: "abandoned" }), gc({ measurements: m })).status.id).toBe("abandoned")
    expect(evaluateGoal(goal({ dueDate: "2026-10-01" }), gc({ measurements: m })).status.id).toBe("overdue")
  })

  it("a parent aggregates its children only when asked", () => {
    const parent = goal({ id: "p", kind: "milestones", numeric: null, checkpoints: [{ id: "x", title: "x", doneOn: null }] })
    const c1 = goal({ id: "c1", parentId: "p" })
    const c2 = goal({ id: "c2", parentId: "p" })
    const m = { ...measures("c1", { "2026-10-01": 80 }), ...measures("c2", { "2026-10-01": 78 }) }
    expect(evaluateGoals([parent, c1, c2], gc({ measurements: m })).get("p")!.outcome.progress).toBe(0)
    const agg = evaluateGoals([{ ...parent, aggregateChildren: true }, c1, c2], gc({ measurements: m }))
    expect(agg.get("p")!.outcome.progress).toBeCloseTo(0.75)
  })
})
