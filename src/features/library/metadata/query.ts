import { z } from "zod"
import { cleanLine, compactIsbn, isbn10to13, isValidIsbn10, isValidIsbn13, normalize } from "@/features/knowledge/domain/text"
import { EDITION_ID, WORK_ID, type BookSearchBy, type PreferredLanguage } from "./openlibrary"
import { SHOW_ID } from "./itunes"

/**
 * Request parameters of the metadata endpoints, checked before anything leaves the server: type,
 * length and format. External URLs are then built from these values only (openlibrary.ts,
 * itunes.ts); no endpoint takes a URL.
 */
export const QUERY_MIN = 2
export const QUERY_MAX = 100

/** A query as sent upstream: one clean line, control characters removed, within the limits. */
export function cleanQuery(s: string): string {
  return cleanLine(s).slice(0, QUERY_MAX).trim()
}

/** Stable key of a query (cache, client session cache): accent-, case- and space-insensitive. */
export function queryKey(s: string): string {
  return normalize(cleanQuery(s)).replace(/\s+/g, " ")
}

/** An ISBN typed with or without hyphens/spaces, as ISBN-13; null if the check digit fails. */
export function detectIsbn(s: string): string | null {
  const v = compactIsbn(s.trim())
  if (/^\d{13}$/.test(v)) return isValidIsbn13(v) ? v : null
  if (/^\d{9}[\dX]$/.test(v)) return isValidIsbn10(v) ? isbn10to13(v) : null
  return null
}

const query = z
  .string()
  .transform(cleanQuery)
  .refine((s) => s.length >= QUERY_MIN, "too short")
const raw = z.string().max(QUERY_MAX * 2)

export interface BookSearchParams {
  by: BookSearchBy
  q: string
  lang: PreferredLanguage
}

const bookSearch = z
  .object({ q: raw.pipe(query), by: z.enum(["any", "title", "author", "isbn"]).default("any"), lang: z.enum(["es", "en"]).default("es") })
  .transform((p, ctx): BookSearchParams => {
    const isbn = detectIsbn(p.q)
    // A valid ISBN always searches as ISBN (exact); asking for an ISBN that is not one is an error.
    if (isbn) return { by: "isbn", q: isbn, lang: p.lang }
    if (p.by === "isbn") {
      ctx.addIssue({ code: "custom", message: "invalid ISBN" })
      return z.NEVER
    }
    return { by: p.by, q: p.q, lang: p.lang }
  })

const bookWork = z.object({ work: z.string().regex(WORK_ID), edition: z.string().regex(EDITION_ID).optional() })
const bookEditions = z.object({ work: z.string().regex(WORK_ID), lang: z.enum(["es", "en"]).default("es") })
const showSearch = z.object({ q: raw.pipe(query) })
const showEpisodes = z.object({ show: z.string().regex(SHOW_ID), q: raw.pipe(query).optional() })

/** First value of each known parameter (repeated ones cannot smuggle a second value). */
function pick(params: URLSearchParams, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of keys) {
    const v = params.get(k)
    if (v !== null && v !== "") out[k] = v
  }
  return out
}

export const PARAMS = {
  bookSearch: (p: URLSearchParams) => bookSearch.safeParse(pick(p, ["q", "by", "lang"])),
  bookWork: (p: URLSearchParams) => bookWork.safeParse(pick(p, ["work", "edition"])),
  bookEditions: (p: URLSearchParams) => bookEditions.safeParse(pick(p, ["work", "lang"])),
  showSearch: (p: URLSearchParams) => showSearch.safeParse(pick(p, ["q"])),
  showEpisodes: (p: URLSearchParams) => showEpisodes.safeParse(pick(p, ["show", "q"])),
}
