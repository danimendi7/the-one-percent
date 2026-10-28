import { describe, expect, it } from "vitest"
import { makeHabit } from "@/features/habits/domain/test-helpers"
import type { Goal } from "@/features/goals/domain/types"
import { DEFAULT_FILTER, parseFilter, periodRange, scopeHabits, serializeFilter } from "./filters"

const p = (q: string) => new URLSearchParams(q)

describe("analytics filters in the URL", () => {
  it("defaults to 30 days, all dimensions, all habits", () => {
    expect(parseFilter(p(""))).toEqual(DEFAULT_FILTER)
    expect(serializeFilter(DEFAULT_FILTER)).toBe("")
  })

  it("round-trips a full filter", () => {
    const f = { period: 90, dimension: "mind", habitId: "abc-123", goalId: "g-1", project: "Tesis doctoral" } as const
    expect(parseFilter(p(serializeFilter(f).slice(1)))).toEqual(f)
    // «Sin proyecto» is the empty project and survives the URL too.
    const none = { ...DEFAULT_FILTER, project: "" }
    expect(parseFilter(p(serializeFilter(none).slice(1)))).toEqual(none)
  })

  it("ignores unknown or hostile values instead of failing", () => {
    expect(parseFilter(p("periodo=12&dimension=hack&habito=<script>"))).toEqual(DEFAULT_FILTER)
    expect(parseFilter(p(`habito=${"x".repeat(65)}`)).habitId).toBe("all")
    expect(parseFilter(p(`proyecto=${"x".repeat(61)}`)).project).toBe("all")
  })
})

describe("scopeHabits", () => {
  const a = makeHabit({ id: "a", dimensionId: "body" })
  const b = makeHabit({ id: "b", dimensionId: "mind" })
  const all = [a, b]

  it("filters by dimension", () => {
    expect(scopeHabits(all, { ...DEFAULT_FILTER, dimension: "mind" }).scope).toEqual([b])
  })

  it("a habit filter wins over the dimension", () => {
    expect(scopeHabits(all, { ...DEFAULT_FILTER, dimension: "mind", habitId: "a" })).toEqual({ scope: [a], habit: a, goal: null })
  })

  it("an unknown habit id falls back to the dimension scope", () => {
    expect(scopeHabits(all, { ...DEFAULT_FILTER, habitId: "gone" })).toEqual({ scope: all, habit: null, goal: null })
  })

  it("a goal filter scopes to its linked habits and its numeric source; a habit filter still wins", () => {
    const c = makeHabit({ id: "c", dimensionId: "work" })
    const goal = { id: "g", habits: [{ habitId: "a", weight: 1 }], numeric: { habitId: "c" } } as unknown as Goal
    expect(scopeHabits([a, b, c], { ...DEFAULT_FILTER, goalId: "g" }, [goal])).toEqual({ scope: [a, c], habit: null, goal })
    expect(scopeHabits([a, b, c], { ...DEFAULT_FILTER, goalId: "g", habitId: "b" }, [goal]).scope).toEqual([b])
    expect(scopeHabits([a, b, c], { ...DEFAULT_FILTER, goalId: "gone" }, [goal]).scope).toEqual([a, b, c])
  })
})

describe("periodRange", () => {
  it("is inclusive of today and crosses the DST change without losing a day", () => {
    expect(periodRange("2026-10-28", 7)).toEqual({ from: "2026-10-22", to: "2026-10-28" })
    expect(periodRange("2026-10-26", 2)).toEqual({ from: "2026-10-25", to: "2026-10-26" })
  })
})
