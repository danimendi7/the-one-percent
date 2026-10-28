/**
 * DEMO check-ins (labelled «Demo» wherever they appear; never imported into an account).
 * Deterministic, about six weeks with realistic gaps, so the three data states and the
 * exploratory comparisons can be explored without an account.
 */
import { addDays, diffDays, isoWeekday, type LocalDate } from "@/features/habits/domain/dates"
import type { HabitsState } from "@/features/habits/domain/types"
import { checkinKey, DEFAULT_CHECKIN_CONFIG, type Checkin, type CheckinMap, type CheckinPhase } from "./domain/types"

const DAYS = 45

const NOTES_PM = [
  "Buen bloque de trabajo por la mañana; la tarde se dispersó.",
  "Entrené y se notó en la energía.",
  "Demasiadas reuniones. Mañana protejo la primera hora.",
  "Día tranquilo, leí antes de dormir.",
]
const NOTES_AM = ["Prioridad: cerrar el informe.", "Dormí mal; hoy sin cafeína después de las 14:00."]

/** Small deterministic generator (mulberry32) so the demo is the same on every device. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (v: number) => Math.min(5, Math.max(1, Math.round(v)))

function mk(date: LocalDate, phase: CheckinPhase, v: Partial<Pick<Checkin, "sleep" | "energy" | "mood" | "stress" | "note">>): Checkin {
  const at = `${date}T${phase === "am" ? "07:30" : "21:30"}:00.000Z`
  const c: Checkin = { date, phase, sleep: null, energy: null, mood: null, stress: null, note: null, stamps: {}, updatedAt: at, ...v }
  for (const f of ["sleep", "energy", "mood", "stress", "note"] as const) if (c[f] !== null) c.stamps[f] = at
  return c
}

export function createDemoCheckins(today: LocalDate): CheckinMap {
  const out: CheckinMap = {}
  for (let i = DAYS; i >= 0; i--) {
    const date = addDays(today, -i)
    const r = rng(diffDays("2020-01-01", date) * 7919)
    const weekday = isoWeekday(date)
    const workday = weekday <= 5
    const sleep = Math.round((6 + r() * 2.5 + (workday ? 0 : 0.5)) * 4) / 4
    const energy = clamp(2 + (sleep - 5.5) * 0.9 + (r() - 0.5) * 1.6)
    // Gaps: some mornings and more evenings are skipped, as in real use.
    if (i === 0 || r() > 0.14) {
      out[checkinKey(date, "am")] = mk(date, "am", {
        sleep,
        energy,
        mood: clamp(energy + (r() - 0.5) * 2),
        note: r() > 0.9 ? NOTES_AM[Math.floor(r() * NOTES_AM.length)] : null,
      })
    }
    if (i > 0 && r() > 0.25) {
      out[checkinKey(date, "pm")] = mk(date, "pm", {
        energy: clamp(energy - 0.6 + (r() - 0.5) * 1.6),
        mood: clamp(energy + (r() - 0.4) * 2),
        stress: clamp((workday ? 2.8 : 1.8) + (r() - 0.5) * 2),
        note: r() > 0.7 ? NOTES_PM[Math.floor(r() * NOTES_PM.length)] : null,
      })
    }
  }
  return out
}

/** Add demo check-ins (and the default indicators) to a demo dataset. */
export function withDemoCheckins(state: Omit<HabitsState, "checkins" | "checkinConfig"> & Partial<Pick<HabitsState, "checkins" | "checkinConfig">>, today: LocalDate): HabitsState {
  return { ...state, checkins: createDemoCheckins(today), checkinConfig: state.checkinConfig ?? DEFAULT_CHECKIN_CONFIG }
}
