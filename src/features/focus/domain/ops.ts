import type { LocalDate } from "@/features/habits/domain/dates"
import { isFocusFed } from "@/features/habits/domain/ops"
import { isEligibleDay } from "@/features/habits/domain/schedule"
import { entryKey, type HabitsState } from "@/features/habits/domain/types"
import {
  activeSeconds,
  localDateOfStart,
  minutesOf,
  pauseSegments,
  resumeSegments,
  trimSegments,
  validateSegments,
  type SegmentsError,
} from "./time"
import {
  ACTUAL_OUTPUT_MAX,
  MAX_ACTIVE_SECONDS,
  MAX_PLANNED_MINUTES,
  MIN_ACTIVE_SECONDS,
  PLANNED_OUTPUT_MAX,
  PROJECT_MAX,
  type FocusSession,
  type Segment,
} from "./types"

/**
 * Pure focus transitions over the shared dataset. Like the habit and goal reducers they
 * return the same reference when nothing changes, and they are what the demo applies,
 * what the sync engine replays optimistically over server state, and what the fake
 * server uses. Every change to a finished session re-derives the day of the habit it
 * feeds, so a fed habit is never logged twice (decision 1).
 */

export type FocusRejection =
  | "session_active"
  | "session_not_found"
  | "not_active"
  | "not_finished"
  | "invalid_minutes"
  | "invalid_habit"
  | "too_short"
  | "invalid_rating"
  | `segments_${SegmentsError}`

export type FocusResult = { ok: true; state: HabitsState } | { ok: false; state: HabitsState; reason: FocusRejection }

const ok = (state: HabitsState): FocusResult => ({ ok: true, state })
const no = (state: HabitsState, reason: FocusRejection): FocusResult => ({ ok: false, state, reason })

export function activeSession(state: Pick<HabitsState, "focusSessions">): FocusSession | null {
  return state.focusSessions.find((s) => s.state !== "finished") ?? null
}

export function sessionById(state: Pick<HabitsState, "focusSessions">, id: string): FocusSession | null {
  return state.focusSessions.find((s) => s.id === id) ?? null
}

/** Trim, collapse empty text to null and cap the length (the server enforces the same caps). */
export function cleanText(v: string | null | undefined, max: number): string | null {
  const t = v?.trim().replace(/\s+/g, " ") ?? ""
  return t ? t.slice(0, max) : null
}

function habitError(state: HabitsState, habitId: string | null): FocusRejection | null {
  if (habitId === null) return null
  const h = state.habits.find((x) => x.id === habitId)
  return h && h.type === "duration" ? null : "invalid_habit"
}

/** Minutes the finished sessions linked to a habit add to one day (rounded once over the total). */
export function focusSecondsOn(state: Pick<HabitsState, "focusSessions">, habitId: string, date: LocalDate): number {
  let total = 0
  for (const s of state.focusSessions) if (s.state === "finished" && s.habitId === habitId && s.localDate === date) total += activeSeconds(s.segments)
  return total
}

/**
 * Re-derive one habit/day from its sessions. Only days from `activitySourceFrom` on are
 * touched, so entries logged before the habit was linked stay as history. A day that is not
 * scheduled or is a rest day keeps no derived value (the minutes still count in Analytics).
 */
export function rederive(state: HabitsState, habitId: string | null, date: LocalDate, now: string): HabitsState {
  if (!habitId) return state
  const habit = state.habits.find((h) => h.id === habitId)
  if (!habit || !isFocusFed(habit, date)) return state
  const minutes = minutesOf(focusSecondsOn(state, habitId, date))
  const key = entryKey(habitId, date)
  const current = state.entries[key]
  const keep = minutes > 0 && isEligibleDay(habit, date) && !state.restDays.includes(date)
  if (!keep) {
    if (!current) return state
    const entries = { ...state.entries }
    delete entries[key]
    return { ...state, entries }
  }
  if (current?.value === minutes) return state
  return { ...state, entries: { ...state.entries, [key]: { habitId, date, value: minutes, opId: `focus:${habitId}:${date}`, updatedAt: now } } }
}

function replace(state: HabitsState, next: FocusSession): HabitsState {
  return { ...state, focusSessions: state.focusSessions.map((s) => (s.id === next.id ? next : s)) }
}

export interface StartInput {
  id: string
  habitId: string | null
  project: string | null
  plannedOutput: string | null
  plannedMinutes: number
  /** ISO, server-corrected clock. */
  at: string
}

/** Only one active session per user, shared between devices (decision 5). */
export function startSession(state: HabitsState, input: StartInput): FocusResult {
  if (state.focusSessions.some((s) => s.id === input.id)) return ok(state)
  if (activeSession(state)) return no(state, "session_active")
  if (!Number.isInteger(input.plannedMinutes) || input.plannedMinutes < 1 || input.plannedMinutes > MAX_PLANNED_MINUTES) return no(state, "invalid_minutes")
  const habitErr = habitError(state, input.habitId)
  if (habitErr) return no(state, habitErr)
  const session: FocusSession = {
    id: input.id,
    habitId: input.habitId,
    project: cleanText(input.project, PROJECT_MAX),
    plannedOutput: cleanText(input.plannedOutput, PLANNED_OUTPUT_MAX),
    actualOutput: null,
    plannedMinutes: input.plannedMinutes,
    segments: [{ start: input.at, end: null }],
    state: "running",
    localDate: localDateOfStart(input.at, state.timezone),
    rating: null,
    version: 1,
    createdAt: input.at,
    updatedAt: input.at,
  }
  return ok({ ...state, focusSessions: [...state.focusSessions, session] })
}

/** Idempotent: pausing a paused session changes nothing. */
export function pauseSession(state: HabitsState, id: string, at: string): FocusResult {
  const s = sessionById(state, id)
  if (!s) return no(state, "session_not_found")
  if (s.state === "finished") return no(state, "not_active")
  if (s.state === "paused") return ok(state)
  return ok(replace(state, { ...s, state: "paused", segments: pauseSegments(s.segments, Date.parse(at)), version: (s.version ?? 1) + 1, updatedAt: at }))
}

export function resumeSession(state: HabitsState, id: string, at: string): FocusResult {
  const s = sessionById(state, id)
  if (!s) return no(state, "session_not_found")
  if (s.state === "finished") return no(state, "not_active")
  if (s.state === "running") return ok(state)
  return ok(replace(state, { ...s, state: "running", segments: resumeSegments(s.segments, Date.parse(at)), version: (s.version ?? 1) + 1, updatedAt: at }))
}

export interface FinishInput {
  /** When «Terminar» happened (closes a running segment). */
  at: string
  /** Optional cut (forgotten timer or minutes edited down at close). */
  trimTo?: string | null
  actualOutput?: string | null
  rating?: number | null
}

function ratingOk(r: number | null | undefined): boolean {
  return r === null || r === undefined || (Number.isInteger(r) && r >= 1 && r <= 5)
}

/** «Terminar» always keeps the real minutes (decision 3); under one minute nothing is saved. */
export function finishSession(state: HabitsState, id: string, input: FinishInput): FocusResult {
  const s = sessionById(state, id)
  if (!s) return no(state, "session_not_found")
  if (s.state === "finished") return no(state, "not_active")
  if (!ratingOk(input.rating)) return no(state, "invalid_rating")
  let segments = pauseSegments(s.segments, Date.parse(input.at))
  if (input.trimTo) segments = trimSegments(segments, Date.parse(input.trimTo))
  if (activeSeconds(segments) < MIN_ACTIVE_SECONDS) return no(state, "too_short")
  // Same cap as the server: a forgotten timer must be cut («Terminar a las HH:MM» or fewer minutes).
  if (activeSeconds(segments) > MAX_ACTIVE_SECONDS) return no(state, "segments_too_long")
  const next: FocusSession = {
    ...s,
    state: "finished",
    segments,
    actualOutput: cleanText(input.actualOutput, ACTUAL_OUTPUT_MAX),
    rating: input.rating ?? null,
    version: (s.version ?? 1) + 1,
    updatedAt: input.at,
  }
  return ok(rederive(replace(state, next), next.habitId, next.localDate, input.at))
}

export interface EditInput {
  segments: Segment[]
  habitId: string | null
  project: string | null
  plannedOutput: string | null
  actualOutput: string | null
  rating: number | null
}

/** Edit a finished session after the fact (hours, texts, rating, habit). Both affected days are re-derived. */
export function editSession(state: HabitsState, id: string, input: EditInput, now: string): FocusResult {
  const s = sessionById(state, id)
  if (!s) return no(state, "session_not_found")
  if (s.state !== "finished") return no(state, "not_finished")
  const segErr = validateSegments(input.segments, Date.parse(now), false)
  if (segErr) return no(state, `segments_${segErr}`)
  if (activeSeconds(input.segments) < MIN_ACTIVE_SECONDS) return no(state, "too_short")
  if (!ratingOk(input.rating)) return no(state, "invalid_rating")
  const habitErr = habitError(state, input.habitId)
  if (habitErr) return no(state, habitErr)
  const next: FocusSession = {
    ...s,
    segments: input.segments,
    localDate: localDateOfStart(input.segments[0].start, state.timezone),
    habitId: input.habitId,
    project: cleanText(input.project, PROJECT_MAX),
    plannedOutput: cleanText(input.plannedOutput, PLANNED_OUTPUT_MAX),
    actualOutput: cleanText(input.actualOutput, ACTUAL_OUTPUT_MAX),
    rating: input.rating,
    version: (s.version ?? 1) + 1,
    updatedAt: now,
  }
  let out = replace(state, next)
  out = rederive(out, s.habitId, s.localDate, now)
  out = rederive(out, next.habitId, next.localDate, now)
  return ok(out)
}

/** «Descartar» counts nothing (decision 3). Idempotent. */
export function discardSession(state: HabitsState, id: string, now: string): HabitsState {
  const s = sessionById(state, id)
  if (!s) return state
  const out = { ...state, focusSessions: state.focusSessions.filter((x) => x.id !== id) }
  return s.state === "finished" ? rederive(out, s.habitId, s.localDate, now) : out
}

/** Link (or unlink) a duration habit to focus sessions from `from` on. History before it is kept. */
export function setHabitSource(state: HabitsState, habitId: string, source: "focus" | null, from: LocalDate): HabitsState {
  const h = state.habits.find((x) => x.id === habitId)
  if (!h || (source !== null && h.type !== "duration")) return state
  if ((h.activitySource ?? null) === source) return state
  return {
    ...state,
    habits: state.habits.map((x) => (x.id === habitId ? { ...x, activitySource: source, activitySourceFrom: source ? from : null } : x)),
  }
}

/** Duration habits fed by focus (the default link when preparing a session). */
export function focusHabits(state: HabitsState, today: LocalDate) {
  return state.habits.filter((h) => h.type === "duration" && h.activitySource === "focus" && (!h.archivedOn || h.archivedOn > today))
}

/** Projects used before, most recent first (decision 4: free text with suggestions). */
export function projectSuggestions(state: Pick<HabitsState, "focusSessions">, limit = 8): string[] {
  const seen = new Map<string, string>()
  const sorted = [...state.focusSessions].sort((a, b) => b.segments[0].start.localeCompare(a.segments[0].start))
  for (const s of sorted) {
    if (!s.project) continue
    const k = s.project.toLocaleLowerCase("es-ES")
    if (!seen.has(k)) seen.set(k, s.project)
    if (seen.size >= limit) break
  }
  return [...seen.values()]
}
