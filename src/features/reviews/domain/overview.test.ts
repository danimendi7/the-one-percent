import { describe, expect, it } from "vitest"
import { createDemoState } from "@/features/habits/fixtures/demo"
import { makeState } from "@/features/habits/domain/test-helpers"
import { closeReview, emptyDraft } from "./close"
import { periodFromStart } from "./periods"
import { buildReviewSnapshot } from "./snapshot"
import {
  decisionLog,
  dueReview,
  figuresFor,
  filterLog,
  historyGroups,
  logSummary,
  pastPeriods,
  previousReviewOf,
  progressLabel,
  reviewSteps,
  reviewsOfKind,
} from "./overview"
import { reviewKey, type Decision, type Review, type ReviewMap } from "./types"

const TODAY = "2026-10-29" // Thursday
const d = (n: number, p: Partial<Decision> = {}): Decision => ({ id: `d0000000-0000-4000-8000-00000000000${n}`, text: `Decisión ${n}`, kind: "keep", expected: null, link: null, ...p })
const draft = (kind: "week" | "month", start: string, p: Partial<Review> = {}): Review => ({ ...emptyDraft(kind, start, "2026-10-29T10:00:00.000Z"), ...p })
const map = (...rs: Review[]): ReviewMap => Object.fromEntries(rs.map((r) => [reviewKey(r.kind, r.periodStart), r]))

describe("the review due now", () => {
  it("is last week from Monday to Saturday and this week on Sunday; last month until the month's last day", () => {
    expect(dueReview({}, "week", TODAY)).toMatchObject({ period: { from: "2026-10-19", to: "2026-10-25" }, phase: "ready" })
    expect(dueReview({}, "week", "2026-11-01").period.from).toBe("2026-10-26")
    expect(dueReview({}, "month", TODAY).period.from).toBe("2026-09-01")
    expect(dueReview({}, "month", "2026-10-31").period.from).toBe("2026-10-01")
  })

  it("reads ready, draft or closed from the stored review", () => {
    const state = makeState([])
    const w = draft("week", "2026-10-19", { content: { wins: "Bien" } })
    expect(dueReview(map(w), "week", TODAY).phase).toBe("draft")
    const closed = closeReview(w, buildReviewSnapshot({ state, kind: "week", periodStart: "2026-10-19", today: TODAY, computedAt: "x" }), "x")
    expect(dueReview(map(closed), "week", TODAY).phase).toBe("closed")
  })
})

describe("history", () => {
  it("is grouped by the month of each period start, newest first, one kind at a time", () => {
    const rs = map(draft("week", "2026-10-19"), draft("week", "2026-09-28"), draft("week", "2026-10-05"), draft("month", "2026-09-01"))
    expect(reviewsOfKind(rs, "week").map((r) => r.periodStart)).toEqual(["2026-10-19", "2026-10-05", "2026-09-28"])
    expect(historyGroups(rs, "week").map((g) => [g.label, g.reviews.length])).toEqual([
      ["Octubre de 2026", 2],
      ["Septiembre de 2026", 1],
    ])
    expect(historyGroups(rs, "month").map((g) => g.month)).toEqual(["2026-09"])
  })

  it("past periods go back to the start of the history, or a bounded number without history", () => {
    expect(pastPeriods("week", TODAY, "2026-10-07").map((p) => p.from)).toEqual(["2026-10-19", "2026-10-12", "2026-10-05"])
    expect(pastPeriods("month", TODAY, "2026-08-20").map((p) => p.from)).toEqual(["2026-09-01", "2026-08-01"])
    expect(pastPeriods("week", TODAY, null, 4)).toHaveLength(4)
  })
})

describe("steps and progress", () => {
  it("adds «Decisiones anteriores» only when the previous review left decisions", () => {
    expect(reviewSteps(null)).toEqual(["figures", "reflection", "decisions", "close"])
    expect(reviewSteps({ decisions: [] })).toEqual(["figures", "reflection", "decisions", "close"])
    expect(reviewSteps({ decisions: [d(1)] })).toEqual(["figures", "reflection", "evaluations", "decisions", "close"])
  })

  it("the previous review is the one of the previous period of the same kind", () => {
    const prev = draft("week", "2026-10-12", { decisions: [d(1)] })
    const p = periodFromStart("week", "2026-10-19")!
    expect(previousReviewOf(map(prev, draft("month", "2026-09-01")), p)).toBe(prev)
    expect(previousReviewOf(map(draft("week", "2026-10-05")), p)).toBeNull()
  })

  it("counts answered questions (not the free note), decisions and decisions still to evaluate", () => {
    expect(progressLabel(undefined, null, 3)).toBe("0 de 3 preguntas · 0 decisiones")
    const r = draft("week", "2026-10-19", { content: { wins: "Sí", note: "Nota", lessons: "  " }, decisions: [d(3)] })
    expect(progressLabel(r, { decisions: [d(1), d(2)] }, 3)).toBe("1 de 3 preguntas · 1 decisión · 2 por evaluar")
  })
})

describe("figures", () => {
  it("a closed review shows its frozen snapshot; a draft shows live figures from the same builder", () => {
    const state = makeState([])
    const p = periodFromStart("week", "2026-10-19")!
    const live = figuresFor(state, undefined, p, TODAY)
    expect(live).toEqual(buildReviewSnapshot({ state, kind: "week", periodStart: p.from, today: TODAY, computedAt: "" }))
    const frozen = { ...live!, computedAt: "frozen" }
    const closed = closeReview(draft("week", p.from), frozen, "frozen")
    expect(figuresFor(state, closed, p, TODAY)).toBe(frozen)
    expect(figuresFor(state, undefined, periodFromStart("week", "2026-10-26")!, TODAY)).toBeNull()
  })
})

describe("decision log", () => {
  const w1 = draft("week", "2026-10-05", { decisions: [d(1, { kind: "start" }), d(2)] })
  const w2 = draft("week", "2026-10-12", {
    decisions: [d(3, { kind: "drop" })],
    evaluations: [{ decisionId: d(1).id, from: "2026-10-05", outcome: "done", note: null }, { decisionId: d(2).id, from: "2026-10-05", outcome: "missed", note: "Viaje" }],
  })
  // An evaluation stored in a review of another period never counts.
  const stray = draft("week", "2026-10-26", { evaluations: [{ decisionId: d(3).id, from: "2026-10-05", outcome: "done", note: null }] })
  const log = decisionLog(map(w1, w2, stray, draft("month", "2026-09-01", { decisions: [d(4)] })))

  it("pairs each decision with its evaluation in the next review of the same kind, newest first", () => {
    expect(log.map((e) => [e.period.from, e.decision.id.slice(-1), e.evaluation?.outcome ?? null, e.evaluatedIn])).toEqual([
      ["2026-10-12", "3", null, null],
      ["2026-10-05", "1", "done", "2026-10-12"],
      ["2026-10-05", "2", "missed", "2026-10-12"],
      ["2026-09-01", "4", null, null],
    ])
  })

  it("filters by kind, decision type and outcome, and counts done over evaluated (n), never a score", () => {
    expect(filterLog(log, { kind: "month", decision: "all", outcome: "all" })).toHaveLength(1)
    expect(filterLog(log, { kind: "all", decision: "start", outcome: "all" }).map((e) => e.decision.id.slice(-1))).toEqual(["1"])
    expect(filterLog(log, { kind: "all", decision: "all", outcome: "pending" })).toHaveLength(2)
    expect(logSummary(log)).toEqual({ done: 1, evaluated: 2 })
  })
})

describe("demo reviews", () => {
  it("two closed weeks and a closed month before the ones due now, with last week's decisions to evaluate", () => {
    const state = createDemoState("2026-10-21")
    const weeks = reviewsOfKind(state.reviews, "week")
    expect(weeks.map((r) => [r.periodStart, r.status])).toEqual([
      ["2026-10-05", "closed"],
      ["2026-09-28", "closed"],
    ])
    expect(reviewsOfKind(state.reviews, "month").map((r) => [r.periodStart, r.status])).toEqual([["2026-08-01", "closed"]])
    const due = dueReview(state.reviews, "week", "2026-10-21")
    expect(due).toMatchObject({ phase: "ready", period: { from: "2026-10-12" } })
    expect(previousReviewOf(state.reviews, due.period)?.decisions).toHaveLength(2)
    // Every closed demo review holds real figures of the demo records.
    for (const r of weeks) expect(r.snapshot?.habits.current.applicable).toBeGreaterThan(0)
  })
})
