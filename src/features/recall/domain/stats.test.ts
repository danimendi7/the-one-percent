import { describe, expect, it } from "vitest"
import { addCard, answerOutcome, emptyRecall, recordAnswer, setSuspended } from "./ops"
import { noteRecallSummary, recallStats, RECALL_HISTORY_DAYS } from "./stats"
import type { RecallState } from "./types"

const TODAY = "2026-11-10"
const NOTE = "note-1"
const AT = "2026-11-10T09:00:00.000Z"
const card = (d: RecallState, id: string, sourceId: string | null = NOTE) => addCard(d, { id, question: "q", answer: "r", sourceType: sourceId ? "note" : null, sourceId, today: TODAY, at: AT })
let n = 0
function answer(d: RecallState, id: string, grade: "again" | "good" | "easy", on = TODAY): RecallState {
  return recordAnswer(d, answerOutcome(d.cards[id], { attemptId: `a${++n}`, grade, respondedAt: `${on}T10:0${n % 10}:00.000Z`, today: on }))
}
const WEEK = { from: "2026-11-04", to: TODAY }

describe("recall in Life Analytics", () => {
  it("with nothing answered has no retention to show, not a zero", () => {
    expect(recallStats(emptyRecall(), WEEK, TODAY)).toMatchObject({ answers: 0, remembered: 0, retention: null, cardsDue: 0, cards: 0 })
  })

  it("counts the answers of the period and how many were remembered", () => {
    let d = card(card(emptyRecall(), "a"), "b")
    d = answer(answer(answer(d, "a", "again"), "a", "good"), "b", "easy")
    expect(recallStats(d, WEEK, TODAY)).toMatchObject({ answers: 3, remembered: 2, retention: 2 / 3 })
  })

  it("leaves out answers outside the period, at both ends", () => {
    let d = card(emptyRecall(), "a")
    d = answer(answer(answer(d, "a", "good", "2026-11-03"), "a", "good", "2026-11-04"), "a", "good", TODAY)
    expect(recallStats(d, WEEK, TODAY).answers).toBe(2)
    expect(recallStats(d, { from: "2026-11-04", to: "2026-11-05" }, TODAY).answers).toBe(1)
  })

  it("counts what is waiting today and the cards in use, without suspended ones", () => {
    let d = card(card(card(emptyRecall(), "a"), "b"), "c")
    d = answer(d, "a", "good")
    d = setSuspended(d, "c", TODAY)
    expect(recallStats(d, WEEK, TODAY)).toMatchObject({ cardsDue: 1, cards: 2 })
  })

  it("says when the period reaches further than a device keeps", () => {
    const edge = "2026-08-12"
    expect(RECALL_HISTORY_DAYS).toBe(90)
    expect(recallStats(emptyRecall(), { from: edge, to: TODAY }, TODAY).historyLimited).toBe(false)
    expect(recallStats(emptyRecall(), { from: "2026-08-11", to: TODAY }, TODAY).historyLimited).toBe(true)
  })
})

describe("an idea in Cerebro knows about its cards", () => {
  it("has nothing to say without cards", () => {
    expect(noteRecallSummary(emptyRecall(), NOTE, TODAY)).toBeNull()
    expect(noteRecallSummary(card(emptyRecall(), "x", "otra"), NOTE, TODAY)).toBeNull()
  })

  it("is waiting today when a card is due", () => {
    expect(noteRecallSummary(card(emptyRecall(), "a"), NOTE, TODAY)).toEqual({ cards: 1, nextDue: TODAY, dueNow: true, daysToNext: 0 })
  })

  it("says when its next card comes back, the soonest of them", () => {
    let d = card(card(emptyRecall(), "a"), "b")
    d = answer(answer(d, "a", "easy"), "b", "good")
    expect(noteRecallSummary(d, NOTE, TODAY)).toEqual({ cards: 2, nextDue: "2026-11-11", dueNow: false, daysToNext: 1 })
  })

  it("ignores suspended cards", () => {
    expect(noteRecallSummary(setSuspended(card(emptyRecall(), "a"), "a", TODAY), NOTE, TODAY)).toBeNull()
  })
})
