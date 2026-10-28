import { describe, expect, it } from "vitest"
import { makeState } from "@/features/habits/domain/test-helpers"
import {
  checkinDate,
  checkinFor,
  cleanNote,
  clearCheckin,
  defaultPhase,
  normalizeConfig,
  previousValue,
  setCheckin,
  setCheckinConfig,
  validValue,
  visibleFields,
} from "./ops"
import { DEFAULT_CHECKIN_CONFIG } from "./types"

const TODAY = "2026-10-21"
const TZ = "Europe/Madrid"
const at = (s: string) => `2026-10-21T${s}.000Z`

describe("day and phase of a check-in (decision 2)", () => {
  it("suggests morning from 04:00 to 13:59 and evening otherwise (Madrid local time)", () => {
    expect(defaultPhase(Date.parse("2026-10-21T05:30:00Z"), TZ)).toBe("am") // 07:30
    expect(defaultPhase(Date.parse("2026-10-21T11:59:00Z"), TZ)).toBe("am") // 13:59
    expect(defaultPhase(Date.parse("2026-10-21T12:00:00Z"), TZ)).toBe("pm") // 14:00
    expect(defaultPhase(Date.parse("2026-10-21T22:40:00Z"), TZ)).toBe("pm") // 00:40 of the 22nd
    expect(defaultPhase(Date.parse("2026-10-22T02:00:00Z"), TZ)).toBe("am") // 04:00
  })

  it("an evening check-in before 04:00 closes the previous day; at 04:10 it is the new day", () => {
    expect(checkinDate(Date.parse("2026-10-21T22:40:00Z"), "pm", TZ)).toBe("2026-10-21") // 00:40 on the 22nd
    expect(checkinDate(Date.parse("2026-10-22T01:59:00Z"), "pm", TZ)).toBe("2026-10-21") // 03:59
    expect(checkinDate(Date.parse("2026-10-22T02:10:00Z"), "pm", TZ)).toBe("2026-10-22") // 04:10
    // A morning check-in is always the day it is made.
    expect(checkinDate(Date.parse("2026-10-21T22:40:00Z"), "am", TZ)).toBe("2026-10-22")
  })

  it("is DST-aware (Europe/Madrid ends summer time on 25/10/2026 and starts it on 28/03/2027)", () => {
    // 25/10/2026: 03:00 CEST → 02:00 CET. 01:30 UTC = 02:30 CET, still before 04:00.
    expect(checkinDate(Date.parse("2026-10-25T01:30:00Z"), "pm", TZ)).toBe("2026-10-24")
    expect(checkinDate(Date.parse("2026-10-25T03:05:00Z"), "pm", TZ)).toBe("2026-10-25") // 04:05 CET
    // 28/03/2027: 02:00 CET → 03:00 CEST. 01:30 UTC = 03:30 CEST, before 04:00.
    expect(checkinDate(Date.parse("2027-03-28T01:30:00Z"), "pm", TZ)).toBe("2027-03-27")
    expect(checkinDate(Date.parse("2027-03-28T02:05:00Z"), "pm", TZ)).toBe("2027-03-28") // 04:05 CEST
  })
})

describe("values", () => {
  it("accepts 1–5 scales, quarter-hour sleep up to 16 h and a capped reflection", () => {
    expect(validValue("energy", 1)).toBe(true)
    expect(validValue("energy", 5)).toBe(true)
    expect(validValue("energy", 0)).toBe(false)
    expect(validValue("stress", 2.5)).toBe(false)
    expect(validValue("sleep", 7.25)).toBe(true)
    expect(validValue("sleep", 7.1)).toBe(false)
    expect(validValue("sleep", 16.25)).toBe(false)
    expect(validValue("mood", null)).toBe(true)
    expect(validValue("note", "x".repeat(1000))).toBe(true)
    expect(validValue("note", "x".repeat(1001))).toBe(false)
    expect(cleanNote("  línea 1\r\nlínea 2  ")).toBe("línea 1\nlínea 2")
    expect(cleanNote("   ")).toBeNull()
  })
})

describe("setCheckin: one check-in per day and phase, autosaved field by field", () => {
  it("creates on the first field and adds fields to the same check-in", () => {
    let s = makeState([])
    s = setCheckin(s, { date: TODAY, phase: "am", values: { energy: 4 }, at: at("07:00:00"), today: TODAY }).state
    s = setCheckin(s, { date: TODAY, phase: "am", values: { sleep: 7.5 }, at: at("07:00:01"), today: TODAY }).state
    expect(Object.keys(s.checkins)).toEqual([`${TODAY}:am`])
    expect(checkinFor(s, TODAY, "am")).toMatchObject({ energy: 4, sleep: 7.5, mood: null, stress: null })
    expect(checkinFor(s, TODAY, "am")!.stamps).toEqual({ energy: at("07:00:00"), sleep: at("07:00:01") })
  })

  it("rejects future days and invalid values without changing anything", () => {
    const s = makeState([])
    expect(setCheckin(s, { date: "2026-10-22", phase: "am", values: { energy: 3 }, at: at("07:00:00"), today: TODAY })).toMatchObject({ ok: false, reason: "future_date" })
    expect(setCheckin(s, { date: TODAY, phase: "am", values: { energy: 6 }, at: at("07:00:00"), today: TODAY })).toMatchObject({ ok: false, reason: "invalid_value" })
    expect(setCheckin(s, { date: TODAY, phase: "am", values: { steps: 3 } as never, at: at("07:00:00"), today: TODAY })).toMatchObject({ ok: false, reason: "invalid_value" })
  })

  it("is last-writer-wins per field: an older write never overwrites a newer value (decision 3)", () => {
    let s = makeState([])
    s = setCheckin(s, { date: TODAY, phase: "pm", values: { mood: 4 }, at: at("20:00:10"), today: TODAY }).state
    const older = setCheckin(s, { date: TODAY, phase: "pm", values: { mood: 2, stress: 3 }, at: at("20:00:05"), today: TODAY })
    // mood keeps the newer 4; stress (never written before) is taken.
    expect(checkinFor(older.state, TODAY, "pm")).toMatchObject({ mood: 4, stress: 3 })
  })

  it("returns the same state when nothing changes, and removes a check-in left empty", () => {
    let s = makeState([])
    s = setCheckin(s, { date: TODAY, phase: "am", values: { energy: 3 }, at: at("07:00:00"), today: TODAY }).state
    expect(setCheckin(s, { date: TODAY, phase: "am", values: { energy: 3 }, at: at("07:00:01"), today: TODAY }).state).toBe(s)
    const cleared = setCheckin(s, { date: TODAY, phase: "am", values: { energy: null }, at: at("07:00:02"), today: TODAY }).state
    expect(checkinFor(cleared, TODAY, "am")).toBeNull()
    const s2 = setCheckin(s, { date: TODAY, phase: "am", values: { mood: 2, note: "hola" }, at: at("07:00:03"), today: TODAY }).state
    expect(checkinFor(clearCheckin(s2, TODAY, "am", at("07:00:04"), TODAY).state, TODAY, "am")).toBeNull()
  })

  it("past days can be edited (history), and the reflection is cleaned", () => {
    const s = setCheckin(makeState([]), { date: "2026-10-10", phase: "pm", values: { note: "  Buen día  " }, at: at("09:00:00"), today: TODAY }).state
    expect(checkinFor(s, "2026-10-10", "pm")!.note).toBe("Buen día")
  })
})

describe("configuration (decision 4)", () => {
  it("defaults: morning sleep/energy/mood, evening energy/mood/stress/reflection", () => {
    expect(DEFAULT_CHECKIN_CONFIG).toEqual({ am: ["sleep", "energy", "mood"], pm: ["energy", "mood", "stress", "note"] })
  })

  it("needs at least one indicator per phase, ignores unknown fields and keeps a canonical order", () => {
    const s = makeState([])
    expect(setCheckinConfig(s, { am: ["note"], pm: ["mood"] })).toMatchObject({ ok: false, reason: "invalid_config" })
    expect(setCheckinConfig(s, { am: [], pm: ["mood"] })).toMatchObject({ ok: false })
    const r = setCheckinConfig(s, { am: ["mood", "sleep"], pm: ["stress", "note"] })
    expect(r.state.checkinConfig).toEqual({ am: ["sleep", "mood"], pm: ["stress", "note"] })
    expect(normalizeConfig({ am: ["x"], pm: 3 })).toEqual(DEFAULT_CHECKIN_CONFIG)
    expect(setCheckinConfig(s, DEFAULT_CHECKIN_CONFIG).state).toBe(s)
  })

  it("hiding an indicator never hides a value already recorded in that check-in", () => {
    let s = makeState([])
    s = setCheckin(s, { date: TODAY, phase: "am", values: { stress: 4 }, at: at("07:00:00"), today: TODAY }).state
    s = setCheckinConfig(s, { am: ["energy"], pm: ["mood"] }).state
    expect(visibleFields(s, "am", checkinFor(s, TODAY, "am"))).toEqual(["energy", "stress"])
    expect(visibleFields(s, "am", null)).toEqual(["energy"])
  })

  it("yesterday's value of the same phase is available as a reference", () => {
    const s = setCheckin(makeState([]), { date: "2026-10-20", phase: "am", values: { energy: 2 }, at: at("07:00:00"), today: TODAY }).state
    expect(previousValue(s, TODAY, "am", "energy")).toBe(2)
    expect(previousValue(s, TODAY, "pm", "energy")).toBeNull()
  })
})
