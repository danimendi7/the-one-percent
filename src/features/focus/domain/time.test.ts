import { describe, expect, it } from "vitest"
import {
  activeMs,
  activeSeconds,
  clock,
  hhmm,
  instantAtActive,
  localDateOfStart,
  minutesOf,
  needsRecovery,
  pauseSegments,
  plannedEndAt,
  resumeSegments,
  retime,
  trimSegments,
  validateSegments,
  zonedInstant,
} from "./time"
import type { FocusSession, Segment } from "./types"

const T = (s: string) => Date.parse(s)
const seg = (start: string, end: string | null): Segment => ({ start, end })

describe("time from segments, never from a counter", () => {
  it("sums closed segments and counts an open one up to now", () => {
    const segs = [seg("2026-10-21T08:00:00.000Z", "2026-10-21T08:20:00.000Z"), seg("2026-10-21T08:30:00.000Z", null)]
    expect(activeMs(segs, T("2026-10-21T08:40:00.000Z"))).toBe(30 * 60_000)
    // Only closed segments are stored as active_seconds.
    expect(activeSeconds(segs)).toBe(20 * 60)
  })

  it("survives the app being closed: time is the same whenever it is read", () => {
    const segs = [seg("2026-10-21T08:00:00.000Z", null)]
    // A backgrounded tab that rendered nothing for 50 minutes still reads 50 minutes.
    expect(activeMs(segs, T("2026-10-21T08:50:00.000Z"))).toBe(50 * 60_000)
  })

  it("pause closes the open segment, resume opens a new one, both idempotent", () => {
    let segs: Segment[] = [seg("2026-10-21T08:00:00.000Z", null)]
    segs = pauseSegments(segs, T("2026-10-21T08:25:00.000Z"))
    expect(segs).toEqual([seg("2026-10-21T08:00:00.000Z", "2026-10-21T08:25:00.000Z")])
    expect(pauseSegments(segs, T("2026-10-21T08:40:00.000Z"))).toEqual(segs)
    segs = resumeSegments(segs, T("2026-10-21T08:35:00.000Z"))
    expect(segs[1]).toEqual(seg("2026-10-21T08:35:00.000Z", null))
    expect(resumeSegments(segs, T("2026-10-21T08:50:00.000Z"))).toEqual(segs)
  })

  it("a pause/resume time earlier than the segment (clock skew) never creates negative time", () => {
    const paused = pauseSegments([seg("2026-10-21T08:00:00.000Z", null)], T("2026-10-21T07:59:00.000Z"))
    expect(activeMs(paused, 0)).toBe(0)
    const resumed = resumeSegments([seg("2026-10-21T08:00:00.000Z", "2026-10-21T08:10:00.000Z")], T("2026-10-21T08:05:00.000Z"))
    expect(resumed[1].start).toBe("2026-10-21T08:10:00.000Z")
  })

  it("DST end in Europe/Madrid (25 Oct): one real hour is 60 minutes although the wall clock repeats", () => {
    // 02:30 CEST → 02:30 CET: same wall time, one real hour.
    const segs = [seg("2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z")]
    expect(hhmm(segs[0].start, "Europe/Madrid")).toBe(hhmm(segs[0].end!, "Europe/Madrid"))
    expect(activeSeconds(segs)).toBe(3600)
    expect(localDateOfStart(segs[0].start, "Europe/Madrid")).toBe("2026-10-25")
  })

  it("a session crossing midnight counts on the day it started", () => {
    // 23:30 Madrid on the 21st → 00:45 on the 22nd.
    expect(localDateOfStart("2026-10-21T21:30:00.000Z", "Europe/Madrid")).toBe("2026-10-21")
    expect(localDateOfStart("2026-10-21T22:30:00.000Z", "Europe/Madrid")).toBe("2026-10-22")
  })

  it("rounds minutes once over the total", () => {
    expect(minutesOf(29)).toBe(0)
    expect(minutesOf(30)).toBe(1)
    expect(minutesOf(25 * 60 + 29)).toBe(25)
  })
})

describe("trim, planned end and recovery", () => {
  const segs = [seg("2026-10-21T08:00:00.000Z", "2026-10-21T08:30:00.000Z"), seg("2026-10-21T09:00:00.000Z", null)]

  it("«Terminar a las HH:MM» cuts the segment in progress and drops later ones", () => {
    expect(trimSegments(segs, T("2026-10-21T09:20:00.000Z"))).toEqual([
      seg("2026-10-21T08:00:00.000Z", "2026-10-21T08:30:00.000Z"),
      seg("2026-10-21T09:00:00.000Z", "2026-10-21T09:20:00.000Z"),
    ])
    expect(trimSegments(segs, T("2026-10-21T08:10:00.000Z"))).toEqual([seg("2026-10-21T08:00:00.000Z", "2026-10-21T08:10:00.000Z")])
  })

  it("the planned end accounts for pauses", () => {
    const s = { segments: segs, plannedMinutes: 50 }
    expect(plannedEndAt(s, T("2026-10-21T12:00:00.000Z"))).toBe(T("2026-10-21T09:20:00.000Z"))
    expect(plannedEndAt(s, T("2026-10-21T09:05:00.000Z"))).toBeNull()
    expect(instantAtActive(segs, 10 * 60, 0)).toBe(T("2026-10-21T08:10:00.000Z"))
  })

  it("asks «¿Sigue en curso?» only for a running session past plan + 30 min", () => {
    const s = { state: "running", plannedMinutes: 25, segments: [seg("2026-10-21T08:00:00.000Z", null)] } as FocusSession
    expect(needsRecovery(s, T("2026-10-21T08:54:00.000Z"))).toBe(false)
    expect(needsRecovery(s, T("2026-10-21T08:56:00.000Z"))).toBe(true)
    expect(needsRecovery({ ...s, state: "paused" }, T("2026-10-22T08:00:00.000Z"))).toBe(false)
  })
})

describe("validation (plan §3 limits)", () => {
  const now = T("2026-10-21T12:00:00.000Z")
  it("accepts ordered, non-overlapping, past segments", () => {
    expect(validateSegments([seg("2026-10-21T08:00:00.000Z", "2026-10-21T08:30:00.000Z")], now, false)).toBeNull()
    expect(validateSegments([seg("2026-10-21T08:00:00.000Z", null)], now, true)).toBeNull()
  })
  it("rejects end before start, overlaps, the future (60 s tolerance), misplaced open ends and > 12 h", () => {
    expect(validateSegments([], now, false)).toBe("empty")
    expect(validateSegments([seg("2026-10-21T08:30:00.000Z", "2026-10-21T08:00:00.000Z")], now, false)).toBe("order")
    expect(
      validateSegments([seg("2026-10-21T08:00:00.000Z", "2026-10-21T08:30:00.000Z"), seg("2026-10-21T08:20:00.000Z", "2026-10-21T08:40:00.000Z")], now, false)
    ).toBe("overlap")
    expect(validateSegments([seg("2026-10-21T11:00:00.000Z", "2026-10-21T12:00:59.000Z")], now, false)).toBeNull()
    expect(validateSegments([seg("2026-10-21T11:00:00.000Z", "2026-10-21T12:01:01.000Z")], now, false)).toBe("future")
    expect(validateSegments([seg("2026-10-21T08:00:00.000Z", null)], now, false)).toBe("open")
    expect(validateSegments([seg("2026-10-20T08:00:00.000Z", "2026-10-20T20:01:00.000Z")], now, false)).toBe("too_long")
  })
})

describe("retime (edit hours after the fact)", () => {
  it("moves the whole session keeping its pauses, then sets the effective minutes", () => {
    const segs = [seg("2026-10-21T08:00:00.000Z", "2026-10-21T08:30:00.000Z"), seg("2026-10-21T08:40:00.000Z", "2026-10-21T09:00:00.000Z")]
    const moved = retime(segs, T("2026-10-21T10:00:00.000Z"), 50)
    expect(moved).toEqual([seg("2026-10-21T10:00:00.000Z", "2026-10-21T10:30:00.000Z"), seg("2026-10-21T10:40:00.000Z", "2026-10-21T11:00:00.000Z")])
    expect(activeSeconds(retime(segs, T("2026-10-21T08:00:00.000Z"), 20))).toBe(20 * 60)
    expect(retime(segs, T("2026-10-21T08:00:00.000Z"), 20)).toHaveLength(1)
    expect(activeSeconds(retime(segs, T("2026-10-21T08:00:00.000Z"), 70))).toBe(70 * 60)
  })
})

describe("display", () => {
  it("formats tabular clocks", () => {
    expect(clock(0)).toBe("00:00")
    expect(clock(25 * 60_000 - 1)).toBe("24:59")
    expect(clock(3600_000 + 61_000)).toBe("1:01:01")
  })
})

describe("zonedInstant (edit sheet: local date + HH:MM → instant)", () => {
  it("resolves CEST and CET, and the repeated hour of the DST change to its first occurrence", () => {
    expect(new Date(zonedInstant("2026-10-21", "09:00", "Europe/Madrid")).toISOString()).toBe("2026-10-21T07:00:00.000Z")
    expect(new Date(zonedInstant("2026-11-02", "09:00", "Europe/Madrid")).toISOString()).toBe("2026-11-02T08:00:00.000Z")
    expect(new Date(zonedInstant("2026-10-25", "02:30", "Europe/Madrid")).toISOString()).toBe("2026-10-25T00:30:00.000Z")
    expect(new Date(zonedInstant("2026-10-21", "23:30", "America/New_York")).toISOString()).toBe("2026-10-22T03:30:00.000Z")
  })
})
