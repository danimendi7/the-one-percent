import { describe, expect, it } from "vitest"
import { addDays, eachDay } from "@/features/habits/domain/dates"
import { makeHabit, makeState } from "@/features/habits/domain/test-helpers"
import { entryKey, type HabitsState } from "@/features/habits/domain/types"
import type { FocusSession } from "@/features/focus/domain/types"
import { setCheckin } from "./ops"
import {
  average,
  changeVsPrevious,
  completionBySleep,
  coverage,
  dayValue,
  energyByFocus,
  mindDataLevel,
  rollingMean,
  series,
} from "./metrics"
import type { CheckinPhase, CheckinValues } from "./types"

const TODAY = "2026-10-31"

function put(s: HabitsState, date: string, phase: CheckinPhase, values: CheckinValues): HabitsState {
  return setCheckin(s, { date, phase, values, at: `${date}T08:00:00.000Z`, today: TODAY }).state
}

describe("values and averages ignore missing days (N/A, never 0)", () => {
  it("a day's value is one phase or the mean of both", () => {
    let s = put(makeState([]), "2026-10-30", "am", { energy: 4 })
    s = put(s, "2026-10-30", "pm", { energy: 2 })
    expect(dayValue(s, "2026-10-30", "energy", "both")).toBe(3)
    expect(dayValue(s, "2026-10-30", "energy", "am")).toBe(4)
    expect(dayValue(s, "2026-10-29", "energy", "both")).toBeNull()
  })

  it("average and coverage report their sample size", () => {
    let s = makeState([])
    s = put(s, "2026-10-29", "am", { mood: 3 })
    s = put(s, "2026-10-31", "pm", { mood: 5, note: "x" })
    const range = { from: "2026-10-25", to: TODAY }
    expect(average(series(s, range, "mood", "both"))).toEqual({ value: 4, n: 2 })
    expect(average(series(s, range, "stress", "both"))).toEqual({ value: null, n: 0 })
    expect(coverage(s, range)).toEqual({ days: 2, total: 7, rate: 2 / 7 })
  })

  it("the rolling mean leaves gaps where a window has fewer than 3 values (no interpolation)", () => {
    let s = makeState([])
    for (const d of ["2026-10-20", "2026-10-21", "2026-10-22"]) s = put(s, d, "am", { energy: 3 })
    const pts = rollingMean(series(s, { from: "2026-10-19", to: "2026-10-31" }, "energy", "both"))
    expect(pts.find((p) => p.date === "2026-10-21")!.value).toBeNull()
    expect(pts.find((p) => p.date === "2026-10-22")!.value).toBe(3)
    expect(pts.find((p) => p.date === "2026-10-29")!.value).toBeNull()
  })
})

describe("data states", () => {
  it("none (0 days), few (1–6 days), enough (≥ 7 days)", () => {
    const range = { from: "2026-10-02", to: TODAY }
    let s = makeState([])
    expect(mindDataLevel(s, range)).toBe("none")
    for (let i = 0; i < 6; i++) s = put(s, addDays(TODAY, -i), "am", { energy: 3 })
    expect(mindDataLevel(s, range)).toBe("few")
    s = put(s, addDays(TODAY, -6), "pm", { stress: 2 })
    expect(mindDataLevel(s, range)).toBe("enough")
  })

  it("the change vs. the previous period needs ≥ 7 days of data in both periods", () => {
    const range = { from: "2026-10-25", to: TODAY }
    let s = makeState([])
    for (const d of eachDay("2026-10-25", TODAY)) s = put(s, d, "am", { energy: 4 })
    expect(changeVsPrevious(s, range, "energy", "both")).toBeNull()
    for (const d of eachDay("2026-10-18", "2026-10-24")) s = put(s, d, "am", { energy: 2 })
    expect(changeVsPrevious(s, range, "energy", "both")).toMatchObject({ delta: 2, current: { n: 7 }, previous: { n: 7 } })
  })
})

describe("exploratory comparisons (decision 5): at least 5 days per group, never causal", () => {
  const session = (date: string, minutes: number): FocusSession => ({
    id: `s-${date}`,
    habitId: null,
    project: null,
    plannedOutput: null,
    actualOutput: null,
    plannedMinutes: minutes,
    segments: [{ start: `${date}T08:00:00.000Z`, end: new Date(Date.parse(`${date}T08:00:00.000Z`) + minutes * 60_000).toISOString() }],
    state: "finished",
    localDate: date,
    rating: null,
    createdAt: `${date}T08:00:00.000Z`,
    updatedAt: `${date}T08:00:00.000Z`,
  })

  it("energy on days with ≥ 60 min of Deep Work vs. the rest, hidden below 5 days per group", () => {
    let s = makeState([])
    const days = eachDay("2026-10-20", "2026-10-29")
    days.forEach((d, i) => (s = put(s, d, "pm", { energy: i < 5 ? 4 : 2 })))
    s = { ...s, focusSessions: days.slice(0, 5).map((d) => session(d, 90)) }
    const range = { from: "2026-10-20", to: TODAY }
    expect(energyByFocus(s, range)).toEqual({ a: { value: 4, n: 5 }, b: { value: 2, n: 5 }, shown: true })
    // 59 min does not reach the threshold; with 4 days in a group the comparison is not shown.
    s = { ...s, focusSessions: [...days.slice(0, 4).map((d) => session(d, 90)), session(days[4], 59)] }
    expect(energyByFocus(s, range)).toMatchObject({ a: { n: 4 }, b: { n: 6 }, shown: false })
  })

  it("habit completion after ≥ 7 h vs. < 7 h of sleep: pooled, closed days only", () => {
    const habit = makeHabit({ id: "h", startDate: "2026-10-01" })
    let s = makeState([habit])
    const days = eachDay("2026-10-20", TODAY)
    days.forEach((d, i) => {
      s = put(s, d, "am", { sleep: i % 2 === 0 ? 8 : 6 })
      if (i % 2 === 0) s = { ...s, entries: { ...s.entries, [entryKey("h", d)]: { habitId: "h", date: d, value: true, opId: d, updatedAt: d } } }
    })
    const r = completionBySleep(s, { from: "2026-10-20", to: TODAY }, TODAY)
    // 20..30 closed (11 days): 6 good-sleep days all done, 5 short-sleep days none; today excluded.
    expect(r).toEqual({ a: { value: 1, n: 6 }, b: { value: 0, n: 5 }, shown: true })
  })
})
