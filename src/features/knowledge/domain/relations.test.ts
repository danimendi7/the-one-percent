import { describe, expect, it } from "vitest"
import { createItem, createNote, createShow, setLink, type Ctx } from "./ops"
import { canonicalLink, episodesOfShow, linkedTo, notesOfShow, relatedByTopics, sectionsOf, showTopics } from "./relations"
import { emptyKnowledge, NOTE_TYPES, type KnowledgeState } from "./types"

const at = (h: number): Ctx => ({ now: `2026-10-30T${String(h).padStart(2, "0")}:00:00.000Z`, today: "2026-10-30" })

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify((r as unknown as { error: unknown }).error))
  return r as Extract<T, { ok: true }>
}

function library(): KnowledgeState {
  let s = emptyKnowledge()
  s = ok(createShow(s, "s1", { title: "Programa", topics: ["Sueño"] }, at(1))).state
  s = ok(createItem(s, "episode", "e1", { title: "Ep 1", topics: ["Hábitos"], episode: { showId: "s1", episodeNumber: 1, publishedOn: "2026-09-01" } }, at(2))).state
  s = ok(createItem(s, "episode", "e2", { title: "Ep 2", topics: ["Hábitos", "Energía"], episode: { showId: "s1", episodeNumber: 2, publishedOn: "2026-10-01" } }, at(3))).state
  s = ok(createItem(s, "book", "b1", { title: "Dormir", topics: ["sueño", "Salud"] }, at(4))).state
  s = ok(createItem(s, "book", "b2", { title: "Hábitos", topics: ["Hábitos", "Energía"] }, at(5))).state
  s = ok(createItem(s, "book", "b3", { title: "Sin temas" }, at(6))).state
  return s
}

describe("links", () => {
  it("the canonical key does not depend on the order", () => {
    const x = { type: "note" as const, id: "n1" }
    const y = { type: "item" as const, id: "b1" }
    expect(canonicalLink(x, y, "t")!.key).toBe(canonicalLink(y, x, "t")!.key)
    expect(canonicalLink(x, x, "t")).toBeNull()
  })

  it("linkedTo returns the other end, oldest first", () => {
    let s = library()
    s = ok(setLink(s, { type: "item", id: "b2" }, { type: "item", id: "b1" }, true, at(7))).state
    s = ok(setLink(s, { type: "item", id: "e1" }, { type: "item", id: "b1" }, true, at(8))).state
    expect(linkedTo(s, { type: "item", id: "b1" })).toEqual([
      { type: "item", id: "b2" },
      { type: "item", id: "e1" },
    ])
  })
})

describe("shows and episodes (no duplicated show data)", () => {
  it("episodes of a show, newest first", () => {
    expect(episodesOfShow(library(), "s1").map((e) => e.id)).toEqual(["e2", "e1"])
  })

  it("a show's notes come from all its episodes", () => {
    let s = library()
    s = ok(createNote(s, "n1", { itemId: "e1", type: "idea", body: "uno" }, at(9))).state
    s = ok(createNote(s, "n2", { itemId: "e2", type: "idea", body: "dos" }, at(10))).state
    s = ok(createNote(s, "n3", { itemId: "b1", type: "idea", body: "tres" }, at(11))).state
    expect(notesOfShow(s, "s1").map((n) => n.id)).toEqual(["n2", "n1"])
  })

  it("show topics: its own first, then its episodes' by frequency", () => {
    expect(showTopics(library(), "s1")).toEqual(["Sueño", "Hábitos", "Energía"])
  })
})

describe("sections of a content page", () => {
  it("every section in the common order, starred first, then by page, then oldest", () => {
    let s = library()
    s = ok(createNote(s, "a", { itemId: "b1", type: "idea", body: "p.50", locator: { page: 50 } }, at(9))).state
    s = ok(createNote(s, "b", { itemId: "b1", type: "idea", body: "p.10", locator: { page: 10 } }, at(10))).state
    s = ok(createNote(s, "c", { itemId: "b1", type: "idea", body: "sin página" }, at(11))).state
    s = ok(createNote(s, "d", { itemId: "b1", type: "idea", body: "destacada", starred: true, locator: { page: 90 } }, at(12))).state
    s = ok(createNote(s, "e", { itemId: "b1", type: "application", body: "hacer" }, at(13))).state
    const secs = sectionsOf(s, "b1")
    expect(secs.map((x) => x.type)).toEqual([...NOTE_TYPES])
    expect(secs[0].notes.map((n) => n.id)).toEqual(["d", "b", "a", "c"])
    expect(secs.find((x) => x.type === "application")!.notes.map((n) => n.id)).toEqual(["e"])
    expect(secs.find((x) => x.type === "quote")!.notes).toEqual([])
  })
})

describe("related content by topics (deterministic, explained)", () => {
  it("shares topics across formats, including an episode's show topics, most shared first", () => {
    const r = relatedByTopics(library(), "b2")
    expect(r.map((x) => [x.item.id, x.shared])).toEqual([
      ["e2", ["Hábitos", "Energía"]],
      ["e1", ["Hábitos"]],
    ])
    // b1 shares «sueño» with the show of e1 and e2.
    expect(relatedByTopics(library(), "b1").map((x) => x.item.id).sort()).toEqual(["e1", "e2"])
  })

  it("leaves out linked content and items without topics", () => {
    const s = ok(setLink(library(), { type: "item", id: "b2" }, { type: "item", id: "e2" }, true, at(9))).state
    expect(relatedByTopics(s, "b2").map((x) => x.item.id)).toEqual(["e1"])
    expect(relatedByTopics(s, "b3")).toEqual([])
    expect(relatedByTopics(s, "missing")).toEqual([])
  })
})
