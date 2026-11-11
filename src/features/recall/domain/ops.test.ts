import { describe, expect, it } from "vitest"
import { addCard, answerOutcome, emptyRecall, LIMITS, recordAnswer, removeCard, setSuspended, validateCardText } from "./ops"
import { nextSchedule } from "./schedule"
import type { RecallState } from "./types"

const TODAY = "2026-11-09"
const AT = "2026-11-09T10:00:00.000Z"
const ID = "11111111-1111-4111-8111-111111111111"
const NOTE = "22222222-2222-4222-8222-222222222222"
const withCard = (): RecallState => addCard(emptyRecall(), { id: ID, question: " ¿Qué es? ", answer: " Esto ", sourceType: "note", sourceId: NOTE, today: TODAY, at: AT })
const answer = (s: RecallState, attemptId: string, grade: "again" | "good", respondedAt: string, today = TODAY) => recordAnswer(s, answerOutcome(s.cards[ID], { attemptId, grade, respondedAt, today }))

describe("a card's text", () => {
  it("is trimmed and needs both sides", () => {
    expect(validateCardText(" a ", " b ")).toEqual({ ok: true, question: "a", answer: "b" })
    expect(validateCardText("  ", "b")).toMatchObject({ ok: false, field: "question" })
    expect(validateCardText("a", "\n")).toMatchObject({ ok: false, field: "answer" })
  })

  it("has limits on each side", () => {
    expect(validateCardText("x".repeat(LIMITS.question + 1), "b")).toMatchObject({ ok: false, field: "question" })
    expect(validateCardText("a", "x".repeat(LIMITS.answer + 1))).toMatchObject({ ok: false, field: "answer" })
  })
})

describe("adding a card", () => {
  it("starts new and due today, with its text clean and its origin", () => {
    expect(withCard().cards[ID]).toMatchObject({ id: ID, question: "¿Qué es?", answer: "Esto", sourceType: "note", sourceId: NOTE, suspendedOn: null, firstAnsweredOn: null, createdAt: AT, schedule: { state: "new", dueOn: TODAY } })
  })

  it("adding the same id again changes nothing", () => {
    const s = withCard()
    expect(addCard(s, { id: ID, question: "Otra", answer: "Otra", sourceType: null, sourceId: null, today: TODAY, at: AT })).toBe(s)
  })
})

describe("answering", () => {
  it("records the attempt with the dates before and after, and moves the card", () => {
    const s = answer(withCard(), "a1", "good", AT)
    expect(s.cards[ID].schedule).toEqual(nextSchedule(withCard().cards[ID].schedule, "good", TODAY))
    expect(s.cards[ID]).toMatchObject({ firstAnsweredOn: TODAY, lastAnsweredAt: AT })
    expect(s.attempts.a1).toMatchObject({ id: "a1", cardId: ID, grade: "good", respondedAt: AT, localDate: TODAY, dueOnBefore: TODAY, dueOnAfter: "2026-11-10", intervalDays: 1, algorithmVersion: 1 })
  })

  it("keeps the day of the first answer", () => {
    const one = answer(withCard(), "a1", "again", AT)
    const two = answer(one, "a2", "good", "2026-11-10T10:00:00.000Z", "2026-11-10")
    expect(two.cards[ID].firstAnsweredOn).toBe(TODAY)
    expect(Object.keys(two.attempts)).toEqual(["a1", "a2"])
  })

  it("an answer older than the last one is kept in the history but does not move the card back", () => {
    const later = answer(withCard(), "late", "good", "2026-11-09T12:00:00.000Z")
    const older = recordAnswer(later, { ...answerOutcome(withCard().cards[ID], { attemptId: "early", grade: "again", respondedAt: "2026-11-09T09:00:00.000Z", today: TODAY }) })
    expect(older.cards[ID].schedule).toEqual(later.cards[ID].schedule)
    expect(older.cards[ID].lastAnsweredAt).toBe("2026-11-09T12:00:00.000Z")
    expect(Object.keys(older.attempts).sort()).toEqual(["early", "late"])
  })

  it("the same attempt twice counts once", () => {
    const outcome = answerOutcome(withCard().cards[ID], { attemptId: "a1", grade: "good", respondedAt: AT, today: TODAY })
    const once = recordAnswer(withCard(), outcome)
    expect(recordAnswer(once, outcome)).toBe(once)
  })

  it("an answer for a card that is gone changes nothing", () => {
    const s = withCard()
    const outcome = answerOutcome(s.cards[ID], { attemptId: "a1", grade: "good", respondedAt: AT, today: TODAY })
    const gone = removeCard(s, ID)
    expect(recordAnswer(gone, outcome)).toBe(gone)
  })
})

describe("suspending and removing", () => {
  it("suspending keeps the schedule, and resuming brings it back as it was", () => {
    const s = answer(withCard(), "a1", "good", AT)
    const off = setSuspended(s, ID, TODAY)
    expect(off.cards[ID]).toMatchObject({ suspendedOn: TODAY, schedule: s.cards[ID].schedule })
    expect(setSuspended(off, ID, null).cards[ID]).toEqual(s.cards[ID])
  })

  it("removing the card keeps its past attempts", () => {
    const s = removeCard(answer(withCard(), "a1", "good", AT), ID)
    expect(s.cards[ID]).toBeUndefined()
    expect(Object.keys(s.attempts)).toEqual(["a1"])
  })

  it("an unknown card changes nothing", () => {
    const s = emptyRecall()
    expect(setSuspended(s, ID, TODAY)).toBe(s)
    expect(removeCard(s, ID)).toBe(s)
  })
})
