import { describe, expect, it } from "vitest"
import { afterAnswer, currentCard, intervalLabel } from "./session"
import { createDemoRecall } from "../fixtures"
import { dailyQueue } from "./schedule"

const card = (id: string) => ({ id })

describe("the card shown next", () => {
  it("is the first of the queue", () => {
    expect(currentCard([card("a"), card("b")], [])).toEqual(card("a"))
  })

  it("leaves what you failed in this session for the end", () => {
    expect(currentCard([card("a"), card("b")], ["a"])).toEqual(card("b"))
  })

  it("comes back to the failed ones, the first failed first", () => {
    expect(currentCard([card("a"), card("b")], ["b", "a"])).toEqual(card("b"))
  })

  it("ignores failed cards no longer in the queue, and is empty at the end", () => {
    expect(currentCard([card("a")], ["gone"])).toEqual(card("a"))
    expect(currentCard([], ["gone"])).toBeNull()
  })
})

describe("after answering", () => {
  it("a failed card goes to the end of the failed ones", () => {
    expect(afterAnswer([], "a", "again")).toEqual(["a"])
    expect(afterAnswer(["a", "b"], "a", "again")).toEqual(["b", "a"])
  })

  it("remembering it takes it out", () => {
    expect(afterAnswer(["a", "b"], "a", "good")).toEqual(["b"])
    expect(afterAnswer(["a"], "x", "easy")).toEqual(["a"])
  })
})

describe("when a card comes back, in words", () => {
  it("reads naturally at every distance", () => {
    expect([0, 1, 6, 59, 60, 365].map(intervalLabel)).toEqual(["hoy", "en 1 día", "en 6 días", "en 59 días", "en 2 meses", "en 12 meses"])
  })
})

describe("the demo cards", () => {
  it("show a queue with an overdue card, one due today and a new one, and something ahead", () => {
    const today = "2026-10-21"
    const { cards } = createDemoRecall(today)
    const q = dailyQueue(Object.values(cards), today)
    expect(q).toMatchObject({ due: 2, newToday: 1, heldBack: 0 })
    expect(q.queue.map((c) => c.schedule.state)).toEqual(["review", "review", "new"])
    expect(Object.values(cards).some((c) => c.schedule.dueOn > today)).toBe(true)
    expect(q.queue.every((c) => c.question.length > 0 && c.answer.length > 0)).toBe(true)
  })
})
