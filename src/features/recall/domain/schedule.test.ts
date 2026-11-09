import { describe, expect, it } from "vitest"
import { ALGORITHM_VERSION, dailyQueue, DEFAULT_NEW_PER_DAY, forecast, isDue, MAX_INTERVAL_DAYS, MIN_EASE, newSchedule, nextSchedule, previewIntervals, type Grade, type Schedule } from "./schedule"

const TODAY = "2026-11-09" // Monday
const fresh = () => newSchedule(TODAY)
const review = (p: Partial<Schedule> = {}): Schedule => ({ state: "review", reps: 3, lapses: 0, easeFactor: 2.5, intervalDays: 15, dueOn: TODAY, ...p })
const answer = (s: Schedule, g: Grade, today = TODAY) => nextSchedule(s, g, today)

describe("a new card", () => {
  it("is due today, with the starting ease and no history", () => {
    expect(fresh()).toEqual({ state: "new", reps: 0, lapses: 0, easeFactor: 2.5, intervalDays: 0, dueOn: TODAY })
  })

  it("Again keeps it for today, as learning, without a lapse: it was never known", () => {
    expect(answer(fresh(), "again")).toEqual({ state: "learning", reps: 0, lapses: 0, easeFactor: 2.5, intervalDays: 0, dueOn: TODAY })
  })

  it("Hard and Good bring it back tomorrow; Easy in four days", () => {
    expect(answer(fresh(), "hard")).toMatchObject({ state: "review", reps: 1, intervalDays: 1, dueOn: "2026-11-10" })
    expect(answer(fresh(), "good")).toMatchObject({ state: "review", reps: 1, intervalDays: 1, dueOn: "2026-11-10" })
    expect(answer(fresh(), "easy")).toMatchObject({ state: "review", reps: 1, intervalDays: 4, dueOn: "2026-11-13" })
  })

  it("the first answer does not change its ease", () => {
    for (const g of ["hard", "good", "easy"] as const) expect(answer(fresh(), g).easeFactor).toBe(2.5)
  })
})

describe("the classic Good sequence", () => {
  it("is 1, 6, then the interval times the ease, the same every time", () => {
    const days: number[] = []
    let s = fresh()
    for (let i = 0; i < 6; i++) {
      s = answer(s, "good")
      days.push(s.intervalDays)
    }
    expect(days).toEqual([1, 6, 15, 38, 95, 238])
  })
})

describe("a card under review", () => {
  it("Again is a lapse: back to today, repetitions lost, ease lowered", () => {
    expect(answer(review(), "again")).toEqual({ state: "learning", reps: 0, lapses: 1, easeFactor: 2.3, intervalDays: 0, dueOn: TODAY })
  })

  it("after a lapse it starts over from one day", () => {
    expect(answer(answer(review(), "again"), "good")).toMatchObject({ state: "review", reps: 1, intervalDays: 1, lapses: 1, dueOn: "2026-11-10" })
  })

  it("Hard grows little and lowers the ease", () => {
    expect(answer(review(), "hard")).toMatchObject({ reps: 4, intervalDays: 18, easeFactor: 2.35, dueOn: "2026-11-27" })
  })

  it("Good multiplies by the ease and leaves it alone", () => {
    expect(answer(review(), "good")).toMatchObject({ reps: 4, intervalDays: 38, easeFactor: 2.5, dueOn: "2026-12-17" })
  })

  it("Easy goes further and raises the ease", () => {
    expect(answer(review(), "easy")).toMatchObject({ reps: 4, intervalDays: 49, easeFactor: 2.65, dueOn: "2026-12-28" })
  })

  it("the options are always strictly ordered", () => {
    const cases: Partial<Schedule>[] = [{ reps: 1, intervalDays: 1 }, { reps: 2, intervalDays: 1, easeFactor: MIN_EASE }, { reps: 2, intervalDays: 2, easeFactor: 1.3 }, { reps: 5, intervalDays: 40 }]
    for (const c of cases) {
      const p = previewIntervals(review(c))
      expect(p.again).toBeLessThan(p.hard)
      expect(p.hard).toBeLessThan(p.good)
      expect(p.good).toBeLessThan(p.easy)
    }
  })

  it("the ease never falls below its floor, nor drifts with decimals", () => {
    let s = review({ easeFactor: 1.35 })
    s = answer(s, "hard")
    expect(s.easeFactor).toBe(MIN_EASE)
    expect(answer(review({ easeFactor: MIN_EASE }), "again").easeFactor).toBe(MIN_EASE)
    let e = review()
    for (let i = 0; i < 7; i++) e = answer(e, "easy")
    expect(e.easeFactor).toBe(3.55)
  })

  it("no interval goes beyond a year", () => {
    expect(answer(review({ intervalDays: 300 }), "good").intervalDays).toBe(MAX_INTERVAL_DAYS)
    expect(answer(review({ intervalDays: 300 }), "easy").intervalDays).toBe(MAX_INTERVAL_DAYS)
    expect(answer(review({ intervalDays: MAX_INTERVAL_DAYS }), "hard").intervalDays).toBe(MAX_INTERVAL_DAYS)
  })
})

describe("the calendar", () => {
  it("counts days from the day it is answered, not from when it was due", () => {
    expect(answer(review({ dueOn: "2026-10-01" }), "good", TODAY).dueOn).toBe("2026-12-17")
  })

  it("is in local dates: the change of hour and the new year do not shift it", () => {
    expect(answer(review({ intervalDays: 1, reps: 2, easeFactor: 1.3 }), "hard", "2026-10-24").dueOn).toBe("2026-10-26")
    expect(answer(fresh(), "easy", "2026-12-30").dueOn).toBe("2027-01-03")
  })

  it("does not mutate the card it reads", () => {
    const s = review()
    const copy = { ...s }
    answer(s, "easy")
    expect(s).toEqual(copy)
  })

  it("refuses a date that does not exist", () => {
    expect(() => answer(review(), "good", "2026-02-30")).toThrow()
  })

  it("has a version, so later changes can be told apart", () => {
    expect(ALGORITHM_VERSION).toBe(1)
  })
})

describe("what to study today", () => {
  let n = 0
  const card = (schedule: Partial<Schedule> & { dueOn: string }, p: { suspendedOn?: string | null; firstAnsweredOn?: string | null; createdAt?: string; id?: string } = {}) => ({
    id: p.id ?? `c${String(++n).padStart(3, "0")}`,
    schedule: { state: "review", reps: 2, lapses: 0, easeFactor: 2.5, intervalDays: 6, ...schedule } as Schedule,
    suspendedOn: p.suspendedOn ?? null,
    firstAnsweredOn: "firstAnsweredOn" in p ? (p.firstAnsweredOn ?? null) : "2026-10-01",
    createdAt: p.createdAt ?? "2026-10-01T08:00:00Z",
  })
  const newCard = (createdAt: string, id?: string) => card({ state: "new", reps: 0, intervalDays: 0, dueOn: TODAY }, { firstAnsweredOn: null, createdAt, id })

  it("a card is due on its day and afterwards, never before, and not while suspended", () => {
    expect(isDue(card({ dueOn: TODAY }), TODAY)).toBe(true)
    expect(isDue(card({ dueOn: "2026-11-01" }), TODAY)).toBe(true)
    expect(isDue(card({ dueOn: "2026-11-10" }), TODAY)).toBe(false)
    expect(isDue(card({ dueOn: TODAY }, { suspendedOn: "2026-11-01" }), TODAY)).toBe(false)
  })

  it("puts the most overdue first and new cards last, the oldest of them first", () => {
    const a = card({ dueOn: TODAY }, { id: "a" })
    const b = card({ dueOn: "2026-11-01" }, { id: "b" })
    const c = newCard("2026-11-02T08:00:00Z", "c")
    const d = newCard("2026-11-01T08:00:00Z", "d")
    expect(dailyQueue([c, a, d, b], TODAY).queue.map((x) => x.id)).toEqual(["b", "a", "d", "c"])
  })

  it("never lists what is suspended or not due yet", () => {
    const r = dailyQueue([card({ dueOn: "2026-12-01" }), card({ dueOn: TODAY }, { suspendedOn: TODAY, id: "s" })], TODAY)
    expect(r.queue).toEqual([])
    expect(r).toMatchObject({ due: 0, newToday: 0, heldBack: 0 })
  })

  it("limits only the new cards, counting those already started today, and says how many wait", () => {
    const fresh = Array.from({ length: DEFAULT_NEW_PER_DAY + 3 }, (_, i) => newCard(`2026-11-01T08:00:${String(i).padStart(2, "0")}Z`))
    const started = card({ dueOn: "2026-11-10" }, { firstAnsweredOn: TODAY })
    const reviews = Array.from({ length: 150 }, () => card({ dueOn: TODAY }))
    const r = dailyQueue([...fresh, started, ...reviews], TODAY)
    expect(r.due).toBe(150)
    expect(r.newToday).toBe(DEFAULT_NEW_PER_DAY - 1)
    expect(r.heldBack).toBe(4)
    expect(r.queue).toHaveLength(150 + DEFAULT_NEW_PER_DAY - 1)
  })

  it("a limit of zero stops new cards and never goes negative", () => {
    const r = dailyQueue([newCard("2026-11-01T08:00:00Z"), card({ dueOn: "2026-11-10" }, { firstAnsweredOn: TODAY })], TODAY, { newPerDay: 0 })
    expect(r).toMatchObject({ newToday: 0, heldBack: 1, queue: [] })
  })

  it("the same input gives the same order", () => {
    const a = card({ dueOn: TODAY }, { id: "a" })
    const b = card({ dueOn: TODAY }, { id: "b" })
    expect(dailyQueue([b, a], TODAY).queue.map((x) => x.id)).toEqual(["a", "b"])
    expect(dailyQueue([a, b], TODAY).queue.map((x) => x.id)).toEqual(["a", "b"])
  })

  it("the forecast counts reviews by day, with the overdue today and without new or suspended cards", () => {
    const cards = [card({ dueOn: "2026-11-01" }), card({ dueOn: TODAY }), card({ dueOn: "2026-11-11" }), card({ dueOn: "2026-11-30" }), newCard("2026-11-01T08:00:00Z"), card({ dueOn: "2026-11-10" }, { suspendedOn: TODAY })]
    expect(forecast(cards, TODAY, 3)).toEqual([
      { date: TODAY, count: 2 },
      { date: "2026-11-10", count: 0 },
      { date: "2026-11-11", count: 1 },
    ])
  })
})
