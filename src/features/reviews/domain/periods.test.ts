import { describe, expect, it } from "vitest"
import { localDateInZone } from "@/features/habits/domain/dates"
import {
  isAvailable,
  isLateClose,
  isOpen,
  isPeriodStart,
  latestAvailable,
  nextPeriod,
  parseRoute,
  periodDays,
  periodFromStart,
  periodLabel,
  periodOf,
  previousPeriod,
} from "./periods"

// October 2026: Monday 26 → Sunday 1 November. Summer time ends on Sunday 25 October 2026.

describe("weeks run Monday to Sunday and belong to their Monday", () => {
  it("a week that spans two months is the week of its Monday", () => {
    expect(periodOf("week", "2026-10-28")).toEqual({ kind: "week", from: "2026-10-26", to: "2026-11-01" })
    expect(periodOf("week", "2026-11-01")).toEqual({ kind: "week", from: "2026-10-26", to: "2026-11-01" })
  })

  it("handles ISO week 53 across the new year", () => {
    expect(periodOf("week", "2027-01-01")).toEqual({ kind: "week", from: "2026-12-28", to: "2027-01-03" })
    expect(nextPeriod(periodOf("week", "2026-12-28")).from).toBe("2027-01-04")
  })

  it("the week of the summer-time change still has 7 days", () => {
    expect(periodDays(periodOf("week", "2026-10-25"))).toBe(7)
  })
})

describe("months are calendar months of every length", () => {
  it.each([
    ["2026-01-15", "2026-01-01", "2026-01-31"],
    ["2027-02-10", "2027-02-01", "2027-02-28"],
    ["2028-02-10", "2028-02-01", "2028-02-29"],
    ["2026-04-30", "2026-04-01", "2026-04-30"],
    ["2026-12-31", "2026-12-01", "2026-12-31"],
  ])("%s → %s … %s", (date, from, to) => {
    expect(periodOf("month", date)).toEqual({ kind: "month", from, to })
  })

  it("previous and next cross year boundaries and leap February", () => {
    expect(previousPeriod(periodOf("month", "2028-03-05"))).toEqual({ kind: "month", from: "2028-02-01", to: "2028-02-29" })
    expect(nextPeriod(periodOf("month", "2026-12-01"))).toEqual({ kind: "month", from: "2027-01-01", to: "2027-01-31" })
    expect(previousPeriod(periodOf("week", "2026-10-26"))).toEqual({ kind: "week", from: "2026-10-19", to: "2026-10-25" })
  })
})

describe("period identity (decision 6): only a Monday or a 1st starts a period", () => {
  it("validates starts", () => {
    expect(isPeriodStart("week", "2026-10-26")).toBe(true)
    expect(isPeriodStart("week", "2026-10-27")).toBe(false)
    expect(isPeriodStart("month", "2026-10-01")).toBe(true)
    expect(isPeriodStart("month", "2026-10-02")).toBe(false)
    expect(isPeriodStart("month", "2026-02-30")).toBe(false)
    expect(isPeriodStart("week", 20261026)).toBe(false)
    expect(periodFromStart("week", "2026-10-27")).toBeNull()
  })
})

describe("availability (decision 2)", () => {
  const week = periodOf("week", "2026-10-26")

  it("from the period's last day on, and for any past period", () => {
    expect(isAvailable(week, "2026-10-31")).toBe(false)
    expect(isAvailable(week, "2026-11-01")).toBe(true)
    expect(isAvailable(week, "2027-03-01")).toBe(true)
  })

  it("on its last day the period is still open (today counts as pending)", () => {
    expect(isOpen(week, "2026-11-01")).toBe(true)
    expect(isOpen(week, "2026-11-02")).toBe(false)
  })

  it("the latest available period is the current one only on its last day", () => {
    expect(latestAvailable("week", "2026-10-28").from).toBe("2026-10-19")
    expect(latestAvailable("week", "2026-11-01").from).toBe("2026-10-26")
    expect(latestAvailable("month", "2026-10-30").from).toBe("2026-09-01")
    expect(latestAvailable("month", "2026-10-31").from).toBe("2026-10-01")
  })

  it("respects the profile timezone: the same instant is Sunday in New York and Monday in Madrid", () => {
    const instant = new Date("2026-11-01T23:30:00Z")
    const madrid = localDateInZone(instant, "Europe/Madrid")
    const newYork = localDateInZone(instant, "America/New_York")
    expect([madrid, newYork]).toEqual(["2026-11-02", "2026-11-01"])
    // Madrid: the week is over. New York: it is its last day, still open.
    expect(isOpen(week, madrid)).toBe(false)
    expect(isOpen(week, newYork)).toBe(true)
    expect(latestAvailable("week", newYork).from).toBe("2026-10-26")
    expect(latestAvailable("week", madrid).from).toBe("2026-10-26")
  })

  it("a late close is only an informative flag", () => {
    expect(isLateClose(week, "2026-11-15", 14)).toBe(false)
    expect(isLateClose(week, "2026-11-16", 14)).toBe(true)
  })
})

describe("routes and labels", () => {
  it("parses /reviews/<kind>/<start> and refuses invalid or future periods", () => {
    expect(parseRoute("week", "2026-10-26", "2026-11-03")).toEqual({ kind: "week", from: "2026-10-26", to: "2026-11-01" })
    expect(parseRoute("week", "2026-10-26", "2026-10-30")).toBeNull()
    expect(parseRoute("week", "2026-10-27", "2026-11-03")).toBeNull()
    expect(parseRoute("year", "2026-01-01", "2027-01-01")).toBeNull()
    expect(parseRoute("month", "../x", "2027-01-01")).toBeNull()
  })

  it("labels weeks and months in Spanish", () => {
    expect(periodLabel(periodOf("week", "2026-10-26"))).toMatch(/^Semana del 26 oct\.? al 1 nov\.?$/)
    expect(periodLabel(periodOf("month", "2026-10-01"))).toBe("Octubre de 2026")
  })
})
