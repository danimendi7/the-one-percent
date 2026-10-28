import type { LocalDate, Weekday } from "@/features/habits/domain/dates"
import { entryKey, type Habit, type HabitEntry, type HabitsState, type ScheduleRule } from "@/features/habits/domain/types"
import { measurementKey } from "@/features/goals/domain/types"
import { toGoal, toMeasurement } from "./goal-wire"
import type { PullPayload, ServerCache, WireEntry, WireHabit, WireVersion } from "./types"

const DEFAULT_DIMENSIONS: HabitsState["dimensions"] = [
  { id: "body", name: "Cuerpo" },
  { id: "mind", name: "Mente" },
  { id: "learn", name: "Aprendizaje" },
  { id: "work", name: "Trabajo profundo" },
]

export function emptyCache(today: LocalDate, timezone = "Europe/Madrid"): ServerCache {
  return {
    state: { version: 1, timezone, dimensions: DEFAULT_DIMENSIONS, habits: [], entries: {}, restDays: [], seededOn: today, goals: [], measurements: {}, focusSessions: [] },
    habitVersion: {},
    rowSeq: {},
    cursor: 0,
    serverToday: today,
  }
}

function toRule(v: WireVersion): ScheduleRule {
  switch (v.kind) {
    case "daily":
      return { kind: "daily" }
    case "weekdays":
      return { kind: "weekdays", weekdays: (v.weekdays ?? []).map((d) => d as Weekday) }
    case "weekly_count":
      return { kind: "weekly_count", timesPerWeek: v.target_count ?? 1 }
  }
}

export function toHabit(w: WireHabit): Habit {
  return {
    id: w.id,
    name: w.title,
    icon: w.icon,
    dimensionId: w.dimension,
    type: w.habit_type,
    ...(w.habit_type !== "binary"
      ? {
          unit: w.unit ?? undefined,
          target: w.target_value === null ? undefined : Number(w.target_value),
          direction: w.target_direction ?? "at_least",
        }
      : {}),
    schedule: w.versions.map((v) => ({ validFrom: v.valid_from, rule: toRule(v) })),
    startDate: w.start_date,
    archivedOn: w.archived_on,
    createdAt: w.created_at,
  }
}

export function toEntry(w: WireEntry): HabitEntry {
  return {
    habitId: w.habit_id,
    date: w.local_date,
    value: w.value_bool !== null ? w.value_bool : Number(w.value_numeric),
    opId: w.client_op_id,
    updatedAt: w.client_updated_at,
  }
}

const seqKey = {
  habit: (id: string) => `h:${id}`,
  entry: (habitId: string, date: string) => `e:${habitId}:${date}`,
  rest: (date: string) => `r:${date}`,
  goal: (id: string) => `g:${id}`,
  measurement: (goalId: string, date: string) => `m:${goalId}:${date}`,
}

/**
 * Merge a pull into the cache. A full pull replaces everything. An incremental
 * pull (which may overlap the previous cursor) applies a row only if it is newer
 * than what the cache holds, so re-reading rows is harmless (idempotent merge).
 */
export function mergePull(cache: ServerCache, p: PullPayload): ServerCache {
  const base = p.full ? emptyCache(p.server_today, p.profile?.timezone) : cache
  const rowSeq = { ...base.rowSeq }
  const habitVersion = { ...base.habitVersion }
  const habits = new Map(base.state.habits.map((h) => [h.id, h]))
  const entries = { ...base.state.entries }
  const rest = new Set(base.state.restDays)
  const goals = new Map(base.state.goals.map((g) => [g.id, g]))
  const measurements = { ...base.state.measurements }

  const newer = (key: string, seq: number) => !(key in rowSeq) || seq > rowSeq[key]

  for (const w of p.habits) {
    const k = seqKey.habit(w.id)
    if (!newer(k, w.server_seq)) continue
    rowSeq[k] = w.server_seq
    habitVersion[w.id] = w.version
    habits.set(w.id, toHabit(w))
  }
  for (const w of p.entries) {
    const k = seqKey.entry(w.habit_id, w.local_date)
    if (!newer(k, w.server_seq)) continue
    rowSeq[k] = w.server_seq
    const ek = entryKey(w.habit_id, w.local_date)
    if (w.deleted) delete entries[ek]
    else entries[ek] = toEntry(w)
  }
  for (const w of p.rest_days) {
    const k = seqKey.rest(w.local_date)
    if (!newer(k, w.server_seq)) continue
    rowSeq[k] = w.server_seq
    if (w.rest) rest.add(w.local_date)
    else rest.delete(w.local_date)
  }
  // A goal arrives whole (links + milestones), so it simply replaces the cached one.
  for (const w of p.goals ?? []) {
    const k = seqKey.goal(w.id)
    if (!newer(k, w.server_seq)) continue
    rowSeq[k] = w.server_seq
    goals.set(w.id, toGoal(w))
  }
  for (const w of p.measurements ?? []) {
    const k = seqKey.measurement(w.goal_id, w.observed_on)
    if (!newer(k, w.server_seq)) continue
    rowSeq[k] = w.server_seq
    const mk = measurementKey(w.goal_id, w.observed_on)
    if (w.deleted) delete measurements[mk]
    else measurements[mk] = toMeasurement(w)
  }

  return {
    state: {
      ...base.state,
      timezone: p.profile?.timezone ?? base.state.timezone,
      dimensions: p.dimensions.length
        ? p.dimensions.map((d) => ({ id: d.slug, name: d.name }))
        : base.state.dimensions,
      habits: [...habits.values()],
      entries,
      restDays: [...rest].sort(),
      seededOn: base.state.seededOn,
      goals: [...goals.values()],
      measurements,
    },
    habitVersion,
    rowSeq,
    cursor: Math.max(p.full ? 0 : cache.cursor, p.cursor),
    serverToday: p.server_today,
    features: { goals: p.goals !== undefined },
  }
}
