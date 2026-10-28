import { describe, expect, it } from "vitest"
import type { FocusSession } from "./types"
import { focusDataLevel, focusSeries, focusStreak, NO_PROJECT, sessionsIn, sessionsInBucket, summarizeSessions } from "./metrics"

const TODAY = "2026-10-21"

function s(id: string, date: string, minutes: number, extra: Partial<FocusSession> = {}): FocusSession {
  const start = new Date(`${date}T09:00:00+02:00`).getTime()
  return {
    id,
    habitId: null,
    project: "Tesis",
    plannedOutput: null,
    actualOutput: null,
    plannedMinutes: 50,
    segments: [{ start: new Date(start).toISOString(), end: new Date(start + minutes * 60_000).toISOString() }],
    state: "finished",
    localDate: date,
    rating: null,
    createdAt: "",
    updatedAt: "",
    ...extra,
  }
}

const all = { range: { from: "2026-10-01", to: TODAY }, project: "all" as const }

describe("focus figures (catalog v3)", () => {
  const state = {
    focusSessions: [
      s("a", "2026-10-21", 50, { rating: 4 }),
      s("b", "2026-10-20", 30, { project: "Web", rating: 2 }),
      s("c", "2026-10-19", 90, { project: null }),
      s("d", "2026-10-21", 10, { state: "running", segments: [{ start: "2026-10-21T10:00:00.000Z", end: null }] }),
    ],
  }

  it("counts only finished sessions; complete = effective ≥ planned; rating mean shows n of N", () => {
    const sum = summarizeSessions(sessionsIn(state, all))
    expect(sum).toMatchObject({ sessions: 3, minutes: 170, complete: 2, rated: 2, avgRating: 3, days: 3 })
    expect(sum.completeRate).toBeCloseTo(2 / 3)
    expect(sum.byProject.map((p) => [p.project, p.minutes])).toEqual([[NO_PROJECT, 90], ["Tesis", 50], ["Web", 30]])
  })

  it("N/D instead of 0 when nothing qualifies", () => {
    const none = summarizeSessions([])
    expect(none.completeRate).toBeNull()
    expect(none.avgRating).toBeNull()
    expect(none.minutes).toBe(0)
  })

  it("filters by project (case-insensitive) and by the «Sin proyecto» group", () => {
    expect(sessionsIn(state, { ...all, project: "tesis" }).map((x) => x.id)).toEqual(["a"])
    expect(sessionsIn(state, { ...all, project: NO_PROJECT }).map((x) => x.id)).toEqual(["c"])
  })

  it("streak: consecutive days up to today; an empty today does not break it", () => {
    expect(focusStreak(state, TODAY)).toBe(3)
    expect(focusStreak(state, "2026-10-22")).toBe(3)
    expect(focusStreak(state, "2026-10-23")).toBe(0)
  })

  it("three data states", () => {
    expect(focusDataLevel({ focusSessions: [] }, all, TODAY)).toBe("none")
    expect(focusDataLevel(state, all, TODAY)).toBe("few")
    const many = { focusSessions: [s("1", "2026-10-05", 25), s("2", "2026-10-12", 25), s("3", "2026-10-20", 25)] }
    expect(focusDataLevel(many, all, TODAY)).toBe("enough")
  })

  it("series is zero-filled; each bar opens exactly its sessions", () => {
    const week = { range: { from: "2026-10-15", to: TODAY }, project: "all" as const }
    const { unit, points } = focusSeries(state, week)
    expect(unit).toBe("day")
    expect(points).toHaveLength(7)
    expect(points.find((p) => p.date === "2026-10-20")).toMatchObject({ minutes: 30, sessions: 1 })
    expect(sessionsInBucket(state, week, "day", "2026-10-21").map((x) => x.id)).toEqual(["a"])
    const long = focusSeries(state, { range: { from: "2026-07-24", to: TODAY }, project: "all" })
    expect(long.unit).toBe("week")
    expect(long.points.reduce((a, p) => a + p.minutes, 0)).toBe(170)
  })
})
