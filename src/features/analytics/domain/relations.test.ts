import { describe, expect, it } from "vitest"
import { addDays, type LocalDate } from "@/features/habits/domain/dates"
import { entries, makeHabit, makeState } from "@/features/habits/domain/test-helpers"
import type { HabitsState } from "@/features/habits/domain/types"
import { setCheckin } from "@/features/mind/domain/ops"
import type { CheckinValues } from "@/features/mind/domain/types"
import {
  RELATION_CLEAR,
  RELATION_MIN_DAYS,
  RELATION_PAIR_COUNT,
  RELATION_SOLID_DAYS,
  relationBetween,
  relations,
  relationSeries,
  relationStrength,
  spearman,
  type RelationSeries,
} from "./relations"

const TODAY = "2026-10-31"
const day = (i: number): LocalDate => addDays("2026-08-01", i)
const PERIOD = { from: day(0), to: TODAY }

function put(s: HabitsState, date: LocalDate, values: CheckinValues): HabitsState {
  return setCheckin(s, { date, phase: "am", values, at: `${date}T08:00:00.000Z`, today: TODAY }).state
}

/** A series with only the two variables a test cares about. */
function pair(xs: number[], ys: number[]): RelationSeries {
  const empty = new Map<LocalDate, number>()
  return {
    completion: empty,
    focus: empty,
    stress: empty,
    mood: empty,
    sleep: new Map(xs.map((x, i) => [day(i), x])),
    energy: new Map(ys.map((y, i) => [day(i), y])),
  }
}
const ladder = (n: number, f: (i: number) => number = (i) => i) => Array.from({ length: n }, (_, i) => f(i))

describe("spearman", () => {
  it("is 1 for the same order and -1 for the opposite, whatever the scale", () => {
    expect(spearman([1, 2, 3, 4], [10, 200, 300, 9000])).toBeCloseTo(1)
    expect(spearman([1, 2, 3, 4], [9, 5, 2, 1])).toBeCloseTo(-1)
  })

  it("shares the rank of ties", () => {
    expect(spearman([1, 1, 2, 2], [1, 1, 2, 2])).toBeCloseTo(1)
    expect(spearman([1, 2, 3, 4, 5], [2, 1, 4, 3, 5])).toBeCloseTo(0.8)
  })

  it("is null when a side never varies or there is nothing to compare", () => {
    expect(spearman([3, 3, 3], [1, 2, 3])).toBeNull()
    expect(spearman([1], [1])).toBeNull()
    expect(spearman([1, 2], [1])).toBeNull()
  })
})

describe("relationBetween", () => {
  it("gives no figure below the minimum, and says how many days there are", () => {
    const n = RELATION_MIN_DAYS - 1
    const r = relationBetween(pair(ladder(n), ladder(n)), "sleep", "energy", PERIOD)
    expect(r).toMatchObject({ status: "few_days", rho: null, strength: null, n })
    expect(r.limitations.join(" ")).toContain(`hay ${n}`)
  })

  it("shows the figure from the minimum on, with period, variables and sample size", () => {
    const r = relationBetween(pair(ladder(RELATION_MIN_DAYS), ladder(RELATION_MIN_DAYS)), "sleep", "energy", PERIOD)
    expect(r).toMatchObject({ status: "shown", a: "sleep", b: "energy", period: PERIOD, n: RELATION_MIN_DAYS, strength: "strong" })
    expect(r.rho).toBeCloseTo(1)
    expect(r.sentence).toBe(`En estos ${RELATION_MIN_DAYS} días, los días con más sueño coinciden con frecuencia con más energía.`)
  })

  it("counts only the days with both values", () => {
    const s = pair(ladder(20), ladder(14))
    expect(relationBetween(s, "sleep", "energy", PERIOD).n).toBe(14)
  })

  it("an opposite order reads as «menos»", () => {
    const r = relationBetween(pair(ladder(20), ladder(20, (i) => -i)), "sleep", "energy", PERIOD)
    expect(r.rho).toBeCloseTo(-1)
    expect(r.sentence).toContain("con menos energía")
  })

  it("a variable that never changes has no figure and says why", () => {
    const r = relationBetween(pair(ladder(20, () => 4), ladder(20)), "sleep", "energy", PERIOD)
    expect(r).toMatchObject({ status: "no_variation", rho: null, strength: null, n: 20 })
    expect(r.limitations[0]).toContain("no cambia")
  })

  it("claims no pattern under the clear threshold", () => {
    expect(relationStrength(RELATION_CLEAR - 0.01)).toBe("unclear")
    const r = relationBetween(pair([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], [3, 9, 1, 12, 5, 14, 2, 8, 11, 4, 13, 6, 10, 7]), "sleep", "energy", PERIOD)
    expect(r.status).toBe("shown")
    expect(r.strength).toBe("unclear")
    expect(r.sentence).toContain("no se aprecia un patrón claro")
  })

  it("every shown result says it is not a cause, and warns of a small sample", () => {
    const small = relationBetween(pair(ladder(RELATION_MIN_DAYS), ladder(RELATION_MIN_DAYS)), "sleep", "energy", PERIOD)
    expect(small.limitations).toHaveLength(2)
    expect(small.limitations[0]).toContain("no qué provoca qué")
    expect(small.limitations[1]).toContain("muestra es pequeña")
    const solid = relationBetween(pair(ladder(RELATION_SOLID_DAYS), ladder(RELATION_SOLID_DAYS)), "sleep", "energy", PERIOD)
    expect(solid.limitations).toHaveLength(1)
  })

  it("no sentence uses causal language", () => {
    const causal = /\b(causa|causan|provoca|provocan|hace que|debido a|gracias a|porque|mejora|empeora|produce|producen)\b/i
    const results = [
      relationBetween(pair(ladder(30), ladder(30)), "sleep", "energy", PERIOD),
      relationBetween(pair(ladder(30), ladder(30, (i) => -i)), "sleep", "energy", PERIOD),
      relationBetween(pair(ladder(20, () => 4), ladder(20)), "sleep", "energy", PERIOD),
      relationBetween(pair(ladder(3), ladder(3)), "sleep", "energy", PERIOD),
    ]
    for (const r of results) expect(r.sentence).not.toMatch(causal)
  })
})

describe("relationSeries from the real state", () => {
  it("takes check-ins as they are and leaves days without one out", () => {
    let s = makeState([])
    s = put(s, day(1), { sleep: 7, energy: 4 })
    const out = relationSeries(s, PERIOD, TODAY)
    expect(out.sleep.get(day(1))).toBe(7)
    expect(out.energy.get(day(1))).toBe(4)
    expect(out.sleep.has(day(0))).toBe(false)
    expect(out.mood.size).toBe(0)
  })

  it("habits count only closed days with something applicable, never today", () => {
    const h = makeHabit({ id: "h1", startDate: day(0) })
    const s = makeState([h], entries("h1", { [day(0)]: true, [addDays(TODAY, -1)]: true, [TODAY]: true }))
    const out = relationSeries(s, PERIOD, TODAY)
    expect(out.completion.get(day(0))).toBe(1)
    expect(out.completion.get(day(1))).toBe(0)
    expect(out.completion.has(TODAY)).toBe(false)
  })

  it("focus is no data before its first session and 0 on later days without one", () => {
    const session = { id: "f1", state: "finished", localDate: day(5), segments: [{ start: `${day(5)}T08:00:00.000Z`, end: `${day(5)}T09:00:00.000Z` }] }
    const s = { ...makeState([]), focusSessions: [session] } as unknown as HabitsState
    const out = relationSeries(s, PERIOD, TODAY)
    expect(out.focus.has(day(4))).toBe(false)
    expect(out.focus.get(day(5))).toBe(60)
    expect(out.focus.get(day(6))).toBe(0)
    expect(out.focus.has(TODAY)).toBe(false)
  })

  it("with nothing recorded, there is no data at all", () => {
    const out = relationSeries(makeState([]), PERIOD, TODAY)
    expect(Object.values(out).map((m) => m.size)).toEqual([0, 0, 0, 0, 0, 0])
  })
})

describe("relations", () => {
  it("covers every pair once, the strongest first and those without a figure last", () => {
    let s = makeState([])
    for (let i = 0; i < 20; i++) s = put(s, day(i), { sleep: 4 + (i % 5), energy: 1 + (i % 5), mood: 5 - (i % 4), stress: 1 + (i % 3) })
    const out = relations(s, PERIOD, TODAY)
    expect(out).toHaveLength(RELATION_PAIR_COUNT)
    expect(new Set(out.map((r) => `${r.a}-${r.b}`)).size).toBe(RELATION_PAIR_COUNT)
    expect(out[0]).toMatchObject({ a: "sleep", b: "energy", status: "shown" })
    expect(out[0].rho).toBeCloseTo(1)
    const shown = out.filter((r) => r.rho !== null).length
    expect(out.slice(shown).every((r) => r.rho === null)).toBe(true)
    expect(out.slice(0, shown).every((r, i) => i === 0 || Math.abs(out[i - 1].rho!) >= Math.abs(r.rho!))).toBe(true)
  })
})
