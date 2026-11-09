import { LIMITS } from "@/features/knowledge/domain/types"
import { episodeSearchUrl, episodesUrl, parseEpisodeSearch, parseLookup, parseShows, showsUrl } from "../itunes"
import {
  authorUrl,
  bookFromRecords,
  editionUrl,
  editionsUrl,
  isbnUrl,
  parseAuthorName,
  parseEdition,
  parseEditions,
  parseSearch,
  parseWork,
  searchUrl,
  workUrl,
  type EditionRecord,
  type PreferredLanguage,
  type WorkRecord,
} from "../openlibrary"
import type { BookSearchParams } from "../query"
import { dedupeShows, filterEpisodes, mergeEpisodes, rankBooks } from "../rank"
import { bookResultSchema, episodeResultSchema, showResultSchema, type BookResult, type EpisodeList, type EpisodeResult, type MetadataErrorCode, type ShowResult } from "../types"
import { CircuitBreaker, InFlight, Spacer, TokenBucket, TtlCache, type Clock } from "./limits"
import { defaultFetchDeps, safeFetchJson, UpstreamError, type FetchDeps } from "./safe-fetch"

/**
 * Metadata service (M4g.1): one instance per server process. It knows the providers' limits,
 * keeps them per instance, retries once at most and caches only public records keyed by provider
 * ids (D-CACHE). It never sees who is asking: user checks happen in the route handler.
 */
export class ServiceError extends Error {
  constructor(
    readonly code: MetadataErrorCode,
    /** Seconds. */
    readonly retryAfter?: number
  ) {
    super(code)
    this.name = "ServiceError"
  }
}

export interface ServiceDeps {
  fetch: FetchDeps
  now: Clock
  sleep: (ms: number) => Promise<void>
  random: () => number
}

export const defaultServiceDeps: ServiceDeps = {
  fetch: defaultFetchDeps,
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  random: Math.random,
}

type Provider = "openlibrary" | "itunes"

/** Time and size limits measured on 31/10/2026 with margin (plan §4.1). */
const CONFIG: Record<Provider, { hosts: string[]; timeoutMs: number; maxBytes: number; types: string[] }> = {
  openlibrary: { hosts: ["openlibrary.org"], timeoutMs: 6_000, maxBytes: 1024 * 1024, types: ["application/json"] },
  // Apple answers JSON as text/javascript; a 200-episode lookup weighs up to ~850 KB.
  itunes: { hosts: ["itunes.apple.com"], timeoutMs: 4_000, maxBytes: 2 * 1024 * 1024, types: ["application/json", "text/javascript"] },
}

/** D-CACHE: 24 h for book records (they barely change); 1 h for a show's episode list (new episodes). */
export const TTL = { record: 24 * 3600_000, episodes: 3600_000 }

const MAX_AUTHORS = 3

const s = (ms: number) => Math.max(1, Math.ceil(ms / 1000))

export function createMetadataService(deps: ServiceDeps = defaultServiceDeps) {
  const breakers: Record<Provider, CircuitBreaker> = { openlibrary: new CircuitBreaker(deps.now), itunes: new CircuitBreaker(deps.now) }
  // Open Library: 1 request per second (its limit without a contact address), waiting up to 4 s.
  const olSpacer = new Spacer(1_000, 4_000, deps.now)
  // Apple: ≈20 per minute documented; 18 with a small burst.
  const appleBucket = new TokenBucket(5, 18, deps.now)
  const inFlight = new InFlight<unknown>()
  const cache = new TtlCache<unknown>(deps.now)

  async function quota(p: Provider): Promise<void> {
    if (p === "openlibrary") {
      const r = olSpacer.reserve()
      if (!r.ok) throw new ServiceError("provider_busy", s(r.retryAfterMs))
      if (r.waitMs > 0) await deps.sleep(r.waitMs)
    } else {
      const r = appleBucket.take()
      if (!r.ok) throw new ServiceError("provider_busy", s(r.retryAfterMs))
    }
  }

  /** One upstream JSON document, with the provider's quota, breaker and at most one retry. */
  function getJson(p: Provider, url: string): Promise<unknown> {
    return inFlight.run(url, async () => {
      for (let attempt = 0; ; attempt++) {
        const blocked = breakers[p].blockedFor()
        if (blocked > 0) throw new ServiceError("provider_unavailable", s(blocked))
        await quota(p)
        try {
          const json = await safeFetchJson(url, CONFIG[p], deps.fetch)
          breakers[p].success()
          return json
        } catch (e) {
          if (!(e instanceof UpstreamError)) throw e
          if (e.kind === "status" && e.status === 404) throw new ServiceError("not_found")
          if (e.kind === "status" && (e.status === 429 || e.status === 403)) {
            breakers[p].refused(e.retryAfter)
            throw new ServiceError("provider_busy", s(breakers[p].blockedFor()))
          }
          breakers[p].failure()
          // Only a transient failure (network or 5xx) is retried, once, after a random 300–600 ms.
          const transient = e.kind === "network" || (e.kind === "status" && (e.status ?? 0) >= 500)
          if (transient && attempt === 0 && breakers[p].blockedFor() === 0) {
            await deps.sleep(300 + Math.floor(deps.random() * 300))
            continue
          }
          throw new ServiceError("provider_unavailable", breakers[p].blockedFor() > 0 ? s(breakers[p].blockedFor()) : undefined)
        }
      }
    })
  }

  /** A provider answer whose overall shape is wrong counts as a failure of that provider. */
  function malformed(p: Provider): never {
    breakers[p].failure()
    throw new ServiceError("provider_unavailable")
  }

  async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key)
    if (hit !== undefined) return hit as T
    const value = await load()
    cache.set(key, value, ttl)
    return value
  }

  const work = (id: string) =>
    cached(`ol:work:${id}`, TTL.record, async () => parseWork(await getJson("openlibrary", workUrl(id))) ?? malformed("openlibrary"))
  const edition = (id: string) =>
    cached(`ol:edition:${id}`, TTL.record, async () => parseEdition(await getJson("openlibrary", editionUrl(id))) ?? malformed("openlibrary"))
  const author = (id: string) =>
    cached(`ol:author:${id}`, TTL.record, async () => parseAuthorName(await getJson("openlibrary", authorUrl(id))))

  /** Only what passes the published contract leaves the server. */
  const valid = <T>(schema: { safeParse: (v: unknown) => { success: boolean } }, list: T[]): T[] => list.filter((x) => schema.safeParse(x).success)

  /**
   * ISBN fallback when the search index has no match (new or recently edited records): the
   * edition's own record, its work and its authors' names.
   */
  async function byIsbn(isbn13: string): Promise<BookResult[]> {
    let ed: EditionRecord | null
    try {
      ed = parseEdition(await getJson("openlibrary", isbnUrl(isbn13)))
    } catch (e) {
      if (e instanceof ServiceError && e.code === "not_found") return []
      throw e
    }
    if (!ed) return []
    let w: WorkRecord | null = null
    if (ed.workId) w = await work(ed.workId).catch((e) => (e instanceof ServiceError && e.code === "not_found" ? null : Promise.reject(e)))
    const ids = (ed.authorIds.length ? ed.authorIds : (w?.authorIds ?? [])).slice(0, MAX_AUTHORS)
    const names: string[] = []
    for (const id of ids) {
      const n = await author(id).catch(() => null)
      if (n) names.push(n)
    }
    const book = bookFromRecords(w, ed, names)
    return book ? [book] : []
  }

  return {
    async searchBooks(p: BookSearchParams): Promise<BookResult[]> {
      const list = parseSearch(await getJson("openlibrary", searchUrl(p.by, p.q, p.lang))) ?? malformed("openlibrary")
      const found = list.length === 0 && p.by === "isbn" ? await byIsbn(p.q) : list
      return valid(bookResultSchema, rankBooks(found, p.q, p.by === "isbn" ? p.q : null))
    },

    /** A work with one of its editions: description, topic suggestions and the edition's data. */
    async bookDetail(p: { work: string; edition?: string }): Promise<BookResult> {
      const [w, ed] = await Promise.all([work(p.work), p.edition ? edition(p.edition) : Promise.resolve(null)])
      // An edition of another work is not this book.
      if (ed && ed.workId !== null && ed.workId !== w.workId) throw new ServiceError("not_found")
      const book = bookFromRecords(w, ed, null)
      if (!book || !bookResultSchema.safeParse(book).success) return malformed("openlibrary")
      return book
    },

    /** Editions of a work (first 20 that Open Library lists), the preferred language first. */
    async bookEditions(p: { work: string; lang: PreferredLanguage }): Promise<BookResult[]> {
      const eds = await cached(`ol:editions:${p.work}`, TTL.record, async () => parseEditions(await getJson("openlibrary", editionsUrl(p.work))) ?? malformed("openlibrary"))
      const books = eds
        .map((e) => bookFromRecords(null, { ...e, workId: e.workId ?? p.work }, null))
        .filter((b): b is BookResult => b !== null && b.workId === p.work)
        .map((b, i) => ({ b, i, k: (b.language === p.lang ? 2 : 0) + (b.isbn13 ? 1 : 0) }))
        .sort((x, y) => y.k - x.k || (y.b.year ?? 0) - (x.b.year ?? 0) || x.i - y.i)
        .map((x) => x.b)
      return valid(bookResultSchema, books)
    },

    async searchShows(p: { q: string }): Promise<ShowResult[]> {
      const parsed = parseShows(await getJson("itunes", showsUrl(p.q))) ?? malformed("itunes")
      return valid(showResultSchema, dedupeShows(parsed))
    },

    /**
     * Episodes of a show: the most recent (Apple gives at most 200). With `q`, those that match
     * plus Apple's episode search for older ones; if that second call fails, the matches among
     * the recent ones are still returned.
     */
    async showEpisodes(p: { show: string; q?: string }): Promise<EpisodeList> {
      const lookup = await cached(`it:lookup:${p.show}`, TTL.episodes, async () => parseLookup(await getJson("itunes", episodesUrl(p.show)), p.show) ?? malformed("itunes"))
      if (!lookup.show && lookup.episodes.length === 0) throw new ServiceError("not_found")
      const show = lookup.show && showResultSchema.safeParse(lookup.show).success ? lookup.show : null
      const total = show?.episodeCount ?? null
      const recent = valid(episodeResultSchema, lookup.episodes)
      if (!p.q) return { show, episodes: recent, scope: "recent", total, complete: total !== null && recent.length >= total }
      let older: EpisodeResult[] = []
      try {
        const term = `${show?.title ?? ""} ${p.q}`.trim().slice(0, LIMITS.title)
        older = (parseEpisodeSearch(await getJson("itunes", episodeSearchUrl(term))) ?? []).filter((e) => e.showId === p.show)
      } catch (e) {
        if (!(e instanceof ServiceError)) throw e
      }
      const episodes = valid(episodeResultSchema, mergeEpisodes(filterEpisodes(recent, p.q), older))
      return { show, episodes, scope: "search", total, complete: false }
    },
  }
}

export type MetadataService = ReturnType<typeof createMetadataService>
