import { describe, expect, it } from "vitest"
import {
  completion,
  currentStreak,
  dailyRates,
  habitOpportunities,
  planProgress,
  todayProgress,
  weekdayConsistency,
} from "./metrics"
import { changeSchedule, isEligibleDay, isFulfilled } from "./schedule"
import { ctx, entries, makeHabit } from "./test-helpers"

// October 2026: Mondays are 5, 12, 19, 26. Wednesdays are 7, 14, 21, 28.

describe("schedule eligibility", () => {
  it("a Monday/Wednesday habit only appears on those days (acceptance #1)", () => {
    const h = makeHabit({ rule: { kind: "weekdays", weekdays: [1, 3] } })
    const week = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]
    expect(week.map((d) => isEligibleDay(h, d))).toEqual([true, false, true, false, false, false, false])
  })

  it("is inactive before the start date and from the archive date", () => {
    const h = makeHabit({ startDate: "2026-10-10", archivedOn: "2026-10-20" })
    expect(isEligibleDay(h, "2026-10-09")).toBe(false)
    expect(isEligibleDay(h, "2026-10-10")).toBe(true)
    expect(isEligibleDay(h, "2026-10-19")).toBe(true)
    expect(isEligibleDay(h, "2026-10-20")).toBe(false)
  })
})

describe("versioned schedules keep historical denominators", () => {
  it("changing Mon/Wed → daily mid-month does not alter earlier weeks (acceptance #1)", () => {
    const original = makeHabit({ rule: { kind: "weekdays", weekdays: [1, 3] } })
    const firstHalf = { from: "2026-10-01", to: "2026-10-14" }
    const c = ctx("2026-10-24")
    const before = completion([original], firstHalf, c)
    expect(before.applicable).toBe(4) // 5, 7, 12, 14 Oct

    const changed = changeSchedule(original, { kind: "daily" }, "2026-10-15")
    expect(completion([changed], firstHalf, c).applicable).toBe(4)
    // 15–24 Oct is now daily: 10 opportunities, today pending
    expect(completion([changed], { from: "2026-10-15", to: "2026-10-24" }, c).applicable).toBe(10)
    expect(changed.schedule).toHaveLength(2)
  })

  it("supersedes versions that start on/after the change date", () => {
    let h = makeHabit()
    h = changeSchedule(h, { kind: "weekdays", weekdays: [1] }, "2026-10-10")
    h = changeSchedule(h, { kind: "weekdays", weekdays: [2] }, "2026-10-10")
    expect(h.schedule.map((v) => v.validFrom)).toEqual(["2026-10-01", "2026-10-10"])
    expect(h.schedule[1].rule).toEqual({ kind: "weekdays", weekdays: [2] })
  })
})

describe("completion rate", () => {
  it("counts only scheduled opportunities; non-scheduled days carry no penalty", () => {
    const h = makeHabit({ rule: { kind: "weekdays", weekdays: [1, 3] } })
    const map = entries("h1", { "2026-10-05": true, "2026-10-06": true /* Tuesday: ignored */ })
    const s = completion([h], { from: "2026-10-05", to: "2026-10-11" }, ctx("2026-10-24", map))
    expect(s).toMatchObject({ fulfilled: 1, applicable: 2, rate: 0.5 })
  })

  it("returns N/A (null), not 0 or 100, when everything is exempt", () => {
    const h = makeHabit()
    const s = completion([h], { from: "2026-10-05", to: "2026-10-06" }, ctx("2026-10-24", {}, ["2026-10-05", "2026-10-06"]))
    expect(s.rate).toBeNull()
    expect(s.exempt).toBe(2)
  })

  it("excludes future days and counts today as pending", () => {
    const h = makeHabit()
    const s = completion([h], { from: "2026-10-22", to: "2026-10-26" }, ctx("2026-10-24", entries("h1", { "2026-10-22": true })))
    expect(s).toMatchObject({ fulfilled: 1, missed: 1, pending: 1, applicable: 3 })
  })

  it("never double-counts the same opportunity", () => {
    const h = makeHabit()
    const map = entries("h1", { "2026-10-20": true })
    // Same key written twice collapses to one entry by construction
    map["h1:2026-10-20"] = { ...map["h1:2026-10-20"], opId: "second" }
    expect(completion([h], { from: "2026-10-20", to: "2026-10-20" }, ctx("2026-10-24", map)).fulfilled).toBe(1)
  })
})

describe("numeric targets", () => {
  const steps = makeHabit({ id: "steps", type: "numeric", unit: "pasos", target: 8000, direction: "at_least" })
  const coffee = makeHabit({ id: "coffee", type: "numeric", unit: "tazas", target: 2, direction: "at_most" })

  it("at_least is met at or above target and preserves the exact amount", () => {
    const map = entries("steps", { "2026-10-20": 12034 })
    expect(isFulfilled(steps, map["steps:2026-10-20"])).toBe(true)
    expect(map["steps:2026-10-20"].value).toBe(12034)
    expect(isFulfilled(steps, entries("steps", { "2026-10-20": 7999 })["steps:2026-10-20"])).toBe(false)
  })

  it("at_most counts a recorded 0 as success but a missing value never does", () => {
    expect(isFulfilled(coffee, entries("coffee", { "2026-10-20": 0 })["coffee:2026-10-20"])).toBe(true)
    expect(isFulfilled(coffee, entries("coffee", { "2026-10-20": 3 })["coffee:2026-10-20"])).toBe(false)
    expect(isFulfilled(coffee, undefined)).toBe(false)
  })
})

describe("weekly-count habits are evaluated at period level", () => {
  const h = makeHabit({ rule: { kind: "weekly_count", timesPerWeek: 3 } })

  it("produces one opportunity per week, not seven", () => {
    const map = entries("h1", { "2026-10-05": true, "2026-10-08": true, "2026-10-10": true })
    const opps = habitOpportunities(h, { from: "2026-10-05", to: "2026-10-11" }, ctx("2026-10-24", map))
    expect(opps).toHaveLength(1)
    expect(opps[0]).toMatchObject({ kind: "week", achieved: 3, target: 3, status: "fulfilled" })
  })

  it("marks a closed week below target as missed", () => {
    const map = entries("h1", { "2026-10-12": true })
    const s = completion([h], { from: "2026-10-12", to: "2026-10-18" }, ctx("2026-10-24", map))
    expect(s).toMatchObject({ fulfilled: 0, missed: 1, rate: 0 })
  })

  it("keeps an open, unmet week out of the denominator", () => {
    const map = entries("h1", { "2026-10-19": true })
    const s = completion([h], { from: "2026-10-19", to: "2026-10-24" }, ctx("2026-10-24", map))
    expect(s).toMatchObject({ applicable: 0, inProgress: 1, rate: null })
  })

  it("reduces the target when rest days leave fewer available days", () => {
    const rest = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]
    const map = entries("h1", { "2026-10-10": true, "2026-10-11": true })
    const [opp] = habitOpportunities(h, { from: "2026-10-05", to: "2026-10-11" }, ctx("2026-10-24", map, rest))
    expect(opp).toMatchObject({ target: 2, achieved: 2, status: "fulfilled" })
  })
})

describe("plan progress and today", () => {
  it("weekly plan includes future units so it only grows", () => {
    const daily = makeHabit({ id: "a" })
    const weekly = makeHabit({ id: "b", rule: { kind: "weekly_count", timesPerWeek: 2 } })
    const map = { ...entries("a", { "2026-10-19": true, "2026-10-20": true }), ...entries("b", { "2026-10-19": true }) }
    const p = planProgress([daily, weekly], { from: "2026-10-19", to: "2026-10-25" }, ctx("2026-10-21", map))
    expect(p).toEqual({ done: 3, planned: 9, ratio: 3 / 9 })
  })

  it("today progress ignores weekly-count habits and rest days", () => {
    const a = makeHabit({ id: "a" })
    const b = makeHabit({ id: "b", rule: { kind: "weekly_count", timesPerWeek: 2 } })
    expect(todayProgress([a, b], ctx("2026-10-21", entries("a", { "2026-10-21": true })))).toEqual({ done: 1, total: 1 })
    expect(todayProgress([a, b], ctx("2026-10-21", {}, ["2026-10-21"]))).toEqual({ done: 0, total: 0 })
  })
})

describe("streaks", () => {
  it("skips unscheduled and rest days, and today's pending does not break it", () => {
    const h = makeHabit({ rule: { kind: "weekdays", weekdays: [1, 3, 5] } })
    const map = entries("h1", { "2026-10-12": true, "2026-10-14": true, "2026-10-19": true })
    // 16 Oct (Fri) is a rest day; today 21 Oct (Wed) not done yet
    expect(currentStreak(h, ctx("2026-10-21", map, ["2026-10-16"]))).toEqual({ count: 3, unit: "day" })
  })

  it("breaks on a missed opportunity", () => {
    const h = makeHabit()
    const map = entries("h1", { "2026-10-18": true, "2026-10-20": true })
    expect(currentStreak(h, ctx("2026-10-21", map)).count).toBe(1)
  })

  it("counts weekly habits in weeks", () => {
    const h = makeHabit({ rule: { kind: "weekly_count", timesPerWeek: 1 } })
    const map = entries("h1", { "2026-10-06": true, "2026-10-13": true })
    expect(currentStreak(h, ctx("2026-10-21", map))).toEqual({ count: 2, unit: "week" })
  })
})

describe("aggregations", () => {
  it("daily rates are null on days without applicable opportunities", () => {
    const h = makeHabit({ rule: { kind: "weekdays", weekdays: [1] } })
    const rates = dailyRates([h], { from: "2026-10-19", to: "2026-10-20" }, ctx("2026-10-24", entries("h1", { "2026-10-19": true })))
    expect(rates).toEqual([
      { date: "2026-10-19", rate: 1, fulfilled: 1, applicable: 1 },
      { date: "2026-10-20", rate: null, fulfilled: 0, applicable: 0 },
    ])
  })

  it("weekday consistency groups by ISO weekday", () => {
    const h = makeHabit()
    const map = entries("h1", { "2026-10-05": true, "2026-10-12": true })
    const rows = weekdayConsistency([h], { from: "2026-10-05", to: "2026-10-18" }, ctx("2026-10-24", map))
    expect(rows.find((r) => r.weekday === 1)).toEqual({ weekday: 1, rate: 1, applicable: 2 })
    expect(rows.find((r) => r.weekday === 2)).toEqual({ weekday: 2, rate: 0, applicable: 2 })
  })
})
