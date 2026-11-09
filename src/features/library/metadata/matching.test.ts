import { describe, expect, it } from "vitest"
import { createItem, createShow, type Ctx } from "@/features/knowledge/domain/ops"
import { emptyKnowledge, type KnowledgeState } from "@/features/knowledge/domain/types"
import { itemSchema, showSchema } from "@/features/knowledge/domain/validation"
import { itemFields, rowToItem, rowToShow, showFields, type WireRow } from "@/features/sync/domain/library-wire"
import { canUseExternalRef, existingShow, findBookMatches, findEpisodeMatches, findShowMatches, titleKey } from "./duplicates"
import { parseLookup, parseShows } from "./itunes"
import { bookFromRecords, parseEdition, parseSearch, parseWork } from "./openlibrary"
import { detectIsbn, PARAMS, queryKey } from "./query"
import { dedupeShows, filterEpisodes, mergeEpisodes, rankBooks } from "./rank"
import { toBookInput, toEpisodeInput, toShowInput } from "./to-input"
import type { BookResult } from "./types"
import olEditionHabitos from "./__fixtures__/ol-edition-habitos.json"
import olIsbnEs from "./__fixtures__/ol-search-isbn-es.json"
import olTitleEn from "./__fixtures__/ol-search-title-en.json"
import olTitleEs from "./__fixtures__/ol-search-title-es.json"
import olWorkAtomic from "./__fixtures__/ol-work-atomic.json"
import itLookup from "./__fixtures__/itunes-lookup-laruina.json"
import itShowsEs from "./__fixtures__/itunes-shows-es.json"

const ctx: Ctx = { now: "2026-10-31T10:00:00.000Z", today: "2026-10-31" }

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify((r as unknown as { error: unknown }).error))
  return r as Extract<T, { ok: true }>
}

const params = (o: Record<string, string>) => new URLSearchParams(o)

describe("request parameters", () => {
  it("a valid ISBN, typed in any form, is searched as an exact ISBN-13", () => {
    expect(detectIsbn("978-84-17860-79-0")).toBe("9788417860790")
    expect(detectIsbn("84 17860 79 7")).toBe("9788417860790")
    expect(detectIsbn("9788417860791")).toBeNull()
    const p = PARAMS.bookSearch(params({ q: "84-17860-79-7" }))
    expect(p.success && p.data).toEqual({ by: "isbn", q: "9788417860790", lang: "es" })
  })

  it("type, length and format are checked; unknown or repeated values cannot sneak in", () => {
    expect(PARAMS.bookSearch(params({ q: "a" })).success).toBe(false)
    expect(PARAMS.bookSearch(params({ q: "x".repeat(201) })).success).toBe(false)
    expect(PARAMS.bookSearch(params({ q: "dune", by: "isbn" })).success).toBe(false)
    expect(PARAMS.bookSearch(params({ q: "dune", by: "url" })).success).toBe(false)
    expect(PARAMS.bookSearch(params({ q: "dune", lang: "fr" })).success).toBe(false)
    const long = PARAMS.bookSearch(params({ q: "palabra ".repeat(20) }))
    expect(long.success && long.data.q.length).toBeLessThanOrEqual(100)
    expect(PARAMS.bookWork(params({ work: "OL1W", edition: "OL2M" })).success).toBe(true)
    expect(PARAMS.bookWork(params({ work: "https://evil.example" })).success).toBe(false)
    expect(PARAMS.bookWork(params({ work: "OL1M" })).success).toBe(false)
    expect(PARAMS.showEpisodes(params({ show: "1455818214", q: "ignatius" })).success).toBe(true)
    expect(PARAMS.showEpisodes(params({ show: "127.0.0.1" })).success).toBe(false)
    const twice = new URLSearchParams("show=1&show=2")
    expect(PARAMS.showEpisodes(twice).success && PARAMS.showEpisodes(twice)).toMatchObject({ data: { show: "1" } })
  })

  it("query keys are stable across accents, case and spaces", () => {
    expect(queryKey("  Cien  AÑOS ")).toBe(queryKey("cien años"))
    expect(queryKey("cien anos")).toBe(queryKey("Cien Años"))
  })
})

describe("ranking", () => {
  it("companion books go below the real one; an exact ISBN goes first", () => {
    const en = parseSearch(olTitleEn)!
    const ranked = rankBooks([...en].reverse(), "atomic habits", null)
    expect(ranked[0].workId).toBe("OL17930368W")
    const noise = ranked.findIndex((b) => /journal|workbook|summary/i.test(b.title))
    expect(noise).toBeGreaterThan(0)
    // Asking for a summary keeps summaries where the provider put them.
    expect(rankBooks(en, "summary of atomic habits", null).length).toBe(en.length)
    const isbn = parseSearch(olIsbnEs)!
    expect(rankBooks([...en, ...isbn], "9788417860790", "9788417860790")[0].isbn13).toBe("9788417860790")
  })

  it("no book is dropped or merged by ranking", () => {
    const es = parseSearch(olTitleEs)!
    expect(rankBooks(es, "cien años de soledad", null)).toHaveLength(es.length)
  })

  it("episodes: filter by every word, union without repeats, newest first", () => {
    const { episodes } = parseLookup(itLookup, "1455818214")!
    expect(filterEpisodes(episodes, "petite lorena").map((e) => e.id)).toEqual(["1000798560432"])
    expect(filterEpisodes(episodes, "")).toHaveLength(episodes.length)
    const merged = mergeEpisodes(episodes.slice(0, 2), episodes.slice(1, 3))
    expect(merged.map((e) => e.id)).toEqual(episodes.slice(0, 3).map((e) => e.id))
  })
})

describe("duplicates (D5: exact may block the same reference, probable only warns)", () => {
  const es = parseSearch(olIsbnEs)![0]
  const another = parseSearch(olTitleEs)![0]

  function withBook(r: BookResult, id = "b1", choices = {}) {
    return ok(createItem(emptyKnowledge(), "book", id, toBookInput(r, choices), ctx)).state
  }

  it("same work: exact; the same reference cannot be saved twice (ops.ts refuses it too)", () => {
    const st = withBook(es)
    const m = findBookMatches(st, es)
    expect(m).toEqual([{ id: "b1", level: "exact", reason: "external_id" }])
    expect(canUseExternalRef(m)).toBe(false)
    const again = createItem(st, "book", "b2", toBookInput(es), ctx)
    expect(again.ok).toBe(false)
  })

  it("another edition of the same work can still be saved, without the external reference", () => {
    const st = withBook(es)
    const translation = bookFromRecords(parseWork(olWorkAtomic), parseEdition(olEditionHabitos), ["James Clear"])!
    const differentWork = { ...translation, workId: es.workId }
    expect(findBookMatches(st, differentWork)[0].level).toBe("exact")
    const st2 = ok(createItem(st, "book", "b2", toBookInput(differentWork, { separateEdition: true }), ctx)).state
    expect(st2.items.b2.external).toBeNull()
    expect(Object.keys(st2.items)).toEqual(["b1", "b2"])
    // Nothing else was touched.
    expect(st2.items.b1).toBe(st.items.b1)
  })

  it("same ISBN from a manual entry: strong warning, saving is still allowed", () => {
    const st = ok(createItem(emptyKnowledge(), "book", "m1", { title: "Mi copia", book: { isbn13: "978-84-17860-79-0" } }, ctx)).state
    const m = findBookMatches(st, es)
    expect(m).toEqual([{ id: "m1", level: "strong", reason: "isbn" }])
    expect(canUseExternalRef(m)).toBe(true)
  })

  it("same title and a common author: possible; another author of the same title is not a match", () => {
    const st = ok(createItem(emptyKnowledge(), "book", "m1", { title: "Cien años de soledad: edición conmemorativa", creators: ["Gabriel García Márquez"] }, ctx)).state
    expect(findBookMatches(st, another)).toEqual([{ id: "m1", level: "possible", reason: "title_creator" }])
    expect(findBookMatches(st, { ...another, creators: ["Josefina Ludmer"] })).toEqual([])
    expect(titleKey("Sapiens: De animales a dioses")).toBe("sapiens")
  })

  it("episodes: the same Apple episode is exact; same title in the same show is possible", () => {
    const { show, episodes } = parseLookup(itLookup, "1455818214")!
    let st: KnowledgeState = ok(createShow(emptyKnowledge(), "s1", toShowInput(show!), ctx)).state
    st = ok(createItem(st, "episode", "e1", toEpisodeInput(episodes[0], "s1", "Europe/Madrid"), ctx)).state
    expect(findEpisodeMatches(st, { id: episodes[0].id, localShowId: "s1", title: episodes[0].title })[0]).toEqual({ id: "e1", level: "exact", reason: "external_id" })
    expect(findEpisodeMatches(st, { id: "999", localShowId: "s1", title: episodes[0].title })).toEqual([{ id: "e1", level: "possible", reason: "title_show" }])
    expect(findEpisodeMatches(st, { id: episodes[1].id, localShowId: "s1", title: episodes[1].title })).toEqual([])
    // M4g.4: the same title in another show is another episode, not a duplicate.
    expect(findEpisodeMatches(st, { id: "998", localShowId: "s2", title: episodes[0].title })).toEqual([])
    expect(findEpisodeMatches(st, { id: "997", localShowId: null, title: episodes[0].title })).toEqual([])
  })

  it("shows: reused by Apple id; a manual show with the same name is a possible match", () => {
    const shows = dedupeShows(parseShows(itShowsEs)!)
    const etm = shows.find((s) => s.title === "Entiende Tu Mente")!
    let st = ok(createShow(emptyKnowledge(), "s1", toShowInput(etm), ctx)).state
    expect(existingShow(st, etm.id)?.id).toBe("s1")
    expect(findShowMatches(st, etm)[0]).toEqual({ id: "s1", level: "exact", reason: "external_id" })
    st = ok(createShow(emptyKnowledge(), "m1", { title: "entiende tu mente" }, ctx)).state
    expect(existingShow(st, etm.id)).toBeNull()
    expect(findShowMatches(st, etm)).toEqual([{ id: "m1", level: "possible", reason: "title_publisher" }])
  })
})

describe("compatibility with M4 (ops, validation, sync wire)", () => {
  const row = (id: string, fields: Record<string, unknown>, extra: Record<string, unknown>): WireRow => ({ id, server_seq: 1, deleted: false, ...fields, ...extra })

  it("every recorded result becomes a valid book through the normal create operation", () => {
    for (const r of [...parseSearch(olTitleEs)!, ...parseSearch(olTitleEn)!, ...parseSearch(olIsbnEs)!]) {
      const st = ok(createItem(emptyKnowledge(), "book", "b", toBookInput(r, { status: "active", rating: 8 }), ctx)).state
      const item = st.items.b
      expect(itemSchema.safeParse(item).success).toBe(true)
      expect(item).toMatchObject({ status: "active", rating: 8, startedOn: "2026-10-31", topics: [] })
      // The sync wire carries it unchanged (cover, external reference and attribution included).
      expect(rowToItem(row(item.id, itemFields(item), { kind: item.kind, created_at: item.createdAt, updated_at: item.updatedAt }))).toEqual(item)
    }
  })

  it("shows and episodes too; the episode's date is the local date of the profile's zone", () => {
    const { show, episodes } = parseLookup(itLookup, "1455818214")!
    const st = ok(createShow(emptyKnowledge(), "s1", toShowInput(show!, { topics: ["Comedia"] }), ctx)).state
    expect(showSchema.safeParse(st.shows.s1).success).toBe(true)
    expect(rowToShow(row("s1", showFields(st.shows.s1), { created_at: st.shows.s1.createdAt, updated_at: st.shows.s1.updatedAt }))).toEqual(st.shows.s1)
    const late = { ...episodes[0], publishedAt: "2026-10-28T23:30:00.000Z" }
    const madrid = ok(createItem(st, "episode", "e1", toEpisodeInput(late, "s1", "Europe/Madrid"), ctx)).state.items.e1
    const ny = ok(createItem(st, "episode", "e1", toEpisodeInput(late, "s1", "America/New_York"), ctx)).state.items.e1
    expect(madrid.kind === "episode" && madrid.episode.publishedOn).toBe("2026-10-29")
    expect(ny.kind === "episode" && ny.episode.publishedOn).toBe("2026-10-28")
    expect(madrid).toMatchObject({ external: { provider: "itunes", id: episodes[0].id, attribution: "Datos: Apple Podcasts" }, episode: { platform: "apple", durationSeconds: 4596, showId: "s1" } })
  })

  it("the user's choices win: description can be left out and only picked topics are saved (D6, D7)", () => {
    const b = bookFromRecords(parseWork(olWorkAtomic), parseEdition(olEditionHabitos), ["James Clear"])!
    expect(b.topicSuggestions.length).toBeGreaterThan(0)
    const input = toBookInput(b, { keepDescription: false, topics: ["Hábitos"] })
    expect(input).toMatchObject({ description: null, topics: ["Hábitos"], creators: ["James Clear"] })
    // Detail answers carry no names (null): the search result's names are used.
    expect(toBookInput({ ...b, creators: null }, { creators: ["James Clear"] }).creators).toEqual(["James Clear"])
  })
})
