/**
 * DEMO focus sessions. Fictional, generated relative to the day the demo is created and
 * labelled as demo in the UI. Nothing here is ever shown in account mode.
 * Three weeks of sessions over several projects (some unrated, some with pauses), a
 * «Deep Work 90 min» habit fed by them, and a project with only two sessions so the
 * «Pocos datos» state can be seen by filtering it.
 */
import { addDays, isoWeekday, type LocalDate } from "@/features/habits/domain/dates"
import type { Habit, HabitsState } from "@/features/habits/domain/types"
import { rederive } from "./domain/ops"
import type { FocusSession, Segment } from "./domain/types"

export const DEMO_FOCUS_HABIT = "demo-focus"
const DAYS = 21

/** Deterministic PRNG (mulberry32): the same demo on every device. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A local wall time in Madrid as an ISO instant (CET/CEST resolved by trying both offsets). */
function madrid(date: LocalDate, hour: number, minute: number): number {
  for (const off of ["+01:00", "+02:00"]) {
    const t = Date.parse(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${off}`)
    const shown = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t)
    if (shown === `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`) return t
  }
  return Date.parse(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+01:00`)
}

export function demoFocusHabit(today: LocalDate): Habit {
  const start = addDays(today, -DAYS)
  return {
    id: DEMO_FOCUS_HABIT,
    name: "Deep Work 90 min",
    icon: "target",
    dimensionId: "work",
    type: "duration",
    unit: "min",
    target: 90,
    direction: "at_least",
    schedule: [{ validFrom: start, rule: { kind: "weekdays", weekdays: [1, 2, 3, 4, 5] } }],
    startDate: start,
    archivedOn: null,
    createdAt: `${start}T08:00:00.000Z`,
    activitySource: "focus",
    activitySourceFrom: start,
  }
}

export function createDemoSessions(today: LocalDate): FocusSession[] {
  const r = rng(20261028)
  const iso = (t: number) => new Date(t).toISOString()
  const out: FocusSession[] = []
  for (let i = DAYS; i >= 1; i--) {
    const date = addDays(today, -i)
    const wd = isoWeekday(date)
    const blocks = wd >= 6 ? (r() < 0.3 ? 1 : 0) : r() < 0.08 ? 0 : r() < 0.4 ? 1 : 2
    for (let b = 0; b < blocks; b++) {
      const planned = [50, 90, 25, 50][Math.floor(r() * 4)]
      const startT = madrid(date, b === 0 ? 9 : 16, Math.floor(r() * 4) * 15)
      // Most blocks reach the plan; some stop early or run a little over.
      const effective = Math.max(12, Math.round(planned * (r() < 0.7 ? 1 + r() * 0.15 : 0.55 + r() * 0.35)))
      const segments: Segment[] = []
      if (effective > 40 && r() < 0.35) {
        const first = Math.round(effective * 0.55)
        const pause = 5 + Math.floor(r() * 10)
        segments.push({ start: iso(startT), end: iso(startT + first * 60_000) })
        const s2 = startT + (first + pause) * 60_000
        segments.push({ start: iso(s2), end: iso(s2 + (effective - first) * 60_000) })
      } else {
        segments.push({ start: iso(startT), end: iso(startT + effective * 60_000) })
      }
      const pick = r()
      const project = pick < 0.1 ? null : pick < 0.58 ? "Tesis" : "Producto"
      out.push({
        id: `demo-focus-${date}-${b}`,
        habitId: project === "Tesis" || project === "Producto" ? DEMO_FOCUS_HABIT : null,
        project,
        plannedOutput: project === "Tesis" ? "Avanzar el capítulo en curso" : project === "Producto" ? "Cerrar una tarea del sprint" : null,
        actualOutput: r() < 0.6 ? (effective >= planned ? "Objetivo del bloque cumplido" : "Avance parcial") : null,
        plannedMinutes: planned,
        segments,
        state: "finished",
        localDate: date,
        // Some sessions are deliberately unrated.
        rating: r() < 0.8 ? 2 + Math.floor(r() * 4) : null,
        version: 1,
        createdAt: segments[0].start,
        updatedAt: segments[segments.length - 1].end!,
      })
    }
  }
  // Few data: a project with only two recent sessions.
  for (const [n, d] of [[0, -3], [1, -1]] as const) {
    const date = addDays(today, d)
    const t = madrid(date, 19, 0)
    out.push({
      id: `demo-focus-writing-${n}`,
      habitId: null,
      project: "Escritura",
      plannedOutput: "Ensayo corto",
      actualOutput: null,
      plannedMinutes: 25,
      segments: [{ start: iso(t), end: iso(t + 25 * 60_000) }],
      state: "finished",
      localDate: date,
      rating: null,
      version: 1,
      createdAt: iso(t),
      updatedAt: iso(t + 25 * 60_000),
    })
  }
  return out
}

/** Add the demo focus habit and sessions, deriving the habit's days from the sessions. */
export function withDemoFocus(state: HabitsState, today: LocalDate): HabitsState {
  const habit = demoFocusHabit(today)
  let out: HabitsState = {
    ...state,
    habits: state.habits.some((h) => h.id === habit.id) ? state.habits : [...state.habits, habit],
    focusSessions: createDemoSessions(today),
  }
  const days = new Set(out.focusSessions.map((s) => s.localDate))
  for (const d of days) out = rederive(out, DEMO_FOCUS_HABIT, d, `${d}T20:00:00.000Z`)
  return out
}
