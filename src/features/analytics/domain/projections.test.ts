import { describe, expect, it } from "vitest"
import { addDays } from "@/features/habits/domain/dates"
import { ctx, entries, makeHabit } from "@/features/habits/domain/test-helpers"
import type { HabitsState } from "@/features/habits/domain/types"
import { PROJECTION_MIN_WEEKS, PROJECTION_WINDOW_WEEKS, projectCompletion, projectFocus, projectNext } from "./projections"

// A Wednesday; the last closed week is Monday 12 to Sunday 18 Oct.
const TODAY = "2026-10-21"
const closedWeek = (back: number) => addDays("2026-10-12", -7 * back)

const session = (date: string, minutes: number) => ({
  id: `f-${date}`,
  state: "finished",
  localDate: date,
  project: null,
  plannedMinutes: minutes,
  rating: null,
  segments: [{ start: `${date}T08:00:00.000Z`, end: new Date(Date.parse(`${date}T08:00:00.000Z`) + minutes * 60_000).toISOString() }],
})
const focusState = (sessions: ReturnType<typeof session>[]) => ({ focusSessions: sessions }) as unknown as Pick<HabitsState, "focusSessions">

describe("projectNext", () => {
  it("follows a straight line one step ahead, with no margin on a perfect fit", () => {
    expect(projectNext([{ x: 0, y: 10 }, { x: 1, y: 20 }, { x: 2, y: 30 }], 3, { min: 0, max: 100 })).toEqual({ value: 40, low: 40, high: 40 })
  })

  it("stays inside the bounds", () => {
    const up = projectNext([{ x: 0, y: 0.8 }, { x: 1, y: 0.9 }, { x: 2, y: 1 }], 3, { min: 0, max: 1 })
    expect(up.value).toBe(1)
    const down = projectNext([{ x: 0, y: 0.2 }, { x: 1, y: 0.1 }, { x: 2, y: 0 }], 3, { min: 0, max: 1 })
    expect(down.value).toBe(0)
  })

  it("widens the margin when the weeks are scattered", () => {
    const r = projectNext([{ x: 0, y: 0.2 }, { x: 1, y: 0.8 }, { x: 2, y: 0.2 }, { x: 3, y: 0.8 }], 4, { min: 0, max: 1 })
    expect(r.high - r.low).toBeGreaterThan(0.3)
  })
})

describe("habit completion", () => {
  const habit = (weeks: number) => makeHabit({ id: "h1", startDate: closedWeek(weeks - 1) })
  const allDone = (weeks: number) => {
    const out: Record<string, boolean> = {}
    for (let i = 0; i < weeks * 7; i++) out[addDays(closedWeek(weeks - 1), i)] = true
    return out
  }

  it("gives no projection with too few closed weeks, and says how many there are", () => {
    const weeks = PROJECTION_MIN_WEEKS - 1
    const p = projectCompletion({ habits: [habit(weeks)] }, ctx(TODAY, entries("h1", allDone(weeks))))
    expect(p).toMatchObject({ status: "few_weeks", weeks })
    expect(p.status === "few_weeks" && p.reason).toContain(`hay ${weeks}`)
    expect(p).not.toHaveProperty("value")
  })

  it("gives no projection with no habits at all", () => {
    expect(projectCompletion({ habits: [] }, ctx(TODAY))).toMatchObject({ status: "few_weeks", weeks: 0 })
  })

  it("projects from the minimum on, with its margin and limits", () => {
    const p = projectCompletion({ habits: [habit(PROJECTION_MIN_WEEKS)] }, ctx(TODAY, entries("h1", allDone(PROJECTION_MIN_WEEKS))))
    expect(p).toMatchObject({ status: "shown", weeks: PROJECTION_MIN_WEEKS, value: 1, low: 1, high: 1 })
    expect(p.status === "shown" && p.limitations.length).toBeGreaterThan(0)
  })

  it("ignores the open week", () => {
    const done = { ...allDone(PROJECTION_MIN_WEEKS), [addDays(TODAY, -1)]: false }
    const p = projectCompletion({ habits: [habit(PROJECTION_MIN_WEEKS)] }, ctx(TODAY, entries("h1", done)))
    expect(p).toMatchObject({ status: "shown", value: 1 })
  })
})

describe("focus minutes", () => {
  const steady = (weeks: number, minutes: number) => Array.from({ length: weeks }, (_, i) => session(closedWeek(i), minutes))

  it("gives no projection before enough weeks have passed since the first session", () => {
    expect(projectFocus(focusState(steady(PROJECTION_MIN_WEEKS - 1, 60)), TODAY)).toMatchObject({ status: "few_weeks", weeks: PROJECTION_MIN_WEEKS - 1 })
    expect(projectFocus(focusState([]), TODAY)).toMatchObject({ status: "few_weeks", weeks: 0 })
  })

  it("projects steady weeks as they are", () => {
    expect(projectFocus(focusState(steady(PROJECTION_WINDOW_WEEKS, 60)), TODAY)).toMatchObject({ status: "shown", weeks: PROJECTION_WINDOW_WEEKS, value: 60, low: 60, high: 60 })
  })

  it("counts an empty week after the first session as 0, not as missing", () => {
    const sessions = steady(PROJECTION_WINDOW_WEEKS, 60).filter((_, i) => i !== 2)
    expect(projectFocus(focusState(sessions), TODAY)).toMatchObject({ status: "shown", weeks: PROJECTION_WINDOW_WEEKS })
  })

  it("never goes below zero", () => {
    const falling = [140, 120, 100, 80, 60, 40, 20, 0].map((m, i) => session(closedWeek(7 - i), Math.max(m, 1)))
    const p = projectFocus(focusState(falling), TODAY)
    expect(p.status === "shown" && p.value).toBe(0)
  })
})
