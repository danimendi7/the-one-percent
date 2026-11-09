import { describe, expect, it } from "vitest"
import { addDays, eachDay } from "@/features/habits/domain/dates"
import { entries, makeHabit, makeState } from "@/features/habits/domain/test-helpers"
import type { HabitsState } from "@/features/habits/domain/types"
import { setCheckin } from "@/features/mind/domain/ops"
import { COMPARISON_MIN_CHECKINS, comparePeriods, type ComparisonMetric } from "./comparisons"

// A Wednesday.
const TODAY = "2026-10-21"
const rowOf = (c: ReturnType<typeof comparePeriods>, m: ComparisonMetric) => c.rows.find((r) => r.metric === m)!

function energy(s: HabitsState, days: string[], value: number): HabitsState {
  return days.reduce((st, date) => setCheckin(st, { date, phase: "am", values: { energy: value }, at: `${date}T08:00:00.000Z`, today: TODAY }).state, s)
}
function session(date: string, minutes: number) {
  const end = new Date(Date.parse(`${date}T08:00:00.000Z`) + minutes * 60_000).toISOString()
  return { id: `f-${date}`, state: "finished", localDate: date, project: null, plannedMinutes: minutes, rating: null, segments: [{ start: `${date}T08:00:00.000Z`, end }] }
}

describe("the periods compared", () => {
  it("are the last closed week and the one before, never the open one", () => {
    const c = comparePeriods(makeState([]), "week", TODAY)
    expect(c.after).toMatchObject({ from: "2026-10-12", to: "2026-10-18" })
    expect(c.before).toMatchObject({ from: "2026-10-05", to: "2026-10-11" })
  })

  it("are calendar months, across a year too", () => {
    const c = comparePeriods(makeState([]), "month", "2026-01-15")
    expect(c.after).toMatchObject({ from: "2025-12-01", to: "2025-12-31" })
    expect(c.before).toMatchObject({ from: "2025-11-01", to: "2025-11-30" })
  })
})

describe("habit completion", () => {
  it("compares the rates and gives the change", () => {
    const h = makeHabit({ id: "h1", startDate: "2026-09-01" })
    const done = (from: string, n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [addDays(from, i), true]))
    const s = makeState([h], entries("h1", { ...done("2026-10-05", 7), ...done("2026-10-12", 3) }))
    const r = rowOf(comparePeriods(s, "week", TODAY), "completion")
    expect(r.before).toBe(1)
    expect(r.after).toBeCloseTo(3 / 7)
    expect(r.delta).toBeCloseTo(3 / 7 - 1)
    expect(r.reason).toBeNull()
  })

  it("is N/D with a reason when a period had nothing applicable, never 0", () => {
    const h = makeHabit({ id: "h1", startDate: "2026-10-12" })
    const r = rowOf(comparePeriods(makeState([h]), "week", TODAY), "completion")
    expect(r).toMatchObject({ before: null, after: 0, delta: null })
    expect(r.reason).toContain("Sin hábitos aplicables")
  })
})

describe("focus", () => {
  it("sums the minutes of each period; a later week without sessions is 0", () => {
    const s = { ...makeState([]), focusSessions: [session("2026-10-06", 50), session("2026-10-07", 30)] } as unknown as HabitsState
    expect(rowOf(comparePeriods(s, "week", TODAY), "focus")).toMatchObject({ before: 80, after: 0, delta: -80 })
  })

  it("is N/D for a period before the first session ever", () => {
    const s = { ...makeState([]), focusSessions: [session("2026-10-13", 25)] } as unknown as HabitsState
    const r = rowOf(comparePeriods(s, "week", TODAY), "focus")
    expect(r).toMatchObject({ before: null, after: 25, delta: null })
    expect(r.reason).toContain("Enfoque")
  })

  it("is N/D with no sessions at all", () => {
    expect(rowOf(comparePeriods(makeState([]), "week", TODAY), "focus")).toMatchObject({ before: null, after: null, delta: null })
  })
})

describe("check-ins", () => {
  const week = (from: string, n: number) => eachDay(from, addDays(from, n - 1))

  it("compares the means once each side reaches the minimum", () => {
    const min = COMPARISON_MIN_CHECKINS.week
    const s = energy(energy(makeState([]), week("2026-10-05", min), 2), week("2026-10-12", min), 4)
    expect(rowOf(comparePeriods(s, "week", TODAY), "energy")).toMatchObject({ before: 2, after: 4, delta: 2, reason: null })
  })

  it("does not compare below the minimum, and says it", () => {
    const min = COMPARISON_MIN_CHECKINS.week
    const s = energy(energy(makeState([]), week("2026-10-05", min - 1), 2), week("2026-10-12", min), 4)
    const r = rowOf(comparePeriods(s, "week", TODAY), "energy")
    expect(r).toMatchObject({ before: null, after: 4, delta: null })
    expect(r.reason).toContain(`${min} días`)
  })

  it("asks a month for more days than a week", () => {
    expect(COMPARISON_MIN_CHECKINS.month).toBeGreaterThan(COMPARISON_MIN_CHECKINS.week)
    const s = energy(energy(makeState([]), week("2026-08-01", 6), 2), week("2026-09-01", 7), 4)
    expect(rowOf(comparePeriods(s, "month", TODAY), "energy")).toMatchObject({ before: null, after: 4, delta: null })
  })
})
