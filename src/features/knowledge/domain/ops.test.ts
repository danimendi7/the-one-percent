import { describe, expect, it } from "vitest"
import { createItem, createNote, createShow, deleteItem, deleteNote, deleteShow, moveNote, restoreRemoved, setLink, updateItem, updateNote, updateShow, type Ctx } from "./ops"
import { emptyKnowledge, type KnowledgeState } from "./types"

const ctx: Ctx = { now: "2026-10-30T10:00:00.000Z", today: "2026-10-30" }
const later: Ctx = { now: "2026-10-31T08:00:00.000Z", today: "2026-10-31" }

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify((r as unknown as { error: unknown }).error))
  return r as Extract<T, { ok: true }>
}

/** A book (300 pages), a show with one episode (1 h), and nothing else. */
function base(): KnowledgeState {
  let s = emptyKnowledge()
  s = ok(createItem(s, "book", "b1", { title: "Libro", book: { pageCount: 300 } }, ctx)).state
  s = ok(createShow(s, "s1", { title: "Programa" }, ctx)).state
  s = ok(createItem(s, "episode", "e1", { title: "Episodio", episode: { showId: "s1", durationSeconds: 3600 } }, ctx)).state
  return s
}

describe("content: create", () => {
  it("a book needs only a title; everything else starts empty and pending", () => {
    const r = ok(createItem(emptyKnowledge(), "book", "b1", { title: "  Hábitos   atómicos " }, ctx))
    expect(r.item).toMatchObject({ kind: "book", title: "Hábitos atómicos", status: "planned", rating: null, favorite: false, creators: [], topics: [], createdAt: ctx.now })
    expect(r.item.book).toEqual({ isbn13: null, isbn10: null, pageCount: null, currentPage: null, progressPercent: null, publisher: null, publishedYear: null })
  })

  it("an episode can have no show (D59)", () => {
    const r = ok(createItem(emptyKnowledge(), "episode", "e1", { title: "Charla suelta" }, ctx))
    expect(r.item.episode.showId).toBeNull()
  })

  it("an episode's show must exist", () => {
    const r = createItem(emptyKnowledge(), "episode", "e1", { title: "X", episode: { showId: "nope" } }, ctx)
    expect(r).toMatchObject({ ok: false, error: { code: "not_found" } })
  })

  it("rejects an empty title, a repeated id and an unsafe link", () => {
    expect(createItem(emptyKnowledge(), "book", "b1", { title: "   " }, ctx)).toMatchObject({ ok: false, error: { code: "invalid" } })
    expect(createItem(base(), "book", "b1", { title: "Otro" }, ctx)).toMatchObject({ ok: false, error: { code: "duplicate" } })
    expect(createItem(emptyKnowledge(), "book", "b2", { title: "X", sourceUrl: "javascript:alert(1)" }, ctx)).toMatchObject({ ok: false, error: { code: "invalid" } })
  })

  it("cleans topics and creators and derives ISBN-13 from ISBN-10", () => {
    const r = ok(createItem(emptyKnowledge(), "book", "b1", { title: "X", topics: ["#Sueño", "sueno"], creators: ["A", "a"], book: { isbn10: "0-306-40615-2" } }, ctx))
    expect(r.item.topics).toEqual(["Sueño"])
    expect(r.item.creators).toEqual(["A"])
    expect(r.item.book).toMatchObject({ isbn10: "0306406152", isbn13: "9780306406157" })
  })

  it("rejects an invalid ISBN and duplicated external ids of the same kind", () => {
    expect(createItem(emptyKnowledge(), "book", "b1", { title: "X", book: { isbn13: "9780306406156" } }, ctx)).toMatchObject({ ok: false, error: { code: "invalid" } })
    const ext = { provider: "openlibrary" as const, id: "OL1M", attribution: null }
    const s = ok(createItem(emptyKnowledge(), "book", "b1", { title: "X", external: ext }, ctx)).state
    expect(createItem(s, "book", "b2", { title: "Y", external: ext }, ctx)).toMatchObject({ ok: false, error: { code: "duplicate", detail: "b1" } })
  })
})

describe("content: status, rating and dates (D60, D61)", () => {
  it("rating is an optional integer from 1 to 10", () => {
    const s = base()
    expect(ok(updateItem(s, "b1", { rating: 1 }, ctx)).item.rating).toBe(1)
    expect(ok(updateItem(s, "b1", { rating: 10 }, ctx)).item.rating).toBe(10)
    expect(ok(updateItem(s, "b1", { rating: null }, ctx)).item.rating).toBeNull()
    for (const bad of [0, 11, 7.5]) expect(updateItem(s, "b1", { rating: bad }, ctx)).toMatchObject({ ok: false, error: { code: "invalid" } })
  })

  it("starting fills the start date and finishing the end date, never overwriting a date the user set", () => {
    let s = base()
    s = ok(updateItem(s, "b1", { status: "active" }, ctx)).state
    expect(s.items.b1).toMatchObject({ startedOn: "2026-10-30", finishedOn: null })
    s = ok(updateItem(s, "b1", { status: "done" }, later)).state
    expect(s.items.b1).toMatchObject({ startedOn: "2026-10-30", finishedOn: "2026-10-31" })
    const explicit = ok(updateItem(base(), "b1", { status: "done", finishedOn: "2026-10-01" }, later)).item
    expect(explicit).toMatchObject({ startedOn: null, finishedOn: "2026-10-01" })
  })

  it("finishing does not invent a start date, and leaving a status clears nothing", () => {
    let s = ok(updateItem(base(), "b1", { status: "done" }, ctx)).state
    expect(s.items.b1.startedOn).toBeNull()
    // Reopening (a re-read) keeps the recorded dates instead of contradicting them.
    s = ok(updateItem(s, "b1", { status: "active" }, later)).state
    expect(s.items.b1).toMatchObject({ status: "active", startedOn: null, finishedOn: "2026-10-30" })
  })

  it("rejects an end before the start", () => {
    expect(updateItem(base(), "b1", { startedOn: "2026-10-10", finishedOn: "2026-10-01" }, ctx)).toMatchObject({ ok: false, error: { code: "invalid" } })
  })

  it("all five statuses are valid for both formats", () => {
    for (const status of ["planned", "active", "paused", "done", "abandoned"] as const) {
      expect(updateItem(base(), "b1", { status }, ctx).ok).toBe(true)
      expect(updateItem(base(), "e1", { status }, ctx).ok).toBe(true)
    }
  })
})

describe("content: update", () => {
  it("returns the same state when nothing changes, and stamps updatedAt otherwise", () => {
    const s = base()
    const same = ok(updateItem(s, "b1", { title: "Libro " }, later))
    expect(same.state).toBe(s)
    const changed = ok(updateItem(s, "b1", { favorite: true }, later))
    expect(changed.item).toMatchObject({ favorite: true, updatedAt: later.now })
    expect(changed.state.items.e1).toBe(s.items.e1)
  })

  it("format blocks only apply to their kind", () => {
    expect(updateItem(base(), "b1", { episode: { durationSeconds: 10 } }, ctx)).toMatchObject({ ok: false, error: { code: "kind_mismatch" } })
    expect(updateItem(base(), "e1", { book: { pageCount: 10 } }, ctx)).toMatchObject({ ok: false, error: { code: "kind_mismatch" } })
  })

  it("progress stays within the content", () => {
    expect(updateItem(base(), "b1", { book: { currentPage: 301 } }, ctx)).toMatchObject({ ok: false, error: { code: "invalid" } })
    expect(updateItem(base(), "e1", { episode: { positionSeconds: 3601 } }, ctx)).toMatchObject({ ok: false, error: { code: "invalid" } })
    expect(updateItem(base(), "b1", { book: { progressPercent: 101 } }, ctx)).toMatchObject({ ok: false, error: { code: "invalid" } })
    expect(ok(updateItem(base(), "b1", { book: { currentPage: 300 } }, ctx)).item.status).toBe("planned")
  })

  it("unknown ids are not found", () => {
    expect(updateItem(base(), "zz", { title: "x" }, ctx)).toMatchObject({ ok: false, error: { code: "not_found" } })
  })
})

describe("notes (D62)", () => {
  it("a note keeps the text cleaned, plain format and its locator", () => {
    const r = ok(createNote(base(), "n1", { itemId: "b1", type: "idea", body: "  Idea\r\n\r\nsegunda línea  ", locator: { page: 12 } }, ctx))
    expect(r.note).toMatchObject({ body: "Idea\n\nsegunda línea", format: "plain", locator: { page: 12, positionSeconds: null, label: null }, applicationStatus: null })
  })

  it("free-standing ideas have no content and no locator", () => {
    const r = ok(createNote(base(), "n1", { itemId: null, type: "idea", body: "Suelta", locator: { page: 3 } }, ctx))
    expect(r.note).toMatchObject({ itemId: null, locator: null })
  })

  it("a page belongs to a book and a timestamp to an episode, within their length", () => {
    const s = base()
    expect(createNote(s, "n1", { itemId: "e1", type: "quote", body: "x", locator: { page: 3 } }, ctx)).toMatchObject({ ok: false, error: { code: "kind_mismatch" } })
    expect(createNote(s, "n1", { itemId: "b1", type: "quote", body: "x", locator: { positionSeconds: 3 } }, ctx)).toMatchObject({ ok: false, error: { code: "kind_mismatch" } })
    expect(createNote(s, "n1", { itemId: "b1", type: "quote", body: "x", locator: { page: 301 } }, ctx)).toMatchObject({ ok: false, error: { code: "invalid" } })
    expect(createNote(s, "n1", { itemId: "e1", type: "quote", body: "x", locator: { positionSeconds: 3601 } }, ctx)).toMatchObject({ ok: false, error: { code: "invalid" } })
    expect(ok(createNote(s, "n1", { itemId: "e1", type: "quote", body: "x", locator: { positionSeconds: 754, label: "Parte 2" } }, ctx)).note.locator).toEqual({ page: null, positionSeconds: 754, label: "Parte 2" })
  })

  it("limits: 10.000 per note and 2.000 per quote (D65), and no empty notes", () => {
    const s = base()
    expect(createNote(s, "n1", { itemId: "b1", type: "note", body: "a".repeat(10_000) }, ctx).ok).toBe(true)
    expect(createNote(s, "n1", { itemId: "b1", type: "note", body: "a".repeat(10_001) }, ctx)).toMatchObject({ ok: false, error: { code: "invalid" } })
    expect(createNote(s, "n1", { itemId: "b1", type: "quote", body: "a".repeat(2_000) }, ctx).ok).toBe(true)
    expect(createNote(s, "n1", { itemId: "b1", type: "quote", body: "a".repeat(2_001) }, ctx)).toMatchObject({ ok: false, error: { detail: "body: quote too long" } })
    expect(createNote(s, "n1", { itemId: "b1", type: "idea", body: " \n " }, ctx)).toMatchObject({ ok: false, error: { code: "invalid" } })
  })

  it("an application starts pending; other types carry no status or link", () => {
    const s = base()
    expect(ok(createNote(s, "n1", { itemId: "b1", type: "application", body: "Hacer X" }, ctx)).note.applicationStatus).toBe("open")
    expect(ok(createNote(s, "n2", { itemId: "b1", type: "idea", body: "Y", applicationStatus: "done" }, ctx)).note.applicationStatus).toBeNull()
  })

  it("changing the type away from application drops its status and link, back starts pending", () => {
    let s = ok(createNote(base(), "n1", { itemId: "b1", type: "application", body: "Hacer X", applicationStatus: "doing", applicationLink: { type: "habit", id: "h1", title: "Leer" } }, ctx)).state
    s = ok(updateNote(s, "n1", { type: "learning" }, later)).state
    expect(s.notes.n1).toMatchObject({ applicationStatus: null, applicationLink: null })
    s = ok(updateNote(s, "n1", { type: "application" }, later)).state
    expect(s.notes.n1.applicationStatus).toBe("open")
  })

  it("an unchanged edit keeps the same state", () => {
    const s = ok(createNote(base(), "n1", { itemId: "b1", type: "idea", body: "Igual" }, ctx)).state
    expect(ok(updateNote(s, "n1", { body: "Igual " }, later)).state).toBe(s)
  })

  it("moving to another format drops a locator that no longer fits, but keeps its label and the text", () => {
    let s = ok(createNote(base(), "n1", { itemId: "b1", type: "quote", body: "Texto", locator: { page: 10, label: "Cap. 1" } }, ctx)).state
    s = ok(moveNote(s, "n1", "e1", later)).state
    expect(s.notes.n1).toMatchObject({ itemId: "e1", body: "Texto", locator: { page: null, positionSeconds: null, label: "Cap. 1" } })
    s = ok(moveNote(s, "n1", null, later)).state
    expect(s.notes.n1).toMatchObject({ itemId: null, locator: null, body: "Texto" })
    expect(moveNote(s, "n1", "nope", later)).toMatchObject({ ok: false, error: { code: "not_found" } })
  })

  it("a note needs an existing content", () => {
    expect(createNote(base(), "n1", { itemId: "nope", type: "idea", body: "x" }, ctx)).toMatchObject({ ok: false, error: { code: "not_found" } })
  })
})

describe("delete and undo", () => {
  function withKnowledge() {
    let s = base()
    s = ok(createNote(s, "n1", { itemId: "b1", type: "idea", body: "Uno" }, ctx)).state
    s = ok(createNote(s, "n2", { itemId: "e1", type: "idea", body: "Dos" }, ctx)).state
    s = ok(setLink(s, { type: "note", id: "n1" }, { type: "note", id: "n2" }, true, ctx)).state
    s = ok(setLink(s, { type: "item", id: "b1" }, { type: "item", id: "e1" }, true, ctx)).state
    s = ok(setLink(s, { type: "show", id: "s1" }, { type: "note", id: "n1" }, true, ctx)).state
    return s
  }

  it("deleting a content removes its notes and every link touching them; undo restores exactly", () => {
    const s = withKnowledge()
    const r = ok(deleteItem(s, "b1"))
    expect(Object.keys(r.state.items)).toEqual(["e1"])
    expect(Object.keys(r.state.notes)).toEqual(["n2"])
    expect(Object.keys(r.state.links)).toEqual([])
    expect(r.removed.notes.map((n) => n.id)).toEqual(["n1"])
    expect(restoreRemoved(r.state, r.removed)).toEqual(s)
  })

  it("deleting a show keeps its episodes and their notes, without a show; undo re-attaches them", () => {
    const s = withKnowledge()
    const r = ok(deleteShow(s, "s1", later))
    expect(r.state.items.e1).toMatchObject({ kind: "episode", episode: { showId: null } })
    expect(r.state.notes.n2.body).toBe("Dos")
    expect(Object.keys(r.state.links).some((k) => k.includes("show:s1"))).toBe(false)
    const back = restoreRemoved(r.state, r.removed)
    expect(back.shows.s1).toEqual(s.shows.s1)
    expect(back.items.e1.kind === "episode" && back.items.e1.episode.showId).toBe("s1")
    expect(Object.keys(back.links).sort()).toEqual(Object.keys(s.links).sort())
  })

  it("deleting a note removes its links; undo brings both back", () => {
    const s = withKnowledge()
    const r = ok(deleteNote(s, "n2"))
    expect(r.state.notes.n2).toBeUndefined()
    expect(Object.keys(r.state.links).some((k) => k.includes("note:n2"))).toBe(false)
    expect(restoreRemoved(r.state, r.removed)).toEqual(s)
  })

  it("missing ids are not found", () => {
    expect(deleteItem(base(), "x").ok).toBe(false)
    expect(deleteShow(base(), "x", ctx).ok).toBe(false)
    expect(deleteNote(base(), "x").ok).toBe(false)
  })
})

describe("shows", () => {
  it("are cleaned, de-duplicated by external id and updated field by field", () => {
    const ext = { provider: "itunes" as const, id: "123", attribution: "Apple Podcasts" }
    let s = ok(createShow(emptyKnowledge(), "s1", { title: " Programa ", publisher: " ", topics: ["#Ciencia"], external: ext }, ctx)).state
    expect(s.shows.s1).toMatchObject({ title: "Programa", publisher: null, topics: ["Ciencia"] })
    expect(createShow(s, "s2", { title: "Otro", external: ext }, ctx)).toMatchObject({ ok: false, error: { code: "duplicate" } })
    const same = ok(updateShow(s, "s1", { title: "Programa" }, later))
    expect(same.state).toBe(s)
    s = ok(updateShow(s, "s1", { publisher: "Estudio" }, later)).state
    expect(s.shows.s1).toMatchObject({ publisher: "Estudio", updatedAt: later.now })
  })
})

describe("links", () => {
  it("are undirected, canonical and idempotent", () => {
    const s = base()
    const a = { type: "item" as const, id: "e1" }
    const b = { type: "item" as const, id: "b1" }
    const one = ok(setLink(s, a, b, true, ctx)).state
    expect(Object.keys(one.links)).toEqual(["item:b1|item:e1"])
    expect(ok(setLink(one, b, a, true, later)).state).toBe(one)
    const none = ok(setLink(one, b, a, false, later)).state
    expect(none.links).toEqual({})
    expect(ok(setLink(none, a, b, false, later)).state).toBe(none)
  })

  it("rejects self-links and missing ends", () => {
    const s = base()
    expect(setLink(s, { type: "item", id: "b1" }, { type: "item", id: "b1" }, true, ctx)).toMatchObject({ ok: false, error: { code: "invalid" } })
    expect(setLink(s, { type: "item", id: "b1" }, { type: "note", id: "nope" }, true, ctx)).toMatchObject({ ok: false, error: { code: "not_found" } })
  })
})
