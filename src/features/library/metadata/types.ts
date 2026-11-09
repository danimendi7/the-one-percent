import { z } from "zod"
import { LIMITS } from "@/features/knowledge/domain/types"

/**
 * Normalized external metadata (M4g, docs/m4g-plan.md §5.2). Provider-independent shapes that the
 * server returns and the client validates again. Nothing here is stored as is: a confirmed result
 * becomes a normal book, show or episode through to-input.ts. A missing value is `null`, never
 * guessed; lists are empty when the provider has nothing.
 */
export type MetadataProvider = "openlibrary" | "itunes"

export const ATTRIBUTION: Record<MetadataProvider, string> = {
  openlibrary: "Datos: Open Library",
  itunes: "Datos: Apple Podcasts",
}

/** D7: imported descriptions are cut at a sentence end within this length. */
export const DESCRIPTION_MAX = 2_000
/** D6: provider subjects or genres are only offered, never saved without a tap. */
export const TOPIC_SUGGESTIONS_MAX = 10

/**
 * A book as found: a WORK (the abstract book, Open Library `OL…W`) seen through one EDITION
 * (`OL…M`, with its ISBN, publisher, pages and cover). Title and subtitle are the edition's when
 * there is one (a translation has its own), `workTitle` keeps the work's when it differs.
 */
export interface BookResult {
  provider: "openlibrary"
  workId: string | null
  editionId: string | null
  title: string
  workTitle: string | null
  subtitle: string | null
  /** null: this answer does not say (the detail endpoint leaves names to the search result). */
  creators: string[] | null
  language: string | null
  /** Year of the edition; `firstPublishedYear` is the work's. */
  year: number | null
  firstPublishedYear: number | null
  publisher: string | null
  pageCount: number | null
  isbn13: string | null
  isbn10: string | null
  /** Canonical provider URL (shown through the same-origin proxy from M4g.2). */
  cover: string | null
  description: string | null
  topicSuggestions: string[]
  editionCount: number | null
  sourceUrl: string
  attribution: string
}

export interface ShowResult {
  provider: "itunes"
  id: string
  title: string
  publisher: string | null
  cover: string | null
  sourceUrl: string | null
  episodeCount: number | null
  latestReleaseAt: string | null
  topicSuggestions: string[]
  attribution: string
}

export interface EpisodeResult {
  provider: "itunes"
  id: string
  showId: string
  showTitle: string | null
  title: string
  description: string | null
  durationSeconds: number | null
  /** Instant; the local date depends on the profile's zone (to-input.ts). */
  publishedAt: string | null
  cover: string | null
  sourceUrl: string | null
  attribution: string
}

/**
 * Episodes of a show. Apple returns at most the 200 most recent (`scope: "recent"`); a search
 * (`scope: "search"`) also asks Apple's episode search, which reaches older ones. `complete` is
 * true only when the list is known to hold every episode of the show.
 */
export interface EpisodeList {
  show: ShowResult | null
  episodes: EpisodeResult[]
  scope: "recent" | "search"
  total: number | null
  complete: boolean
}

export type MetadataErrorCode =
  | "unauthorized"
  | "unavailable"
  | "bad_request"
  | "rate_limited"
  | "provider_busy"
  | "provider_unavailable"
  | "not_found"
  /** Client side only: no answer reached the app. */
  | "network"

export interface MetadataError {
  code: MetadataErrorCode
  /** Seconds, when waiting helps. */
  retryAfter?: number
}

export type MetadataResponse<T> = { ok: true; data: T } | { ok: false; error: MetadataError }

/** Texts for the interface (M4g.3/M4g.4). Manual entry is always offered next to them (D8). */
export const METADATA_ERROR_TEXT: Record<MetadataErrorCode, string> = {
  unauthorized: "La búsqueda está disponible con tu cuenta.",
  unavailable: "La búsqueda no está disponible ahora.",
  bad_request: "Escribe al menos dos letras o un ISBN válido.",
  rate_limited: "Demasiadas búsquedas seguidas; espera unos segundos.",
  provider_busy: "El servicio está ocupado; inténtalo en unos segundos.",
  provider_unavailable: "El servicio no responde ahora.",
  not_found: "No se encontró.",
  network: "Sin conexión con la app.",
}

// ---------- schemas (the client re-validates what the server sends) ----------

const text = (max: number) => z.string().min(1).max(max)
const url = z.string().url().max(LIMITS.url)
const year = z.number().int().min(-3000).max(3000)
const instant = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "invalid instant")
const topics = z.array(text(LIMITS.topic)).max(TOPIC_SUGGESTIONS_MAX)

export const bookResultSchema = z
  .object({
    provider: z.literal("openlibrary"),
    workId: z.string().regex(/^OL\d+W$/).nullable(),
    editionId: z.string().regex(/^OL\d+M$/).nullable(),
    title: text(LIMITS.title),
    workTitle: text(LIMITS.title).nullable(),
    subtitle: text(LIMITS.subtitle).nullable(),
    creators: z.array(text(LIMITS.creator)).max(LIMITS.creators).nullable(),
    language: text(LIMITS.language).nullable(),
    year: year.nullable(),
    firstPublishedYear: year.nullable(),
    publisher: text(LIMITS.publisher).nullable(),
    pageCount: z.number().int().min(1).max(LIMITS.pages).nullable(),
    isbn13: z.string().regex(/^97[89]\d{10}$/).nullable(),
    isbn10: z.string().regex(/^\d{9}[\dX]$/).nullable(),
    cover: url.nullable(),
    description: text(DESCRIPTION_MAX).nullable(),
    topicSuggestions: topics,
    editionCount: z.number().int().min(0).nullable(),
    sourceUrl: url,
    attribution: text(LIMITS.attribution),
  })
  .strict() satisfies z.ZodType<BookResult>

export const showResultSchema = z
  .object({
    provider: z.literal("itunes"),
    id: z.string().regex(/^\d{1,15}$/),
    title: text(LIMITS.title),
    publisher: text(LIMITS.publisher).nullable(),
    cover: url.nullable(),
    sourceUrl: url.nullable(),
    episodeCount: z.number().int().min(0).nullable(),
    latestReleaseAt: instant.nullable(),
    topicSuggestions: topics,
    attribution: text(LIMITS.attribution),
  })
  .strict() satisfies z.ZodType<ShowResult>

export const episodeResultSchema = z
  .object({
    provider: z.literal("itunes"),
    id: z.string().regex(/^\d{1,20}$/),
    showId: z.string().regex(/^\d{1,15}$/),
    showTitle: text(LIMITS.title).nullable(),
    title: text(LIMITS.title),
    description: text(DESCRIPTION_MAX).nullable(),
    durationSeconds: z.number().int().min(1).max(LIMITS.durationSeconds).nullable(),
    publishedAt: instant.nullable(),
    cover: url.nullable(),
    sourceUrl: url.nullable(),
    attribution: text(LIMITS.attribution),
  })
  .strict() satisfies z.ZodType<EpisodeResult>

export const episodeListSchema = z
  .object({
    show: showResultSchema.nullable(),
    episodes: z.array(episodeResultSchema),
    scope: z.enum(["recent", "search"]),
    total: z.number().int().min(0).nullable(),
    complete: z.boolean(),
  })
  .strict() satisfies z.ZodType<EpisodeList>

const errorSchema = z
  .object({
    code: z.enum(["unauthorized", "unavailable", "bad_request", "rate_limited", "provider_busy", "provider_unavailable", "not_found", "network"]),
    retryAfter: z.number().int().min(0).optional(),
  })
  .strict()

export function responseSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), data }).strict(), z.object({ ok: z.literal(false), error: errorSchema }).strict()])
}
