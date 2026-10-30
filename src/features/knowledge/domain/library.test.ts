import { describe, expect, it } from "vitest"
import { createItem, createShow, updateItem, type Ctx } from "./ops"
import { filterContent, inProgress, progressOf, shelfCounts, suggestsFinish } from "./library"
import { emptyKnowledge, type KnowledgeState } from "./types"

const at = (h: number): Ctx => ({ now: `2026-10-30T${String(h).padStart(2, "0")}:00:00.000Z`, today: "2026-10-30" })

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify((r as unknown as { error: unknown }).error))
  return r as Extract<T, { ok: true }>
}

function library(): KnowledgeState {
  let s = emptyKnowledge()
  s = ok(createShow(s, "s1", { title: "Señal y Ruido", topics: ["Ciencia"] }, at(1))).state
  s = ok(createItem(s, "book", "b1", { title: "Ética", creators: ["Zoe"], status: "done", rating: 6, finishedOn: "2026-01-02", topics: ["Filosofía"] }, at(2))).state
  s = ok(createItem(s, "book", "b2", { title: "álgebra", creators: ["Ana"], status: "active", favorite: true, book: { isbn13: "9780306406157" } }, at(3))).state
  s = ok(createItem(s, "book", "b3", { title: "Biología", status: "done", rating: 9, finishedOn: "2025-05-01" }, at(4))).state
  s = ok(createItem(s, "book", "b4", { title: "Cosmos", status: "abandoned" }, at(5))).state
  s = ok(createItem(s, "episode", "e1", { title: "Episodio", status: "active", episode: { showId: "s1" } }, at(6))).state
  return s
}

describe("lists of a section", () => {
  it("only the requested format, newest activity first by default", () => {
    expect(filterContent(library(), { kind: "book" }).map((i) => i.id)).toEqual(["b4", "b3", "b2", "b1"])
    expect(filterContent(library(), { kind: "episode" }).map((i) => i.id)).toEqual(["e1"])
  })

  it("shelves: status, favourites (independent of status) and all", () => {
    const s = library()
    expect(filterContent(s, { kind: "book", shelf: "done" }).map((i) => i.id)).toEqual(["b3", "b1"])
    expect(filterContent(s, { kind: "book", shelf: "favorites" }).map((i) => i.id)).toEqual(["b2"])
    expect(shelfCounts(s, "book")).toEqual({ all: 4, active: 1, planned: 0, done: 2, paused: 0, abandoned: 1, favorites: 1 })
  })

  it("query matches title, creators and ISBN, ignoring accents and case; episodes also by show title", () => {
    const s = library()
    expect(filterContent(s, { kind: "book", query: "ETICA" }).map((i) => i.id)).toEqual(["b1"])
    expect(filterContent(s, { kind: "book", query: "ana" }).map((i) => i.id)).toEqual(["b2"])
    expect(filterContent(s, { kind: "book", query: "9780306406157" }).map((i) => i.id)).toEqual(["b2"])
    expect(filterContent(s, { kind: "episode", query: "senal" }).map((i) => i.id)).toEqual(["e1"])
  })

  it("topic (an episode inherits its show's) and minimum rating, which leaves unrated content out", () => {
    const s = library()
    expect(filterContent(s, { kind: "episode", topic: "ciencia" }).map((i) => i.id)).toEqual(["e1"])
    expect(filterContent(s, { kind: "book", topic: "Filosofia" }).map((i) => i.id)).toEqual(["b1"])
    expect(filterContent(s, { kind: "book", minRating: 7 }).map((i) => i.id)).toEqual(["b3"])
  })

  it("sorts: title (locale, accents), creator (missing last), rating (unrated last), finish date", () => {
    const s = library()
    expect(filterContent(s, { kind: "book", sort: "title" }).map((i) => i.title)).toEqual(["álgebra", "Biología", "Cosmos", "Ética"])
    expect(filterContent(s, { kind: "book", sort: "creator" }).map((i) => i.id)).toEqual(["b2", "b1", "b3", "b4"])
    expect(filterContent(s, { kind: "book", sort: "rating" }).map((i) => i.id)).toEqual(["b3", "b1", "b2", "b4"])
    expect(filterContent(s, { kind: "book", sort: "finished" }).map((i) => i.id)).toEqual(["b1", "b3", "b2", "b4"])
  })

  it("in progress: both formats, newest first", () => {
    expect(inProgress(library()).map((i) => i.id)).toEqual(["e1", "b2"])
  })
})

describe("progress", () => {
  it("pages, manual percentage, episode position, unknown and finished", () => {
    let s = library()
    s = ok(updateItem(s, "b2", { book: { pageCount: 200, currentPage: 50 } }, at(7))).state
    expect(progressOf(s.items.b2)).toBe(0.25)
    s = ok(updateItem(s, "b4", { book: { progressPercent: 40 } }, at(7))).state
    expect(progressOf(s.items.b4)).toBe(0.4)
    s = ok(updateItem(s, "e1", { episode: { durationSeconds: 1000, positionSeconds: 250 } }, at(7))).state
    expect(progressOf(s.items.e1)).toBe(0.25)
    expect(progressOf(library().items.b2)).toBeNull()
    expect(progressOf(library().items.b1)).toBe(1)
  })

  it("at the end it suggests finishing but never decides", () => {
    const s = ok(updateItem(library(), "b2", { book: { pageCount: 100, currentPage: 100 } }, at(7))).state
    expect(s.items.b2.status).toBe("active")
    expect(suggestsFinish(s.items.b2)).toBe(true)
    expect(suggestsFinish(s.items.b1)).toBe(false)
  })
})
