import { addDays, isLocalDate, localDateInZone, type LocalDate } from "@/features/habits/domain/dates"
import type { HabitsState } from "@/features/habits/domain/types"
import {
  CHECKIN_FIELDS,
  DAY_ROLLOVER_HOUR,
  DEFAULT_CHECKIN_CONFIG,
  EVENING_FROM_HOUR,
  INDICATORS,
  NOTE_MAX,
  SLEEP_MAX,
  SLEEP_STEP,
  checkinKey,
  type Checkin,
  type CheckinConfig,
  type CheckinField,
  type CheckinPhase,
  type CheckinValues,
} from "./types"

/**
 * Pure check-in transitions over the shared dataset. Like the habit, goal and focus reducers
 * they return the same reference when nothing changes, and they are what the demo applies,
 * what the sync engine replays optimistically over server state and what the fake server uses.
 */

export type CheckinRejection = "future_date" | "invalid_date" | "invalid_value" | "invalid_config"
export type CheckinResult = { ok: true; state: HabitsState } | { ok: false; state: HabitsState; reason: CheckinRejection }

type MindState = Pick<HabitsState, "checkins" | "checkinConfig">

// ── Day and phase (decision 2) ───────────────────────────────────────────
const hourFmt = new Map<string, Intl.DateTimeFormat>()
/** Local hour (0–23) of an instant in an IANA timezone. */
export function localHour(ms: number, timezone: string): number {
  let f = hourFmt.get(timezone)
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" })
    hourFmt.set(timezone, f)
  }
  return Number(f.formatToParts(new Date(ms)).find((p) => p.type === "hour")?.value ?? 0)
}

/** Phase suggested by the clock: late night still closes the previous evening. */
export function defaultPhase(ms: number, timezone: string): CheckinPhase {
  const h = localHour(ms, timezone)
  return h >= DAY_ROLLOVER_HOUR && h < EVENING_FROM_HOUR ? "am" : "pm"
}

/** Day a check-in made now belongs to: an evening one before 04:00 closes the day before. */
export function checkinDate(ms: number, phase: CheckinPhase, timezone: string): LocalDate {
  const today = localDateInZone(new Date(ms), timezone)
  return phase === "pm" && localHour(ms, timezone) < DAY_ROLLOVER_HOUR ? addDays(today, -1) : today
}

// ── Values ───────────────────────────────────────────────────────────────
/** Reflection text: trimmed, capped, empty → null. Line breaks are kept (it is free text). */
export function cleanNote(v: string | null | undefined): string | null {
  const t = (v ?? "").replace(/\r\n?/g, "\n").trim()
  return t ? t.slice(0, NOTE_MAX) : null
}

export function validValue(field: CheckinField, v: unknown): boolean {
  if (v === null) return true
  if (field === "note") return typeof v === "string" && v.length <= NOTE_MAX
  if (typeof v !== "number" || !Number.isFinite(v)) return false
  if (field === "sleep") return v >= 0 && v <= SLEEP_MAX && Number.isInteger(v / SLEEP_STEP)
  return Number.isInteger(v) && v >= 1 && v <= 5
}

export function isEmptyCheckin(c: Pick<Checkin, CheckinField>): boolean {
  return CHECKIN_FIELDS.every((f) => c[f] === null)
}

export function checkinFor(state: Pick<HabitsState, "checkins">, date: LocalDate, phase: CheckinPhase): Checkin | null {
  return state.checkins[checkinKey(date, phase)] ?? null
}

export interface SetCheckinInput {
  date: LocalDate
  phase: CheckinPhase
  /** Only the fields being changed; null clears one. */
  values: CheckinValues
  /** Hybrid instant (ISO) of the intent. */
  at: string
  today: LocalDate
}

/**
 * Set some fields of one check-in. Each field is applied only if this write is at least as
 * recent as the field's last write (per-field last-writer-wins, decision 3). A check-in left
 * without any value disappears (the server keeps a tombstone).
 */
export function setCheckin(state: HabitsState, input: SetCheckinInput): CheckinResult {
  const { date, phase, at } = input
  if (!isLocalDate(date) || (phase !== "am" && phase !== "pm")) return { ok: false, state, reason: "invalid_date" }
  if (date > input.today) return { ok: false, state, reason: "future_date" }
  const values: CheckinValues = { ...input.values }
  if ("note" in values) values.note = cleanNote(values.note)
  for (const [f, v] of Object.entries(values)) {
    if (!CHECKIN_FIELDS.includes(f as CheckinField) || !validValue(f as CheckinField, v)) return { ok: false, state, reason: "invalid_value" }
  }

  const key = checkinKey(date, phase)
  const prev = state.checkins[key]
  const next: Checkin = prev
    ? { ...prev, stamps: { ...prev.stamps } }
    : { date, phase, sleep: null, energy: null, mood: null, stress: null, note: null, stamps: {}, updatedAt: at }
  const t = Date.parse(at)
  let changed = false
  for (const [f, v] of Object.entries(values) as [CheckinField, number | string | null][]) {
    const stamp = next.stamps[f]
    if (stamp && Date.parse(stamp) > t) continue
    if (next[f] !== v) changed = true
    ;(next as unknown as Record<CheckinField, number | string | null>)[f] = v
    next.stamps[f] = at
  }
  if (!changed) return { ok: true, state }
  next.updatedAt = at
  const checkins = { ...state.checkins }
  if (isEmptyCheckin(next)) delete checkins[key]
  else checkins[key] = next
  return { ok: true, state: { ...state, checkins } }
}

/** Clear a whole check-in (every field, with the same per-field rule). */
export function clearCheckin(state: HabitsState, date: LocalDate, phase: CheckinPhase, at: string, today: LocalDate): CheckinResult {
  return setCheckin(state, { date, phase, at, today, values: { sleep: null, energy: null, mood: null, stress: null, note: null } })
}

// ── Configuration (decision 4) ───────────────────────────────────────────
/** Canonical order, known fields only, no duplicates. */
function canonical(fields: readonly unknown[]): CheckinField[] {
  return CHECKIN_FIELDS.filter((f) => fields.includes(f))
}

export function validateConfig(c: unknown): c is CheckinConfig {
  if (typeof c !== "object" || c === null) return false
  const { am, pm } = c as Record<string, unknown>
  const okPhase = (v: unknown) =>
    Array.isArray(v) && v.length <= CHECKIN_FIELDS.length && v.every((f) => CHECKIN_FIELDS.includes(f)) && v.some((f) => INDICATORS.includes(f))
  return okPhase(am) && okPhase(pm)
}

/** Anything malformed falls back to the defaults (never trusted, never thrown). */
export function normalizeConfig(raw: unknown): CheckinConfig {
  if (!validateConfig(raw)) return DEFAULT_CHECKIN_CONFIG
  return { am: canonical(raw.am), pm: canonical(raw.pm) }
}

export function setCheckinConfig(state: HabitsState, config: CheckinConfig): CheckinResult {
  if (!validateConfig(config)) return { ok: false, state, reason: "invalid_config" }
  const next = normalizeConfig(config)
  const cur = state.checkinConfig
  if (cur.am.join() === next.am.join() && cur.pm.join() === next.pm.join()) return { ok: true, state }
  return { ok: true, state: { ...state, checkinConfig: next } }
}

/**
 * Fields the sheet shows: the configured ones, plus any hidden field that already has a value
 * in this check-in, so hiding an indicator never hides (or loses) what was recorded.
 */
export function visibleFields(state: MindState, phase: CheckinPhase, c: Checkin | null): CheckinField[] {
  const configured = state.checkinConfig[phase]
  return CHECKIN_FIELDS.filter((f) => configured.includes(f) || (c !== null && c[f] !== null))
}

/** Same phase, previous day: the discreet «ayer» marker (never pre-filled). */
export function previousValue(state: Pick<HabitsState, "checkins">, date: LocalDate, phase: CheckinPhase, field: Exclude<CheckinField, "note">): number | null {
  return checkinFor(state, addDays(date, -1), phase)?.[field] ?? null
}
