import { normalize, tokenize } from "@/features/knowledge/domain/text"
import type { ParsedShow } from "./itunes"
import type { BookResult, EpisodeResult, ShowResult } from "./types"

/**
 * Ordering of provider results (docs/m4g-plan.md §5.2). Nothing is merged or dropped for books:
 * two works or two editions stay two results (the user decides). Shows that Apple lists twice for
 * the same feed are the same show, so only one is kept.
 */

/** Companion books that bury the real one («Summary of…», «Workbook for…»). */
const NOISE = /\b(summary|summaries|resumen|workbook|journal|study guide|guia de estudio|cuaderno|analysis of|analisis de|companion|key takeaways)\b/

function plain(s: string): string {
  return tokenize(s).join(" ")
}

function bookScore(b: BookResult, q: string, isbn: string | null): number {
  let s = 0
  // isbnsOf() already derives the ISBN-13 of an edition that only lists an ISBN-10.
  if (isbn && b.isbn13 === isbn) s += 100
  const title = plain(b.workTitle ?? b.title)
  const query = plain(q)
  if (query && title === query) s += 20
  else if (query && title.startsWith(query)) s += 10
  if (NOISE.test(plain(b.title)) && !NOISE.test(query)) s -= 30
  if (b.cover) s += 3
  if (b.creators && b.creators.length > 0) s += 3
  if (b.editionCount) s += Math.min(10, Math.log2(b.editionCount + 1) * 2)
  return s
}

/** Best match first; ties keep the provider's order (it already ranks by relevance). */
export function rankBooks(books: BookResult[], query: string, isbn: string | null): BookResult[] {
  return books
    .map((b, i) => ({ b, i, s: bookScore(b, query, isbn) }))
    .sort((x, y) => y.s - x.s || x.i - y.i)
    .map((x) => x.b)
}

/**
 * Apple sometimes lists one show twice (same feed, or same title and author). The entry with
 * more episodes stays (then the most recent), in the position of the first one seen.
 */
export function dedupeShows(parsed: ParsedShow[]): ShowResult[] {
  const groups: { keys: string[]; best: ParsedShow }[] = []
  for (const p of parsed) {
    const keys = [p.feedKey ? `feed:${p.feedKey}` : null, `name:${normalize(p.show.title)}|${normalize(p.show.publisher ?? "")}`].filter((k): k is string => k !== null)
    const g = groups.find((x) => x.keys.some((k) => keys.includes(k)))
    if (!g) {
      groups.push({ keys, best: p })
      continue
    }
    g.keys.push(...keys)
    const a = g.best.show
    const b = p.show
    const better = (b.episodeCount ?? 0) > (a.episodeCount ?? 0) || ((b.episodeCount ?? 0) === (a.episodeCount ?? 0) && (b.latestReleaseAt ?? "") > (a.latestReleaseAt ?? ""))
    if (better) g.best = p
  }
  return groups.map((g) => g.best.show)
}

/** Episodes whose title or description contain every word of the query (accent-insensitive). */
export function filterEpisodes(episodes: EpisodeResult[], query: string): EpisodeResult[] {
  const words = tokenize(query)
  if (words.length === 0) return episodes
  return episodes.filter((e) => {
    const hay = plain(`${e.title} ${e.description ?? ""}`)
    return words.every((w) => hay.includes(w))
  })
}

/** Union by id, first occurrence wins, newest first (episodes without a date at the end). */
export function mergeEpisodes(...lists: EpisodeResult[][]): EpisodeResult[] {
  const seen = new Map<string, EpisodeResult>()
  for (const list of lists) for (const e of list) if (!seen.has(e.id)) seen.set(e.id, e)
  return [...seen.values()].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
}
