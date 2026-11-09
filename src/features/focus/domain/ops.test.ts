import { describe, expect, it } from "vitest"
import { setEntry } from "@/features/habits/domain/ops"
import { makeHabit, makeState } from "@/features/habits/domain/test-helpers"
import { entryKey, type HabitsState } from "@/features/habits/domain/types"
import { evaluateGoal } from "@/features/goals/domain/progress"
import type { Goal } from "@/features/goals/domain/types"
import {
  activeSession,
  discardSession,
  editSession,
  finishSession,
  focusSecondsOn,
  pauseSession,
  projectSuggestions,
  resumeSession,
  setHabitSource,
  startSession,
  type FocusResult,
} from "./ops"
import { summarizeSessions, sessionsIn } from "./metrics"
import { activeSeconds } from "./time"

const DW = "dw"
const OTHER = "bin"
const TODAY = "2026-10-21"

function base(): HabitsState {
  const dw = makeHabit({ id: DW, name: "Deep Work 90 min", type: "duration", unit: "min", target: 90, direction: "at_least", startDate: "2026-10-01" })
  const bin = makeHabit({ id: OTHER, name: "Leer", startDate: "2026-10-01" })
  return makeState([dw, bin])
}

function must(r: FocusResult): HabitsState {
  if (!r.ok) throw new Error(r.reason)
  return r.state
}

const at = (hhmm: string, day = TODAY) => new Date(`${day}T${hhmm}:00+02:00`).toISOString()

function fed(): HabitsState {
  return setHabitSource(base(), DW, "focus", "2026-10-15")
}

function run(state: HabitsState, id: string, from: string, to: string, habitId: string | null = DW, day = TODAY) {
  const s = must(startSession(state, { id, habitId, project: "Tesis", plannedOutput: "Capítulo 2", plannedMinutes: 50, at: at(from, day) }))
  return must(finishSession(s, id, { at: at(to, day), actualOutput: "Hecho", rating: 4 }))
}

describe("one active session (decision 5)", () => {
  it("a second start is refused while one is running or paused, and allowed after finishing", () => {
    let s = must(startSession(base(), { id: "a", habitId: null, project: null, plannedOutput: null, plannedMinutes: 25, at: at("09:00") }))
    expect(startSession(s, { id: "b", habitId: null, project: null, plannedOutput: null, plannedMinutes: 25, at: at("09:01") })).toMatchObject({ ok: false, reason: "session_active" })
    s = must(pauseSession(s, "a", at("09:10")))
    expect(startSession(s, { id: "b", habitId: null, project: null, plannedOutput: null, plannedMinutes: 25, at: at("09:11") }).ok).toBe(false)
    s = must(finishSession(s, "a", { at: at("09:12") }))
    expect(activeSession(s)).toBeNull()
    expect(startSession(s, { id: "b", habitId: null, project: null, plannedOutput: null, plannedMinutes: 25, at: at("09:13") }).ok).toBe(true)
  })

  it("re-applying the same start is a no-op (idempotent replay)", () => {
    const input = { id: "a", habitId: null, project: null, plannedOutput: null, plannedMinutes: 25, at: at("09:00") }
    const s = must(startSession(base(), input))
    expect(must(startSession(s, input))).toBe(s)
  })

  it("validates minutes and the linked habit (duration only)", () => {
    const i = { id: "a", project: null, plannedOutput: null, at: at("09:00") }
    expect(startSession(base(), { ...i, habitId: null, plannedMinutes: 0 })).toMatchObject({ reason: "invalid_minutes" })
    expect(startSession(base(), { ...i, habitId: null, plannedMinutes: 721 })).toMatchObject({ reason: "invalid_minutes" })
    expect(startSession(base(), { ...i, habitId: OTHER, plannedMinutes: 25 })).toMatchObject({ reason: "invalid_habit" })
  })
})

describe("finish and discard (decision 3)", () => {
  it("«Terminar» keeps the real minutes, with pauses excluded", () => {
    let s = must(startSession(base(), { id: "a", habitId: null, project: null, plannedOutput: null, plannedMinutes: 50, at: at("09:00") }))
    s = must(pauseSession(s, "a", at("09:20")))
    s = must(resumeSession(s, "a", at("09:30")))
    s = must(finishSession(s, "a", { at: at("10:05"), actualOutput: "  Borrador   listo ", rating: 5 }))
    const done = s.focusSessions[0]
    expect(done).toMatchObject({ state: "finished", actualOutput: "Borrador listo", rating: 5 })
    expect(activeSeconds(done.segments)).toBe(55 * 60)
  })

  it("under one effective minute nothing is saved", () => {
    const s = must(startSession(base(), { id: "a", habitId: null, project: null, plannedOutput: null, plannedMinutes: 25, at: at("09:00") }))
    expect(finishSession(s, "a", { at: new Date(Date.parse(at("09:00")) + 59_000).toISOString() })).toMatchObject({ ok: false, reason: "too_short" })
  })

  it("«Terminar a las HH:MM» trims a forgotten timer", () => {
    const s = must(startSession(base(), { id: "a", habitId: null, project: null, plannedOutput: null, plannedMinutes: 50, at: at("09:00") }))
    const done = must(finishSession(s, "a", { at: at("13:00"), trimTo: at("09:50") }))
    expect(activeSeconds(done.focusSessions[0].segments)).toBe(50 * 60)
  })

  it("over 12 effective hours must be cut before saving (same cap as the server)", () => {
    const s = must(startSession(base(), { id: "a", habitId: null, project: null, plannedOutput: null, plannedMinutes: 50, at: at("09:00", "2026-10-20") }))
    expect(finishSession(s, "a", { at: at("22:00") })).toMatchObject({ ok: false, reason: "segments_too_long" })
    expect(finishSession(s, "a", { at: at("22:00"), trimTo: at("09:50", "2026-10-20") }).ok).toBe(true)
  })

  it("rejects ratings outside 1–5", () => {
    const s = must(startSession(base(), { id: "a", habitId: null, project: null, plannedOutput: null, plannedMinutes: 25, at: at("09:00") }))
    expect(finishSession(s, "a", { at: at("09:30"), rating: 6 })).toMatchObject({ reason: "invalid_rating" })
    expect(finishSession(s, "a", { at: at("09:30"), interruptions: -1 })).toMatchObject({ reason: "invalid_interruptions" })
    expect(finishSession(s, "a", { at: at("09:30"), interruptions: 100 })).toMatchObject({ reason: "invalid_interruptions" })
    expect(finishSession(s, "a", { at: at("09:30"), interruptions: 1.5 })).toMatchObject({ reason: "invalid_interruptions" })
  })

  it("finishing twice (two devices) is refused the second time", () => {
    const s = run(base(), "a", "09:00", "09:30", null)
    expect(finishSession(s, "a", { at: at("09:40") })).toMatchObject({ ok: false, reason: "not_active" })
    expect(pauseSession(s, "a", at("09:40"))).toMatchObject({ ok: false, reason: "not_active" })
  })
})

describe("habit fed by focus (decision 1: derived, never logged twice)", () => {
  it("finishing raises the habit's day; another session adds to it; discarding lowers it", () => {
    let s = run(fed(), "a", "09:00", "09:50")
    expect(s.entries[entryKey(DW, TODAY)]?.value).toBe(50)
    s = run(s, "b", "11:00", "11:45")
    expect(s.entries[entryKey(DW, TODAY)]?.value).toBe(95)
    s = discardSession(s, "a", at("12:00"))
    expect(s.entries[entryKey(DW, TODAY)]?.value).toBe(45)
    s = discardSession(s, "b", at("12:00"))
    expect(s.entries[entryKey(DW, TODAY)]).toBeUndefined()
  })

  it("interruptions: an edit without the field keeps them, and an explicit value replaces them", () => {
    const started = must(startSession(fed(), { id: "a", habitId: DW, project: "Tesis", plannedOutput: null, plannedMinutes: 50, at: at("09:00") }))
    const finished = must(finishSession(started, "a", { at: at("09:50"), interruptions: 3 }))
    expect(finished.focusSessions[0].interruptions).toBe(3)
    const { segments, habitId } = finished.focusSessions[0]
    const base = { segments, habitId, project: "Tesis", plannedOutput: null, actualOutput: null, rating: null }
    expect(must(editSession(finished, "a", base, at("12:00"))).focusSessions[0].interruptions).toBe(3)
    expect(must(editSession(finished, "a", { ...base, interruptions: 0 }, at("12:00"))).focusSessions[0].interruptions).toBe(0)
    expect(must(editSession(finished, "a", { ...base, interruptions: null }, at("12:00"))).focusSessions[0].interruptions).toBeNull()
  })

  it("editing the hours recomputes both the old and the new day", () => {
    let s = run(fed(), "a", "09:00", "09:50")
    const seg = s.focusSessions[0].segments
    s = must(
      editSession(
        s,
        "a",
        { segments: [{ start: at("09:00", "2026-10-20"), end: at("09:30", "2026-10-20") }], habitId: DW, project: "Tesis", plannedOutput: null, actualOutput: null, rating: null },
        at("12:00")
      )
    )
    expect(s.entries[entryKey(DW, TODAY)]).toBeUndefined()
    expect(s.entries[entryKey(DW, "2026-10-20")]?.value).toBe(30)
    expect(s.focusSessions[0].localDate).toBe("2026-10-20")
    expect(seg).toHaveLength(1)
  })

  it("a manual entry for a fed day is rejected; days before the link stay manual history", () => {
    const s = fed()
    expect(setEntry(s, { habitId: DW, date: TODAY, value: 30, opId: "x", now: "", today: TODAY })).toMatchObject({ ok: false, reason: "derived_entry" })
    const before = setEntry(s, { habitId: DW, date: "2026-10-10", value: 30, opId: "x", now: "", today: TODAY })
    expect(before.ok).toBe(true)
    // A session on a day before the link never rewrites that history.
    const r = run(before.state, "old", "09:00", "09:50", DW, "2026-10-10")
    expect(r.entries[entryKey(DW, "2026-10-10")]?.value).toBe(30)
  })

  it("an unlinked session or a not-fed habit never writes entries", () => {
    expect(Object.keys(run(fed(), "a", "09:00", "09:50", null).entries)).toEqual([])
    expect(Object.keys(run(base(), "a", "09:00", "09:50").entries)).toEqual([])
  })

  it("a rest day keeps no derived value (the minutes still count in Analytics)", () => {
    const s = run({ ...fed(), restDays: [TODAY] }, "a", "09:00", "09:50")
    expect(s.entries[entryKey(DW, TODAY)]).toBeUndefined()
    expect(summarizeSessions(sessionsIn(s, { range: { from: TODAY, to: TODAY }, project: "all" })).minutes).toBe(50)
  })

  it("the habit's minutes equal the Analytics minutes for that day", () => {
    let s = run(fed(), "a", "09:00", "09:50")
    s = run(s, "b", "10:00", "10:20")
    const analytics = summarizeSessions(sessionsIn(s, { range: { from: TODAY, to: TODAY }, project: "all" })).minutes
    expect(s.entries[entryKey(DW, TODAY)]?.value).toBe(analytics)
    expect(Math.round(focusSecondsOn(s, DW, TODAY) / 60)).toBe(analytics)
  })

  it("a goal fed by that habit adds the session minutes with no extra logging", () => {
    let s = run(fed(), "a", "09:00", "09:50")
    s = run(s, "b", "11:00", "11:40", DW, "2026-10-20")
    const goal: Goal = {
      id: "g", title: "100 h de foco", kind: "numeric",
      numeric: { source: "habit", habitId: DW, aggregation: "sum", unit: "min", baseline: 0, target: 6000, direction: "up" },
      startDate: "2026-10-15", dueDate: "2026-12-31", priority: "primary", state: "active", habits: [], checkpoints: [], createdAt: "", updatedAt: "",
    }
    const ev = evaluateGoal(goal, { habits: s.habits, measurements: {}, ctx: { entries: s.entries, restDays: new Set(), today: TODAY } })
    expect(ev.outcome.current).toBe(90)
  })

  it("linking only applies to duration habits and is a no-op when unchanged", () => {
    const s = base()
    expect(setHabitSource(s, OTHER, "focus", TODAY)).toBe(s)
    const linked = setHabitSource(s, DW, "focus", TODAY)
    expect(setHabitSource(linked, DW, "focus", "2026-10-22")).toBe(linked)
    expect(setHabitSource(linked, DW, null, TODAY).habits.find((h) => h.id === DW)).toMatchObject({ activitySource: null, activitySourceFrom: null })
  })
})

describe("projects (decision 4)", () => {
  it("suggests previous projects, most recent first, case-insensitive unique", () => {
    let s = base()
    for (const [id, p, h] of [["a", "Tesis", "08:00"], ["b", "Web", "09:00"], ["c", "tesis", "10:00"]] as const) {
      s = must(startSession(s, { id, habitId: null, project: p, plannedOutput: null, plannedMinutes: 25, at: at(h) }))
      s = must(finishSession(s, id, { at: at(h.replace(":00", ":30")) }))
    }
    expect(projectSuggestions(s)).toEqual(["tesis", "Web"])
  })
})
