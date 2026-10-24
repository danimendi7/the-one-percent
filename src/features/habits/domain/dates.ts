/**
 * Calendar-date helpers.
 *
 * A `LocalDate` is a calendar day ("YYYY-MM-DD") in the user's timezone. It is
 * never a point in time, so all arithmetic is done on UTC midnights, which have
 * no DST transitions. Converting an instant to a LocalDate is the only place a
 * timezone is involved (`localDateInZone`).
 */

export type LocalDate = string
/** ISO weekday: 1 = Monday … 7 = Sunday */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

const DAY_MS = 86_400_000
const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string") return false
  const m = LOCAL_DATE_RE.exec(value)
  if (!m) return false
  return fromUtcMs(toUtcMs(value)) === value
}

export function toUtcMs(date: LocalDate): number {
  const m = LOCAL_DATE_RE.exec(date)
  if (!m) throw new Error(`Invalid LocalDate: ${date}`)
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

export function fromUtcMs(ms: number): LocalDate {
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0")
  const da = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${mo}-${da}`
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromUtcMs(toUtcMs(date) + days * DAY_MS)
}

/** Whole days from `a` to `b` (positive when b is later). */
export function diffDays(a: LocalDate, b: LocalDate): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS)
}

export function isoWeekday(date: LocalDate): Weekday {
  const js = new Date(toUtcMs(date)).getUTCDay()
  return (js === 0 ? 7 : js) as Weekday
}

/** Monday of the ISO week containing `date`. */
export function startOfWeek(date: LocalDate): LocalDate {
  return addDays(date, 1 - isoWeekday(date))
}

export function weekDates(date: LocalDate): LocalDate[] {
  const monday = startOfWeek(date)
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

/** Inclusive list of days from `from` to `to`. Empty when from > to. */
export function eachDay(from: LocalDate, to: LocalDate): LocalDate[] {
  const n = diffDays(from, to)
  if (n < 0) return []
  return Array.from({ length: n + 1 }, (_, i) => addDays(from, i))
}

export function minDate(a: LocalDate, b: LocalDate): LocalDate {
  return a <= b ? a : b
}

export function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return a >= b ? a : b
}

/** Calendar date of an instant as seen in an IANA timezone (DST-aware). */
export function localDateInZone(instant: Date, timeZone: string): LocalDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}`
}

// ── Display helpers (Spanish). Formatting a UTC midnight in UTC is
// deterministic on server and client, so these are hydration-safe.

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function fmt(locale: string, options: Intl.DateTimeFormatOptions) {
  const key = locale + JSON.stringify(options)
  let f = fmtCache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" })
    fmtCache.set(key, f)
  }
  return f
}

export function formatDate(
  date: LocalDate,
  options: Intl.DateTimeFormatOptions,
  locale = "es-ES"
): string {
  return fmt(locale, options).format(new Date(toUtcMs(date)))
}

export const WEEKDAY_SHORT: Record<Weekday, string> = {
  1: "L",
  2: "M",
  3: "X",
  4: "J",
  5: "V",
  6: "S",
  7: "D",
}

export const WEEKDAY_ABBR: Record<Weekday, string> = {
  1: "Lun",
  2: "Mar",
  3: "Mié",
  4: "Jue",
  5: "Vie",
  6: "Sáb",
  7: "Dom",
}

export const WEEKDAY_LONG: Record<Weekday, string> = {
  1: "lunes",
  2: "martes",
  3: "miércoles",
  4: "jueves",
  5: "viernes",
  6: "sábado",
  7: "domingo",
}

export function capitalize(s: string): string {
  return s.charAt(0).toLocaleUpperCase("es-ES") + s.slice(1)
}
