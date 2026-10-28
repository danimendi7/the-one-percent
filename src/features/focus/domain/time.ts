import { localDateInZone, type LocalDate } from "@/features/habits/domain/dates"
import { FUTURE_TOLERANCE_MS, MAX_ACTIVE_SECONDS, PAUSE_RECOVERY_MS, RECOVERY_GRACE_MS, type FocusSession, type Segment } from "./types"

/**
 * Time model (plan §3). Pure functions over segments; the server computes the same
 * figures from the same segments (supabase/migrations/*_focus.sql), so a session shows
 * identical minutes on every device and in every screen.
 */

const ms = (iso: string) => Date.parse(iso)
const iso = (t: number) => new Date(t).toISOString()

/** Effective milliseconds; an open segment counts up to `now`. */
export function activeMs(segments: readonly Segment[], now: number): number {
  let total = 0
  for (const s of segments) total += Math.max(0, (s.end === null ? now : ms(s.end)) - ms(s.start))
  return total
}

/** Effective whole seconds of closed segments (what the server stores as active_seconds). */
export function activeSeconds(segments: readonly Segment[]): number {
  let total = 0
  for (const s of segments) if (s.end !== null) total += Math.max(0, ms(s.end) - ms(s.start))
  return Math.round(total / 1000)
}

/** Minutes a set of sessions adds to a day: rounded once over the total, never per session. */
export function minutesOf(seconds: number): number {
  return Math.round(seconds / 60)
}

export function startedAt(s: Pick<FocusSession, "segments">): string {
  return s.segments[0].start
}

export function endedAt(s: Pick<FocusSession, "segments" | "state">): string | null {
  return s.state === "finished" ? s.segments[s.segments.length - 1].end : null
}

/** Day the session counts in: the local day it started, in the profile's timezone. */
export function localDateOfStart(start: string, timezone: string): LocalDate {
  return localDateInZone(new Date(start), timezone)
}

export function pauseSegments(segments: readonly Segment[], at: number): Segment[] {
  const last = segments[segments.length - 1]
  if (!last || last.end !== null) return [...segments]
  return [...segments.slice(0, -1), { start: last.start, end: iso(Math.max(at, ms(last.start))) }]
}

export function resumeSegments(segments: readonly Segment[], at: number): Segment[] {
  const last = segments[segments.length - 1]
  if (!last || last.end === null) return [...segments]
  return [...segments, { start: iso(Math.max(at, ms(last.end))), end: null }]
}

/**
 * Cut the session at an instant: later segments are dropped and the one in progress at
 * that moment ends there. «Terminar a las HH:MM» uses it so a forgotten timer cannot
 * inflate the minutes.
 */
export function trimSegments(segments: readonly Segment[], at: number): Segment[] {
  const out: Segment[] = []
  for (const s of segments) {
    const start = ms(s.start)
    if (start >= at) break
    const end = s.end === null ? at : Math.min(ms(s.end), at)
    out.push({ start: s.start, end: iso(end) })
  }
  return out.length ? out : [{ start: segments[0].start, end: segments[0].start }]
}

/** Instant at which the effective time reached `seconds` (null if it never did). */
export function instantAtActive(segments: readonly Segment[], seconds: number, now: number): number | null {
  let left = seconds * 1000
  for (const s of segments) {
    const start = ms(s.start)
    const end = s.end === null ? now : ms(s.end)
    const len = Math.max(0, end - start)
    if (len >= left) return start + left
    left -= len
  }
  return null
}

/** When the plan is fulfilled, accounting for pauses; null while it has not been reached. */
export function plannedEndAt(s: Pick<FocusSession, "segments" | "plannedMinutes">, now: number): number | null {
  return instantAtActive(s.segments, s.plannedMinutes * 60, now)
}

/** «¿Sigue en curso?»: a running session past its plan + 30 min. Never closes on its own. */
export function needsRecovery(s: FocusSession, now: number): boolean {
  if (s.state !== "running") return false
  return activeMs(s.segments, now) > s.plannedMinutes * 60_000 + RECOVERY_GRACE_MS
}

/** Instant the session was paused (end of its last segment); null unless paused. */
export function pausedAt(s: Pick<FocusSession, "segments" | "state">): number | null {
  if (s.state !== "paused") return null
  const end = s.segments[s.segments.length - 1]?.end
  return end ? ms(end) : null
}

/**
 * M3.3 decision 6: a session paused for more than 30 min, or whose pause crosses midnight in the
 * profile's timezone, asks «Continuar / Terminar / Descartar». It is never closed automatically.
 */
export function pausedTooLong(s: FocusSession, now: number, timezone: string): boolean {
  const at = pausedAt(s)
  if (at === null || now <= at) return false
  return now - at > PAUSE_RECOVERY_MS || localDateInZone(new Date(at), timezone) !== localDateInZone(new Date(now), timezone)
}

export type SegmentsError = "empty" | "order" | "overlap" | "future" | "open" | "too_long"

/** Plan §3 limits. `open` is whether the session is running (only then may the last segment be open). */
export function validateSegments(segments: readonly Segment[], now: number, open: boolean): SegmentsError | null {
  if (segments.length === 0) return "empty"
  let prevEnd = -Infinity
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]
    const start = ms(s.start)
    if (!Number.isFinite(start)) return "order"
    const last = i === segments.length - 1
    if (s.end === null) {
      if (!last || !open) return "open"
    } else if (last && open) return "open"
    const end = s.end === null ? start : ms(s.end)
    if (!Number.isFinite(end) || end < start) return "order"
    if (start < prevEnd) return "overlap"
    if (Math.max(start, end) > now + FUTURE_TOLERANCE_MS) return "future"
    prevEnd = end
  }
  if (activeMs(segments, now) > MAX_ACTIVE_SECONDS * 1000) return "too_long"
  return null
}

/**
 * Edit a finished session's times: move it to a new start (pauses keep their place relative
 * to it) and set its effective minutes by extending or trimming the end.
 */
export function retime(segments: readonly Segment[], startAt: number, activeMinutes: number): Segment[] {
  const delta = startAt - ms(segments[0].start)
  const shifted = segments.map((s) => ({ start: iso(ms(s.start) + delta), end: s.end === null ? null : iso(ms(s.end) + delta) }))
  const want = activeMinutes * 60_000
  const out: Segment[] = []
  let left = want
  for (let i = 0; i < shifted.length; i++) {
    const s = shifted[i]
    const start = ms(s.start)
    const len = Math.max(0, (s.end === null ? start : ms(s.end)) - start)
    const lastOne = i === shifted.length - 1
    if (len >= left || lastOne) {
      out.push({ start: s.start, end: iso(start + left) })
      return out
    }
    out.push({ start: s.start, end: s.end })
    left -= len
  }
  return out
}

/** mm:ss or h:mm:ss for a duration in ms (tabular display). */
export function clock(msValue: number): string {
  const total = Math.max(0, Math.floor(msValue / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, "0")
  const ss = String(s).padStart(2, "0")
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** HH:MM of an instant in a timezone (24 h). */
export function hhmm(t: number | string, timezone: string): string {
  return new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone }).format(new Date(t))
}

/**
 * Instant of a local wall time (YYYY-MM-DD + HH:MM) in an IANA timezone, DST-aware.
 * In the repeated hour of a DST change the earlier instant is used.
 */
export function zonedInstant(date: LocalDate, time: string, timezone: string): number {
  const [h, m] = time.split(":").map(Number)
  const [y, mo, d] = date.split("-").map(Number)
  const wall = Date.UTC(y, mo - 1, d, h, m)
  const offsetAt = (t: number) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(t)
    const get = (k: string) => Number(p.find((x) => x.type === k)?.value)
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - Math.floor(t / 60_000) * 60_000
  }
  // Two passes settle the offset on both sides of a transition; prefer the earlier candidate.
  const a = wall - offsetAt(wall - 12 * 3600_000)
  const b = wall - offsetAt(wall + 12 * 3600_000)
  const fits = (t: number) => t + offsetAt(t) === wall
  if (fits(a) && fits(b)) return Math.min(a, b)
  return fits(a) ? a : fits(b) ? b : wall - offsetAt(wall)
}
