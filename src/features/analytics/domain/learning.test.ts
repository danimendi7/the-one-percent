import { describe, expect, it } from "vitest"
import { createItem, type Ctx } from "@/features/knowledge/domain/ops"
import { emptyKnowledge, type KnowledgeNote, type KnowledgeState } from "@/features/knowledge/domain/types"
import { learningMetrics } from "./learning"

const CTX: Ctx = { now: "2026-10-20T10:00:00.000Z", today: "2026-10-20" }
const RANGE = { from: "2026-10-01", to: "2026-10-31" }

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify(r))
  return r as Extract<T, { ok: true }>
}
const note = (id: string, createdAt: string, type: KnowledgeNote["type"] = "idea"): KnowledgeNote => ({ id, itemId: null, type, format: "plain", body: "x", locator: null, starred: false, applicationStatus: null, applicationLink: null, topics: [], createdAt, updatedAt: createdAt })

function item(s: KnowledgeState, kind: "book" | "episode", id: string, input: Record<string, unknown>): KnowledgeState {
  return ok(createItem(s, kind as "book", id, { title: id, ...input } as never, CTX)).state
}

describe("learningMetrics", () => {
  it("an empty library counts nothing", () => {
    expect(learningMetrics(emptyKnowledge(), RANGE, "Europe/Madrid")).toEqual({ booksFinished: 0, episodesFinished: 0, finishedWithoutDate: 0, listenedSeconds: 0, episodesWithoutDuration: 0, notesAdded: 0, applicationsAdded: 0, inProgress: 0 })
  })

  it("counts what was finished inside the period, by its finish date", () => {
    let s = emptyKnowledge()
    s = item(s, "book", "in", { status: "done", finishedOn: "2026-10-15" })
    s = item(s, "book", "out", { status: "done", finishedOn: "2026-09-30" })
    s = item(s, "book", "reading", { status: "active" })
    const m = learningMetrics(s, RANGE, "Europe/Madrid")
    expect(m.booksFinished).toBe(1)
    expect(m.inProgress).toBe(1)
  })

  it("reports a finished item without a date apart, without guessing its period", () => {
    const s = item(emptyKnowledge(), "book", "b", { status: "done" })
    const undated: KnowledgeState = { ...s, items: { b: { ...s.items.b, finishedOn: null } } }
    expect(learningMetrics(undated, RANGE, "Europe/Madrid")).toMatchObject({ booksFinished: 0, finishedWithoutDate: 1 })
  })

  it("adds listening time only for known durations, and says how many are unknown", () => {
    let s = emptyKnowledge()
    s = item(s, "episode", "e1", { status: "done", finishedOn: "2026-10-02", episode: { durationSeconds: 1800 } })
    s = item(s, "episode", "e2", { status: "done", finishedOn: "2026-10-03" })
    expect(learningMetrics(s, RANGE, "Europe/Madrid")).toMatchObject({ episodesFinished: 2, listenedSeconds: 1800, episodesWithoutDuration: 1 })
  })

  it("places a note on its local day, not the UTC one", () => {
    const s: KnowledgeState = { ...emptyKnowledge(), notes: { a: note("a", "2026-09-30T22:30:00.000Z"), b: note("b", "2026-10-31T23:30:00.000Z") } }
    // In Madrid, the first is 1 Oct (in) and the second is 1 Nov (out).
    expect(learningMetrics(s, RANGE, "Europe/Madrid").notesAdded).toBe(1)
    expect(learningMetrics(s, RANGE, "UTC").notesAdded).toBe(1)
  })

  it("counts the practical applications among the notes", () => {
    const s: KnowledgeState = { ...emptyKnowledge(), notes: { a: note("a", "2026-10-10T10:00:00.000Z", "application"), b: note("b", "2026-10-11T10:00:00.000Z") } }
    expect(learningMetrics(s, RANGE, "Europe/Madrid")).toMatchObject({ notesAdded: 2, applicationsAdded: 1 })
  })
})
