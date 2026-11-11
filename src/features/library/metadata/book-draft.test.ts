import { describe, expect, it } from "vitest"
import { createItem, type Ctx } from "@/features/knowledge/domain/ops"
import { emptyKnowledge } from "@/features/knowledge/domain/types"
import { itemSchema } from "@/features/knowledge/domain/validation"
import { applyDetail, applyEdition, createDraft, draftErrors, draftResult, editField, setKeepDescription, setUseCover } from "./book-draft"
import { bookFromRecords, parseEdition, parseEditions, parseSearch, parseWork } from "./openlibrary"
import { toBookInput } from "./to-input"
import type { BookResult } from "./types"
import olEditionHabitos from "./__fixtures__/ol-edition-habitos.json"
import olEditions from "./__fixtures__/ol-editions-infinito.json"
import olIsbnEs from "./__fixtures__/ol-search-isbn-es.json"
import olTitleEs from "./__fixtures__/ol-search-title-es.json"
import olWorkAtomic from "./__fixtures__/ol-work-atomic.json"
import olWorkInfinito from "./__fixtures__/ol-work-infinito.json"

const ctx: Ctx = { now: "2026-10-31T10:00:00.000Z", today: "2026-10-31" }
const siruela = parseSearch(olIsbnEs)![0]
const editions = parseEditions(olEditions)!.map((e) => bookFromRecords(null, { ...e, workId: e.workId ?? "OL20770492W" }, null)!)
const other = editions.find((e) => e.editionId !== siruela.editionId && e.publisher !== siruela.publisher)!

describe("book draft (M4g.3)", () => {
  it("starts from the result; what the provider does not know stays empty", () => {
    const bare = parseSearch(olTitleEs)!.find((b) => b.workId === "OL43144891W")!
    const d = createDraft(bare)
    expect(d.values).toMatchObject({ isbn: "", pageCount: "", description: "" })
    expect(d.useCover).toBe(false)
    expect(createDraft(siruela).values).toMatchObject({ title: "El infinito en un junco", publisher: "Siruela", year: "2020", language: "es", isbn: "9788417860790" })
  })

  it("another edition replaces the untouched edition fields, also with empty ones", () => {
    const d = applyEdition(createDraft(siruela), other)
    expect(d.values.publisher).toBe(other.publisher ?? "")
    expect(d.values.isbn).toBe(other.isbn13 ?? other.isbn10 ?? "")
    expect(d.source).toMatchObject({ workId: "OL20770492W", editionId: other.editionId, sourceUrl: other.sourceUrl })
    // Work data is not the edition's: authors stay.
    expect(d.values.creators).toBe("Irene Vallejo")
    const noPublisher: BookResult = { ...other, publisher: null, pageCount: null }
    expect(applyEdition(createDraft(siruela), noPublisher).values).toMatchObject({ publisher: "", pageCount: "" })
  })

  it("never overwrites what the user edited: editions and late details respect touched fields", () => {
    let d = createDraft(siruela)
    d = editField(d, "publisher", "Mi editorial")
    d = editField(d, "pageCount", "500")
    d = editField(d, "title", "Mi título")
    d = applyEdition(d, other)
    expect(d.values).toMatchObject({ publisher: "Mi editorial", pageCount: "500", title: "Mi título" })
    d = applyDetail(d, { ...other, description: "Desde la obra", pageCount: 999, title: "Otro" })
    expect(d.values).toMatchObject({ publisher: "Mi editorial", pageCount: "500", title: "Mi título", description: "Desde la obra" })
    expect(d.touched.sort()).toEqual(["pageCount", "publisher", "title"])
  })

  it("a detail that arrives after changing edition cannot overwrite the chosen edition", () => {
    const chosen = { ...other, editionId: "OL-CHOSEN", publisher: "Debate", year: 2021, pageCount: 460, language: "es", isbn13: "9788417860790", isbn10: null, cover: null }
    const late = { ...siruela, editionId: "OL-FIRST", publisher: "Siruela", year: 2019, pageCount: 452, language: "en", description: "Desde la obra", topicSuggestions: ["Historia"] }
    const before = applyEdition(createDraft({ ...siruela, editionId: "OL-FIRST" }), chosen)
    const d = applyDetail(before, late)
    for (const f of ["publisher", "year", "pageCount", "language", "isbn"] as const) expect(d.values[f]).toBe(before.values[f])
    expect(d.isbns).toEqual(before.isbns)
    expect([d.cover, d.useCover]).toEqual([before.cover, before.useCover])
    expect(d.source.editionId).toBe("OL-CHOSEN")
    // What belongs to the work, not to an edition, still arrives.
    expect(d.values.description).toBe("Desde la obra")
    expect(d.topicSuggestions).toEqual(["Historia"])
  })

  it("a detail for the same edition, or for a result without one, still fills its fields", () => {
    const first = { ...siruela, editionId: "OL-FIRST", publisher: null, year: null }
    const detail = { ...siruela, editionId: "OL-FIRST", publisher: "Siruela", year: 2019 }
    expect(applyDetail(createDraft(first), detail).values).toMatchObject({ publisher: "Siruela", year: "2019" })
    const workOnly = { ...first, editionId: null }
    expect(applyDetail(createDraft(workOnly), detail).values).toMatchObject({ publisher: "Siruela", year: "2019" })
  })

  it("the late detail fills what was missing but never empties a field", () => {
    const detail = bookFromRecords(parseWork(olWorkInfinito), parseEdition({ ...olEditionHabitos, key: "/books/OL28108908M" }), null)!
    const d = applyDetail(createDraft(siruela), { ...detail, publisher: null, isbn13: null, isbn10: null })
    expect(d.values.description.length).toBeGreaterThan(100)
    expect(d.values.publisher).toBe("Siruela")
    expect(d.values.isbn).toBe("9788417860790")
    expect(d.topicSuggestions.length).toBeGreaterThan(0)
  })

  it("the cover follows the edition until the user decides; «sin portada» stays", () => {
    let d = applyEdition(createDraft(siruela), { ...other, cover: null })
    expect([d.useCover, draftResult(d).cover]).toEqual([false, null])
    d = applyEdition(d, siruela)
    expect(d.useCover).toBe(true)
    d = setUseCover(d, false)
    d = applyEdition(d, { ...other, cover: "https://covers.openlibrary.org/b/id/5-L.jpg" })
    expect(draftResult(d).cover).toBeNull()
  })

  it("an edition's ISBN-10 is saved with its ISBN-13 although the field shows only the ISBN-13", () => {
    const debate = editions.find((e) => e.isbn13 && e.isbn10 && e.editionId !== siruela.editionId)!
    const d = applyEdition(createDraft(siruela), debate)
    expect(d.values.isbn).toBe(debate.isbn13)
    expect(draftResult(d)).toMatchObject({ isbn13: debate.isbn13, isbn10: debate.isbn10 })
    // A different ISBN typed by the user replaces the pair (only what was typed, plus its ISBN-13).
    expect(draftResult(editField(d, "isbn", "9780735211292"))).toMatchObject({ isbn13: "9780735211292", isbn10: null })
    // Typing the edition's own ISBN-10 keeps the pair.
    expect(draftResult(editField(d, "isbn", debate.isbn10!))).toMatchObject({ isbn13: debate.isbn13, isbn10: debate.isbn10 })
  })

  it("checks: title required, ISBN check digit, four-digit year, positive pages, language code", () => {
    const d = createDraft(siruela)
    expect(draftErrors(d)).toEqual({})
    expect(Object.keys(draftErrors(editField(d, "title", "  ")))).toEqual(["title"])
    expect(draftErrors(editField(d, "isbn", "978-84-17860-79-1")).isbn).toMatch(/no es válido/)
    expect(draftErrors(editField(d, "isbn", "84-17860-79-7"))).toEqual({})
    expect(draftErrors(editField(d, "year", "20")).year).toBeDefined()
    expect(draftErrors(editField(d, "pageCount", "0")).pageCount).toBeDefined()
    expect(draftErrors(editField(d, "language", "español")).language).toBeDefined()
  })

  it("the result keeps the provider identity and the user's values; it saves through createItem", () => {
    let d = createDraft(siruela)
    d = editField(d, "creators", "Irene Vallejo, Otra Persona")
    d = editField(d, "isbn", "84-17860-79-7")
    d = setKeepDescription(d, false)
    const r = draftResult(d)
    expect(r).toMatchObject({ workId: "OL20770492W", editionId: "OL28108908M", creators: ["Irene Vallejo", "Otra Persona"], isbn13: "9788417860790", isbn10: "8417860797", attribution: "Datos: Open Library" })
    const st = createItem(emptyKnowledge(), "book", "b1", toBookInput(r, { keepDescription: d.keepDescription, status: "active", rating: 9, favorite: true }), ctx)
    expect(st.ok).toBe(true)
    const item = st.ok ? st.state.items.b1 : null
    expect(itemSchema.safeParse(item).success).toBe(true)
    expect(item).toMatchObject({ status: "active", rating: 9, favorite: true, description: null, external: { provider: "openlibrary", id: "OL20770492W" }, cover: { source: "external" } })
  })

  it("a translation (work in English, edition in Spanish) keeps both titles apart", () => {
    const b = bookFromRecords(parseWork(olWorkAtomic), parseEdition(olEditionHabitos), ["James Clear"])!
    const r = draftResult(createDraft(b))
    expect([r.title, r.workTitle]).toEqual(["Hábitos Atómicos", "Atomic Habits"])
  })
})
