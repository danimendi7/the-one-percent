import { describe, expect, it } from "vitest"
import { episodesUrl, episodeSearchUrl, parseEpisodeSearch, parseLookup, parseShows, showsUrl } from "./itunes"
import { bookFromRecords, editionUrl, isbnUrl, parseEdition, parseEditions, parseSearch, parseWork, searchUrl, workUrl } from "./openlibrary"
import { dedupeShows } from "./rank"
import { bookResultSchema, episodeResultSchema, showResultSchema } from "./types"
import olAuthorEs from "./__fixtures__/ol-search-author-es.json"
import olEditionHabitos from "./__fixtures__/ol-edition-habitos.json"
import olEditionSiruela from "./__fixtures__/ol-edition-siruela.json"
import olEditions from "./__fixtures__/ol-editions-infinito.json"
import olIsbnEn from "./__fixtures__/ol-search-isbn-en.json"
import olIsbnEs from "./__fixtures__/ol-search-isbn-es.json"
import olTitleEn from "./__fixtures__/ol-search-title-en.json"
import olTitleEs from "./__fixtures__/ol-search-title-es.json"
import olWorkAtomic from "./__fixtures__/ol-work-atomic.json"
import olWorkInfinito from "./__fixtures__/ol-work-infinito.json"
import olWorkOutlive from "./__fixtures__/ol-work-outlive.json"
import itEpisodeSearch from "./__fixtures__/itunes-episodes-search.json"
import itLookup from "./__fixtures__/itunes-lookup-laruina.json"
import itShowsEn from "./__fixtures__/itunes-shows-en.json"
import itShowsEs from "./__fixtures__/itunes-shows-es.json"

/** Recorded on 31/10/2026 from the public APIs (catalogue data only, trimmed). No test calls the network. */
const valid = (schema: { safeParse: (v: unknown) => { success: boolean } }, xs: unknown[]) => xs.every((x) => schema.safeParse(x).success)

describe("Open Library", () => {
  it("builds URLs only from validated identifiers, on its own origin", () => {
    expect(searchUrl("title", "cien años", "es")).toMatch(/^https:\/\/openlibrary\.org\/search\.json\?title=cien\+a%C3%B1os&limit=10&lang=es&fields=/)
    expect(workUrl("OL20770492W")).toBe("https://openlibrary.org/works/OL20770492W.json")
    expect(() => workUrl("../../admin")).toThrow()
    expect(() => editionUrl("OL1W")).toThrow()
    expect(() => isbnUrl("9788417860791x")).toThrow()
    // A query cannot change the host or path: it is only ever a parameter value.
    expect(new URL(searchUrl("any", "x&fields=*#@evil.example/", "en")).host).toBe("openlibrary.org")
  })

  it("Spanish title search: work and edition kept apart, nothing invented", () => {
    const r = parseSearch(olTitleEs)!
    expect(valid(bookResultSchema, r)).toBe(true)
    const garcia = r[0]
    expect(garcia).toMatchObject({ workId: "OL274505W", editionId: "OL38570141M", title: "Cien años de soledad", creators: ["Gabriel García Márquez"], firstPublishedYear: 1967, isbn13: "9786070714863", isbn10: "6070714865", sourceUrl: "https://openlibrary.org/books/OL38570141M", attribution: "Datos: Open Library" })
    // The search index has no description and no per-edition page count: left null, not guessed.
    expect(garcia.description).toBeNull()
    expect(garcia.pageCount).toBeNull()
    // Works without cover or ISBN stay results, with nulls.
    const bare = r.find((b) => b.workId === "OL43144891W")!
    expect(bare).toMatchObject({ cover: null, isbn13: null, isbn10: null })
  })

  it("English title search and author search", () => {
    const en = parseSearch(olTitleEn)!
    expect(valid(bookResultSchema, en)).toBe(true)
    expect(en[0].workId).toBe("OL17930368W")
    expect(en[0].creators).toEqual(["James Clear"])
    const byAuthor = parseSearch(olAuthorEs)!
    expect(byAuthor.every((b) => b.creators?.includes("Irene Vallejo"))).toBe(true)
  })

  it("ISBN search returns the edition with that ISBN (Spanish and English)", () => {
    const es = parseSearch(olIsbnEs)!
    expect(es[0]).toMatchObject({ workId: "OL20770492W", editionId: "OL28108908M", publisher: "Siruela", year: 2020, language: "es", isbn13: "9788417860790", cover: "https://covers.openlibrary.org/b/id/9689877-L.jpg" })
    const en = parseSearch(olIsbnEn)!
    expect(en.map((b) => b.isbn13)).toEqual(["9780735211292", "9780735211292"])
    expect(en[0].language).toBe("en")
  })

  it("work and edition records: description string or object, `-1` covers, free-text dates", () => {
    const w = parseWork(olWorkInfinito)!
    expect(w.description!.length).toBeGreaterThan(100)
    expect(w.topicSuggestions.length).toBeGreaterThan(0)
    expect(parseWork({ ...olWorkAtomic, description: { type: "/type/text", value: "Texto <b>largo</b>" } })!.description).toBe("Texto largo")
    expect(parseWork(olWorkOutlive)!.description).toBeNull()
    const siruela = parseEdition(olEditionSiruela)!
    expect(siruela).toMatchObject({ editionId: "OL28108908M", workId: "OL20770492W", pageCount: 452, publisher: "Siruela", year: 2020, language: "es", cover: "https://covers.openlibrary.org/b/id/9689877-L.jpg" })
    expect(parseEdition(olEditionHabitos)!.year).toBe(2024)
  })

  it("a translation keeps its own title and the work's description; the edition's data wins", () => {
    const b = bookFromRecords(parseWork(olWorkAtomic), parseEdition(olEditionHabitos), null)!
    expect(b).toMatchObject({ workId: "OL17930368W", editionId: "OL51155019M", title: "Hábitos Atómicos", workTitle: "Atomic Habits", creators: null, language: "es", publisher: "Ediciones Paidós" })
    expect(bookResultSchema.safeParse(b).success).toBe(true)
  })

  it("editions of a work are separate results, never merged", () => {
    const eds = parseEditions(olEditions)!
    expect(eds.length).toBe(5)
    expect(new Set(eds.map((e) => e.editionId)).size).toBe(5)
  })

  it("malformed answers: wrong shape is null, broken documents are skipped one by one", () => {
    expect(parseSearch({ nope: 1 })).toBeNull()
    expect(parseSearch("<html>")).toBeNull()
    const r = parseSearch({ docs: [null, 7, { key: 5 }, { key: "/works/OL1W" }, { key: "/works/../x", title: "X" }, { key: "/works/OL2W", title: "Bien", author_name: "no es lista", editions: { docs: [{ key: "/books/OL3M", title: ["x"], isbn: [123] }] } }] })!
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ workId: "OL2W", editionId: "OL3M", title: "Bien", creators: [], isbn13: null })
    expect(parseWork({ key: "/works/OL1W" })).toBeNull()
    expect(parseEdition([])).toBeNull()
    expect(parseEditions({ entries: "x" })).toBeNull()
  })
})

describe("Apple Podcasts", () => {
  it("builds URLs only from validated values, on its own origin", () => {
    expect(showsUrl("la ruina")).toBe("https://itunes.apple.com/search?term=la+ruina&media=podcast&entity=podcast&limit=10&country=ES")
    expect(episodesUrl("1455818214")).toBe("https://itunes.apple.com/lookup?id=1455818214&entity=podcastEpisode&limit=200&country=ES")
    expect(() => episodesUrl("1&entity=x")).toThrow()
    expect(new URL(episodeSearchUrl("a#b@evil.example")).host).toBe("itunes.apple.com")
  })

  it("Spanish shows: Apple's duplicate of the same show is shown once", () => {
    const parsed = parseShows(itShowsEs)!
    const shows = dedupeShows(parsed)
    expect(valid(showResultSchema, shows)).toBe(true)
    const etm = shows.filter((s) => s.title === "Entiende Tu Mente")
    expect(parsed.filter((p) => p.show.title === "Entiende Tu Mente")).toHaveLength(2)
    expect(etm).toHaveLength(1)
    expect(etm[0]).toMatchObject({ id: "1229124446", publisher: "Molo Cebrián", attribution: "Datos: Apple Podcasts" })
    expect(etm[0].cover).toMatch(/600x600bb\.jpg$/)
    expect(etm[0].topicSuggestions).not.toContain("Podcasts")
  })

  it("English show", () => {
    const [h] = dedupeShows(parseShows(itShowsEn)!)
    expect(h).toMatchObject({ id: "1545953110", title: "Huberman Lab", publisher: "Scicomm Media" })
  })

  it("lookup: the show and its episodes with duration, instant, description and link", () => {
    const { show, episodes } = parseLookup(itLookup, "1455818214")!
    expect(show).toMatchObject({ id: "1455818214", title: "La Ruina" })
    expect(episodes).toHaveLength(5)
    expect(valid(episodeResultSchema, episodes)).toBe(true)
    expect(episodes[0]).toMatchObject({ id: "1000798560432", showId: "1455818214", showTitle: "La Ruina", title: "331. La Ruina (con Petite Lorena)", durationSeconds: 4596, publishedAt: "2026-10-28T17:00:00.000Z" })
    expect(episodes[0].sourceUrl).toBe("https://podcasts.apple.com/es/podcast/331-la-ruina-con-petite-lorena/id1455818214?i=1000798560432")
    expect(episodes[0].description!.length).toBeLessThanOrEqual(2000)
    // Episodes of another show in the same answer are not this show's.
    expect(parseLookup(itLookup, "1")!.episodes).toEqual([])
  })

  it("episode search spans shows: the caller filters by show", () => {
    const eps = parseEpisodeSearch(itEpisodeSearch)!
    expect(eps.length).toBeGreaterThan(1)
    expect(eps.filter((e) => e.showId === "1455818214").map((e) => e.title)).toEqual(["89. La Ruina (con Ignatius Farray)"])
  })

  it("malformed answers", () => {
    expect(parseShows({ results: "x" })).toBeNull()
    expect(parseLookup(null, "1")).toBeNull()
    const eps = parseEpisodeSearch({ results: [{ wrapperType: "podcastEpisode", trackId: "1", collectionId: 2, trackName: "x" }, { wrapperType: "podcastEpisode", trackId: 3, collectionId: 2, trackName: "Bien", trackTimeMillis: -5, releaseDate: "ayer", artworkUrl600: "javascript:x" }] })!
    expect(eps).toEqual([expect.objectContaining({ id: "3", durationSeconds: null, publishedAt: null, cover: null, sourceUrl: null })])
  })
})
