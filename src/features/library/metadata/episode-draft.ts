import { isLocalDate, localDateInZone, type LocalDate } from "@/features/habits/domain/dates"
import type { EpisodeInput } from "@/features/knowledge/domain/ops"
import { formatTimestamp, parseTimestamp, safeUrl } from "@/features/knowledge/domain/text"
import { LIMITS, type ContentStatus } from "@/features/knowledge/domain/types"
import type { EpisodeResult } from "./types"

/**
 * The confirmation sheet of an episode (M4g.4, docs/m4g-plan.md §20). Pure and tested, like the
 * book draft: what Apple proposed, what the user typed (never overwritten again), nothing invented.
 *
 * Dates: Apple gives an instant; the sheet shows and saves the calendar day of that instant in the
 * profile's zone (an episode out at 23:30 UTC on the 28th is the 29th in Madrid), and the instant
 * itself is not changed or stored (the model keeps a local date).
 */
export type EpisodeField = "title" | "creators" | "publishedOn" | "duration" | "episodeNumber" | "description" | "sourceUrl"

export interface EpisodeDraft {
  source: EpisodeResult
  values: Record<EpisodeField, string>
  touched: EpisodeField[]
  cover: string | null
  useCover: boolean
  keepDescription: boolean
}

/** Calendar day of an instant in a zone; null when there is no instant. */
export function localDayOf(instant: string | null, timeZone: string): LocalDate | null {
  if (!instant) return null
  const t = Date.parse(instant)
  return Number.isNaN(t) ? null : localDateInZone(new Date(t), timeZone)
}

/** «1 h 17 min», «38 min», «45 s»; empty without a duration. */
export function durationLabel(seconds: number | null): string {
  if (!seconds || seconds <= 0) return ""
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`
  return m > 0 ? `${m} min` : `${seconds} s`
}

export function createEpisodeDraft(e: EpisodeResult, timeZone: string, showCover: string | null = null): EpisodeDraft {
  const cover = e.cover ?? showCover
  return {
    source: e,
    values: {
      title: e.title,
      creators: "",
      publishedOn: localDayOf(e.publishedAt, timeZone) ?? "",
      duration: e.durationSeconds ? formatTimestamp(e.durationSeconds) : "",
      episodeNumber: "",
      description: e.description ?? "",
      sourceUrl: e.sourceUrl ?? "",
    },
    touched: [],
    cover,
    useCover: cover !== null,
    keepDescription: true,
  }
}

export function editEpisodeField(d: EpisodeDraft, field: EpisodeField, value: string): EpisodeDraft {
  return { ...d, values: { ...d.values, [field]: value }, touched: d.touched.includes(field) ? d.touched : [...d.touched, field] }
}

/** Same rule as the manual form: digits alone are minutes («45»); otherwise «1:02:30» or «12:34». */
export function parseDuration(s: string): number | null | "bad" {
  const v = s.trim()
  if (!v) return null
  const t = /^\d+$/.test(v) ? Number(v) * 60 : parseTimestamp(v)
  return t === null || t <= 0 || t > LIMITS.durationSeconds ? "bad" : t
}

export type EpisodeErrors = Partial<Record<EpisodeField, string>>

export function episodeDraftErrors(d: EpisodeDraft): EpisodeErrors {
  const e: EpisodeErrors = {}
  const v = d.values
  if (!v.title.trim()) e.title = "Escribe al menos el título."
  else if (v.title.trim().length > LIMITS.title) e.title = `Como mucho ${LIMITS.title} caracteres.`
  if (v.publishedOn && !isLocalDate(v.publishedOn)) e.publishedOn = "Elige una fecha válida."
  if (parseDuration(v.duration) === "bad") e.duration = "Escribe la duración en minutos (45) o como 1:02:30."
  if (v.episodeNumber.trim() && !/^\d{1,7}$/.test(v.episodeNumber.trim())) e.episodeNumber = "Escribe un número."
  if (v.sourceUrl.trim() && safeUrl(v.sourceUrl) === null) e.sourceUrl = "Escribe un enlace que empiece por https://."
  if (v.description.length > LIMITS.description) e.description = "La descripción es demasiado larga."
  return e
}

export interface EpisodeChoices {
  status?: ContentStatus
  rating?: number | null
  favorite?: boolean
}

/** The draft as the input of the existing createItem («episode»), on the show the user chose. */
export function episodeDraftInput(d: EpisodeDraft, showId: string | null, c: EpisodeChoices = {}): EpisodeInput {
  const v = d.values
  const duration = parseDuration(v.duration)
  return {
    title: v.title.trim(),
    creators: v.creators
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    description: d.keepDescription ? v.description.trim() || null : null,
    cover: d.useCover && d.cover ? { source: "external", url: d.cover } : null,
    sourceUrl: v.sourceUrl.trim() ? safeUrl(v.sourceUrl) : null,
    external: { provider: "itunes", id: d.source.id, attribution: d.source.attribution },
    topics: [],
    ...(c.status !== undefined && { status: c.status }),
    ...(c.rating !== undefined && { rating: c.rating }),
    ...(c.favorite !== undefined && { favorite: c.favorite }),
    episode: {
      showId,
      platform: "apple",
      durationSeconds: duration === "bad" ? null : duration,
      publishedOn: v.publishedOn || null,
      episodeNumber: v.episodeNumber.trim() ? Number(v.episodeNumber.trim()) : null,
    },
  }
}
