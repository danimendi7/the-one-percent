import { describe, expect, it } from "vitest"
import { addDays, type LocalDate } from "@/features/habits/domain/dates"
import { entries, makeHabit, makeState } from "@/features/habits/domain/test-helpers"
import type { HabitsState } from "@/features/habits/domain/types"
import type { FocusSession } from "@/features/focus/domain/types"
import { setCheckin } from "@/features/mind/domain/ops"
import { INSIGHT_RULES, insights, type Insight } from "./insights"

const TODAY = "2026-11-10" // Tuesday
const days = (from: LocalDate, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i))
const done = (dates: LocalDate[]) => Object.fromEntries(dates.map((d) => [d, true]))
const habit = (id: string, name: string, start = "2026-08-01") => makeHabit({ id, name, dimensionId: "body", startDate: start })
const of = (list: Insight[], kind: Insight["kind"]) => list.filter((i) => i.kind === kind)
const causal = /\b(causa|causan|provoca|provocan|hace que|debido a|gracias a|porque|mejora|empeora|produce|producen)\b/i

function session(id: string, date: LocalDate, minutes: number, interruptions: number | null): FocusSession {
  const start = Date.parse(`${date}T09:00:00+01:00`)
  return { id, habitId: null, project: null, plannedOutput: null, actualOutput: null, plannedMinutes: 50, segments: [{ start: new Date(start).toISOString(), end: new Date(start + minutes * 60_000).toISOString() }], state: "finished", localDate: date, rating: null, interruptions, createdAt: "", updatedAt: "" }
}

describe("every insight says where it comes from", () => {
  it("there are none without data", () => {
    expect(insights(makeState([]), TODAY)).toEqual([])
  })

  it("has a period, its variables, its n, at least one limitation, and no causal words", () => {
    const steady = habit("h1", "Leer")
    const s = makeState([steady], entries("h1", done(days("2026-08-01", 101))))
    const list = insights(s, TODAY)
    expect(list.length).toBeGreaterThan(0)
    for (const i of list) {
      expect(i.period.from <= i.period.to && i.period.to < TODAY).toBe(true)
      expect(i.variables.length).toBeGreaterThan(0)
      expect(i.n).toBeGreaterThanOrEqual(INSIGHT_RULES[i.kind].minN)
      expect(i.limitations.length).toBeGreaterThan(0)
      expect(i.limitations.join(" ")).toMatch(/no (dice|indica) (la causa|por qué)/)
      expect(`${i.title} ${i.statement}`).not.toMatch(causal)
    }
  })

  it("every rule documents its minimum and what it compares", () => {
    for (const r of Object.values(INSIGHT_RULES)) {
      expect(r.minN).toBeGreaterThan(0)
      expect(r.description.length).toBeGreaterThan(20)
    }
  })
})

describe("a habit kept steadily", () => {
  it("appears with its count over the last 28 days", () => {
    const s = makeState([habit("h1", "Leer")], entries("h1", done(days("2026-10-13", 28).filter((_, i) => i !== 3))))
    expect(of(insights(s, TODAY), "habit_steady")).toMatchObject([{ variables: ["Leer"], n: 28, period: { from: "2026-10-13", to: "2026-11-09" } }])
    expect(of(insights(s, TODAY), "habit_steady")[0].statement).toContain("27 de 28")
  })

  it("not with too few chances to tell", () => {
    const s = makeState([habit("h1", "Leer", "2026-10-30")], entries("h1", done(days("2026-10-30", 11))))
    expect(of(insights(s, TODAY), "habit_steady")).toEqual([])
  })
})

describe("a habit that dropped", () => {
  const before = days("2026-09-15", 28)
  const after = days("2026-10-13", 28)

  it("compares the last 28 days with the 28 before", () => {
    const s = makeState([habit("h1", "Correr")], entries("h1", done([...before, ...after.filter((_, i) => i % 2 === 0)])))
    const [i] = of(insights(s, TODAY), "habit_drop")
    expect(i).toMatchObject({ variables: ["Correr"], n: 56, tone: "negative" })
    expect(i.statement).toMatch(/100 %.*50 %/)
  })

  it("not for a small dip", () => {
    const s = makeState([habit("h1", "Correr")], entries("h1", done([...before, ...after.filter((_, i) => i % 5 !== 0)])))
    expect(of(insights(s, TODAY), "habit_drop")).toEqual([])
  })
})

describe("a weekday that lags behind", () => {
  it("names the day and both rates, with eight weeks behind it", () => {
    const window = days("2026-09-15", 56)
    const s = makeState([habit("h1", "Meditar")], entries("h1", done(window.filter((d) => new Date(`${d}T12:00:00Z`).getUTCDay() !== 0))))
    const [i] = of(insights(s, TODAY), "weekday_low")
    expect(i.statement).toMatch(/domingos/)
    expect(i.statement).toMatch(/0 %/)
    expect(i.n).toBe(8)
  })

  it("not when every day is alike", () => {
    const s = makeState([habit("h1", "Meditar")], entries("h1", done(days("2026-09-15", 56))))
    expect(of(insights(s, TODAY), "weekday_low")).toEqual([])
  })
})

describe("last week against the one before", () => {
  it("says how far completion moved, with both counts", () => {
    const s = makeState([habit("h1", "Leer")], entries("h1", done([...days("2026-10-26", 7), ...days("2026-11-02", 3)])))
    const [i] = of(insights(s, TODAY), "week_change")
    expect(i).toMatchObject({ period: { from: "2026-10-26", to: "2026-11-08" }, n: 14, tone: "negative" })
    expect(i.statement).toMatch(/7 de 7.*3 de 7/)
  })

  it("needs a full week of chances on each side", () => {
    const s = makeState([habit("h1", "Leer", "2026-11-01")], entries("h1", done(days("2026-11-01", 3))))
    expect(of(insights(s, TODAY), "week_change")).toEqual([])
  })
})

describe("relations between variables", () => {
  it("only clear ones, with the days they share and the relation's own limits", () => {
    let s: HabitsState = makeState([])
    for (const [i, d] of days("2026-10-13", 20).entries()) s = setCheckin(s, { date: d, phase: "am", values: { sleep: 5 + (i % 5) * 0.5, energy: 1 + (i % 5) }, at: `${d}T08:00:00.000Z`, today: TODAY }).state
    const list = of(insights(s, TODAY), "relation")
    expect(list.length).toBeGreaterThan(0)
    expect(list[0].variables.length).toBe(2)
    expect(list[0].n).toBeGreaterThanOrEqual(14)
    expect(list[0].limitations.join(" ")).toContain("no qué provoca qué")
  })

  it("none with fewer than 14 shared days", () => {
    let s: HabitsState = makeState([])
    for (const [i, d] of days("2026-10-27", 13).entries()) s = setCheckin(s, { date: d, phase: "am", values: { sleep: 5 + (i % 5) * 0.5, energy: 1 + (i % 5) }, at: `${d}T08:00:00.000Z`, today: TODAY }).state
    expect(of(insights(s, TODAY), "relation")).toEqual([])
  })
})

describe("interruptions in Deep Work", () => {
  const noted = (zero: number, some: number) => [
    ...days("2026-10-20", zero).map((d, i) => session(`z${i}`, d, 50, 0)),
    ...days("2026-11-01", some).map((d, i) => session(`s${i}`, d, 20, 2)),
  ]

  it("compares sessions without and with interruptions, counting only noted ones", () => {
    const s: HabitsState = { ...makeState([]), focusSessions: [...noted(4, 4), session("x", "2026-10-25", 90, null)] }
    const [i] = of(insights(s, TODAY), "interruptions")
    expect(i).toMatchObject({ n: 8 })
    expect(i.statement).toMatch(/50 min.*20 min/)
  })

  it("not with fewer than four noted sessions on a side", () => {
    expect(of(insights({ ...makeState([]), focusSessions: noted(4, 3) }, TODAY), "interruptions")).toEqual([])
  })
})
