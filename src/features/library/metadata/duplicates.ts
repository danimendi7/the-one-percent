import { compactIsbn, isbn10to13, isValidIsbn13, normalize, tokenize } from "@/features/knowledge/domain/text"
import type { KnowledgeState, PodcastShow } from "@/features/knowledge/domain/types"

/**
 * Duplicate detection against the local copy (docs/m4g-plan.md §5.4), so it also works offline.
 *
 * - `exact`: same provider and external id. That record already exists; saving another one with
 *   the same reference would be refused by ops.ts and by the database's unique index.
 * - `strong`: same edition (ISBN). Shown as a warning: a second copy is a legitimate choice.
 * - `possible`: same normalised title and a creator (or show/publisher) in common. A warning too.
 *
 * Only `exact` may block, and only the use of the same external reference: another edition can
 * still be saved without it (to-input.ts, `separateEdition`). Nothing here changes any record.
 */
export type MatchLevel = "exact" | "strong" | "possible"
export type MatchReason = "external_id" | "isbn" | "title_creator" | "title_show" | "title_publisher"

export interface Match {
  id: string
  level: MatchLevel
  reason: MatchReason
}

const RANK: Record<MatchLevel, number> = { exact: 3, strong: 2, possible: 1 }

function collect(found: Match[]): Match[] {
  const best = new Map<string, Match>()
  for (const m of found) {
    const prev = best.get(m.id)
    if (!prev || RANK[m.level] > RANK[prev.level]) best.set(m.id, m)
  }
  return [...best.values()].sort((a, b) => RANK[b.level] - RANK[a.level] || a.id.localeCompare(b.id))
}

/** Title for matching: words only, and without a subtitle after «:» or «.» («Sapiens: De animales…»). */
export function titleKey(title: string): string {
  return tokenize(title.split(/\s[:.]\s|:\s/)[0] ?? title).join(" ")
}

export function isbn13Of(isbn13: string | null, isbn10: string | null): string | null {
  if (isbn13 && isValidIsbn13(compactIsbn(isbn13))) return compactIsbn(isbn13)
  return isbn10 ? isbn10to13(isbn10) : null
}

function shareName(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a.map((x) => normalize(x)))
  return b.some((x) => set.has(normalize(x)))
}

export interface BookCandidate {
  workId: string | null
  isbn13: string | null
  isbn10: string | null
  title: string
  creators: string[] | null
}

export function findBookMatches(state: KnowledgeState, c: BookCandidate): Match[] {
  const isbn = isbn13Of(c.isbn13, c.isbn10)
  const title = titleKey(c.title)
  const found: Match[] = []
  for (const item of Object.values(state.items)) {
    if (item.kind !== "book") continue
    if (c.workId && item.external?.provider === "openlibrary" && item.external.id === c.workId) found.push({ id: item.id, level: "exact", reason: "external_id" })
    if (isbn && isbn13Of(item.book.isbn13, item.book.isbn10) === isbn) found.push({ id: item.id, level: "strong", reason: "isbn" })
    // Without names on either side the title alone is enough to ask.
    if (title && titleKey(item.title) === title && (!c.creators?.length || item.creators.length === 0 || shareName(item.creators, c.creators)))
      found.push({ id: item.id, level: "possible", reason: "title_creator" })
  }
  return collect(found)
}

export interface EpisodeCandidate {
  /** Apple `trackId`. */
  id: string
  /** The local show it will belong to, when known. */
  localShowId: string | null
  title: string
}

export function findEpisodeMatches(state: KnowledgeState, c: EpisodeCandidate): Match[] {
  const title = titleKey(c.title)
  const found: Match[] = []
  for (const item of Object.values(state.items)) {
    if (item.kind !== "episode") continue
    if (item.external?.provider === "itunes" && item.external.id === c.id) found.push({ id: item.id, level: "exact", reason: "external_id" })
    if (c.localShowId && item.episode.showId === c.localShowId && titleKey(item.title) === title) found.push({ id: item.id, level: "possible", reason: "title_show" })
  }
  return collect(found)
}

export interface ShowCandidate {
  /** Apple `collectionId`. */
  id: string
  title: string
  publisher: string | null
}

export function findShowMatches(state: KnowledgeState, c: ShowCandidate): Match[] {
  const title = normalize(c.title)
  const found: Match[] = []
  for (const show of Object.values(state.shows)) {
    if (show.external?.provider === "itunes" && show.external.id === c.id) found.push({ id: show.id, level: "exact", reason: "external_id" })
    if (normalize(show.title) === title && (!show.publisher || !c.publisher || normalize(show.publisher) === normalize(c.publisher)))
      found.push({ id: show.id, level: "possible", reason: "title_publisher" })
  }
  return collect(found)
}

/** The local show that already is this Apple show, to reuse it instead of creating another. */
export function existingShow(state: KnowledgeState, appleId: string): PodcastShow | null {
  return Object.values(state.shows).find((s) => s.external?.provider === "itunes" && s.external.id === appleId) ?? null
}

/** Whether the external reference can be saved: false only when a record already holds it. */
export function canUseExternalRef(matches: readonly Match[]): boolean {
  return !matches.some((m) => m.level === "exact")
}

