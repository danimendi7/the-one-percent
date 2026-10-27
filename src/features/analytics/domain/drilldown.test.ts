import { describe, expect, it } from "vitest"
import { addDays, eachDay, type Weekday } from "@/features/habits/domain/dates"
import { completion, dailyRates, weekdayConsistency, weeklySeries } from "@/features/habits/domain/metrics"
import { ctx, entries, makeHabit } from "@/features/habits/domain/test-helpers"
import { drilldown } from "./drilldown"

// Scenario around the Europe/Madrid DST fall-back (Sunday 25 Oct 2026) with a schedule
// change mid-period, a weekly target, a numeric habit, a rest day and today pending.
const today = "2026-10-28" // Wednesday
const read = makeHabit({ id: "read", name: "Leer", startDate: "2026-10-12" })
read.schedule.push({ validFrom: "2026-10-22", rule: { kind: "weekdays", weekdays: [1, 3, 5] } })
const gym = makeHabit({ id: "gym", name: "Gimnasio", startDate: "2026-10-12", rule: { kind: "weekly_count", timesPerWeek: 3 } })
const water = makeHabit({ id: "water", name: "Agua", type: "numeric", unit: "l", target: 2, direction: "at_least", startDate: "2026-10-12" })
const habits = [read, gym, water]
const map = {
  ...entries("read", { "2026-10-12": true, "2026-10-14": true, "2026-10-21": true, "2026-10-23": true, "2026-10-26": true }),
  ...entries("gym", { "2026-10-13": true, "2026-10-15": true, "2026-10-17": true, "2026-10-20": true, "2026-10-26": true }),
  ...entries("water", { "2026-10-24": 2.5, "2026-10-25": 1.5, "2026-10-26": 2 }),
}
const c = ctx(today, map, ["2026-10-18"])
const range = { from: "2026-10-12", to: today }

describe("drilldown reproduces every analytics figure exactly", () => {
  it("whole period: same summary as completion()", () => {
    expect(drilldown(habits, { kind: "range", range }, c).summary).toEqual(completion(habits, range, c))
  })

  it("each calendar day: same fulfilled/applicable as the heatmap", () => {
    for (const d of dailyRates(habits, range, c)) {
      const s = drilldown(habits, { kind: "day", date: d.date }, c).summary
      expect([s.fulfilled, s.applicable], d.date).toEqual([d.fulfilled, d.applicable])
    }
  })

  it("each weekday column: same rate and base as the weekday chart", () => {
    for (const w of weekdayConsistency(habits, range, c)) {
      const s = drilldown(habits, { kind: "weekday", weekday: w.weekday as Weekday, range }, c).summary
      expect([s.rate, s.applicable], `weekday ${w.weekday}`).toEqual([w.rate, w.applicable])
    }
  })

  it("each trend week (including the 25-hour DST week): same rate as the weekly trend", () => {
    for (const w of weeklySeries(habits, 3, c)) {
      const s = drilldown(habits, { kind: "week", weekStart: w.weekStart }, c).summary
      expect([s.rate, s.applicable], w.weekStart).toEqual([w.rate, w.applicable])
    }
  })

  it("the same inputs always give the same numbers (no hidden state)", () => {
    const a = drilldown(habits, { kind: "range", range }, c)
    const b = drilldown([...habits].reverse(), { kind: "range", range }, ctx(today, { ...map }, ["2026-10-18"]))
    expect(b.summary).toEqual(a.summary)
    expect(b.rows).toEqual(a.rows)
  })
})

describe("drilldown rows", () => {
  it("list the real opportunities worst first, never future ones", () => {
    const { rows } = drilldown(habits, { kind: "range", range }, c)
    const statuses = rows.map((r) => r.status)
    expect(statuses.indexOf("missed")).toBeLessThan(statuses.lastIndexOf("fulfilled"))
    expect(rows.every((r) => r.date <= today)).toBe(true)
    expect(rows.some((r) => (r.status as string) === "future")).toBe(false)
  })

  it("follow the schedule version in force each day (Leer: daily, then Mon/Wed/Fri from 22 Oct)", () => {
    const leer = drilldown([read], { kind: "range", range }, c).rows.map((r) => r.date).sort()
    const before = eachDay("2026-10-12", "2026-10-21").filter((d) => d !== "2026-10-18") // rest day is exempt, listed separately
    expect(leer.filter((d) => d < "2026-10-22")).toEqual([...before, "2026-10-18"].sort())
    expect(leer.filter((d) => d >= "2026-10-22")).toEqual(["2026-10-23", "2026-10-26", "2026-10-28"])
  })

  it("show weekly targets as one row per week with progress, the open week in progress", () => {
    const g = drilldown([gym], { kind: "range", range }, c).rows
    expect(g.map((r) => [r.date, r.status, r.achieved, r.target])).toEqual([
      ["2026-10-19", "missed", 1, 3],
      ["2026-10-26", "in_progress", 1, 3],
      // Week of the rest day: 6 available days, target stays 3, achieved 3.
      ["2026-10-12", "fulfilled", 3, 3],
    ])
  })

  it("never count a missing numeric value as success; a value under the minimum is a miss", () => {
    const w = drilldown([water], { kind: "range", range: { from: "2026-10-24", to: "2026-10-26" } }, c).rows
    expect(Object.fromEntries(w.map((r) => [r.date, r.status]))).toEqual({
      "2026-10-24": "fulfilled",
      "2026-10-25": "missed",
      "2026-10-26": "fulfilled",
    })
  })

  it("today is pending, not missed", () => {
    const t = drilldown(habits, { kind: "day", date: today }, c).rows
    expect(t.find((r) => r.habitId === "read")?.status).toBe("pending")
  })

  it("an empty scope is N/A, not 0%", () => {
    expect(drilldown([], { kind: "range", range }, c).summary.rate).toBeNull()
    expect(drilldown(habits, { kind: "day", date: addDays(today, 1) }, c).summary.rate).toBeNull()
  })
})
