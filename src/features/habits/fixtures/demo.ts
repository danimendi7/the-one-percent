/**
 * DEMO fixtures. Deterministic, fictional history generated relative to the
 * first day the prototype is opened. Clearly labelled as demo in the UI.
 */
import { addDays, eachDay, isoWeekday, startOfWeek, type LocalDate } from "../domain/dates"
import { isEligibleDay } from "../domain/schedule"
import { createDemoGoals } from "@/features/goals/fixtures"
import { withDemoFocus } from "@/features/focus/fixtures"
import { withDemoCheckins } from "@/features/mind/fixtures"
import { withDemoReviews } from "@/features/reviews/fixtures"
import { createDemoRecall } from "@/features/recall/fixtures"
import { DEFAULT_CHECKIN_CONFIG } from "@/features/mind/domain/types"
import {
  entryKey,
  type Dimension,
  type EntryMap,
  type Habit,
  type HabitsState,
} from "../domain/types"

export const DEMO_DIMENSIONS: Dimension[] = [
  { id: "body", name: "Cuerpo" },
  { id: "mind", name: "Mente" },
  { id: "learn", name: "Aprendizaje" },
  { id: "work", name: "Trabajo profundo" },
]

const HISTORY_DAYS = 120

/** Small deterministic PRNG (mulberry32) seeded from a string. */
function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Profile {
  /** Base probability of success on a given day */
  p: number
  weekendPenalty?: number
  /** Gentle improvement over time (0 = flat) */
  trend?: number
  value?: (r: () => number, success: boolean) => number
}

function demoHabits(start: LocalDate, today: LocalDate): { habit: Habit; profile: Profile }[] {
  const at = "2026-01-01T08:00:00.000Z"
  const base = { startDate: start, archivedOn: null, createdAt: at }
  const changeOn = startOfWeek(addDays(today, -35))
  return [
    {
      habit: {
        ...base,
        id: "demo-training",
        name: "Entrenamiento de fuerza",
        icon: "dumbbell",
        dimensionId: "body",
        type: "binary",
        // Versioned schedule: Tue/Thu until five weeks ago, then Mon/Wed/Fri.
        schedule: [
          { validFrom: start, rule: { kind: "weekdays", weekdays: [2, 4] } },
          { validFrom: changeOn, rule: { kind: "weekdays", weekdays: [1, 3, 5] } },
        ],
      },
      profile: { p: 0.82, trend: 0.06 },
    },
    {
      habit: {
        ...base,
        id: "demo-steps",
        name: "Pasos",
        icon: "footprints",
        dimensionId: "body",
        type: "numeric",
        unit: "pasos",
        target: 8000,
        direction: "at_least",
        schedule: [{ validFrom: start, rule: { kind: "daily" } }],
      },
      profile: {
        p: 0.74,
        weekendPenalty: 0.1,
        value: (r, ok) => Math.round((ok ? 8000 + r() * 5200 : 3800 + r() * 4100) / 10) * 10,
      },
    },
    {
      habit: {
        ...base,
        id: "demo-meditation",
        name: "Meditación",
        icon: "wind",
        dimensionId: "mind",
        type: "duration",
        unit: "min",
        target: 10,
        direction: "at_least",
        schedule: [{ validFrom: start, rule: { kind: "daily" } }],
      },
      profile: {
        p: 0.78,
        trend: 0.08,
        value: (r, ok) => (ok ? 10 + Math.round(r() * 3) * 5 : Math.round(r() * 2) * 3),
      },
    },
    {
      habit: {
        ...base,
        id: "demo-reading",
        name: "Lectura",
        icon: "book-open",
        dimensionId: "learn",
        type: "duration",
        unit: "min",
        target: 20,
        direction: "at_least",
        schedule: [{ validFrom: start, rule: { kind: "daily" } }],
      },
      profile: {
        p: 0.71,
        value: (r, ok) => (ok ? 20 + Math.round(r() * 5) * 5 : 5 + Math.round(r() * 2) * 5),
      },
    },
    {
      habit: {
        ...base,
        id: "demo-deepwork",
        name: "Bloque de trabajo profundo",
        icon: "target",
        dimensionId: "work",
        type: "binary",
        schedule: [{ validFrom: start, rule: { kind: "weekdays", weekdays: [1, 2, 3, 4, 5] } }],
      },
      profile: { p: 0.8 },
    },
    {
      habit: {
        ...base,
        id: "demo-screens",
        name: "Sin pantallas después de las 23:00",
        icon: "moon",
        dimensionId: "mind",
        type: "binary",
        schedule: [{ validFrom: start, rule: { kind: "daily" } }],
      },
      profile: { p: 0.62, weekendPenalty: 0.2, trend: 0.1 },
    },
    {
      habit: {
        ...base,
        id: "demo-coffee",
        name: "Café",
        icon: "coffee",
        dimensionId: "body",
        type: "numeric",
        unit: "tazas",
        target: 2,
        direction: "at_most",
        schedule: [{ validFrom: start, rule: { kind: "daily" } }],
      },
      profile: { p: 0.8, value: (r, ok) => (ok ? (r() < 0.3 ? 1 : 2) : 3 + Math.round(r())) },
    },
    {
      habit: {
        ...base,
        id: "demo-mobility",
        name: "Movilidad",
        icon: "activity",
        dimensionId: "body",
        type: "binary",
        schedule: [{ validFrom: start, rule: { kind: "weekly_count", timesPerWeek: 3 } }],
      },
      profile: { p: 0.45 },
    },
  ]
}

export function createDemoState(today: LocalDate, timezone = "Europe/Madrid"): HabitsState {
  const start = addDays(today, -HISTORY_DAYS)
  // A planned long weekend three weeks ago, labelled as rest.
  const restAnchor = startOfWeek(addDays(today, -21))
  const restDays = [addDays(restAnchor, 4), addDays(restAnchor, 5)]
  const entries: EntryMap = {}

  // Today's entries are left mostly empty so the checklist is interactive.
  const history = eachDay(start, addDays(today, -1))

  for (const { habit, profile } of demoHabits(start, today)) {
    const r = rng(habit.id)
    for (const date of history) {
      if (!isEligibleDay(habit, date) || restDays.includes(date)) continue
      const progress = history.length > 1 ? history.indexOf(date) / history.length : 1
      const wd = isoWeekday(date)
      let p = profile.p + (profile.trend ?? 0) * (progress - 0.5)
      if (wd >= 6) p -= profile.weekendPenalty ?? 0
      const success = r() < p
      if (habit.type === "binary") {
        if (success) entries[entryKey(habit.id, date)] = mk(habit.id, date, true)
      } else {
        // Numeric habits record a value most days, even when the target is missed.
        if (!success && r() < 0.35) continue
        entries[entryKey(habit.id, date)] = mk(habit.id, date, profile.value!(r, success))
      }
    }
  }

  // A couple of early wins today so the screen shows partial progress.
  entries[entryKey("demo-meditation", today)] = mk("demo-meditation", today, 15)
  entries[entryKey("demo-coffee", today)] = mk("demo-coffee", today, 1)

  return withDemoReviews(withDemoCheckins(
    withDemoFocus(
    {
      version: 1,
      timezone,
      dimensions: DEMO_DIMENSIONS,
      habits: demoHabits(start, today).map((d) => d.habit),
      entries,
      restDays,
      seededOn: today,
      ...createDemoGoals(today),
      focusSessions: [],
      checkins: {},
      checkinConfig: DEFAULT_CHECKIN_CONFIG,
      reviews: {},
      recall: createDemoRecall(today),
      discovery: { topics: {}, feedback: {} },
      experiments: {},
    },
    today
    ),
    today
  ), today)
}

function mk(habitId: string, date: LocalDate, value: boolean | number) {
  return { habitId, date, value, opId: `demo:${habitId}:${date}`, updatedAt: `${date}T20:00:00.000Z` }
}
