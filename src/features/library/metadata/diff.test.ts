import { describe, expect, it } from "vitest"
import { createItem, createNote, createShow, updateItem, type BookInput, type Ctx, type EpisodeInput, type ItemPatch, type ShowInput } from "@/features/knowledge/domain/ops"
import { emptyKnowledge, type Book, type Episode, type KnowledgeState, type PodcastShow } from "@/features/knowledge/domain/types"
import { defaultSelection, diffBook, diffEpisode, diffShow, diffTarget, directLookup, editionIdOf, patchOf, staleFields, updateLabel, withDetail, type DiffField, type DiffRow } from "./diff"
import type { BookResult, EpisodeResult, ShowResult } from "./types"

const ctx: Ctx = { now: "2026-11-09T10:00:00.000Z", today: "2026-11-09" }

function withBook(input: Partial<BookInput> = {}, state: KnowledgeState = emptyKnowledge(), id = "b1"): { state: KnowledgeState; item: Book } {
  const r = createItem(state, "book", id, { title: "Mi libro", ...input }, ctx)
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return { state: r.state, item: r.item }
}

function withEpisode(input: Partial<EpisodeInput> = {}, state: KnowledgeState = emptyKnowledge(), id = "e1"): { state: KnowledgeState; item: Episode } {
  const r = createItem(state, "episode", id, { title: "Mi episodio", ...input }, ctx)
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return { state: r.state, item: r.item }
}

function withShow(input: Partial<ShowInput> = {}, state: KnowledgeState = emptyKnowledge(), id = "s1"): { state: KnowledgeState; show: PodcastShow } {
  const r = createShow(state, id, { title: "Mi programa", ...input }, ctx)
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return { state: r.state, show: r.show }
}

const book = (over: Partial<BookResult> = {}): BookResult => ({
  provider: "openlibrary",
  workId: "OL1W",
  editionId: "OL1M",
  title: "Mi libro",
  workTitle: null,
  subtitle: null,
  creators: null,
  language: null,
  year: null,
  firstPublishedYear: null,
  publisher: null,
  pageCount: null,
  isbn13: null,
  isbn10: null,
  cover: null,
  description: null,
  topicSuggestions: [],
  editionCount: null,
  sourceUrl: "https://openlibrary.org/books/OL1M",
  attribution: "Datos: Open Library",
  ...over,
})

const episode = (over: Partial<EpisodeResult> = {}): EpisodeResult => ({
  provider: "itunes",
  id: "100",
  showId: "7",
  showTitle: null,
  title: "Mi episodio",
  description: null,
  durationSeconds: null,
  publishedAt: null,
  cover: null,
  sourceUrl: null,
  attribution: "Datos: Apple Podcasts",
  ...over,
})

const show = (over: Partial<ShowResult> = {}): ShowResult => ({
  provider: "itunes",
  id: "7",
  title: "Mi programa",
  publisher: null,
  cover: null,
  sourceUrl: null,
  episodeCount: null,
  latestReleaseAt: null,
  topicSuggestions: [],
  attribution: "Datos: Apple Podcasts",
  ...over,
})

const OL_REF = { provider: "openlibrary" as const, id: "OL1W", attribution: "Datos: Open Library" }
const row = (rows: readonly DiffRow[], field: DiffField) => rows.find((r) => r.field === field)
const fields = (rows: readonly DiffRow[]) => rows.map((r) => r.field)

describe("diffBook: what is offered", () => {
  it("an empty field is offered and preselected", () => {
    const { state, item } = withBook()
    const rows = diffBook(state, item, book({ pageCount: 432 }))
    expect(row(rows, "pageCount")).toMatchObject({ kind: "fill", current: null, proposed: "432", blocked: null })
    expect(defaultSelection(rows).has("pageCount")).toBe(true)
  })

  it("a field holding another value is offered but left unselected", () => {
    const { state, item } = withBook({ book: { publisher: "Mi editorial" } })
    const rows = diffBook(state, item, book({ publisher: "Siruela" }))
    expect(row(rows, "publisher")).toMatchObject({ kind: "replace", current: "Mi editorial", proposed: "Siruela" })
    expect(defaultSelection(rows).has("publisher")).toBe(false)
  })

  it("a different title is always asked: it is never preselected", () => {
    const { state, item } = withBook({ title: "Mi título" })
    const rows = diffBook(state, item, book({ title: "Cien años de soledad" }))
    expect(row(rows, "title")?.kind).toBe("replace")
    expect(defaultSelection(rows).has("title")).toBe(false)
  })

  it("the same value written with other capitals or spaces is not a change", () => {
    const { state, item } = withBook({ title: "cien años  de soledad", book: { publisher: "SIRUELA" } })
    const rows = diffBook(state, item, book({ title: "Cien años de soledad", publisher: "Siruela" }))
    expect(fields(rows)).not.toContain("title")
    expect(fields(rows)).not.toContain("publisher")
  })

  it("an accent is a real difference, offered without being preselected", () => {
    const { state, item } = withBook({ title: "Cien anos de soledad" })
    const rows = diffBook(state, item, book({ title: "Cien años de soledad" }))
    expect(row(rows, "title")?.kind).toBe("replace")
  })

  it("what the provider does not know never empties a value", () => {
    const { state, item } = withBook({ subtitle: "Mi subtítulo", description: "Mi texto", book: { publisher: "Mi editorial", pageCount: 100 } })
    const rows = diffBook(state, item, book())
    expect(fields(rows)).toEqual(["sourceUrl", "external"])
  })

  it("offers each piece of book data the provider knows", () => {
    const { state, item } = withBook()
    const rows = diffBook(state, item, book({ subtitle: "Sub", creators: ["Irene Vallejo"], description: "Texto", language: "es", year: 2020, publisher: "Siruela", pageCount: 452, isbn13: "9788417860790", isbn10: "8417860797", cover: "https://covers.openlibrary.org/b/id/1-L.jpg" }))
    expect(fields(rows).sort()).toEqual(["cover", "creators", "description", "external", "isbn", "language", "pageCount", "publishedYear", "publisher", "sourceUrl", "subtitle"])
  })

  it("the year falls back to the work's first publication", () => {
    const { state, item } = withBook()
    expect(row(diffBook(state, item, book({ firstPublishedYear: 1967 })), "publishedYear")).toMatchObject({ proposed: "1967", patch: { book: { publishedYear: 1967 } } })
  })

  it("the order of the authors is not a change, and nothing is offered when the provider has no names", () => {
    const { state, item } = withBook({ creators: ["Ana", "Luis"] })
    expect(fields(diffBook(state, item, book({ creators: ["Luis", "Ana"] })))).not.toContain("creators")
    expect(fields(diffBook(state, item, book({ creators: [] })))).not.toContain("creators")
    expect(fields(diffBook(state, item, book({ creators: null })))).not.toContain("creators")
  })

  it("a description the user already holds in full is not offered again when the provider's is cut", () => {
    const { state, item } = withBook({ description: "Primera frase. Segunda frase que el proveedor recortó." })
    expect(fields(diffBook(state, item, book({ description: "Primera frase." })))).not.toContain("description")
  })

  it("the same cover is not a change; the user's own cover is only replaced if they mark it", () => {
    const url = "https://covers.openlibrary.org/b/id/1-L.jpg"
    const same = withBook({ cover: { source: "external", url } })
    expect(fields(diffBook(same.state, same.item, book({ cover: url })))).not.toContain("cover")
    const own = withBook({ cover: { source: "upload", path: "u/portada.jpg" } })
    const rows = diffBook(own.state, own.item, book({ cover: url }))
    expect(row(rows, "cover")).toMatchObject({ kind: "replace", preview: { current: { source: "upload", path: "u/portada.jpg" }, proposed: { source: "external", url } } })
    expect(defaultSelection(rows).has("cover")).toBe(false)
  })
})

describe("diffBook: ISBN", () => {
  it("both forms of one edition are the same ISBN", () => {
    const { state, item } = withBook({ book: { isbn10: "8417860797", isbn13: null } })
    expect(fields(diffBook(state, item, book({ isbn13: "9788417860790" })))).not.toContain("isbn")
  })

  it("an empty ISBN is filled with both forms, the ISBN-13 derived when the provider has only the ISBN-10", () => {
    const { state, item } = withBook()
    expect(row(diffBook(state, item, book({ isbn13: "9788417860790", isbn10: "8417860797" })), "isbn")).toMatchObject({ kind: "fill", patch: { book: { isbn13: "9788417860790", isbn10: "8417860797" } } })
    expect(row(diffBook(state, item, book({ isbn10: "8417860797" })), "isbn")).toMatchObject({ patch: { book: { isbn13: "9788417860790", isbn10: "8417860797" } } })
  })

  it("another edition's ISBN is offered unselected and replaces both forms", () => {
    const { state, item } = withBook({ book: { isbn13: "9788417860790", isbn10: "8417860797" } })
    const rows = diffBook(state, item, book({ isbn13: "9788419399151" }))
    expect(row(rows, "isbn")).toMatchObject({ kind: "replace", patch: { book: { isbn13: "9788419399151", isbn10: null } } })
    expect(defaultSelection(rows).has("isbn")).toBe(false)
  })
})

describe("diffBook: values that cannot be applied", () => {
  it("a page count below the current page is shown blocked, not selectable", () => {
    const { state, item } = withBook({ book: { currentPage: 500 } })
    const rows = diffBook(state, item, book({ pageCount: 432 }))
    expect(row(rows, "pageCount")?.blocked).toMatch(/500/)
    expect(defaultSelection(rows).has("pageCount")).toBe(false)
  })

  it("a page count below a note's page is blocked too: that note could no longer be edited", () => {
    const { state, item } = withBook()
    const n = createNote(state, "n1", { itemId: item.id, type: "idea", body: "Idea", locator: { page: 460 } }, ctx)
    if (!n.ok) throw new Error("note")
    expect(row(diffBook(n.state, item, book({ pageCount: 432 })), "pageCount")?.blocked).toMatch(/460/)
  })

  it("a page count equal to where the user is can be applied", () => {
    const { state, item } = withBook({ book: { currentPage: 432 } })
    expect(row(diffBook(state, item, book({ pageCount: 432 })), "pageCount")?.blocked).toBeNull()
  })

  it("the link to the work is offered preselected when the book has none", () => {
    const { state, item } = withBook()
    const rows = diffBook(state, item, book())
    expect(row(rows, "external")).toMatchObject({ kind: "fill", proposed: "Open Library", patch: { external: OL_REF } })
    expect(defaultSelection(rows).has("external")).toBe(true)
  })

  it("the link is not offered when it is already this one", () => {
    const { state, item } = withBook({ external: OL_REF })
    expect(fields(diffBook(state, item, book()))).not.toContain("external")
  })

  it("a link held by another book is blocked and names it (a separate edition stays separate, D101)", () => {
    const first = withBook({ title: "El original", external: OL_REF }, emptyKnowledge(), "b0")
    const { state, item } = withBook({ title: "Otra edición" }, first.state, "b1")
    const rows = diffBook(state, item, book({ title: "Otra edición" }))
    expect(row(rows, "external")?.blocked).toMatch(/El original/)
    expect(defaultSelection(rows).has("external")).toBe(false)
  })

  it("no work id means no link to offer", () => {
    const { state, item } = withBook()
    expect(fields(diffBook(state, item, book({ workId: null })))).not.toContain("external")
  })
})

describe("diffEpisode", () => {
  it("fills what is empty, with the date in the profile's zone", () => {
    const { state, item } = withEpisode()
    const rows = diffEpisode(state, item, episode({ durationSeconds: 3600, publishedAt: "2026-01-01T23:30:00Z", description: "Texto", cover: "https://is1-ssl.mzstatic.com/a.jpg", sourceUrl: "https://podcasts.apple.com/e/1" }), "Europe/Madrid")
    expect(row(rows, "durationSeconds")).toMatchObject({ kind: "fill", proposed: "1:00:00", patch: { episode: { durationSeconds: 3600 } } })
    expect(row(rows, "publishedOn")).toMatchObject({ kind: "fill", patch: { episode: { publishedOn: "2026-01-02" } } })
    expect(row(rows, "platform")).toMatchObject({ kind: "fill", proposed: "Apple Podcasts", patch: { episode: { platform: "apple" } } })
    expect(row(rows, "external")).toMatchObject({ patch: { external: { provider: "itunes", id: "100", attribution: "Datos: Apple Podcasts" } } })
    for (const f of ["durationSeconds", "publishedOn", "platform", "description", "cover", "sourceUrl", "external"] as DiffField[]) expect(defaultSelection(rows).has(f)).toBe(true)
  })

  it("the place where the user listens is theirs: another platform is not preselected", () => {
    const { state, item } = withEpisode({ episode: { platform: "spotify" } })
    const rows = diffEpisode(state, item, episode(), "Europe/Madrid")
    expect(row(rows, "platform")).toMatchObject({ kind: "replace", current: "Spotify" })
    expect(defaultSelection(rows).has("platform")).toBe(false)
  })

  it("a duration below where the user stopped, or below a note's minute, is blocked", () => {
    const stopped = withEpisode({ episode: { positionSeconds: 1800 } })
    expect(row(diffEpisode(stopped.state, stopped.item, episode({ durationSeconds: 900 }), "UTC"), "durationSeconds")?.blocked).toMatch(/30:00/)
    const { state, item } = withEpisode()
    const n = createNote(state, "n1", { itemId: item.id, type: "quote", body: "Cita", locator: { positionSeconds: 1200 } }, ctx)
    if (!n.ok) throw new Error("note")
    expect(row(diffEpisode(n.state, item, episode({ durationSeconds: 900 }), "UTC"), "durationSeconds")?.blocked).toMatch(/20:00/)
  })

  it("an Apple link held by another episode is blocked", () => {
    const first = withEpisode({ title: "El primero", external: { provider: "itunes", id: "100", attribution: null } }, emptyKnowledge(), "e0")
    const { state, item } = withEpisode({}, first.state, "e1")
    expect(row(diffEpisode(state, item, episode(), "UTC"), "external")?.blocked).toMatch(/El primero/)
  })
})

describe("diffShow", () => {
  it("fills the publisher, asks about the name, and has no description to offer", () => {
    const { state, show: s } = withShow({ title: "Mi nombre" })
    const rows = diffShow(state, s, show({ title: "Nombre en Apple", publisher: "Productora", cover: "https://is1-ssl.mzstatic.com/a.jpg", sourceUrl: "https://podcasts.apple.com/s/7" }))
    expect(row(rows, "publisher")).toMatchObject({ kind: "fill", patch: { publisher: "Productora" } })
    expect(row(rows, "title")?.kind).toBe("replace")
    expect(defaultSelection(rows).has("title")).toBe(false)
    expect(fields(rows)).not.toContain("description")
  })

  it("a link held by another show is blocked", () => {
    const first = withShow({ title: "El otro", external: { provider: "itunes", id: "7", attribution: null } }, emptyKnowledge(), "s0")
    const { state, show: s } = withShow({}, first.state, "s1")
    expect(row(diffShow(state, s, show()), "external")?.blocked).toMatch(/El otro/)
  })
})

describe("patchOf", () => {
  const full = () => {
    const { state, item } = withBook({ book: { publisher: "Mi editorial" } })
    return { state, item, rows: diffBook(state, item, book({ publisher: "Siruela", pageCount: 432, isbn13: "9788417860790", description: "Texto" })) }
  }

  it("only what is marked goes in, the book's fields together", () => {
    const { rows } = full()
    expect(patchOf(rows, new Set<DiffField>(["pageCount", "isbn", "description"]))).toEqual({ description: "Texto", book: { pageCount: 432, isbn13: "9788417860790", isbn10: null } })
  })

  it("nothing marked is an empty patch", () => {
    expect(patchOf(full().rows, new Set())).toEqual({})
  })

  it("a blocked row stays out even if something marked it", () => {
    const { state, item } = withBook({ book: { currentPage: 500 } })
    const rows = diffBook(state, item, book({ pageCount: 432 }))
    expect(patchOf(rows, new Set<DiffField>(["pageCount"]))).toEqual({})
  })

  it("marking every row still leaves the user's own data alone", () => {
    const base = withBook({ status: "active", rating: 8, favorite: true, topics: ["Historia"], startedOn: "2026-01-01", book: { currentPage: 20 } })
    const rows = diffBook(base.state, base.item, book({ title: "Otro título", subtitle: "Sub", creators: ["A"], description: "D", language: "es", year: 2020, publisher: "P", pageCount: 432, isbn13: "9788417860790", cover: "https://covers.openlibrary.org/b/id/1-L.jpg", topicSuggestions: ["Ruido"] }))
    const r = updateItem(base.state, base.item.id, patchOf(rows, new Set(rows.map((x) => x.field))) as ItemPatch, ctx)
    if (!r.ok) throw new Error(JSON.stringify(r.error))
    expect(r.item).toMatchObject({ status: "active", rating: 8, favorite: true, topics: ["Historia"], startedOn: "2026-01-01", finishedOn: null })
    expect((r.item as Book).book).toMatchObject({ currentPage: 20, pageCount: 432 })
  })

  it("the default selection applied fills the blanks and keeps what the user wrote", () => {
    const { state, item, rows } = full()
    const r = updateItem(state, item.id, patchOf(rows, defaultSelection(rows)) as ItemPatch, ctx)
    if (!r.ok) throw new Error(JSON.stringify(r.error))
    expect((r.item as Book).book).toMatchObject({ publisher: "Mi editorial", pageCount: 432, isbn13: "9788417860790" })
    expect(r.item.description).toBe("Texto")
    expect(r.item.external).toEqual(OL_REF)
  })
})

describe("staleFields: the record changed while the comparison was open", () => {
  const proposal = book({ pageCount: 432, publisher: "Siruela", description: "Texto" })
  const setup = () => {
    const { state, item } = withBook()
    return { state, item, shown: diffBook(state, item, proposal) }
  }
  const change = (state: KnowledgeState, id: string, patch: ItemPatch) => {
    const r = updateItem(state, id, patch, { ...ctx, now: "2026-11-09T11:00:00.000Z" })
    if (!r.ok) throw new Error(JSON.stringify(r.error))
    return r
  }

  it("nothing changed: nothing is stale", () => {
    const { shown } = setup()
    expect(staleFields(shown, shown, new Set<DiffField>(["pageCount"]))).toEqual([])
  })

  it("a marked field that now holds another value is stale, so it is not silently overwritten", () => {
    const { state, item, shown } = setup()
    const r = change(state, item.id, { book: { publisher: "Del otro dispositivo" } })
    expect(staleFields(shown, diffBook(r.state, r.item as Book, proposal), new Set<DiffField>(["publisher"]))).toEqual(["publisher"])
  })

  it("a field nobody marked may change freely", () => {
    const { state, item, shown } = setup()
    const r = change(state, item.id, { book: { publisher: "Del otro dispositivo" } })
    expect(staleFields(shown, diffBook(r.state, r.item as Book, proposal), new Set<DiffField>(["pageCount"]))).toEqual([])
  })

  it("a marked field that now equals the proposal has nothing left to apply", () => {
    const { state, item, shown } = setup()
    const r = change(state, item.id, { description: "Texto" })
    expect(staleFields(shown, diffBook(r.state, r.item as Book, proposal), new Set<DiffField>(["description"]))).toEqual(["description"])
  })

  it("a marked field that became impossible meanwhile is stale", () => {
    const { state, item, shown } = setup()
    const r = change(state, item.id, { book: { currentPage: 500 } })
    expect(staleFields(shown, diffBook(r.state, r.item as Book, proposal), new Set<DiffField>(["pageCount"]))).toEqual(["pageCount"])
  })
})

describe("withDetail", () => {
  const found = book({ creators: ["Garcia Marquez, Gabriel"], publisher: "Siruela", year: 2020 })

  it("adds what only the detail knows to the result that was chosen", () => {
    expect(withDetail(found, book({ creators: null, description: "Texto", pageCount: 452 }))).toMatchObject({ publisher: "Siruela", year: 2020, description: "Texto", pageCount: 452 })
  })

  it("keeps a name that has a comma as one author", () => {
    expect(withDetail(found, book({ creators: null })).creators).toEqual(["Garcia Marquez, Gabriel"])
  })

  it("prefers the names of the detail when it has them", () => {
    expect(withDetail(found, book({ creators: ["Gabriel García Márquez"] })).creators).toEqual(["Gabriel García Márquez"])
  })
})

describe("diffTarget", () => {
  it("compares whatever record the target points to", () => {
    const { state, item } = withBook()
    expect(fields(diffTarget(state, { entity: "item", id: item.id }, { kind: "book", result: book({ pageCount: 10 }) }, "UTC")!)).toContain("pageCount")
  })

  it("is null when the record is gone, so nothing can be applied to it", () => {
    expect(diffTarget(emptyKnowledge(), { entity: "item", id: "nope" }, { kind: "book", result: book() }, "UTC")).toBeNull()
    expect(diffTarget(emptyKnowledge(), { entity: "show", id: "nope" }, { kind: "show", result: show() }, "UTC")).toBeNull()
  })

  it("is null for a proposal of another kind of record", () => {
    const { state, item } = withBook()
    expect(diffTarget(state, { entity: "item", id: item.id }, { kind: "episode", result: episode() }, "UTC")).toBeNull()
  })

  it("does not take an inherited name for a record", () => {
    expect(diffTarget(emptyKnowledge(), { entity: "item", id: "constructor" }, { kind: "book", result: book() }, "UTC")).toBeNull()
  })
})

describe("where the data is looked up", () => {
  it("reads the edition from an Open Library edition link", () => {
    expect(editionIdOf("https://openlibrary.org/books/OL28108908M")).toBe("OL28108908M")
    expect(editionIdOf("https://openlibrary.org/books/OL28108908M/El_infinito")).toBe("OL28108908M")
  })

  it("a work link, another site or no link say no edition", () => {
    expect(editionIdOf("https://openlibrary.org/works/OL1W")).toBeNull()
    expect(editionIdOf("https://example.com/books/OL1M")).toBeNull()
    expect(editionIdOf(null)).toBeNull()
  })

  it("a linked book goes straight to its work and edition", () => {
    const { state, item } = withBook({ external: OL_REF, sourceUrl: "https://openlibrary.org/books/OL1M" })
    expect(directLookup(state, { entity: "item", id: item.id })).toEqual({ kind: "book", work: "OL1W", edition: "OL1M" })
  })

  it("a book without a link, or linked elsewhere, has to be searched", () => {
    const manual = withBook()
    expect(directLookup(manual.state, { entity: "item", id: manual.item.id })).toBeNull()
    const other = withBook({ external: { provider: "googlebooks", id: "x", attribution: null } })
    expect(directLookup(other.state, { entity: "item", id: other.item.id })).toBeNull()
  })

  it("a linked show goes straight to Apple", () => {
    const { state, show: s } = withShow({ external: { provider: "itunes", id: "7", attribution: null } })
    expect(directLookup(state, { entity: "show", id: s.id })).toEqual({ kind: "show", id: "7" })
  })

  it("a linked episode needs its show's Apple id to be found", () => {
    const linkedShow = withShow({ external: { provider: "itunes", id: "7", attribution: null } })
    const ep = withEpisode({ external: { provider: "itunes", id: "100", attribution: null }, episode: { showId: linkedShow.show.id } }, linkedShow.state)
    expect(directLookup(ep.state, { entity: "item", id: ep.item.id })).toEqual({ kind: "episode", id: "100", show: "7" })
    const noShow = withEpisode({ external: { provider: "itunes", id: "100", attribution: null } })
    expect(directLookup(noShow.state, { entity: "item", id: noShow.item.id })).toBeNull()
  })

  it("«Actualizar datos» only with a reference the app can look up again", () => {
    expect(updateLabel(withBook({ external: OL_REF }).item)).toBe("Actualizar datos")
    expect(updateLabel(withBook().item)).toBe("Buscar datos")
    expect(updateLabel(withBook({ external: { provider: "googlebooks", id: "x", attribution: null } }).item)).toBe("Buscar datos")
    expect(updateLabel(withShow({ external: { provider: "itunes", id: "7", attribution: null } }).show)).toBe("Actualizar datos")
  })
})
