import { describe, expect, it } from "vitest"
import { entries, makeHabit, makeState } from "@/features/habits/domain/test-helpers"
import type { HabitsState } from "@/features/habits/domain/types"
import { DEFAULT_SETTINGS, evaluate, inQuietHours, stillDue, type EvalInput, type MotivationSettings, type SentNudge } from "./motivation"

const TODAY = "2026-11-10" // Tuesday
const at = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))
const habits = [makeHabit({ id: "h1", name: "Leer", startDate: "2026-10-01" }), makeHabit({ id: "h2", name: "Correr", startDate: "2026-10-01" })]
const input = (p: Partial<EvalInput> & { time?: string } = {}): EvalInput => ({ state: makeState(habits), today: TODAY, minutes: at(p.time ?? "19:30"), settings: DEFAULT_SETTINGS, sent: [], ...p })
const rules = (i: EvalInput) => evaluate(i).nudges.map((n) => n.rule)
const only = (rule: keyof MotivationSettings["rules"]): MotivationSettings => ({ ...DEFAULT_SETTINGS, rules: Object.fromEntries(Object.keys(DEFAULT_SETTINGS.rules).map((k) => [k, k === rule])) as MotivationSettings["rules"] })
const sent = (rule: SentNudge["rule"], time: string, key = `${rule}:${TODAY}`): SentNudge => ({ key, rule, at: `${TODAY}T${time}:00`, localDate: TODAY, minutes: at(time) })

describe("nothing for a habit that is done or resting", () => {
  it("the evening reminder lists only what is still pending", () => {
    const s: HabitsState = makeState(habits, entries("h1", { [TODAY]: true }))
    const [n] = evaluate(input({ state: s, settings: only("late") })).nudges
    expect(n).toMatchObject({ rule: "late", key: `late:${TODAY}`, habitIds: ["h2"] })
    expect(n.body).toContain("Correr")
    expect(n.body).not.toContain("Leer")
  })

  it("with every habit done there is no reminder, only the recognition when it is on", () => {
    const s = makeState(habits, { ...entries("h1", { [TODAY]: true }), ...entries("h2", { [TODAY]: true }) })
    expect(rules(input({ state: s, settings: only("late") }))).toEqual([])
    expect(rules(input({ state: s, settings: only("due"), time: "13:30" }))).toEqual([])
    expect(rules(input({ state: s, settings: only("allDone") }))).toEqual(["allDone"])
  })

  it("on a planned rest day nothing is said about habits", () => {
    const s = makeState(habits, {}, [TODAY])
    for (const r of ["morning", "due", "late", "allDone"] as const) expect(rules(input({ state: s, settings: only(r), time: r === "morning" ? "08:30" : r === "due" ? "13:30" : "19:30" }))).toEqual([])
    expect(evaluate(input({ state: s, settings: only("late") })).skipped).toContainEqual({ rule: "late", reason: "Hoy es día de descanso planificado." })
  })

  it("a habit not scheduled today is not pending", () => {
    const weekdays = makeHabit({ id: "h3", name: "Gimnasio", startDate: "2026-10-01", rule: { kind: "weekdays", weekdays: [1, 3, 5] } })
    const [n] = evaluate(input({ state: makeState([weekdays, habits[0]]), settings: only("late") })).nudges
    expect(n.habitIds).toEqual(["h1"])
  })
})

describe("silence, cap and spacing", () => {
  it("quiet hours can wrap midnight", () => {
    const s = { ...DEFAULT_SETTINGS, quietStart: "22:00", quietEnd: "08:00" }
    expect(inQuietHours(s, at("23:00"))).toBe(true)
    expect(inQuietHours(s, at("07:59"))).toBe(true)
    expect(inQuietHours(s, at("08:00"))).toBe(false)
    expect(inQuietHours({ ...s, quietStart: "13:00", quietEnd: "15:00" }, at("14:00"))).toBe(true)
    expect(rules(input({ settings: { ...only("late"), quietStart: "19:00", quietEnd: "08:00" } }))).toEqual([])
  })

  it("the daily cap counts what was already sent today", () => {
    const settings = { ...DEFAULT_SETTINGS, dailyCap: 2, minGapMinutes: 0 }
    expect(rules(input({ settings, sent: [sent("morning", "08:30"), sent("due", "13:30")] }))).toEqual([])
    expect(evaluate(input({ settings, sent: [sent("morning", "08:30"), sent("due", "13:30")] })).skipped[0].reason).toMatch(/tope de 2/)
  })

  it("only the most important ones fit in what is left of the cap", () => {
    const s: HabitsState = makeState(habits)
    const settings = { ...DEFAULT_SETTINGS, dailyCap: 1, minGapMinutes: 0, rules: { ...DEFAULT_SETTINGS.rules, review: true, recall: true } }
    expect(rules(input({ state: s, settings, time: "20:30" }))).toEqual(["late"])
  })

  it("keeps a minimum gap after the last one", () => {
    expect(rules(input({ settings: { ...only("late"), minGapMinutes: 60 }, sent: [sent("due", "19:00", "due:x")] }))).toEqual([])
    expect(rules(input({ settings: { ...only("late"), minGapMinutes: 60 }, sent: [sent("due", "18:00", "due:x")] }))).toEqual(["late"])
  })

  it("with a minimum gap, at most one at a time: two at once would break it", () => {
    const settings = { ...DEFAULT_SETTINGS, dailyCap: 4, minGapMinutes: 30, rules: { ...DEFAULT_SETTINGS.rules, recall: false } }
    const sunday = "2026-11-15"
    expect(rules(input({ today: sunday, settings, time: "19:30" }))).toEqual(["late"])
    expect(rules(input({ today: sunday, settings: { ...settings, minGapMinutes: 0 }, time: "19:30" }))).toEqual(["late", "review"])
  })

  it("never sends the same reminder twice the same day", () => {
    expect(rules(input({ settings: { ...only("late"), minGapMinutes: 0 }, sent: [sent("late", "19:00")] }))).toEqual([])
  })

  it("days off and the global switch silence everything", () => {
    expect(rules(input({ settings: { ...DEFAULT_SETTINGS, daysOff: [2] } }))).toEqual([])
    expect(rules(input({ settings: { ...DEFAULT_SETTINGS, enabled: false } }))).toEqual([])
    expect(evaluate(input({ settings: { ...DEFAULT_SETTINGS, enabled: false } })).skipped[0].reason).toBe("Los avisos están desactivados.")
  })
})

describe("each rule at its time", () => {
  it("morning only in its window", () => {
    expect(rules(input({ settings: only("morning"), time: "07:00" }))).toEqual([])
    expect(rules(input({ settings: only("morning"), time: "08:30" }))).toEqual(["morning"])
    expect(rules(input({ settings: only("morning"), time: "12:30" }))).toEqual([])
  })

  it("the weekly review once its week is reviewable and not closed", () => {
    const sunday = "2026-11-15"
    expect(rules(input({ today: sunday, settings: only("review"), time: "18:30" }))).toEqual(["review"])
    expect(evaluate(input({ today: sunday, settings: only("review"), time: "18:30" })).nudges[0].key).toBe("review:2026-11-09")
  })

  it("recall only with cards waiting", () => {
    expect(rules(input({ settings: only("recall"), time: "20:30" }))).toEqual([])
    const s: HabitsState = { ...makeState(habits), recall: { cards: { c: { id: "c", question: "q", answer: "a", sourceType: null, sourceId: null, schedule: { state: "review", reps: 1, lapses: 0, easeFactor: 2.5, intervalDays: 1, dueOn: TODAY }, suspendedOn: null, firstAnsweredOn: "2026-11-09", lastAnsweredAt: null, algorithmVersion: 1, createdAt: "" } }, attempts: {} } }
    expect(evaluate(input({ state: s, settings: only("recall"), time: "20:30" })).nudges[0]).toMatchObject({ rule: "recall", body: expect.stringContaining("1 tarjeta") })
  })
})

describe("re-evaluated at send time", () => {
  it("a reminder computed earlier is dropped if the habits were done meanwhile", () => {
    const [n] = evaluate(input({ settings: only("late") })).nudges
    const done = makeState(habits, { ...entries("h1", { [TODAY]: true }), ...entries("h2", { [TODAY]: true }) })
    expect(stillDue(n, input({ settings: only("late") }))).toBe(true)
    expect(stillDue(n, input({ state: done, settings: only("late") }))).toBe(false)
  })
})

describe("the words", () => {
  it("follow the tone, with strong language only behind its own switch", () => {
    const body = (tone: MotivationSettings["tone"], profanity = false) => evaluate(input({ settings: { ...only("late"), tone, profanity } })).nudges[0].body
    expect(new Set([body("calm"), body("balanced"), body("hardcore")]).size).toBe(3)
    expect(body("hardcore", true)).not.toBe(body("hardcore"))
    expect(body("calm", true)).toBe(body("calm"))
  })

  it("never quote anyone or show check-in details", () => {
    for (const r of Object.keys(DEFAULT_SETTINGS.rules)) {
      const n = evaluate(input({ settings: { ...only(r as never), minGapMinutes: 0 }, time: "08:30" })).nudges[0]
      if (n) expect(`${n.title} ${n.body}`).not.toMatch(/«|»|"|energía|ánimo|estrés|sueño/i)
    }
  })
})
