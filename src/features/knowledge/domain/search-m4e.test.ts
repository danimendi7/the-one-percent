import { describe, expect, it } from "vitest"
import { createItem, createNote, createShow, deleteNote, moveNote, setLink, updateItem, updateShow, type Ctx } from "./ops"
import { noteTopics, relatedNotes } from "./relations"
import { buildIndex, explainMatch, search } from "./search"
import { emptyKnowledge, type KnowledgeState } from "./types"

const at = (h: number): Ctx => ({ now: `2026-10-30T${String(h).padStart(2, "0")}:00:00.000Z`, today: "2026-10-30" })

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify((r as unknown as { error: unknown }).error))
  return r as Extract<T, { ok: true }>
}

function library(): KnowledgeState {
  let s = emptyKnowledge()
  s = ok(createShow(s, "s1", { title: "Ritmo Lento", topics: ["Descanso"] }, at(1))).state
  s = ok(createItem(s, "book", "b1", { title: "Outlive", creators: ["Peter Attia"], status: "active", favorite: true, rating: 9, topics: ["Longevidad"] }, at(2))).state
  s = ok(createItem(s, "book", "b2", { title: "Hábitos atómicos", creators: ["James Clear"], status: "done", rating: 6, topics: ["Hábitos"] }, at(3))).state
  s = ok(createItem(s, "episode", "e1", { title: "Dormir mejor", creators: ["Invitada Ficticia"], topics: ["Sueño"], episode: { showId: "s1" } }, at(4))).state
  s = ok(createNote(s, "n1", { itemId: "b1", type: "idea", body: "La zona 2 se entrena con constancia." }, at(5))).state
  s = ok(createNote(s, "n2", { itemId: "b2", type: "application", body: "Diseñar el entorno antes que la voluntad." }, at(6))).state
  s = ok(createNote(s, "n3", { itemId: "e1", type: "quote", body: "La regularidad importa más que la cantidad.", locator: { label: "Bloque dos" } }, at(7))).state
  s = ok(createNote(s, "n4", { itemId: null, type: "idea", body: "Repasar la semana el domingo.", topics: ["Longevidad"] }, at(8))).state
  return s
}

const ids = <T extends { entity: { id: string } }>(hits: T[]) => hits.map((h) => h.entity.id)

describe("M4e · a note is found by where it comes from", () => {
  it("several words across the note and its source (AND): author + body, show + body", () => {
    const s = library()
    const idx = buildIndex(s)
    expect(ids(search(s, idx, { query: "attia zona" }).notes)).toEqual(["n1"])
    expect(ids(search(s, idx, { query: "ritmo regularidad" }).notes)).toEqual(["n3"])
    expect(ids(search(s, idx, { query: "invitada" }).notes)).toEqual(["n3"])
    // a word only in another source finds nothing
    expect(search(s, idx, { query: "attia regularidad" }).notes).toEqual([])
  })

  it("its own words rank above a match that is only in its source", () => {
    let s = library()
    s = ok(createNote(s, "n5", { itemId: "b2", type: "learning", body: "Lo que aprendí de Outlive: dormir bien." }, at(9))).state
    const r = search(s, buildIndex(s), { query: "outlive" })
    expect(ids(r.notes)[0]).toBe("n5")
    expect(ids(r.notes)).toContain("n1")
    expect(ids(r.items)).toEqual(["b1"])
  })

  it("incremental: renaming a content or a show re-indexes its notes, not the others", () => {
    const s0 = library()
    const idx = buildIndex(s0)
    const n2Doc = idx.docs.get("note:n2")
    const s1 = ok(updateItem(s0, "b1", { title: "Vivir más" }, at(10))).state
    buildIndex(s1, idx)
    expect(ids(search(s1, idx, { query: "vivir zona" }).notes)).toEqual(["n1"])
    expect(search(s1, idx, { query: "outlive" }).notes).toEqual([])
    expect(idx.docs.get("note:n2")).toBe(n2Doc)
    const s2 = ok(updateShow(s1, "s1", { title: "Pausa Activa" }, at(11))).state
    buildIndex(s2, idx)
    expect(ids(search(s2, idx, { query: "pausa regularidad" }).notes)).toEqual(["n3"])
    expect(search(s2, idx, { query: "ritmo" }).notes).toEqual([])
    // same result as a fresh build
    expect(ids(search(s2, buildIndex(s2), { query: "pausa regularidad" }).notes)).toEqual(["n3"])
  })

  it("moving or deleting a note keeps the index right", () => {
    const s0 = library()
    const idx = buildIndex(s0)
    const s1 = ok(moveNote(s0, "n1", "b2", at(10))).state
    buildIndex(s1, idx)
    expect(ids(search(s1, idx, { query: "clear zona" }).notes)).toEqual(["n1"])
    expect(search(s1, idx, { query: "attia zona" }).notes).toEqual([])
    const s2 = ok(deleteNote(s1, "n1")).state
    buildIndex(s2, idx)
    expect(search(s2, idx, { query: "zona" }).notes).toEqual([])
  })

  it("empty, blank and special input never throws and finds nothing by text", () => {
    const s = library()
    const idx = buildIndex(s)
    for (const q of ["", "   ", "***", "«»¿?", "a", ")(][", "\u0000", "🙂"]) {
      const r = search(s, idx, { query: q })
      expect(r.items).toEqual([])
    }
    // no terms = every note (the plain list), newest first
    expect(ids(search(s, idx, { query: "  " }).notes)).toEqual(["n4", "n3", "n2", "n1"])
  })
})

describe("M4e · new filters", () => {
  it("content status and favourite combine with the others; free notes never match them", () => {
    const s = library()
    const idx = buildIndex(s)
    expect(ids(search(s, idx, { filters: { contentStatus: ["active"] } }).notes)).toEqual(["n1"])
    expect(ids(search(s, idx, { filters: { contentStatus: ["done", "active"] } }).notes).sort()).toEqual(["n1", "n2"])
    expect(ids(search(s, idx, { filters: { favorite: true } }).notes)).toEqual(["n1"])
    expect(ids(search(s, idx, { filters: { favorite: true, minRating: 10 } }).notes)).toEqual([])
    expect(ids(search(s, idx, { filters: { formats: ["book"], noteTypes: ["application"] } }).notes)).toEqual(["n2"])
    // a note-only filter leaves contents and shows out of the results
    expect(search(s, idx, { query: "outlive", filters: { favorite: true } }).items).toEqual([])
  })
})

describe("M4e · explainMatch", () => {
  it("says where each match is", () => {
    const s = library()
    expect(explainMatch(s, s.notes.n1, ["attia", "zona"])).toEqual(["text", "source"])
    expect(explainMatch(s, s.notes.n1, ["out"])).toEqual(["source"])
    expect(explainMatch(s, s.notes.n3, ["bloque"])).toEqual(["locator"])
    expect(explainMatch(s, s.notes.n3, ["ritmo"])).toEqual(["source"])
    expect(explainMatch(s, s.notes.n4, ["longev"])).toEqual(["topics"])
    expect(explainMatch(s, s.notes.n4, [])).toEqual([])
  })
})

describe("M4e · related notes by topics (no AI)", () => {
  it("own and inherited topics, explained; same content and linked notes left out", () => {
    let s = library()
    // n4 (free, «Longevidad») relates to n1 (inherits «Longevidad» from Outlive)
    expect(noteTopics(s, s.notes.n1)).toEqual(["Longevidad"])
    expect(relatedNotes(s, "n4")).toEqual([{ note: s.notes.n1, shared: ["Longevidad"] }])
    s = ok(createNote(s, "n6", { itemId: "b1", type: "learning", body: "Otra de Outlive." }, at(9))).state
    // same content: not suggested
    expect(relatedNotes(s, "n1").map((r) => r.note.id)).toEqual(["n4"])
    s = ok(setLink(s, { type: "note", id: "n1" }, { type: "note", id: "n4" }, true, at(10))).state
    expect(relatedNotes(s, "n1")).toEqual([])
    expect(relatedNotes(s, "missing")).toEqual([])
  })
})

describe("M4e · index built in slices", () => {
  it("gives the same index as buildIndex, however it is sliced, also over a previous index", async () => {
    const { indexBuilder } = await import("./search")
    const { syntheticLibrary } = await import("./synthetic")
    const s = syntheticLibrary({ books: 20, shows: 4, episodes: 15, notes: 400, links: 30, seed: 3 })
    const whole = buildIndex(s)
    const b = indexBuilder(s)
    let slices = 0
    let calls = 0
    while (!b.step(() => ++calls % 2 === 0)) slices++
    expect(slices).toBeGreaterThan(1)
    expect(b.progress).toBe(1)
    expect(b.index.tokens).toEqual(whole.tokens)
    expect([...b.index.docs.keys()].sort()).toEqual([...whole.docs.keys()].sort())
    for (const q of ["habito", "atencion sueno", "en"]) expect(ids(search(s, b.index, { query: q }).notes)).toEqual(ids(search(s, whole, { query: q }).notes))
    // over a previous index: a later state is caught up the same way
    const s2 = ok(deleteNote(s, Object.keys(s.notes)[0])).state
    const again = indexBuilder(s2, b.index)
    while (!again.step(() => true));
    expect(ids(search(s2, again.index, { query: "en" }).notes)).toEqual(ids(search(s2, buildIndex(s2), { query: "en" }).notes))
  })
})

describe("M4e · incremental index equals a fresh build after many edits", () => {
  it("tokens, documents and results, across edits that add and remove words", async () => {
    const { syntheticLibrary } = await import("./synthetic")
    const { updateNote: edit } = await import("./ops")
    let s = syntheticLibrary({ books: 10, shows: 2, episodes: 6, notes: 120, links: 10, seed: 11 })
    const idx = buildIndex(s)
    const noteIds = Object.keys(s.notes)
    for (let i = 0; i < 40; i++) {
      const id = noteIds[(i * 7) % noteIds.length]
      if (!s.notes[id]) continue
      const op = i % 4
      if (op === 0) s = ok(edit(s, id, { body: `palabraunica${i} y otra` }, at(12))).state
      else if (op === 1) s = ok(deleteNote(s, id)).state
      else if (op === 2) s = ok(moveNote(s, id, null, at(12))).state
      else s = ok(edit(s, id, { body: s.notes[id].body.split(" ").slice(0, 3).join(" ") }, at(12))).state
      buildIndex(s, idx)
      const fresh = buildIndex(s)
      expect(idx.tokens).toEqual(fresh.tokens)
      expect(idx.tokens).toEqual([...idx.postings.keys()].sort())
      expect(idx.docs.size).toBe(fresh.docs.size)
    }
    expect(ids(search(s, idx, { query: "palabraunica" }).notes).sort()).toEqual(ids(search(s, buildIndex(s), { query: "palabraunica" }).notes).sort())
  })
})
