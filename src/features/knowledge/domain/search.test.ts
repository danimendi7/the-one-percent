import { describe, expect, it } from "vitest"
import { createItem, createNote, createShow, deleteItem, updateNote, updateShow, type Ctx } from "./ops"
import { buildIndex, queryTerms, search } from "./search"
import { emptyKnowledge, type KnowledgeState } from "./types"

const at = (h: number, day = 30): Ctx => {
  const d = `2026-10-${String(day).padStart(2, "0")}`
  return { now: `${d}T${String(h).padStart(2, "0")}:00:00.000Z`, today: d }
}

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify((r as unknown as { error: unknown }).error))
  return r as Extract<T, { ok: true }>
}

function library(): KnowledgeState {
  let s = emptyKnowledge()
  s = ok(createShow(s, "s1", { title: "Señal y Ruido", topics: ["Ciencia"] }, at(1))).state
  s = ok(createItem(s, "book", "b1", { title: "Atención plena", creators: ["Ana Pérez"], rating: 9, topics: ["Mente"] }, at(2))).state
  s = ok(createItem(s, "book", "b2", { title: "Correr", description: "Un libro sobre la atención al cuerpo.", rating: 4 }, at(3))).state
  s = ok(createItem(s, "episode", "e1", { title: "Dormir bien", episode: { showId: "s1" } }, at(4))).state
  s = ok(createNote(s, "n1", { itemId: "b1", type: "idea", body: "La atención es un músculo que se entrena." }, at(5, 1))).state
  s = ok(createNote(s, "n2", { itemId: "e1", type: "quote", body: "Dormir es entrenar la memoria.", locator: { positionSeconds: 60 } }, at(6, 2))).state
  s = ok(createNote(s, "n3", { itemId: null, type: "application", body: "Entrenar la atención cada mañana.", topics: ["Rutina"] }, at(7, 3))).state
  s = ok(createNote(s, "n4", { itemId: "b2", type: "learning", body: "Correr despacio también suma.", starred: true }, at(8, 4))).state
  return s
}

const ids = <T extends { entity: { id: string } }>(hits: T[]) => hits.map((h) => h.entity.id)

describe("query terms", () => {
  it("normalised and de-duplicated words; single letters dropped, digits kept", () => {
    expect(queryTerms("La Atención y la ATENCION 2")).toEqual(["la", "atencion", "2"])
    expect(queryTerms("  ")).toEqual([])
  })
})

describe("search (D67)", () => {
  it("finds notes, content and shows ignoring accents, with word prefixes", () => {
    const s = library()
    const r = search(s, buildIndex(s), { query: "atencion" })
    expect(ids(r.notes).sort()).toEqual(["n1", "n3"])
    expect(ids(r.items)).toEqual(["b1", "b2"])
    expect(ids(search(s, buildIndex(s), { query: "entren" }).notes).sort()).toEqual(["n1", "n2", "n3"])
    expect(ids(search(s, buildIndex(s), { query: "senal" }).shows)).toEqual(["s1"])
  })

  it("every term must match (AND)", () => {
    const s = library()
    expect(ids(search(s, buildIndex(s), { query: "entrenar atención" }).notes)).toEqual(["n3"])
    expect(search(s, buildIndex(s), { query: "atención zzz" }).total).toEqual({ notes: 0, items: 0, shows: 0 })
  })

  it("does not match inside words", () => {
    const s = library()
    expect(search(s, buildIndex(s), { query: "tencion" }).total.notes).toBe(0)
  })

  it("a title match ranks above a description match", () => {
    const s = library()
    expect(ids(search(s, buildIndex(s), { query: "atención" }).items)).toEqual(["b1", "b2"])
  })

  it("finds content by author and by its show's title", () => {
    const s = library()
    expect(ids(search(s, buildIndex(s), { query: "perez" }).items)).toEqual(["b1"])
    expect(ids(search(s, buildIndex(s), { query: "ruido" }).items)).toEqual(["e1"])
  })

  it("without a query lists every note, newest first, or oldest first", () => {
    const s = library()
    expect(ids(search(s, buildIndex(s), {}).notes)).toEqual(["n4", "n3", "n2", "n1"])
    expect(ids(search(s, buildIndex(s), { sort: "oldest" }).notes)).toEqual(["n1", "n2", "n3", "n4"])
    expect(search(s, buildIndex(s), {}).items).toEqual([])
  })

  it("filters: note type, format, content, show, rating, starred, application status, topics and period", () => {
    const s = library()
    const idx = buildIndex(s)
    const f = (filters: Parameters<typeof search>[2]["filters"]) => ids(search(s, idx, { filters }).notes).sort()
    expect(f({ noteTypes: ["quote", "learning"] })).toEqual(["n2", "n4"])
    expect(f({ formats: ["episode"] })).toEqual(["n2"])
    expect(f({ formats: ["free"] })).toEqual(["n3"])
    expect(f({ itemId: "b1" })).toEqual(["n1"])
    expect(f({ itemId: null })).toEqual(["n3"])
    expect(f({ showId: "s1" })).toEqual(["n2"])
    expect(f({ minRating: 5 })).toEqual(["n1"])
    expect(f({ starred: true })).toEqual(["n4"])
    expect(f({ applicationStatus: ["open"] })).toEqual(["n3"])
    // Topics: the note's own, its content's and its show's.
    expect(f({ topics: ["rutina"] })).toEqual(["n3"])
    expect(f({ topics: ["Mente"] })).toEqual(["n1"])
    expect(f({ topics: ["ciencia"] })).toEqual(["n2"])
    expect(f({ since: "2026-10-02T00:00:00.000Z", until: "2026-10-03T23:59:59.999Z" })).toEqual(["n2", "n3"])
  })

  it("note filters leave content and shows out of the results", () => {
    const s = library()
    const r = search(s, buildIndex(s), { query: "atención", filters: { noteTypes: ["idea"] } })
    expect(ids(r.notes)).toEqual(["n1"])
    expect(r.items).toEqual([])
  })

  it("limit cuts the list but total counts every match", () => {
    const s = library()
    const r = search(s, buildIndex(s), { limit: 2 })
    expect(r.notes).toHaveLength(2)
    expect(r.total.notes).toBe(4)
  })

  it("a starred note ranks higher at equal match", () => {
    let s = library()
    s = ok(createNote(s, "n5", { itemId: "b2", type: "idea", body: "Correr con calma." }, at(9, 5))).state
    expect(ids(search(s, buildIndex(s), { query: "correr" }).notes)).toEqual(["n4", "n5"])
  })
})

describe("incremental index after edits", () => {
  /** Same documents, tokens and postings as an index built from scratch. */
  function expectSameAsFresh(state: KnowledgeState, idx: ReturnType<typeof buildIndex>) {
    const fresh = buildIndex(state)
    expect(idx.tokens).toEqual(fresh.tokens)
    expect([...idx.docs.keys()].sort()).toEqual([...fresh.docs.keys()].sort())
    expect(new Map([...idx.postings].map(([t, p]) => [t, new Map([...p].sort())]))).toEqual(new Map([...fresh.postings].map(([t, p]) => [t, new Map([...p].sort())])))
  }

  it("updates in place, re-indexing only what changed", () => {
    let s = library()
    const idx = buildIndex(s)
    const n1 = idx.docs.get("note:n1")!.weights
    const n2 = idx.docs.get("note:n2")!.weights
    s = ok(updateNote(s, "n1", { body: "Ahora habla de concentración." }, at(10))).state
    expect(buildIndex(s, idx)).toBe(idx)
    expect(idx.docs.get("note:n2")!.weights).toBe(n2)
    expect(idx.docs.get("note:n1")!.weights).not.toBe(n1)
    expect(search(s, idx, { query: "concentracion" }).total.notes).toBe(1)
    expect(search(s, idx, { query: "musculo" }).total.notes).toBe(0)
    expectSameAsFresh(s, idx)
  })

  it("stays equal to a fresh index through creates, deletes and new words", () => {
    let s = library()
    const idx = buildIndex(s)
    s = ok(createNote(s, "n9", { itemId: "b1", type: "idea", body: "Zygote xilófono quórum" }, at(11))).state
    buildIndex(s, idx)
    expect(ids(search(s, idx, { query: "xilofono" }).notes)).toEqual(["n9"])
    expectSameAsFresh(s, idx)
    s = ok(deleteItem(s, "b1")).state
    buildIndex(s, idx)
    expect(search(s, idx, { query: "xilofono" }).total.notes).toBe(0)
    expect(search(s, idx, { query: "atencion" }).items.map((h) => h.entity.id)).toEqual(["b2"])
    expectSameAsFresh(s, idx)
  })

  it("renaming a show updates its episodes' entries", () => {
    let s = library()
    const idx = buildIndex(s)
    s = ok(updateShow(s, "s1", { title: "Ondas" }, at(10))).state
    buildIndex(s, idx)
    expect(ids(search(s, idx, { query: "ondas" }).items)).toEqual(["e1"])
    expect(search(s, idx, { query: "ruido" }).total.items).toBe(0)
    expectSameAsFresh(s, idx)
  })
})
