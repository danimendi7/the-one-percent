import { describe, expect, it } from "vitest"
import { demoLibrary, DEMO_NOTICE } from "../demo"
import { createItem, createNote, updateItem, type Ctx } from "./ops"
import { applicationSummary, countByType, finishedByYear, notesByMonth } from "./stats"
import { syntheticLibrary, VOLUME_5K } from "./synthetic"
import { emptyKnowledge, noteLabel, STATUS_LABEL, type KnowledgeState } from "./types"
import { itemSchema, linkSchema, noteSchema, sessionSchema, showSchema } from "./validation"

const ctx: Ctx = { now: "2026-10-30T10:00:00.000Z", today: "2026-10-30" }

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify((r as unknown as { error: unknown }).error))
  return r as Extract<T, { ok: true }>
}

/** Every entity passes its schema and every reference points to something that exists. */
function expectConsistent(s: KnowledgeState) {
  for (const i of Object.values(s.items)) {
    expect(itemSchema.safeParse(i).success, i.id).toBe(true)
    if (i.kind === "episode" && i.episode.showId) expect(s.shows[i.episode.showId], i.id).toBeDefined()
  }
  for (const sh of Object.values(s.shows)) expect(showSchema.safeParse(sh).success, sh.id).toBe(true)
  for (const n of Object.values(s.notes)) {
    expect(noteSchema.safeParse(n).success, n.id).toBe(true)
    if (n.itemId) expect(s.items[n.itemId], n.id).toBeDefined()
  }
  for (const l of Object.values(s.links)) {
    expect(linkSchema.safeParse(l).success, l.key).toBe(true)
    for (const end of [l.a, l.b]) expect(end.type === "item" ? s.items[end.id] : end.type === "show" ? s.shows[end.id] : s.notes[end.id], l.key).toBeDefined()
  }
}

describe("statistics (N/D, never 0 %)", () => {
  it("finished per year counts only items still finished", () => {
    let s = emptyKnowledge()
    s = ok(createItem(s, "book", "a", { title: "A", status: "done", finishedOn: "2025-03-01" }, ctx)).state
    s = ok(createItem(s, "book", "b", { title: "B", status: "done", finishedOn: "2026-01-01" }, ctx)).state
    s = ok(createItem(s, "book", "c", { title: "C", status: "done", finishedOn: "2026-02-01" }, ctx)).state
    s = ok(createItem(s, "episode", "e", { title: "E", status: "done", finishedOn: "2026-02-01" }, ctx)).state
    s = ok(updateItem(s, "c", { status: "abandoned" }, ctx)).state
    expect(finishedByYear(s, "book")).toEqual([
      { year: 2025, count: 1 },
      { year: 2026, count: 1 },
    ])
    expect(finishedByYear(s, "episode")).toEqual([{ year: 2026, count: 1 }])
  })

  it("applications: done over the ones still meant to happen; null with none", () => {
    expect(applicationSummary(emptyKnowledge()).doneRatio).toBeNull()
    let s = ok(createItem(emptyKnowledge(), "book", "a", { title: "A" }, ctx)).state
    for (const [id, st] of [["1", "done"], ["2", "open"], ["3", "dropped"], ["4", "doing"]] as const) {
      s = ok(createNote(s, id, { itemId: "a", type: "application", body: "x", applicationStatus: st }, ctx)).state
    }
    expect(applicationSummary(s)).toEqual({ open: 1, doing: 1, done: 1, dropped: 1, doneRatio: 1 / 3 })
  })

  it("notes per month and per type", () => {
    let s = ok(createItem(emptyKnowledge(), "book", "a", { title: "A" }, ctx)).state
    s = ok(createNote(s, "1", { itemId: "a", type: "idea", body: "x" }, { ...ctx, now: "2026-09-10T10:00:00.000Z" })).state
    s = ok(createNote(s, "2", { itemId: "a", type: "idea", body: "y" }, ctx)).state
    s = ok(createNote(s, "3", { itemId: null, type: "quote", body: "z" }, ctx)).state
    expect(notesByMonth(s)).toEqual([
      { month: "2026-09", count: 1 },
      { month: "2026-10", count: 2 },
    ])
    expect(notesByMonth(s, ["quote"])).toEqual([{ month: "2026-10", count: 1 }])
    expect(countByType(s, "a")).toMatchObject({ idea: 2, quote: 0 })
    expect(countByType(s)).toMatchObject({ idea: 2, quote: 1 })
  })
})

describe("demo library (labelled, nothing invented passed off as real)", () => {
  const demo = demoLibrary("2026-10-30")

  it("is consistent and valid", () => {
    expectConsistent(demo)
    expect(Object.values(demo.items).filter((i) => i.kind === "book").length).toBeGreaterThanOrEqual(5)
    expect(Object.values(demo.items).filter((i) => i.kind === "episode").length).toBeGreaterThanOrEqual(3)
    expect(Object.values(demo.notes).some((n) => n.itemId === null)).toBe(true)
    expect(Object.values(demo.items).some((i) => i.kind === "episode" && i.episode.showId === null)).toBe(true)
  })

  it("carries no external data, links, covers or ISBNs that could pass for verified", () => {
    for (const i of Object.values(demo.items)) {
      expect(i).toMatchObject({ sourceUrl: null, cover: null, external: null })
      if (i.kind === "book") expect(i.book).toMatchObject({ isbn13: null, isbn10: null })
    }
    for (const s of Object.values(demo.shows)) expect(s).toMatchObject({ sourceUrl: null, cover: null, external: null })
  })

  it("podcasts are named as examples and the only quote says it is fictional", () => {
    for (const s of Object.values(demo.shows)) expect(s.title).toMatch(/ejemplo/)
    for (const i of Object.values(demo.items)) if (i.kind === "episode") expect(i.title).toMatch(/ejemplo/)
    const quotes = Object.values(demo.notes).filter((n) => n.type === "quote")
    expect(quotes.length).toBeGreaterThan(0)
    for (const q of quotes) {
      expect(demo.items[q.itemId!].kind).toBe("episode")
      expect(q.body).toMatch(/ficticia/)
    }
    expect(DEMO_NOTICE).toMatch(/^Demo/)
  })

  it("dates follow today", () => {
    const other = demoLibrary("2027-01-15")
    expect(other.items["demo-book-outlive"].startedOn).toBe("2026-12-22")
  })
})

describe("synthetic volume library (tests and benchmark only)", () => {
  it("has exactly the requested size, is deterministic and valid", () => {
    const s = syntheticLibrary(VOLUME_5K)
    expect(Object.keys(s.notes)).toHaveLength(5_000)
    expect(Object.keys(s.items)).toHaveLength(560)
    expect(Object.keys(s.shows)).toHaveLength(40)
    expect(Object.keys(s.links).length).toBeGreaterThan(950)
    expect(syntheticLibrary(VOLUME_5K)).toEqual(s)
    expectConsistent(s)
  })

  it("respects the limits (D65) and includes long notes and free-standing ones", () => {
    const notes = Object.values(syntheticLibrary(VOLUME_5K).notes)
    expect(Math.max(...notes.filter((n) => n.type === "quote").map((n) => n.body.length))).toBeLessThanOrEqual(2_000)
    expect(Math.max(...notes.map((n) => n.body.length))).toBeGreaterThan(2_000)
    expect(notes.filter((n) => n.itemId === null).length).toBeGreaterThan(150)
  })
})

describe("labels per format (one model, words of each format)", () => {
  it("statuses and quotes read naturally for books and episodes", () => {
    expect(STATUS_LABEL.book.active).toBe("Leyendo")
    expect(STATUS_LABEL.episode.active).toBe("En curso")
    expect(STATUS_LABEL.episode.done).toBe("Completado")
    expect(noteLabel("quote", "book")).toBe("Cita")
    expect(noteLabel("quote", "episode", true)).toBe("Momentos destacados")
    expect(noteLabel("idea", null, true)).toBe("Ideas principales")
  })
})

describe("sessions (shared model for M4h, D64)", () => {
  it("validates minutes and page order", () => {
    const base = { id: "s1", itemId: "b1", localDate: "2026-10-30", minutes: 20, pagesFrom: 10, pagesTo: 30, note: null }
    expect(sessionSchema.safeParse(base).success).toBe(true)
    expect(sessionSchema.safeParse({ ...base, minutes: 0 }).success).toBe(false)
    expect(sessionSchema.safeParse({ ...base, pagesFrom: 40 }).success).toBe(false)
    expect(sessionSchema.safeParse({ ...base, localDate: "30/10/2026" }).success).toBe(false)
  })
})
