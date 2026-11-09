import { describe, expect, it } from "vitest"
import { CircuitBreaker, InFlight, KeyedLimiter, Spacer, TokenBucket, TtlCache } from "./limits"
import { createMetadataService, ServiceError, TTL, type ServiceDeps } from "./service"
import { UpstreamError } from "./safe-fetch"
import olEditionSiruela from "../__fixtures__/ol-edition-siruela.json"
import olIsbnEs from "../__fixtures__/ol-search-isbn-es.json"
import olTitleEs from "../__fixtures__/ol-search-title-es.json"
import olWorkInfinito from "../__fixtures__/ol-work-infinito.json"
import olEditions from "../__fixtures__/ol-editions-infinito.json"
import itLookup from "../__fixtures__/itunes-lookup-laruina.json"
import itEpisodeSearch from "../__fixtures__/itunes-episodes-search.json"
import itShowsEs from "../__fixtures__/itunes-shows-es.json"

describe("limits", () => {
  it("token bucket: burst, then refill per minute", () => {
    let t = 0
    const b = new TokenBucket(2, 60, () => t)
    expect(b.take().ok).toBe(true)
    expect(b.take().ok).toBe(true)
    expect(b.take()).toEqual({ ok: false, retryAfterMs: 1000 })
    t = 1000
    expect(b.take().ok).toBe(true)
  })

  it("keyed limiter: one user's quota never touches another's; keys are bounded", () => {
    const l = new KeyedLimiter(1, 1, () => 0, 2)
    expect(l.take("a").ok).toBe(true)
    expect(l.take("a").ok).toBe(false)
    expect(l.take("b").ok).toBe(true)
    l.take("c")
    // «a» was evicted (least recently used), never shared.
    expect(l.take("a").ok).toBe(true)
  })

  it("spacer: one call per interval, refused beyond the maximum wait (concurrent callers get distinct slots)", () => {
    const s = new Spacer(1000, 2500, () => 0)
    expect([s.reserve(), s.reserve(), s.reserve(), s.reserve()]).toEqual([
      { ok: true, waitMs: 0 },
      { ok: true, waitMs: 1000 },
      { ok: true, waitMs: 2000 },
      { ok: false, retryAfterMs: 3000 },
    ])
  })

  it("breaker: opens on refusal (Retry-After, capped) or repeated failures; success closes it", () => {
    let t = 0
    const b = new CircuitBreaker(() => t, 3, 120_000)
    b.refused(30)
    expect(b.blockedFor()).toBe(30_000)
    b.refused(99_999)
    expect(b.blockedFor()).toBe(300_000)
    b.success()
    b.failure()
    b.failure()
    expect(b.blockedFor()).toBe(0)
    b.failure()
    expect(b.blockedFor()).toBe(120_000)
    t = 120_000
    expect(b.blockedFor()).toBe(0)
  })

  it("in-flight: identical concurrent calls share one request", async () => {
    const f = new InFlight<number>()
    let n = 0
    const run = () => f.run("k", async () => ++n)
    expect(await Promise.all([run(), run(), run()])).toEqual([1, 1, 1])
    expect(await run()).toBe(2)
  })

  it("cache: expiry, entry and total limits, least recently used out", () => {
    let t = 0
    const c = new TtlCache<string>(() => t, 2, 1_000, 100)
    c.set("a", "1", 10)
    c.set("b", "2", 10)
    c.get("a")
    c.set("c", "3", 10)
    expect([c.get("a"), c.get("b"), c.get("c")]).toEqual(["1", undefined, "3"])
    c.set("big", "x".repeat(200), 10)
    expect(c.get("big")).toBeUndefined()
    t = 10
    expect(c.get("a")).toBeUndefined()
  })
})

// ---------- service against recorded answers ----------

type Reply = { status?: number; json?: unknown; headers?: Record<string, string>; throws?: UpstreamError }

function harness(routes: Record<string, Reply | Reply[]>) {
  let t = 0
  const calls: string[] = []
  const sleeps: number[] = []
  const deps: ServiceDeps = {
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms)
      t += ms
    },
    random: () => 0.5,
    fetch: {
      lookup: async () => ["93.184.216.34"],
      fetch: async (input) => {
        const url = String(input)
        calls.push(url)
        const key = Object.keys(routes).find((k) => url.startsWith(k))
        const r = key ? routes[key] : undefined
        const reply = Array.isArray(r) ? (r.length > 1 ? r.shift()! : r[0]) : r
        if (!reply) throw new TypeError("fetch failed")
        if (reply.throws) throw reply.throws
        const type = url.startsWith("https://itunes") ? "text/javascript; charset=utf-8" : "application/json"
        return new Response(JSON.stringify(reply.json ?? {}), { status: reply.status ?? 200, headers: { "content-type": type, ...reply.headers } })
      },
    },
  }
  return { service: createMetadataService(deps), calls, sleeps, advance: (ms: number) => (t += ms) }
}

const OL_SEARCH = "https://openlibrary.org/search.json"
const code = async (p: Promise<unknown>) => {
  try {
    await p
    return "ok"
  } catch (e) {
    return e instanceof ServiceError ? `${e.code}${e.retryAfter !== undefined ? ` ${e.retryAfter}` : ""}` : String(e)
  }
}

describe("metadata service", () => {
  it("book search: ranked, valid results; free-text searches are not cached on the server", async () => {
    const h = harness({ [OL_SEARCH]: { json: olTitleEs } })
    const r = await h.service.searchBooks({ by: "title", q: "cien años de soledad", lang: "es" })
    expect(r[0].workId).toBe("OL274505W")
    await h.service.searchBooks({ by: "title", q: "cien años de soledad", lang: "es" })
    expect(h.calls).toHaveLength(2)
  })

  it("Open Library is called at most once per second (conservative limit, D-UA)", async () => {
    const h = harness({ [OL_SEARCH]: { json: olTitleEs } })
    await h.service.searchBooks({ by: "any", q: "uno", lang: "es" })
    await h.service.searchBooks({ by: "any", q: "dos", lang: "es" })
    expect(h.sleeps).toEqual([1000])
  })

  it("ISBN not in the search index: falls back to the edition record, its work and author names", async () => {
    const h = harness({
      [OL_SEARCH]: { json: { numFound: 0, docs: [] } },
      "https://openlibrary.org/isbn/9788417860790.json": { status: 302, headers: { location: "/books/OL28108908M.json" } },
      "https://openlibrary.org/books/OL28108908M.json": { json: olEditionSiruela },
      "https://openlibrary.org/works/OL20770492W.json": { json: olWorkInfinito },
      "https://openlibrary.org/authors/OL5980983A.json": { json: { name: "Irene Vallejo" } },
    })
    const [b] = await h.service.searchBooks({ by: "isbn", q: "9788417860790", lang: "es" })
    expect(b).toMatchObject({ workId: "OL20770492W", editionId: "OL28108908M", creators: ["Irene Vallejo"], isbn13: "9788417860790", pageCount: 452, publisher: "Siruela" })
    expect(b.description).not.toBeNull()
  })

  it("an ISBN nobody knows is an empty list, not an error", async () => {
    const h = harness({ [OL_SEARCH]: { json: { docs: [] } }, "https://openlibrary.org/isbn/": { status: 404 } })
    expect(await h.service.searchBooks({ by: "isbn", q: "9780000000002", lang: "es" })).toEqual([])
  })

  it("detail: work + edition, cached by id for 24 h; an edition of another work is refused", async () => {
    const h = harness({
      "https://openlibrary.org/works/OL20770492W.json": { json: olWorkInfinito },
      "https://openlibrary.org/books/OL28108908M.json": { json: olEditionSiruela },
      "https://openlibrary.org/works/OL1W.json": { json: { ...olWorkInfinito, key: "/works/OL1W" } },
    })
    const b = await h.service.bookDetail({ work: "OL20770492W", edition: "OL28108908M" })
    expect(b).toMatchObject({ title: "El infinito en un junco", creators: null, pageCount: 452 })
    await h.service.bookDetail({ work: "OL20770492W", edition: "OL28108908M" })
    expect(h.calls).toHaveLength(2)
    h.advance(TTL.record)
    await h.service.bookDetail({ work: "OL20770492W" })
    expect(h.calls).toHaveLength(3)
    expect(await code(h.service.bookDetail({ work: "OL1W", edition: "OL28108908M" }))).toBe("not_found")
  })

  it("editions: separate results, the preferred language first", async () => {
    const h = harness({ "https://openlibrary.org/works/OL20770492W/editions.json": { json: olEditions } })
    const es = await h.service.bookEditions({ work: "OL20770492W", lang: "es" })
    expect(es.length).toBe(5)
    expect(es[0].language).toBe("es")
    expect(new Set(es.map((e) => e.editionId)).size).toBe(5)
  })

  it("a missing work is not_found and does not count as a provider failure", async () => {
    const h = harness({ "https://openlibrary.org/works/": { status: 404 }, [OL_SEARCH]: { json: olTitleEs } })
    for (let i = 0; i < 5; i++) expect(await code(h.service.bookDetail({ work: "OL9W" }))).toBe("not_found")
    expect(await code(h.service.searchBooks({ by: "any", q: "x y", lang: "es" }))).toBe("ok")
  })

  it("429: no retry, provider paused for its Retry-After, answered at once meanwhile", async () => {
    const h = harness({ [OL_SEARCH]: { status: 429, headers: { "retry-after": "20" } } })
    expect(await code(h.service.searchBooks({ by: "any", q: "uno", lang: "es" }))).toBe("provider_busy 20")
    expect(await code(h.service.searchBooks({ by: "any", q: "dos", lang: "es" }))).toMatch(/^provider_unavailable \d+$/)
    expect(h.calls).toHaveLength(1)
  })

  it("5xx: one retry after a short random wait; repeated failures open the breaker (no retry storm)", async () => {
    const h = harness({ [OL_SEARCH]: [{ status: 503 }, { json: olIsbnEs }] })
    expect((await h.service.searchBooks({ by: "any", q: "x y", lang: "es" }))[0].isbn13).toBe("9788417860790")
    expect(h.sleeps).toContain(450)
    const down = harness({ [OL_SEARCH]: { status: 500 } })
    expect(await code(down.service.searchBooks({ by: "any", q: "a b", lang: "es" }))).toBe("provider_unavailable")
    expect(await code(down.service.searchBooks({ by: "any", q: "c d", lang: "es" }))).toMatch(/^provider_unavailable \d+$/)
    const before = down.calls.length
    for (let i = 0; i < 10; i++) await code(down.service.searchBooks({ by: "any", q: `q${i} x`, lang: "es" }))
    expect(down.calls.length).toBe(before)
    expect(before).toBe(3)
  })

  it("timeouts and malformed answers are provider failures, without retry", async () => {
    const slow = harness({ [OL_SEARCH]: { throws: new UpstreamError("timeout") } })
    expect(await code(slow.service.searchBooks({ by: "any", q: "a b", lang: "es" }))).toBe("provider_unavailable")
    expect(slow.calls).toHaveLength(1)
    const junk = harness({ [OL_SEARCH]: { json: { unexpected: true } } })
    expect(await code(junk.service.searchBooks({ by: "any", q: "a b", lang: "es" }))).toBe("provider_unavailable")
    const html = harness({ [OL_SEARCH]: { json: "<html>" } })
    expect(await code(html.service.searchBooks({ by: "any", q: "a b", lang: "es" }))).toBe("provider_unavailable")
  })

  it("Apple down does not affect Open Library (separate breakers)", async () => {
    const h = harness({ "https://itunes.apple.com/search": { status: 503 }, [OL_SEARCH]: { json: olTitleEs } })
    for (let i = 0; i < 3; i++) await code(h.service.searchShows({ q: `show ${i}` }))
    expect(await code(h.service.searchShows({ q: "otra" }))).toMatch(/^provider_unavailable/)
    expect(await code(h.service.searchBooks({ by: "any", q: "x y", lang: "es" }))).toBe("ok")
  })

  it("Apple quota: about 18 a minute with a small burst, then provider_busy", async () => {
    const h = harness({ "https://itunes.apple.com/search": { json: itShowsEs } })
    const results = []
    for (let i = 0; i < 7; i++) results.push(await code(h.service.searchShows({ q: `q${i} x` })))
    expect(results.slice(0, 5)).toEqual(Array(5).fill("ok"))
    expect(results[5]).toMatch(/^provider_busy \d+$/)
  })

  it("shows: Apple duplicates removed", async () => {
    const h = harness({ "https://itunes.apple.com/search": { json: itShowsEs } })
    const shows = await h.service.searchShows({ q: "entiende tu mente" })
    expect(shows.filter((s) => s.title === "Entiende Tu Mente")).toHaveLength(1)
  })

  it("episodes: recent list (cached 1 h), then search reaching older episodes of that show only", async () => {
    const h = harness({ "https://itunes.apple.com/lookup": { json: itLookup }, "https://itunes.apple.com/search": { json: itEpisodeSearch } })
    const recent = await h.service.showEpisodes({ show: "1455818214" })
    expect(recent).toMatchObject({ scope: "recent", total: 356, complete: false })
    expect(recent.episodes).toHaveLength(5)
    const found = await h.service.showEpisodes({ show: "1455818214", q: "ignatius" })
    expect(found.scope).toBe("search")
    expect(found.episodes.map((e) => e.title)).toEqual(["89. La Ruina (con Ignatius Farray)"])
    expect(h.calls.filter((c) => c.includes("/lookup"))).toHaveLength(1)
    expect(h.calls.find((c) => c.includes("entity=podcastEpisode") && c.includes("/search"))).toContain("term=La+Ruina+ignatius")
  })

  it("episode search failing still returns the matches among recent episodes", async () => {
    const h = harness({ "https://itunes.apple.com/lookup": { json: itLookup }, "https://itunes.apple.com/search": { status: 429 } })
    const r = await h.service.showEpisodes({ show: "1455818214", q: "petite lorena" })
    expect(r.episodes.map((e) => e.id)).toEqual(["1000798560432"])
  })

  it("an unknown show is not_found", async () => {
    const h = harness({ "https://itunes.apple.com/lookup": { json: { resultCount: 0, results: [] } } })
    expect(await code(h.service.showEpisodes({ show: "1" }))).toBe("not_found")
  })
})
