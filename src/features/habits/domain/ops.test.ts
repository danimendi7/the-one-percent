import { describe, expect, it } from "vitest"
import { addHabit, archiveHabit, setEntry, setRestDay, updateHabit } from "./ops"
import { completion } from "./metrics"
import { ctx, makeHabit, makeState } from "./test-helpers"

const base = { opId: "op", now: "2026-10-21T10:00:00Z", today: "2026-10-21" }

describe("setEntry (set desired state, not toggle)", () => {
  it("is idempotent: repeating the same desired state is a no-op", () => {
    const s0 = makeState([makeHabit()])
    const r1 = setEntry(s0, { ...base, habitId: "h1", date: "2026-10-21", value: true })
    expect(r1.ok && r1.previous).toBe(null)
    const r2 = setEntry(r1.state, { ...base, habitId: "h1", date: "2026-10-21", value: true, opId: "retry" })
    expect(r2.state).toBe(r1.state)
    expect(Object.keys(r2.state.entries)).toHaveLength(1)
  })

  it("unmarking removes the entry and reports the previous value for undo", () => {
    const s1 = setEntry(makeState([makeHabit()]), { ...base, habitId: "h1", date: "2026-10-21", value: true }).state
    const r = setEntry(s1, { ...base, habitId: "h1", date: "2026-10-21", value: false })
    expect(r.ok && r.previous).toBe(true)
    expect(r.state.entries).toEqual({})
  })

  it("rejects future dates, unscheduled days, rest days and wrong value types", () => {
    const weekly = makeHabit({ rule: { kind: "weekdays", weekdays: [1] } })
    const s = makeState([weekly], {}, ["2026-10-19"])
    expect(setEntry(s, { ...base, habitId: "h1", date: "2026-10-26", value: true })).toMatchObject({ ok: false, reason: "future" })
    expect(setEntry(s, { ...base, habitId: "h1", date: "2026-10-20", value: true })).toMatchObject({ ok: false, reason: "not_eligible" })
    expect(setEntry(s, { ...base, habitId: "h1", date: "2026-10-19", value: true })).toMatchObject({ ok: false, reason: "rest_day" })
    expect(setEntry(s, { ...base, habitId: "h1", date: "2026-10-12", value: 3 })).toMatchObject({ ok: false, reason: "invalid_value" })
    expect(setEntry(s, { ...base, habitId: "nope", date: "2026-10-12", value: true })).toMatchObject({ ok: false, reason: "unknown_habit" })
  })

  it("stores exact numeric amounts and rejects negatives", () => {
    const h = makeHabit({ type: "numeric", target: 8000, unit: "pasos", direction: "at_least" })
    const s = makeState([h])
    const r = setEntry(s, { ...base, habitId: "h1", date: "2026-10-21", value: 10432 })
    expect(r.state.entries["h1:2026-10-21"].value).toBe(10432)
    expect(setEntry(s, { ...base, habitId: "h1", date: "2026-10-21", value: -1 }).ok).toBe(false)
  })
})

describe("habit lifecycle", () => {
  it("a new habit starts today and does not create past opportunities", () => {
    const s = addHabit(makeState([]), {
      name: "  Leer  ", icon: "book", dimensionId: "learn", type: "binary", rule: { kind: "daily" },
    }, { id: "n1", today: "2026-10-21", now: base.now })
    expect(s.habits[0]).toMatchObject({ name: "Leer", startDate: "2026-10-21" })
    expect(completion(s.habits, { from: "2026-10-01", to: "2026-10-21" }, ctx("2026-10-21")).applicable).toBe(1)
  })

  it("editing the schedule versions it from today; cosmetic edits do not", () => {
    const s = makeState([makeHabit({ rule: { kind: "weekdays", weekdays: [1, 3] } })])
    const input = { name: "Nuevo", icon: "check", dimensionId: "body" as const, type: "binary" as const }
    const renamed = updateHabit(s, "h1", { ...input, rule: { kind: "weekdays", weekdays: [3, 1] } }, "2026-10-21")
    expect(renamed.habits[0].schedule).toHaveLength(1)
    expect(renamed.habits[0].name).toBe("Nuevo")
    const rescheduled = updateHabit(s, "h1", { ...input, rule: { kind: "daily" } }, "2026-10-21")
    expect(rescheduled.habits[0].schedule.map((v) => v.validFrom)).toEqual(["2026-10-01", "2026-10-21"])
  })

  it("archiving keeps history in metrics but stops new opportunities", () => {
    const s = archiveHabit(makeState([makeHabit()]), "h1", "2026-10-15")
    const c = ctx("2026-10-21")
    expect(completion(s.habits, { from: "2026-10-01", to: "2026-10-21" }, c).applicable).toBe(14)
  })

  it("rest days are idempotent", () => {
    const s1 = setRestDay(makeState([]), "2026-10-21", true)
    expect(setRestDay(s1, "2026-10-21", true)).toBe(s1)
    expect(setRestDay(s1, "2026-10-21", false).restDays).toEqual([])
  })
})
