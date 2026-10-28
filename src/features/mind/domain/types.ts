import type { LocalDate } from "@/features/habits/domain/dates"

/**
 * Mind & Energy check-ins (docs/m3.3-mind-energy-plan.md). One check-in per day and phase
 * (spec: unique (user_id, local_date, checkin_phase)). Each indicator is its own desired state:
 * the latest write of each field wins (decision 3), so two devices editing different
 * indicators never lose anything. The reflection is rich text: a concurrent edit is a conflict
 * the user resolves, never a silent overwrite.
 */
export type CheckinPhase = "am" | "pm"
export type Indicator = "sleep" | "energy" | "mood" | "stress"
export type CheckinField = Indicator | "note"

export const INDICATORS: readonly Indicator[] = ["sleep", "energy", "mood", "stress"]
export const CHECKIN_FIELDS: readonly CheckinField[] = [...INDICATORS, "note"]
export const SCALE_INDICATORS: readonly Exclude<Indicator, "sleep">[] = ["energy", "mood", "stress"]

export interface Checkin {
  date: LocalDate
  phase: CheckinPhase
  /** Hours slept (0–16, quarter hours). */
  sleep: number | null
  /** 1–5. */
  energy: number | null
  mood: number | null
  /** 1–5; higher means MORE stress (never "better"). */
  stress: number | null
  note: string | null
  /** Hybrid instant (ISO) of the last write of each field: per-field last-writer-wins. */
  stamps: Partial<Record<CheckinField, string>>
  /** server_seq of the last reflection change as this device saw it (conflict base). */
  noteSeq?: number | null
  updatedAt: string
}

export type CheckinMap = Record<string, Checkin>

/** Indicators shown per phase (decision 4). Hiding one never deletes its history. */
export interface CheckinConfig {
  am: CheckinField[]
  pm: CheckinField[]
}

export const DEFAULT_CHECKIN_CONFIG: CheckinConfig = {
  am: ["sleep", "energy", "mood"],
  pm: ["energy", "mood", "stress", "note"],
}

export type CheckinValues = Partial<{ sleep: number | null; energy: number | null; mood: number | null; stress: number | null; note: string | null }>

export const SLEEP_MAX = 16
export const SLEEP_STEP = 0.25
export const NOTE_MAX = 1000
/** An evening check-in before this local hour belongs to the day being closed (decision 2). */
export const DAY_ROLLOVER_HOUR = 4
/** Before this hour (and after the rollover) the default phase is the morning one. */
export const EVENING_FROM_HOUR = 14

export function checkinKey(date: LocalDate, phase: CheckinPhase): string {
  return `${date}:${phase}`
}

export const INDICATOR_LABEL: Record<CheckinField, string> = {
  sleep: "Sueño",
  energy: "Energía",
  mood: "Ánimo",
  stress: "Estrés",
  note: "Reflexión",
}

/** Scale words. Stress reads «Muy poco … Mucho» so a high value is never mistaken for a good one. */
export const SCALE_WORDS: Record<Exclude<Indicator, "sleep">, readonly [string, string, string, string, string]> = {
  energy: ["Muy baja", "Baja", "Normal", "Alta", "Muy alta"],
  mood: ["Muy bajo", "Bajo", "Normal", "Bueno", "Muy bueno"],
  stress: ["Muy poco", "Poco", "Moderado", "Bastante", "Mucho"],
}

export const PHASE_LABEL: Record<CheckinPhase, string> = { am: "Mañana", pm: "Noche" }
