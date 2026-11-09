import { z } from "zod"
import { LIMITS } from "@/features/knowledge/domain/types"
import { creatorsOf, description, isbnsOf, languageOf, openLibraryCover, positiveInt, textLine, topicSuggestionsOf, yearOf } from "./clean"
import { ATTRIBUTION, type BookResult } from "./types"

/**
 * Open Library adapter (D1): URL builders that only take validated identifiers, and pure parsers
 * of the JSON it returns. A malformed document is skipped on its own; a response whose overall
 * shape is wrong yields `null` (the service turns that into `provider_unavailable`).
 */
export const OPEN_LIBRARY_ORIGIN = "https://openlibrary.org"

export const WORK_ID = /^OL[1-9]\d{0,11}W$/
export const EDITION_ID = /^OL[1-9]\d{0,11}M$/
const AUTHOR_ID = /^OL[1-9]\d{0,11}A$/

export type BookSearchBy = "any" | "title" | "author" | "isbn"
export type PreferredLanguage = "es" | "en"

const SEARCH_FIELDS = [
  "key", "title", "subtitle", "author_name", "first_publish_year", "cover_i", "edition_count",
  "editions", "editions.key", "editions.title", "editions.subtitle", "editions.language", "editions.isbn",
  "editions.publisher", "editions.publish_date", "editions.cover_i",
].join(",")

export const SEARCH_LIMIT = 10
export const EDITIONS_LIMIT = 20

/** `lang` makes Open Library pick, for each work, an edition in that language when it has one. */
export function searchUrl(by: BookSearchBy, query: string, lang: PreferredLanguage): string {
  const u = new URL("/search.json", OPEN_LIBRARY_ORIGIN)
  u.searchParams.set(by === "any" ? "q" : by, query)
  u.searchParams.set("limit", String(SEARCH_LIMIT))
  u.searchParams.set("lang", lang)
  u.searchParams.set("fields", SEARCH_FIELDS)
  return u.href
}

function checked(id: string, re: RegExp): string {
  if (!re.test(id)) throw new Error("invalid Open Library id")
  return id
}

export const workUrl = (id: string) => `${OPEN_LIBRARY_ORIGIN}/works/${checked(id, WORK_ID)}.json`
export const editionUrl = (id: string) => `${OPEN_LIBRARY_ORIGIN}/books/${checked(id, EDITION_ID)}.json`
export const authorUrl = (id: string) => `${OPEN_LIBRARY_ORIGIN}/authors/${checked(id, AUTHOR_ID)}.json`
export const editionsUrl = (id: string) => `${OPEN_LIBRARY_ORIGIN}/works/${checked(id, WORK_ID)}/editions.json?limit=${EDITIONS_LIMIT}`
/** Redirects (302, same host) to the edition's record. */
export function isbnUrl(isbn13: string): string {
  if (!/^97[89]\d{10}$/.test(isbn13)) throw new Error("invalid ISBN-13")
  return `${OPEN_LIBRARY_ORIGIN}/isbn/${isbn13}.json`
}

/** `/works/OL1W` → `OL1W` when it has the expected form. */
function keyId(v: unknown, re: RegExp): string | null {
  if (typeof v !== "string") return null
  const id = v.replace(/^\/(works|books|authors)\//, "")
  return re.test(id) ? id : null
}

const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v)

/** `description` (and `notes`) are a string or `{ type: "/type/text", value }`. */
function textValue(v: unknown): unknown {
  return v && typeof v === "object" && "value" in v ? (v as { value: unknown }).value : v
}

const searchShape = z.object({ docs: z.array(z.unknown()) })
const doc = z.object({ key: z.string() }).passthrough()

export function parseSearch(json: unknown): BookResult[] | null {
  const top = searchShape.safeParse(json)
  if (!top.success) return null
  const out: BookResult[] = []
  for (const raw of top.data.docs) {
    const d = doc.safeParse(raw)
    if (!d.success) continue
    const r = d.data as Record<string, unknown>
    const workId = keyId(r.key, WORK_ID)
    const workTitle = textLine(r.title, LIMITS.title)
    if (!workId || !workTitle) continue
    const eds = r.editions && typeof r.editions === "object" ? (r.editions as { docs?: unknown }).docs : null
    const e = (Array.isArray(eds) && eds[0] && typeof eds[0] === "object" ? eds[0] : null) as Record<string, unknown> | null
    const editionId = e ? keyId(e.key, EDITION_ID) : null
    const edition = editionId ? e : null
    const title = (edition && textLine(edition.title, LIMITS.title)) ?? workTitle
    out.push({
      provider: "openlibrary",
      workId,
      editionId,
      title,
      workTitle: title === workTitle ? null : workTitle,
      subtitle: textLine(edition ? edition.subtitle : r.subtitle, LIMITS.subtitle),
      creators: creatorsOf(r.author_name),
      language: edition ? languageOf(first(edition.language)) : null,
      year: edition ? yearOf(first(edition.publish_date)) : null,
      firstPublishedYear: yearOf(r.first_publish_year),
      publisher: edition ? textLine(first(edition.publisher), LIMITS.publisher) : null,
      // The search index only has the median across editions: not this edition's, so not used.
      pageCount: null,
      ...(edition ? isbnsOf(edition.isbn) : { isbn13: null, isbn10: null }),
      cover: openLibraryCover(edition?.cover_i) ?? openLibraryCover(r.cover_i),
      description: null,
      topicSuggestions: [],
      editionCount: positiveInt(r.edition_count, 1_000_000),
      sourceUrl: `${OPEN_LIBRARY_ORIGIN}${editionId ? `/books/${editionId}` : `/works/${workId}`}`,
      attribution: ATTRIBUTION.openlibrary,
    })
  }
  return out
}

export interface WorkRecord {
  workId: string
  title: string
  subtitle: string | null
  description: string | null
  topicSuggestions: string[]
  cover: string | null
  authorIds: string[]
}

export function parseWork(json: unknown): WorkRecord | null {
  if (!json || typeof json !== "object") return null
  const r = json as Record<string, unknown>
  const workId = keyId(r.key, WORK_ID)
  const title = textLine(r.title, LIMITS.title)
  if (!workId || !title) return null
  const authors = Array.isArray(r.authors) ? r.authors : []
  return {
    workId,
    title,
    subtitle: textLine(r.subtitle, LIMITS.subtitle),
    description: description(textValue(r.description)),
    topicSuggestions: topicSuggestionsOf(r.subjects),
    cover: firstCover(r.covers),
    authorIds: authors
      .map((a) => keyId(a && typeof a === "object" ? (a as { author?: { key?: unknown } }).author?.key : null, AUTHOR_ID))
      .filter((x): x is string => x !== null)
      .slice(0, 5),
  }
}

/** Open Library lists `-1` for removed covers. */
function firstCover(v: unknown): string | null {
  if (!Array.isArray(v)) return null
  for (const id of v) {
    const c = openLibraryCover(id)
    if (c) return c
  }
  return null
}

export interface EditionRecord {
  editionId: string
  workId: string | null
  title: string
  subtitle: string | null
  language: string | null
  year: number | null
  publisher: string | null
  pageCount: number | null
  isbn13: string | null
  isbn10: string | null
  cover: string | null
  authorIds: string[]
}

export function parseEdition(json: unknown): EditionRecord | null {
  if (!json || typeof json !== "object") return null
  const r = json as Record<string, unknown>
  const editionId = keyId(r.key, EDITION_ID)
  const title = textLine(r.title, LIMITS.title)
  if (!editionId || !title) return null
  const works = Array.isArray(r.works) ? r.works : []
  const langs = Array.isArray(r.languages) ? r.languages : []
  const authors = Array.isArray(r.authors) ? r.authors : []
  return {
    editionId,
    workId: keyId(works[0] && typeof works[0] === "object" ? (works[0] as { key?: unknown }).key : null, WORK_ID),
    title,
    subtitle: textLine(r.subtitle, LIMITS.subtitle),
    language: languageOf(langs[0] && typeof langs[0] === "object" ? (langs[0] as { key?: unknown }).key : null),
    year: yearOf(r.publish_date),
    publisher: textLine(first(r.publishers), LIMITS.publisher),
    pageCount: positiveInt(r.number_of_pages, LIMITS.pages),
    ...isbnsOf([...(Array.isArray(r.isbn_13) ? r.isbn_13 : []), ...(Array.isArray(r.isbn_10) ? r.isbn_10 : [])]),
    cover: firstCover(r.covers),
    authorIds: authors
      .map((a) => keyId(a && typeof a === "object" ? (a as { key?: unknown }).key : null, AUTHOR_ID))
      .filter((x): x is string => x !== null)
      .slice(0, 5),
  }
}

export function parseEditions(json: unknown): EditionRecord[] | null {
  if (!json || typeof json !== "object" || !Array.isArray((json as { entries?: unknown }).entries)) return null
  return ((json as { entries: unknown[] }).entries.map(parseEdition).filter((e): e is EditionRecord => e !== null))
}

export function parseAuthorName(json: unknown): string | null {
  if (!json || typeof json !== "object") return null
  return textLine((json as { name?: unknown }).name, LIMITS.creator)
}

/**
 * A book from its work and, when chosen, one edition: the edition's data wins for what belongs
 * to the edition (title, ISBN, pages, publisher, language, year, cover), the work gives the
 * description and topic suggestions. `creators` stays null unless the caller resolved names.
 */
export function bookFromRecords(work: WorkRecord | null, edition: EditionRecord | null, creators: string[] | null): BookResult | null {
  if (!work && !edition) return null
  const workId = work?.workId ?? edition?.workId ?? null
  const title = edition?.title ?? work!.title
  const workTitle = work && work.title !== title ? work.title : null
  return {
    provider: "openlibrary",
    workId,
    editionId: edition?.editionId ?? null,
    title,
    workTitle,
    subtitle: edition ? edition.subtitle : (work?.subtitle ?? null),
    creators,
    language: edition?.language ?? null,
    year: edition?.year ?? null,
    firstPublishedYear: null,
    publisher: edition?.publisher ?? null,
    pageCount: edition?.pageCount ?? null,
    isbn13: edition?.isbn13 ?? null,
    isbn10: edition?.isbn10 ?? null,
    cover: edition?.cover ?? work?.cover ?? null,
    description: work?.description ?? null,
    topicSuggestions: work?.topicSuggestions ?? [],
    editionCount: null,
    sourceUrl: `${OPEN_LIBRARY_ORIGIN}${edition ? `/books/${edition.editionId}` : `/works/${workId}`}`,
    attribution: ATTRIBUTION.openlibrary,
  }
}
