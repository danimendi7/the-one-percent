import { describe, expect, it } from "vitest"
import { addDays, type LocalDate } from "@/features/habits/domain/dates"
import { entries, makeHabit, makeState } from "@/features/habits/domain/test-helpers"
import type { HabitsState } from "@/features/habits/domain/types"
import { setCheckin } from "@/features/mind/domain/ops"
import { addExperiment, closeExperiment, emptyExperiments, EXPERIMENT_DAYS, measureExperiment, removeExperiment, suggestExperiments, validateExperiment, MAX_ACTIVE } from "./experiments"
import type { Insight } from "./insights"

const TODAY = "2026-11-10"
const AT = "2026-11-10T09:00:00.000Z"
const days = (from: LocalDate, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i))
const done = (dates: LocalDate[]) => Object.fromEntries(dates.map((d) => [d, true]))
const H = "11111111-1111-4111-8111-111111111111"
const exp = (p: Partial<Parameters<typeof addExperiment>[1]> = {}) => ({ id: "e1", title: "Preparar la ropa la noche antes", metric: { kind: "habit" as const, habitId: H }, startOn: "2026-11-01", days: 14 as const, at: AT, ...p })
const state = (dates: LocalDate[]): HabitsState => makeState([makeHabit({ id: H, name: "Correr", startDate: "2026-09-01" })], entries(H, done(dates)))

describe("creating an experiment", () => {
  it("needs what you will change, a metric and a known length", () => {
    expect(validateExperiment({ title: " Leer antes de dormir ", metric: { kind: "focus" }, days: 14 })).toEqual({ ok: true, title: "Leer antes de dormir" })
    expect(validateExperiment({ title: "  ", metric: { kind: "focus" }, days: 14 })).toMatchObject({ ok: false, field: "title" })
    expect(validateExperiment({ title: "x".repeat(141), metric: { kind: "focus" }, days: 14 })).toMatchObject({ ok: false, field: "title" })
    expect(validateExperiment({ title: "A", metric: { kind: "focus" }, days: 10 as never })).toMatchObject({ ok: false, field: "days" })
    expect(validateExperiment({ title: "A", metric: { kind: "checkin", indicator: "hunger" as never }, days: 7 })).toMatchObject({ ok: false, field: "metric" })
    expect(EXPERIMENT_DAYS).toEqual([7, 14, 21, 28])
  })

  it("starts active; the same id twice is the same experiment", () => {
    const s = addExperiment(emptyExperiments(), exp())
    expect(s.e1).toMatchObject({ status: "active", endedOn: null, note: null, createdAt: AT })
    expect(addExperiment(s, exp({ title: "Otro" }))).toBe(s)
  })

  it("closing keeps the first close; removing takes it away", () => {
    const s = addExperiment(emptyExperiments(), exp())
    const closed = closeExperiment(s, "e1", { status: "finished", endedOn: TODAY, note: " Funcionó a medias " })
    expect(closed.e1).toMatchObject({ status: "finished", endedOn: TODAY, note: "Funcionó a medias" })
    expect(closeExperiment(closed, "e1", { status: "abandoned", endedOn: TODAY, note: null })).toBe(closed)
    expect(removeExperiment(closed, "e1").e1).toBeUndefined()
  })

  it("allows a few at a time", () => {
    expect(MAX_ACTIVE).toBe(3)
  })
})

describe("measuring", () => {
  it("compares the days of the experiment with as many days just before, each with its n", () => {
    const before = days("2026-10-18", 14).filter((_, i) => i % 2 === 0) // 7 of 14
    const during = days("2026-11-01", 9) // every day so far (1–9 Nov; today is the 10th, still open)
    const m = measureExperiment(state([...before, ...during]), addExperiment(emptyExperiments(), exp()).e1, TODAY)
    expect(m.baseline).toEqual({ range: { from: "2026-10-18", to: "2026-10-31" }, value: 0.5, n: 14 })
    expect(m.trial).toEqual({ range: { from: "2026-11-01", to: "2026-11-09" }, value: 1, n: 9 })
    expect(m).toMatchObject({ unit: "pct", delta: 0.5, enough: true, finished: false, day: 10, of: 14 })
    expect(m.limitations.join(" ")).toMatch(/no demuestra que el cambio sea la causa/)
  })

  it("with too few days on a side gives no result, only the counts", () => {
    const m = measureExperiment(state(days("2026-10-18", 23)), addExperiment(emptyExperiments(), exp({ startOn: "2026-11-07" })).e1, TODAY)
    expect(m.trial.n).toBe(3)
    expect(m).toMatchObject({ enough: false, delta: null })
  })

  it("stops counting on the day it ended", () => {
    const s = closeExperiment(addExperiment(emptyExperiments(), exp()), "e1", { status: "abandoned", endedOn: "2026-11-05", note: null })
    const m = measureExperiment(state(days("2026-10-01", 40)), s.e1, TODAY)
    expect(m.trial.range).toEqual({ from: "2026-11-01", to: "2026-11-05" })
    expect(m.finished).toBe(true)
  })

  it("measures a check-in indicator as a mean of the days with data", () => {
    let s = makeState([])
    for (const [i, d] of days("2026-10-18", 23).entries()) s = setCheckin(s, { date: d, phase: "am", values: { energy: i < 14 ? 2 : 4 }, at: `${d}T08:00:00.000Z`, today: TODAY }).state
    const m = measureExperiment(s, addExperiment(emptyExperiments(), exp({ metric: { kind: "checkin", indicator: "energy" } })).e1, TODAY)
    expect(m).toMatchObject({ unit: "points", enough: true, baseline: { value: 2, n: 14 }, trial: { value: 4, n: 9 }, delta: 2 })
  })

  it("for focus, a stretch before the first session ever is no data, not zero", () => {
    const m = measureExperiment(makeState([]), addExperiment(emptyExperiments(), exp({ metric: { kind: "focus" } })).e1, TODAY)
    expect(m).toMatchObject({ unit: "minutes", enough: false, delta: null, baseline: { value: null } })
  })

  it("before its first day has nothing measured", () => {
    const m = measureExperiment(state([]), addExperiment(emptyExperiments(), exp({ startOn: TODAY })).e1, TODAY)
    expect(m).toMatchObject({ trial: { n: 0, value: null }, enough: false, day: 1 })
  })
})

describe("suggestions come from insights, never invented", () => {
  const insight = (p: Partial<Insight>): Insight => ({ id: "x", kind: "habit_drop", title: "", statement: "", period: { from: TODAY, to: TODAY }, variables: [], n: 20, nLabel: "", limitations: [], tone: "negative", ...p })

  it("a habit that dropped suggests measuring that habit", () => {
    expect(suggestExperiments([insight({ id: `habit_drop:${H}`, variables: ["Correr"] })])).toEqual([{ id: `habit_drop:${H}`, metric: { kind: "habit", habitId: H }, reason: "«Correr» ha bajado en las últimas 4 semanas" }])
  })

  it("interruptions suggest measuring focus, and a relation its check-in side", () => {
    expect(suggestExperiments([insight({ id: "interruptions", kind: "interruptions" })])[0].metric).toEqual({ kind: "focus" })
    expect(suggestExperiments([insight({ id: "relation:sleep:energy", kind: "relation", variables: ["Sueño", "Energía"] })])[0].metric).toEqual({ kind: "checkin", indicator: "energy" })
  })

  it("nothing for insights without a clear thing to measure", () => {
    expect(suggestExperiments([insight({ id: "habit_steady:x", kind: "habit_steady" }), insight({ id: "weekday_low:7", kind: "weekday_low" })])).toEqual([])
  })
})
