import { describe, expect, it } from "vitest"
import { makeHabit, makeState } from "@/features/habits/domain/test-helpers"
import type { HabitsState } from "@/features/habits/domain/types"
import {
  addGoalLogEntry,
  archiveGoal,
  cleanLogText,
  GOAL_LOG_LIMITS,
  goalLogNewestFirst,
  removeGoalLogEntry,
  createGoal,
  goalStatusView,
  goalsForHabit,
  restoreGoal,
  setCheckpointDone,
  setGoalReview,
  setGoalState,
  setMeasurement,
  updateGoal,
  validateGoal,
  type GoalInput,
} from "./ops"

const TODAY = "2026-10-27"
const NOW = "2026-10-27T10:00:00.000Z"
const habits = [makeHabit({ id: "run" }), makeHabit({ id: "km", type: "numeric", unit: "km", target: 5, direction: "at_least" })]

function input(p: Partial<GoalInput> = {}): GoalInput {
  return {
    title: "Bajar a 78 kg",
    kind: "numeric",
    numeric: { source: "manual", habitId: null, aggregation: "last", unit: "kg", baseline: 82, target: 78, direction: "down" },
    startDate: "2026-10-01",
    dueDate: "2027-03-01",
    priority: "primary",
    habits: [{ habitId: "run", weight: 2 }],
    checkpoints: [],
    ...p,
  }
}

function withGoal(p: Partial<GoalInput> = {}): HabitsState {
  return createGoal(makeState(habits), input(p), { id: "g1", now: NOW })
}

describe("validateGoal", () => {
  const s = makeState(habits)
  it("accepts a well-formed goal", () => expect(validateGoal(input(), s)).toEqual({}))
  it("rejects a target on the wrong side of the baseline", () =>
    expect(validateGoal(input({ numeric: { ...input().numeric!, target: 85 } }), s)["numeric.values"]).toMatch(/menor/))
  it("rejects a binary habit as a numeric source", () =>
    expect(validateGoal(input({ numeric: { ...input().numeric!, source: "habit", habitId: "run" } }), s)["numeric.habit"]).toMatch(/numéricos/))
  it("requires linked habits for habit goals and milestones for milestone goals", () => {
    expect(validateGoal(input({ kind: "habits", numeric: null, habits: [] }), s).habits).toBeDefined()
    expect(validateGoal(input({ kind: "milestones", numeric: null, checkpoints: [{ id: "a", title: " " }] }), s).checkpoints).toBeDefined()
  })
  it("rejects unknown habits and weights outside 1–3", () => {
    expect(validateGoal(input({ habits: [{ habitId: "nope", weight: 1 }] }), s).habits).toBeDefined()
    expect(validateGoal(input({ habits: [{ habitId: "run", weight: 5 }] }), s).habits).toBeDefined()
  })
  it("rejects due dates before the start", () => expect(validateGoal(input({ dueDate: "2026-09-01" }), s).dates).toBeDefined())
  it("prevents cycles in the hierarchy", () => {
    let st = createGoal(s, input(), { id: "a", now: NOW })
    st = createGoal(st, input({ parentId: "a" }), { id: "b", now: NOW })
    expect(validateGoal(input({ parentId: "b" }), st, "a").parent).toMatch(/sí mismo/)
    expect(validateGoal(input({ parentId: "a" }), st, "a").parent).toBeDefined()
  })
})

describe("goal reducers", () => {
  it("create is idempotent by id and refuses invalid input", () => {
    const s1 = withGoal()
    expect(s1.goals).toHaveLength(1)
    expect(createGoal(s1, input(), { id: "g1", now: NOW })).toBe(s1)
    const s = makeState(habits)
    expect(createGoal(s, input({ title: "" }), { id: "x", now: NOW })).toBe(s)
  })

  it("normalizes: threshold only for habit goals, deduplicated links", () => {
    const s = createGoal(makeState(habits), input({ kind: "habits", numeric: null, habits: [{ habitId: "run", weight: 1 }, { habitId: "run", weight: 3 }] }), { id: "h", now: NOW })
    expect(s.goals[0]).toMatchObject({ threshold: 0.85, numeric: null, habits: [{ habitId: "run", weight: 3 }] })
  })

  it("update bumps the version only when something changed", () => {
    const s1 = withGoal()
    expect(updateGoal(s1, "g1", input(), NOW)).toBe(s1)
    const s2 = updateGoal(s1, "g1", input({ title: "Bajar a 77 kg" }), NOW)
    expect(s2.goals[0]).toMatchObject({ title: "Bajar a 77 kg", version: 2 })
  })

  it("state, archive and restore are idempotent", () => {
    const s1 = withGoal()
    const s2 = setGoalState(s1, "g1", "achieved", TODAY, NOW)
    expect(s2.goals[0]).toMatchObject({ state: "achieved", closedOn: TODAY })
    expect(setGoalState(s2, "g1", "achieved", TODAY, NOW)).toBe(s2)
    const s3 = archiveGoal(s2, "g1", TODAY)
    expect(archiveGoal(s3, "g1", TODAY)).toBe(s3)
    expect(restoreGoal(s3, "g1").goals[0].archivedOn).toBeNull()
  })

  describe("process log", () => {
    const entry = (id: string, on = TODAY, text = "Sin tiempo por las mañanas") => ({ id, kind: "obstacle" as const, text, on })

    it("appends once per id, cleans the text and leaves the definition alone", () => {
      const s1 = withGoal()
      const s2 = addGoalLogEntry(s1, "g1", entry("a", TODAY, "  Viaje\n\nde  trabajo "))
      expect(s2.goals[0].processLog).toEqual([{ id: "a", kind: "obstacle", text: "Viaje de trabajo", on: TODAY }])
      expect(s2.goals[0].version).toBe(s1.goals[0].version)
      expect(addGoalLogEntry(s2, "g1", entry("a"))).toBe(s2)
    })

    it("refuses an empty note, an oversized one, a full log and an unknown goal", () => {
      const s = withGoal()
      expect(addGoalLogEntry(s, "g1", entry("a", TODAY, " \n "))).toBe(s)
      expect(addGoalLogEntry(s, "g1", entry("a", TODAY, "x".repeat(GOAL_LOG_LIMITS.text + 1)))).toBe(s)
      expect(addGoalLogEntry(s, "nope", entry("a"))).toBe(s)
      let full = s
      for (let i = 0; i < GOAL_LOG_LIMITS.entries; i++) full = addGoalLogEntry(full, "g1", entry(`e${i}`))
      expect(full.goals[0].processLog).toHaveLength(GOAL_LOG_LIMITS.entries)
      expect(addGoalLogEntry(full, "g1", entry("extra"))).toBe(full)
    })

    it("removes only that entry, and removing twice changes nothing", () => {
      const s = addGoalLogEntry(addGoalLogEntry(withGoal(), "g1", entry("a")), "g1", entry("b"))
      const after = removeGoalLogEntry(s, "g1", "a")
      expect(after.goals[0].processLog!.map((e) => e.id)).toEqual(["b"])
      expect(removeGoalLogEntry(after, "g1", "a")).toBe(after)
    })

    it("an edit of the goal keeps the log", () => {
      const s = addGoalLogEntry(withGoal(), "g1", entry("a"))
      expect(updateGoal(s, "g1", input({ title: "Otro" }), NOW).goals[0].processLog).toHaveLength(1)
    })

    it("lists the newest day first, the last written first within a day, without changing the stored order", () => {
      const log = [entry("old", "2026-10-01"), entry("a"), entry("b"), entry("mid", "2026-10-15")]
      expect(goalLogNewestFirst(log).map((e) => e.id)).toEqual(["b", "a", "mid", "old"])
      expect(log[0].id).toBe("old")
      expect(goalLogNewestFirst(undefined)).toEqual([])
    })

    it("cleans control characters", () => {
      expect(cleanLogText("a\u0007b\tc")).toBe("ab c")
    })
  })

  it("review is a desired state that keeps its first date and no other field", () => {
    const s1 = withGoal()
    const s2 = setGoalReview(s1, "g1", TODAY)
    expect(s2.goals[0]).toEqual({ ...s1.goals[0], reviewSince: TODAY })
    expect(setGoalReview(s2, "g1", "2026-10-28")).toBe(s2)
    expect(setGoalReview(s2, "g1", null).goals[0].reviewSince).toBeNull()
    expect(setGoalReview(s1, "g1", null)).toBe(s1)
    expect(setGoalReview(s1, "missing", TODAY)).toBe(s1)
  })

  it("editing a goal in review does not take it out of review", () => {
    const s = setGoalReview(withGoal(), "g1", TODAY)
    expect(updateGoal(s, "g1", input({ title: "Bajar a 77 kg" }), NOW).goals[0]).toMatchObject({ title: "Bajar a 77 kg", reviewSince: TODAY })
  })

  it("every goal belongs to exactly one list, and a review only counts while it is open", () => {
    const view = (p: Partial<Parameters<typeof goalStatusView>[0]>) => goalStatusView({ state: "active", archivedOn: null, reviewSince: null, ...p })
    expect(view({})).toBe("active")
    expect(view({ reviewSince: TODAY })).toBe("review")
    expect(view({ state: "achieved" })).toBe("closed")
    expect(view({ state: "abandoned", reviewSince: TODAY })).toBe("closed")
    expect(view({ archivedOn: TODAY })).toBe("archived")
    expect(view({ state: "achieved", archivedOn: TODAY, reviewSince: TODAY })).toBe("archived")
    // Goals saved before this field existed have no value at all.
    expect(goalStatusView({ state: "active" })).toBe("active")
  })
})

describe("setMeasurement (desired state, one per goal and day)", () => {
  const op = { goalId: "g1", date: "2026-10-20", opId: "o1", now: NOW, today: TODAY }
  it("sets, replaces and removes the day's value", () => {
    const s1 = setMeasurement(withGoal(), { ...op, value: 81 })
    expect(s1.ok && Object.values(s1.state.measurements)).toHaveLength(1)
    const s2 = setMeasurement(s1.state, { ...op, value: 80.5 })
    expect(Object.values(s2.state.measurements).map((m) => m.value)).toEqual([80.5])
    expect(setMeasurement(s2.state, { ...op, value: 80.5 }).state).toBe(s2.state)
    expect(setMeasurement(s2.state, { ...op, value: null }).state.measurements).toEqual({})
  })
  it("refuses future dates, dates before the start and habit-fed goals", () => {
    expect(setMeasurement(withGoal(), { ...op, date: "2026-10-28", value: 1 })).toMatchObject({ ok: false, reason: "future" })
    expect(setMeasurement(withGoal(), { ...op, date: "2026-09-01", value: 1 })).toMatchObject({ ok: false, reason: "before_start" })
    const fed = withGoal({ numeric: { source: "habit", habitId: "km", aggregation: "sum", unit: "km", baseline: 0, target: 500, direction: "up" } })
    expect(setMeasurement(fed, { ...op, value: 10 })).toMatchObject({ ok: false, reason: "not_manual" })
  })
})

describe("milestones", () => {
  const cps = [{ id: "a", title: "A" }, { id: "b", title: "B", value: 80 }]
  it("marks a manual milestone as desired state; not in the future", () => {
    const s = withGoal({ kind: "milestones", numeric: null, checkpoints: cps })
    const s2 = setCheckpointDone(s, "g1", "a", "2026-10-20", TODAY)
    expect(s2.goals[0].checkpoints[0].doneOn).toBe("2026-10-20")
    expect(setCheckpointDone(s2, "g1", "a", "2026-10-20", TODAY)).toBe(s2)
    expect(setCheckpointDone(s2, "g1", "a", "2026-11-01", TODAY)).toBe(s2)
  })
  it("never lets a data-driven numeric milestone be ticked by hand", () => {
    const s = withGoal({ checkpoints: cps })
    expect(setCheckpointDone(s, "g1", "b", TODAY, TODAY)).toBe(s)
  })
})

it("goalsForHabit finds effort links and numeric sources, not archived goals", () => {
  let s = withGoal()
  s = createGoal(s, input({ habits: [], numeric: { source: "habit", habitId: "km", aggregation: "sum", unit: "km", baseline: 0, target: 500, direction: "up" } }), { id: "g2", now: NOW })
  expect(goalsForHabit(s, "run").map((g) => g.id)).toEqual(["g1"])
  expect(goalsForHabit(s, "km").map((g) => g.id)).toEqual(["g2"])
  expect(goalsForHabit(archiveGoal(s, "g1", TODAY), "run")).toEqual([])
})
