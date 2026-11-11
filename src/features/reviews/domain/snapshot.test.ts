import { describe, expect, it } from "vitest"
import { addDays, eachDay } from "@/features/habits/domain/dates"
import { completion, perfectDays, dailyRates } from "@/features/habits/domain/metrics"
import { entries, makeHabit, makeState } from "@/features/habits/domain/test-helpers"
import type { HabitsState } from "@/features/habits/domain/types"
import { evaluateGoals } from "@/features/goals/domain/progress"
import { measurementKey, type Goal } from "@/features/goals/domain/types"
import { sessionsIn, summarizeSessions } from "@/features/focus/domain/metrics"
import type { FocusSession } from "@/features/focus/domain/types"
import { setCheckin } from "@/features/mind/domain/ops"
import type { CheckinPhase, CheckinValues } from "@/features/mind/domain/types"
import { METRICS_VERSION } from "@/features/analytics/domain/catalog"
import { buildReviewSnapshot, compareSnapshot, goalsAsOf, sameFigures, SnapshotError, snapshotBytes, withoutNotes, type ReviewSnapshot } from "./snapshot"
import { LIMITS } from "./types"

// Week under review: Monday 19 → Sunday 25 October 2026 (summer time ends that Sunday).
const WEEK = "2026-10-19"
const AT = "2026-10-26T09:00:00.000Z"
const DIMENSIONS: HabitsState["dimensions"] = [
  { id: "body", name: "Cuerpo" },
  { id: "mind", name: "Mente" },
]

function checkin(s: HabitsState, date: string, phase: CheckinPhase, values: CheckinValues): HabitsState {
  return setCheckin(s, { date, phase, values, at: `${date}T08:00:00.000Z`, today: "2027-12-31" }).state
}

function session(id: string, date: string, minutes: number, p: Partial<FocusSession> = {}): FocusSession {
  const start = Date.parse(`${date}T09:00:00+02:00`)
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
    rating: 4,
    createdAt: "",
    updatedAt: "",
    ...p,
  }
}

function goal(p: Partial<Goal> = {}): Goal {
  return {
    id: "g1",
    title: "Bajar a 78 kg",
    kind: "numeric",
    numeric: { source: "manual", habitId: null, aggregation: "last", unit: "kg", baseline: 82, target: 78, direction: "down" },
    threshold: null,
    startDate: "2026-10-01",
    dueDate: "2026-12-31",
    priority: "primary",
    state: "active",
    habits: [],
    checkpoints: [],
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "",
    ...p,
  }
}

/** Two habits (daily and 3×/week), a goal, focus sessions and check-ins around the week under review. */
function fixture(): HabitsState {
  const daily = makeHabit({ id: "h1", name: "Leer", dimensionId: "body", startDate: "2026-10-01" })
  const weekly = makeHabit({ id: "h2", name: "Correr", dimensionId: "mind", startDate: "2026-10-01", rule: { kind: "weekly_count", timesPerWeek: 3 } })
  let s: HabitsState = {
    ...makeState(
      [daily, weekly],
      {
        ...entries("h1", { "2026-10-12": true, "2026-10-13": true, "2026-10-19": true, "2026-10-20": true, "2026-10-22": true, "2026-10-25": true }),
        ...entries("h2", { "2026-10-13": true, "2026-10-20": true, "2026-10-23": true, "2026-10-24": true }),
      },
      ["2026-10-21"]
    ),
    dimensions: DIMENSIONS,
    goals: [goal()],
    measurements: { [measurementKey("g1", "2026-10-20")]: { goalId: "g1", date: "2026-10-20", value: 80, opId: "m1", updatedAt: "" } },
    focusSessions: [session("f1", "2026-10-19", 50), session("f2", "2026-10-22", 30, { project: "Web", rating: null }), session("f0", "2026-10-14", 90)],
  }
  s = checkin(s, "2026-10-19", "am", { energy: 4, mood: 3, sleep: 7 })
  s = checkin(s, "2026-10-20", "pm", { energy: 2, stress: 4, note: "NOTA-PRIVADA-1" })
  return s
}

const build = (state: HabitsState, today: string, p: { kind?: "week" | "month"; start?: string; at?: string } = {}) =>
  buildReviewSnapshot({ state, kind: p.kind ?? "week", periodStart: p.start ?? WEEK, today, computedAt: p.at ?? AT })

/** Data written after the week: must not change a snapshot of that week. */
function laterData(s: HabitsState): HabitsState {
  let t: HabitsState = {
    ...s,
    entries: { ...s.entries, ...entries("h1", { "2026-10-26": true, "2026-11-03": true }), ...entries("h2", { "2026-10-27": true }) },
    restDays: [...s.restDays, "2026-11-02"],
    measurements: { ...s.measurements, [measurementKey("g1", "2026-11-05")]: { goalId: "g1", date: "2026-11-05", value: 78, opId: "m2", updatedAt: "" } },
    goals: s.goals.map((g) => ({ ...g, state: "achieved" as const, closedOn: "2026-11-05" })),
    focusSessions: [...s.focusSessions, session("f9", "2026-11-04", 120)],
  }
  t = checkin(t, "2026-11-01", "am", { energy: 1 })
  return t
}

describe("figures come from the Life Analytics functions (no formula of its own)", () => {
  it("habits, focus and goals equal the screens' figures for the same range", () => {
    const s = fixture()
    const today = "2026-11-20"
    const snap = build(s, today)
    const ctx = { entries: s.entries, restDays: new Set(s.restDays), today }
    const range = { from: WEEK, to: "2026-10-25" }
    expect(snap.habits.current).toEqual(completion(s.habits, range, ctx))
    expect(snap.habits.perfectDays).toEqual(perfectDays(dailyRates(s.habits, range, ctx)))
    const focus = summarizeSessions(sessionsIn(s, { range, project: "all" }))
    expect(snap.focus.current).toMatchObject({ minutes: focus.minutes, sessions: focus.sessions, avgRating: focus.avgRating, completeRate: focus.completeRate })
    expect(snap.metricsVersion).toBe(METRICS_VERSION)
  })

  it("weekly targets are evaluated per whole week, rest days are exempt", () => {
    const snap = build(fixture(), "2026-10-26")
    const correr = snap.habits.rows.find((r) => r.id === "h2")!
    expect(correr).toMatchObject({ fulfilled: 1, applicable: 1, rate: 1 })
    const leer = snap.habits.rows.find((r) => r.id === "h1")!
    expect(leer).toMatchObject({ fulfilled: 4, applicable: 6, exempt: 1 })
    expect(snap.habits.byDimension.map((d) => d.id)).toEqual(["body", "mind"])
  })

  it("the week of the summer-time change counts 7 daily opportunities", () => {
    const snap = build(makeState([makeHabit({ startDate: "2026-10-01" })]), "2026-10-26")
    expect(snap.habits.current.applicable).toBe(7)
  })
})

describe("deterministic close semantics", () => {
  it("the same input always gives the same snapshot", () => {
    expect(build(fixture(), "2026-10-27")).toEqual(build(fixture(), "2026-10-27"))
  })

  it("closing late gives exactly the same figures as closing on time, whatever happened afterwards", () => {
    const onTime = build(fixture(), "2026-10-26", { at: "2026-10-26T09:00:00.000Z" })
    const late = build(laterData(fixture()), "2026-12-15", { at: "2026-12-15T20:00:00.000Z" })
    expect(sameFigures(onTime, late)).toBe(true)
    expect(late.computedAt).not.toBe(onTime.computedAt)
  })

  it("on the period's last day today is pending, like Analytics, and asOf records it", () => {
    const s = fixture()
    const withoutSunday = { ...s, entries: Object.fromEntries(Object.entries(s.entries).filter(([, e]) => e.date !== "2026-10-25")) }
    const snap = build(withoutSunday, "2026-10-25")
    expect(snap.asOf).toBe("2026-10-25")
    expect(snap.habits.current.pending).toBe(1)
    expect(build(withoutSunday, "2026-10-26").habits.current.pending).toBe(0)
  })

  it("is refused before the period's last day and for an invalid period start", () => {
    expect(() => build(fixture(), "2026-10-24")).toThrow(SnapshotError)
    expect(() => build(fixture(), "2026-10-24")).toThrow("not_available")
    expect(() => build(fixture(), "2026-10-27", { start: "2026-10-20" })).toThrow("invalid_period")
  })
})

describe("records changed after the close (plan §4.4)", () => {
  it("the frozen snapshot is a value: later edits only show up when comparing with live figures", () => {
    const frozen = build(fixture(), "2026-10-26")
    const copy: ReviewSnapshot = JSON.parse(JSON.stringify(frozen))
    // A record of the reviewed week is added later and a session is edited.
    const edited = { ...fixture(), entries: { ...fixture().entries, ...entries("h1", { "2026-10-23": true }) } }
    const live = build(edited, "2026-11-10")
    expect(frozen).toEqual(copy)
    const cmp = compareSnapshot(frozen, live)
    expect(cmp.comparable).toBe(true)
    expect(cmp.comparable && cmp.changes.map((c) => c.figure)).toContain("habits.current")
  })

  it("nothing changed → no differences; a different metrics version is not compared", () => {
    const a = build(fixture(), "2026-10-26")
    expect(compareSnapshot(a, build(laterData(fixture()), "2026-11-30"))).toEqual({ comparable: true, changes: [] })
    expect(compareSnapshot({ ...a, metricsVersion: 3 }, a)).toEqual({ comparable: false, reason: "metrics_version" })
  })
})

describe("goals as of a historical date never see later records", () => {
  it("a goal achieved after the week is shown as it was at the end of the week", () => {
    const snap = build(laterData(fixture()), "2026-12-01")
    const row = snap.goals.find((g) => g.id === "g1")!
    expect(row.closedInPeriod).toBeNull()
    expect(row.status).not.toBe("achieved")
    // Only the 80 kg measurement of 20 October: (82 − 80) / (82 − 78) = 50 %.
    expect(row.progress).toBeCloseTo(0.5)
  })

  it("equals evaluateGoals run with the data cut at that date", () => {
    const s = laterData(fixture())
    const cut = {
      habits: s.habits,
      ctx: { entries: {}, restDays: new Set<string>(), today: "2026-10-25" },
      measurements: { [measurementKey("g1", "2026-10-20")]: s.measurements[measurementKey("g1", "2026-10-20")] },
    }
    const expected = evaluateGoals(goalsAsOf(s.goals, "2026-10-25", s.timezone), cut).get("g1")!
    expect(build(s, "2026-12-01").goals[0]).toMatchObject({ progress: expected.outcome.progress, status: expected.status.id })
  })

  it("the month in which it was achieved reports it as achieved in the period", () => {
    const snap = build(laterData(fixture()), "2026-12-01", { kind: "month", start: "2026-11-01" })
    expect(snap.goals.find((g) => g.id === "g1")).toMatchObject({ closedInPeriod: "achieved", status: "achieved" })
  })

  it("milestones done later are not done yet; goals created later or archived before are not part of the period", () => {
    const s = fixture()
    const goals = [
      goal({ id: "m", title: "Hitos", kind: "milestones", numeric: null, checkpoints: [{ id: "c1", title: "A", doneOn: "2026-10-20" }, { id: "c2", title: "B", doneOn: "2026-11-02" }] }),
      goal({ id: "late", title: "Creado después", createdAt: "2026-11-02T10:00:00.000Z" }),
      goal({ id: "arch", title: "Archivado", archivedOn: "2026-10-10" }),
    ]
    const snap = build({ ...s, goals }, "2026-12-01")
    expect(snap.goals.map((g) => g.id)).toEqual(["m"])
    expect(snap.goals[0].progress).toBeCloseTo(0.5)
  })

  it("a habit-based goal's effort ignores records after the date", () => {
    const s = laterData(fixture())
    const hg = goal({ id: "hg", title: "Sistema de lectura", kind: "habits", numeric: null, threshold: 0.8, habits: [{ habitId: "h1", weight: 1 }] })
    const a = build({ ...fixture(), goals: [hg] }, "2026-10-26").goals[0]
    const b = build({ ...s, goals: [hg] }, "2026-12-20").goals[0]
    expect(b).toEqual(a)
  })
})

describe("no data is N/D with its denominator, never an invented 0 %", () => {
  it("an empty account", () => {
    const snap = build(makeState([]), "2026-10-26")
    expect(snap.habits.current).toMatchObject({ rate: null, applicable: 0, fulfilled: 0 })
    expect(snap.habits.perfectDays).toEqual({ perfect: 0, withData: 0 })
    expect(snap.focus.current).toMatchObject({ minutes: 0, sessions: 0, completeRate: null, avgRating: null })
    expect(snap.mind.level).toBe("none")
    expect(snap.mind.averages.energy).toEqual({ value: null, n: 0 })
    expect(snap.mind.change.energy).toBeNull()
    expect(snap.goals).toEqual([])
    expect(snap.historyStart).toBeNull()
  })

  it("a history that starts mid-period is recorded; only applicable days count", () => {
    const snap = build(makeState([makeHabit({ startDate: "2026-10-23" })]), "2026-10-26")
    expect(snap.historyStart).toBe("2026-10-23")
    expect(snap.habits.current.applicable).toBe(3)
    expect(snap.habits.previous).toMatchObject({ applicable: 0, rate: null })
  })
})

describe("Mind & Energy: numbers only, never the reflections", () => {
  it("no reflection text reaches the snapshot, the averages still count", () => {
    const snap = build(fixture(), "2026-10-26")
    expect(JSON.stringify(snap)).not.toContain("NOTA-PRIVADA")
    expect(snap.mind.averages.energy).toEqual({ value: 3, n: 2 })
    expect(snap.mind.coverage).toEqual({ days: 2, total: 7 })
  })

  it("second barrier: the metrics run on check-ins whose reflection was removed, indicators intact", () => {
    const clean = withoutNotes(fixture().checkins)
    expect(Object.values(clean).every((c) => c.note === null)).toBe(true)
    expect(JSON.stringify(clean)).not.toContain("NOTA-PRIVADA")
    expect(Object.values(clean).map((c) => c.energy)).toEqual([4, 2])
  })

  it("change needs ≥ 7 days with data in both periods (catalog rule)", () => {
    let s = makeState([])
    for (const d of eachDay("2026-10-12", "2026-10-25")) s = checkin(s, d, "am", { energy: d < WEEK ? 3 : 4 })
    expect(build(s, "2026-10-26").mind.change.energy).toBe(1)
    const six = { ...s, checkins: Object.fromEntries(Object.entries(s.checkins).filter(([k]) => !k.startsWith("2026-10-25"))) }
    expect(build(six, "2026-10-26").mind.change.energy).toBeNull()
  })

  it("a monthly review compares with the previous calendar month, not a same-length window", () => {
    let s = makeState([])
    for (const d of eachDay("2026-09-01", "2026-10-31")) s = checkin(s, d, "am", { energy: d < "2026-10-01" ? 3 : 4 })
    // 31 August would fall in a same-length window before October; it must not count.
    s = checkin(s, "2026-08-31", "am", { energy: 1 })
    const snap = build(s, "2026-11-01", { kind: "month", start: "2026-10-01" })
    expect(snap.mind.change.energy).toBe(1)
    expect(snap.previous).toEqual({ from: "2026-09-01", to: "2026-09-30" })
  })
})

describe("monthly reviews: months of every length", () => {
  it.each([
    ["2027-02-01", 28, 4],
    ["2028-02-01", 29, 5],
    ["2026-03-01", 31, 6],
  ])("%s has %i days and %i week rows clipped to the month", (start, days, weeks) => {
    const snap = build(makeState([makeHabit({ startDate: "2026-01-01" })]), "2028-12-31", { kind: "month", start })
    expect(snap.mind.coverage.total).toBe(days)
    expect(snap.weekly).toHaveLength(weeks)
    expect(snap.weekly![0].range.from).toBe(start)
    expect(snap.weekly!.at(-1)!.range.to).toBe(snap.period.to)
    expect(snap.weekly!.reduce((n, w) => n + w.applicable, 0)).toBe(days)
  })

  it("includes the outcome at the start of the month, weekday consistency and streaks at the period end", () => {
    const s = laterData(fixture())
    const snap = build(s, "2026-12-01", { kind: "month", start: "2026-11-01" })
    expect(snap.goals[0].progressAtStart).toBeCloseTo(0.5)
    expect(snap.habits.weekday).toHaveLength(7)
    expect(snap.habits.rows.every((r) => r.streak !== undefined)).toBe(true)
  })
})

describe("timezone and size", () => {
  it("dates are local: changing the profile timezone later changes no figure, only the recorded zone", () => {
    const a = build(fixture(), "2026-10-26")
    const b = build({ ...fixture(), timezone: "America/New_York" }, "2026-10-26")
    expect({ ...b, timezone: a.timezone }).toEqual(a)
    expect(b.timezone).toBe("America/New_York")
  })

  it("a busy month (40 habits, 20 goals) stays far below the 64 KB limit", () => {
    const habits = Array.from({ length: 40 }, (_, i) => makeHabit({ id: `h${i}`, name: `Hábito con un nombre bastante largo ${i}`, startDate: "2026-01-01" }))
    const goals = Array.from({ length: 20 }, (_, i) => goal({ id: `g${i}`, title: `Objetivo con un título largo ${i}` }))
    let map = {}
    for (const h of habits) map = { ...map, ...entries(h.id, Object.fromEntries(eachDay("2026-10-01", "2026-10-31").map((d) => [d, true]))) }
    const snap = build({ ...makeState(habits, map), dimensions: DIMENSIONS, goals }, "2026-11-02", { kind: "month", start: "2026-10-01" })
    expect(snapshotBytes(snap)).toBeLessThan(LIMITS.snapshotBytes / 2)
    expect(addDays(snap.period.to, 1)).toBe("2026-11-01")
  })
})

describe("a daily review (C5) counts the day itself", () => {
  const day = (date: string, today = "2026-10-26", state = fixture()) => buildReviewSnapshot({ state, kind: "day", periodStart: date, today, computedAt: AT })

  it("counts fixed-schedule habits only: a weekly target is judged per week, never per day", () => {
    const s = day("2026-10-20") // Tuesday: h1 done; h2 (3×/week) was also done, but it has no daily verdict
    expect(s.habits.current).toMatchObject({ fulfilled: 1, applicable: 1, inProgress: 0, exempt: 0, rate: 1 })
    expect(s.habits.rows.map((r) => r.id)).toEqual(["h1"])
    expect(s.habits.byDimension.map((d) => d.id)).toEqual(["body"])
  })

  it("a day without the habit done counts as missed once it is over", () => {
    expect(day("2026-10-23").habits.current).toMatchObject({ fulfilled: 0, missed: 1, applicable: 1, rate: 0 })
  })

  it("a planned rest day is exempt, never missed", () => {
    expect(day("2026-10-21").habits.current).toMatchObject({ fulfilled: 0, missed: 0, exempt: 1, applicable: 0, rate: null })
  })

  it("while the day is open, what is left stays pending and in the denominator", () => {
    expect(day("2026-10-23", "2026-10-23").habits.current).toMatchObject({ fulfilled: 0, missed: 0, pending: 1, applicable: 1, rate: 0 })
  })

  it("compares with the day before and covers exactly one day", () => {
    const s = day("2026-10-20")
    expect(s).toMatchObject({ kind: "day", period: { from: "2026-10-20", to: "2026-10-20" }, previous: { from: "2026-10-19", to: "2026-10-19" }, asOf: "2026-10-20" })
    expect(s.habits.previous).toMatchObject({ fulfilled: 1, applicable: 1 })
    expect(s.mind.coverage.total).toBe(1)
    expect(s.weekly).toBeUndefined()
  })

  it("does not carry goals: a daily review is about the day's habits", () => {
    expect(day("2026-10-20").goals).toEqual([])
  })

  it("closing a past day later gives the same figures", () => {
    expect(sameFigures(day("2026-10-20", "2026-10-21"), day("2026-10-20", "2026-11-30"))).toBe(true)
  })

  it("a future day is not available", () => {
    expect(() => day("2026-10-27")).toThrow(SnapshotError)
  })

  it("keeps the frozen shape the server checks", () => {
    const s = day("2026-10-20")
    expect(s.v).toBe(1)
    expect(s.metricsVersion).toBe(METRICS_VERSION)
    expect(typeof s.habits).toBe("object")
    expect(Array.isArray(s.goals)).toBe(true)
    expect(typeof s.focus).toBe("object")
    expect(typeof s.mind).toBe("object")
  })
})
