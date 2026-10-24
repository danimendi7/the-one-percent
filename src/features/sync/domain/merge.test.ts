import { describe, expect, it } from "vitest"
import { entryKey } from "@/features/habits/domain/types"
import { emptyCache, mergePull } from "./merge"
import type { PullPayload, WireEntry, WireHabit } from "./types"

const H = "11111111-1111-4111-8111-111111111111"

const habit = (seq: number, title = "Leer", version = 1): WireHabit => ({
  id: H, title, icon: "book-open", dimension: "learn", habit_type: "numeric", unit: "min",
  target_value: 20, target_direction: "at_least", start_date: "2026-10-01", archived_on: null,
  version, created_at: "2026-10-01T08:00:00Z", server_seq: seq,
  versions: [{ valid_from: "2026-10-01", kind: "weekdays", weekdays: [1, 3], target_count: null }],
})

const entry = (seq: number, date: string, value: number | null, deleted = false): WireEntry => ({
  habit_id: H, local_date: date, value_bool: null, value_numeric: value, deleted,
  client_op_id: `op-${seq}`, client_updated_at: "2026-10-20T10:00:00Z", server_seq: seq,
})

const payload = (p: Partial<PullPayload>): PullPayload => ({
  server_today: "2026-10-21", full: false, profile: null, dimensions: [], habits: [], entries: [], rest_days: [], cursor: 0, ...p,
})

describe("mergePull", () => {
  it("maps wire rows to domain objects (numeric values, weekday schedules)", () => {
    const c = mergePull(emptyCache("2026-10-21"), payload({ full: true, habits: [habit(1)], entries: [entry(2, "2026-10-19", 25)], cursor: 2 }))
    expect(c.state.habits[0]).toMatchObject({ name: "Leer", type: "numeric", target: 20, schedule: [{ validFrom: "2026-10-01", rule: { kind: "weekdays", weekdays: [1, 3] } }] })
    expect(c.state.entries[entryKey(H, "2026-10-19")].value).toBe(25)
    expect(c.habitVersion[H]).toBe(1)
    expect(c.cursor).toBe(2)
  })

  it("re-reading overlapping rows is idempotent and older rows never overwrite newer ones", () => {
    let c = mergePull(emptyCache("2026-10-21"), payload({ full: true, habits: [habit(5, "Lectura", 2)], entries: [entry(6, "2026-10-19", 30)], cursor: 6 }))
    // Overlapping pull returns a stale copy (lower seq) and the same newest row again
    c = mergePull(c, payload({ habits: [habit(1, "Leer", 1)], entries: [entry(6, "2026-10-19", 30), entry(3, "2026-10-19", 10)], cursor: 6 }))
    expect(c.state.habits[0].name).toBe("Lectura")
    expect(c.habitVersion[H]).toBe(2)
    expect(c.state.entries[entryKey(H, "2026-10-19")].value).toBe(30)
  })

  it("tombstones remove values on incremental pulls; a full pull rebuilds from scratch", () => {
    let c = mergePull(emptyCache("2026-10-21"), payload({ full: true, habits: [habit(1)], entries: [entry(2, "2026-10-19", 25)], cursor: 2 }))
    c = mergePull(c, payload({ entries: [entry(7, "2026-10-19", null, true)], cursor: 7 }))
    expect(c.state.entries[entryKey(H, "2026-10-19")]).toBeUndefined()
    const rebuilt = mergePull(c, payload({ full: true, habits: [], entries: [], cursor: 7 }))
    expect(rebuilt.state.habits).toEqual([])
  })
})
