import { describe, expect, it } from "vitest"
import {
  addDays,
  diffDays,
  eachDay,
  isLocalDate,
  isoWeekday,
  localDateInZone,
  startOfWeek,
  weekDates,
} from "./dates"

describe("calendar arithmetic", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01")
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29")
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28")
  })

  it("is unaffected by DST transitions (Europe: 29 Mar and 25 Oct 2026)", () => {
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25")
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26")
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30")
    expect(diffDays("2026-10-24", "2026-10-26")).toBe(2)
    expect(eachDay("2026-10-24", "2026-10-27")).toHaveLength(4)
  })

  it("computes ISO weekdays and Monday-based weeks", () => {
    expect(isoWeekday("2026-10-19")).toBe(1) // Monday
    expect(isoWeekday("2026-10-25")).toBe(7) // Sunday
    expect(startOfWeek("2026-10-25")).toBe("2026-10-19")
    expect(startOfWeek("2026-10-19")).toBe("2026-10-19")
    expect(weekDates("2026-10-22")).toEqual([
      "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22",
      "2026-10-23", "2026-10-24", "2026-10-25",
    ])
  })

  it("validates local dates strictly", () => {
    expect(isLocalDate("2026-10-24")).toBe(true)
    expect(isLocalDate("2026-02-30")).toBe(false)
    expect(isLocalDate("2026-1-5")).toBe(false)
    expect(isLocalDate(20261024)).toBe(false)
  })
})

describe("localDateInZone", () => {
  const tz = "Europe/Madrid"

  it("maps instants around midnight to the Madrid calendar day", () => {
    // 22:30 UTC on 24 Oct is 00:30 CEST on 25 Oct
    expect(localDateInZone(new Date("2026-10-24T22:30:00Z"), tz)).toBe("2026-10-25")
    expect(localDateInZone(new Date("2026-10-24T21:59:00Z"), tz)).toBe("2026-10-24")
  })

  it("handles the autumn DST fall-back day (25 Oct 2026, 25 hours long)", () => {
    // 23:30 UTC on 25 Oct is 00:30 CET on 26 Oct (offset is now +1)
    expect(localDateInZone(new Date("2026-10-25T22:30:00Z"), tz)).toBe("2026-10-25")
    expect(localDateInZone(new Date("2026-10-25T23:30:00Z"), tz)).toBe("2026-10-26")
    // the repeated 02:00–03:00 hour stays on the same day
    expect(localDateInZone(new Date("2026-10-25T00:30:00Z"), tz)).toBe("2026-10-25")
    expect(localDateInZone(new Date("2026-10-25T01:30:00Z"), tz)).toBe("2026-10-25")
  })

  it("handles the spring DST jump (29 Mar 2026, 23 hours long)", () => {
    expect(localDateInZone(new Date("2026-03-28T23:30:00Z"), tz)).toBe("2026-03-29")
    expect(localDateInZone(new Date("2026-03-29T21:59:00Z"), tz)).toBe("2026-03-29")
    expect(localDateInZone(new Date("2026-03-29T22:00:00Z"), tz)).toBe("2026-03-30")
  })
})
