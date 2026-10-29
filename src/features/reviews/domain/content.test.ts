import { describe, expect, it } from "vitest"
import {
  addDecision,
  decisionsToEvaluate,
  normalizeContent,
  normalizeDecision,
  reviewFields,
  sectionProgress,
  setEvaluation,
  validateContent,
} from "./content"
import { LIMITS, type Decision, type Evaluation, type ReviewKind } from "./types"

const ID = ["0b9c8a52-6a3e-4c1e-9d6f-2f3b1c4d5e61", "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60", "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6071"]

function decision(i: number, p: Partial<Decision> = {}): Decision {
  return { id: ID[i], text: `Decisión ${i}`, kind: "keep", expected: null, link: null, ...p }
}

function review(p: { kind?: ReviewKind; content?: Record<string, string>; decisions?: Decision[]; evaluations?: Evaluation[] } = {}) {
  return { kind: p.kind ?? ("week" as ReviewKind), content: p.content ?? {}, decisions: p.decisions ?? [], evaluations: p.evaluations ?? [] }
}

describe("nothing is required: a review can close with no text at all", () => {
  it("an empty review is valid", () => {
    expect(validateContent(review())).toEqual({ ok: true })
    expect(validateContent(review({ kind: "month" }))).toEqual({ ok: true })
  })

  it("answers are trimmed and a blank answer means «no answer»", () => {
    expect(normalizeContent({ wins: "  Terminé el informe  ", struggles: "   ", note: "" })).toEqual({ wins: "Terminé el informe" })
  })
})

describe("limits and keys", () => {
  it("answers up to 600 characters, the free note up to 1000", () => {
    expect(validateContent(review({ content: { wins: "a".repeat(LIMITS.answer) } })).ok).toBe(true)
    expect(validateContent(review({ content: { wins: "a".repeat(LIMITS.answer + 1) } }))).toMatchObject({ ok: false, field: "content.wins" })
    expect(validateContent(review({ content: { note: "a".repeat(LIMITS.note) } })).ok).toBe(true)
  })

  it("a weekly review does not accept the monthly questions (and vice versa)", () => {
    expect(validateContent(review({ content: { pattern: "x" } })).ok).toBe(false)
    expect(validateContent(review({ kind: "month", content: { pattern: "x", stop: "y" } })).ok).toBe(true)
    expect(validateContent(review({ kind: "month", content: { wins: "x" } })).ok).toBe(false)
  })

  it("lists the sections that conflict independently (decision 5)", () => {
    expect(reviewFields("week")).toEqual(["content.wins", "content.struggles", "content.lessons", "content.note", "decisions", "evaluations"])
    expect(reviewFields("month")).toEqual(["content.pattern", "content.attention", "content.stop", "content.note", "decisions", "evaluations"])
  })
})

describe("decisions (decision 3)", () => {
  it("at most three; adding a fourth changes nothing", () => {
    const three = [decision(0), decision(1), decision(2)]
    expect(validateContent(review({ decisions: three })).ok).toBe(true)
    expect(addDecision(three, decision(3))).toEqual(three)
    expect(validateContent(review({ decisions: [...three, decision(3)] }))).toMatchObject({ ok: false, field: "decisions" })
  })

  it("types start / keep / change / drop, an optional measurable result and an optional link", () => {
    const d = decision(0, { kind: "start", expected: "4 sesiones de 90 min", link: { type: "habit", id: "h1", title: "Deep Work" } })
    expect(validateContent(review({ decisions: [d] })).ok).toBe(true)
    expect(validateContent(review({ decisions: [decision(0, { kind: "pause" as Decision["kind"] })] })).ok).toBe(false)
    expect(validateContent(review({ decisions: [decision(0, { text: "a".repeat(LIMITS.decisionText + 1) })] })).ok).toBe(false)
    expect(validateContent(review({ decisions: [decision(0, { expected: "a".repeat(LIMITS.expected + 1) })] })).ok).toBe(false)
  })

  it("an empty expected result becomes null; texts are trimmed", () => {
    expect(normalizeDecision(decision(0, { text: "  Dormir 7 h  ", expected: "   " }))).toMatchObject({ text: "Dormir 7 h", expected: null })
  })

  it("rejects duplicate ids and non-uuid ids", () => {
    expect(validateContent(review({ decisions: [decision(0), decision(0)] })).ok).toBe(false)
    expect(validateContent(review({ decisions: [decision(0, { id: "x" })] })).ok).toBe(false)
  })
})

describe("evaluations live in the next review (decision 4)", () => {
  const previous = { decisions: [decision(0), decision(1)] }

  it("lists the previous decisions still without evaluation", () => {
    const e: Evaluation = { decisionId: ID[0], from: "2026-10-19", outcome: "done", note: null }
    expect(decisionsToEvaluate(previous, [e]).map((d) => d.id)).toEqual([ID[1]])
    expect(decisionsToEvaluate(null, [])).toEqual([])
  })

  it("rating a decision again replaces the earlier rating (desired state)", () => {
    const first: Evaluation = { decisionId: ID[0], from: "2026-10-19", outcome: "partial", note: null }
    const again: Evaluation = { ...first, outcome: "done", note: "Al final sí" }
    expect(setEvaluation([first], again)).toEqual([again])
    expect(validateContent(review({ evaluations: [first, first] })).ok).toBe(false)
  })

  it("progress counts answered questions, decisions and pending evaluations; the free note is optional", () => {
    const r = review({ content: { wins: "x", note: "y" }, decisions: [decision(2)] })
    expect(sectionProgress(r, previous)).toEqual({ answered: 1, questions: 3, decisions: 1, toEvaluate: 2 })
  })
})
