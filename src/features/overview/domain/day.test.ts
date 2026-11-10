import { describe, expect, it } from "vitest"
import { todayProgress } from "@/features/habits/domain/metrics"
import { ctx, entries, makeHabit } from "@/features/habits/domain/test-helpers"
import { daySummary } from "./day"

// Wednesday 21 Oct 2026; yesterday is Tuesday 20.
const TODAY = "2026-10-21"
const run = makeHabit({ id: "run", name: "Correr" })
const read = makeHabit({ id: "read", name: "Leer" })
const gym = makeHabit({ id: "gym", name: "Gimnasio", rule: { kind: "weekdays", weekdays: [1, 5] } })
const weekly = makeHabit({ id: "swim", name: "Nadar", rule: { kind: "weekly_count", timesPerWeek: 3 } })

describe("the day in the Command Center", () => {
  it("no active habit: nothing to measure, never a failure", () => {
    expect(daySummary([], [], ctx(TODAY))).toEqual({ kind: "no_habits", done: 0, pending: 0, rests: 0, missedYesterday: 0 })
  })

  it("tells done, pending and yesterday's misses apart, and agrees with todayProgress", () => {
    const c = ctx(TODAY, { ...entries("run", { [TODAY]: true, "2026-10-20": true }), ...entries("read", {}) })
    const s = daySummary([run, read], [run, read], c)
    expect(s).toEqual({ kind: "active", done: 1, pending: 1, rests: 0, missedYesterday: 1 })
    const p = todayProgress([run, read], c)
    expect([s.done, s.done + s.pending]).toEqual([p.done, p.total])
  })

  it("a planned rest day is rest, not «nothing scheduled» and not undone", () => {
    const s = daySummary([run, read], [run, read], ctx(TODAY, {}, [TODAY]))
    expect(s).toEqual({ kind: "rest", done: 0, pending: 0, rests: 2, missedYesterday: 2 })
  })

  it("a rest day yesterday leaves nothing undone yesterday", () => {
    expect(daySummary([run], [run], ctx(TODAY, {}, ["2026-10-20"])).missedYesterday).toBe(0)
  })

  it("habits that are not due today: nothing today, which is neither rest nor failure", () => {
    const s = daySummary([gym], [gym], ctx(TODAY))
    expect(s).toEqual({ kind: "nothing_today", done: 0, pending: 0, rests: 0, missedYesterday: 0 })
  })

  it("weekly targets are judged by the week: they never count as pending today or missed yesterday", () => {
    expect(daySummary([weekly], [weekly], ctx(TODAY))).toEqual({ kind: "nothing_today", done: 0, pending: 0, rests: 0, missedYesterday: 0 })
  })

  it("yesterday counts a habit archived today, but today does not", () => {
    const archived = makeHabit({ id: "old", archivedOn: TODAY })
    const s = daySummary([run], [run, archived], ctx(TODAY, entries("run", { "2026-10-20": true })))
    expect(s).toMatchObject({ done: 0, pending: 1, missedYesterday: 1 })
  })

  it("a habit that starts today was not missed yesterday", () => {
    const fresh = makeHabit({ id: "new", startDate: TODAY })
    expect(daySummary([fresh], [fresh], ctx(TODAY)).missedYesterday).toBe(0)
  })

  it("a numeric habit below its target yesterday counts as undone", () => {
    const water = makeHabit({ id: "water", type: "numeric", target: 8, direction: "at_least", unit: "vasos" })
    expect(daySummary([water], [water], ctx(TODAY, entries("water", { "2026-10-20": 5 }))).missedYesterday).toBe(1)
  })
})
