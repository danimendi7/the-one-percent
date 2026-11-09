import { z } from "zod"
import { LIMITS } from "@/features/knowledge/domain/types"
import { appleArtwork, description, instantOf, positiveInt, providerUrl, textLine, topicSuggestionsOf } from "./clean"
import { ATTRIBUTION, type EpisodeResult, type ShowResult } from "./types"

/**
 * Apple Podcasts (iTunes Search API) adapter (D2). Lookup returns at most the 200 most recent
 * episodes of a show (checked on 31/10/2026: `limit` above 200 is ignored); older ones are reached
 * through the episode search. Results come from the Spanish storefront, which also lists shows in
 * English.
 */
export const ITUNES_ORIGIN = "https://itunes.apple.com"
export const SHOW_ID = /^[1-9]\d{0,14}$/
export const SHOWS_LIMIT = 10
export const LOOKUP_LIMIT = 200
export const EPISODE_SEARCH_LIMIT = 50
const COUNTRY = "ES"

const LINK_HOSTS = ["podcasts.apple.com", "itunes.apple.com"]

export function showsUrl(query: string): string {
  const u = new URL("/search", ITUNES_ORIGIN)
  u.search = new URLSearchParams({ term: query, media: "podcast", entity: "podcast", limit: String(SHOWS_LIMIT), country: COUNTRY }).toString()
  return u.href
}

export function episodesUrl(showId: string): string {
  if (!SHOW_ID.test(showId)) throw new Error("invalid show id")
  const u = new URL("/lookup", ITUNES_ORIGIN)
  u.search = new URLSearchParams({ id: showId, entity: "podcastEpisode", limit: String(LOOKUP_LIMIT), country: COUNTRY }).toString()
  return u.href
}

export function episodeSearchUrl(term: string): string {
  const u = new URL("/search", ITUNES_ORIGIN)
  u.search = new URLSearchParams({ term, media: "podcast", entity: "podcastEpisode", limit: String(EPISODE_SEARCH_LIMIT), country: COUNTRY }).toString()
  return u.href
}

const resultsShape = z.object({ results: z.array(z.unknown()) })
const idOf = (v: unknown, max = 15): string | null => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 && String(v).length <= max ? String(v) : null)

/** Feed address without scheme or query: two Apple entries with the same one are the same show. */
function feedKey(v: unknown): string | null {
  if (typeof v !== "string") return null
  try {
    const u = new URL(v)
    return (u.hostname + u.pathname).toLowerCase().replace(/\/+$/, "")
  } catch {
    return null
  }
}

export interface ParsedShow {
  show: ShowResult
  /** Internal, for grouping duplicates (rank.ts); never sent to the client. */
  feedKey: string | null
}

function parseShow(raw: unknown): ParsedShow | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (r.wrapperType !== "track" || r.kind !== "podcast") return null
  const id = idOf(r.collectionId)
  const title = textLine(r.collectionName, LIMITS.title)
  if (!id || !title) return null
  return {
    show: {
      provider: "itunes",
      id,
      title,
      publisher: textLine(r.artistName, LIMITS.publisher),
      cover: appleArtwork(r.artworkUrl600),
      sourceUrl: providerUrl(r.collectionViewUrl, LINK_HOSTS),
      episodeCount: positiveInt(r.trackCount, 1_000_000),
      latestReleaseAt: instantOf(r.releaseDate),
      topicSuggestions: topicSuggestionsOf(r.genres, ["Podcasts"]),
      attribution: ATTRIBUTION.itunes,
    },
    feedKey: feedKey(r.feedUrl),
  }
}

export function parseShows(json: unknown): ParsedShow[] | null {
  const top = resultsShape.safeParse(json)
  if (!top.success) return null
  return top.data.results.map(parseShow).filter((s): s is ParsedShow => s !== null)
}

function parseEpisode(raw: unknown): EpisodeResult | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (r.wrapperType !== "podcastEpisode") return null
  const id = idOf(r.trackId, 20)
  const showId = idOf(r.collectionId)
  const title = textLine(r.trackName, LIMITS.title)
  if (!id || !showId || !title) return null
  const ms = typeof r.trackTimeMillis === "number" && Number.isFinite(r.trackTimeMillis) ? Math.round(r.trackTimeMillis / 1000) : null
  return {
    provider: "itunes",
    id,
    showId,
    showTitle: textLine(r.collectionName, LIMITS.title),
    title,
    description: description(r.description) ?? description(r.shortDescription),
    durationSeconds: ms !== null && ms >= 1 && ms <= LIMITS.durationSeconds ? ms : null,
    publishedAt: instantOf(r.releaseDate),
    cover: appleArtwork(r.artworkUrl600),
    sourceUrl: providerUrl(r.trackViewUrl, LINK_HOSTS),
    attribution: ATTRIBUTION.itunes,
  }
}

/** Lookup answer: the show itself (first result) and its episodes, newest first as Apple sends them. */
export function parseLookup(json: unknown, showId: string): { show: ShowResult | null; episodes: EpisodeResult[] } | null {
  const top = resultsShape.safeParse(json)
  if (!top.success) return null
  const show = top.data.results.map(parseShow).find((s) => s?.show.id === showId)?.show ?? null
  const episodes = top.data.results.map(parseEpisode).filter((e): e is EpisodeResult => e !== null && e.showId === showId)
  return { show, episodes }
}

/** Episode search across Apple; the caller keeps only those of the requested show. */
export function parseEpisodeSearch(json: unknown): EpisodeResult[] | null {
  const top = resultsShape.safeParse(json)
  if (!top.success) return null
  return top.data.results.map(parseEpisode).filter((e): e is EpisodeResult => e !== null)
}
