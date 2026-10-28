import type { LocalDate } from "./dates"
import { DEFAULT_CHECKIN_CONFIG } from "@/features/mind/domain/types"
import type { EvalContext } from "./metrics"
import { entryKey, type EntryMap, type Habit, type HabitsState, type ScheduleRule } from "./types"

export function makeHabit(partial: Partial<Habit> & { rule?: ScheduleRule } = {}): Habit {
  const startDate = partial.startDate ?? "2026-10-01"
  const { rule, ...rest } = partial
  return {
    id: "h1",
    name: "Hábito",
    icon: "check",
    dimensionId: "body",
    type: "binary",
    schedule: [{ validFrom: startDate, rule: rule ?? { kind: "daily" } }],
    startDate,
    archivedOn: null,
    createdAt: "2026-10-01T08:00:00.000Z",
    ...rest,
  }
}

export function entries(habitId: string, values: Record<LocalDate, boolean | number>): EntryMap {
  const out: EntryMap = {}
  for (const [date, value] of Object.entries(values)) {
    out[entryKey(habitId, date)] = { habitId, date, value, opId: `op-${date}`, updatedAt: "" }
  }
  return out
}

export function ctx(today: LocalDate, map: EntryMap = {}, rest: LocalDate[] = []): EvalContext {
  return { today, entries: map, restDays: new Set(rest) }
}

export function makeState(habits: Habit[], map: EntryMap = {}, rest: LocalDate[] = []): HabitsState {
  return {
    version: 1,
    timezone: "Europe/Madrid",
    dimensions: [],
    habits,
    entries: map,
    restDays: rest,
    seededOn: "2026-10-01",
    goals: [],
    measurements: {},
    focusSessions: [],
    checkins: {},
    checkinConfig: DEFAULT_CHECKIN_CONFIG,
  }
}
