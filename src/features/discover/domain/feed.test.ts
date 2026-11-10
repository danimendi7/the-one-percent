import { describe, expect, it } from "vitest"
import { CATALOG } from "./catalog"
import { applyFeedback, addOwnTopic, emptyDiscovery, removeOwnTopic, validateOwnTopic, CATEGORIES, TOPIC_LIMITS } from "./ops"
import { allTopics, dislikedCategories, historyTopics, savedTopics, topicByKey, todayTopic, upcomingTopics } from "./feed"
import type { DiscoveryState } from "./types"

const TODAY = "2026-11-10"
const AT = "2026-11-10T09:00:00.000Z"
const set = (d: DiscoveryState, key: string, fields: Parameters<typeof applyFeedback>[2], on = TODAY) => applyFeedback(d, key, fields, on, AT)
const key = (t: { key: string } | null) => t!.key
const OWN = "11111111-1111-4111-8111-111111111111"
const own = (d: DiscoveryState, id = OWN, p: Partial<Parameters<typeof addOwnTopic>[1]> = {}) => addOwnTopic(d, { id, title: "Mi tema", category: "Ciencia", body: "Lo que quiero recordar", sourceTitle: null, sourceUrl: null, at: AT, ...p })

describe("the curated catalog invents no sources", () => {
  const text = (t: (typeof CATALOG)[number]) => [t.title, t.hook, t.takeaway, t.recallQuestion, ...t.sections.flatMap((s) => [s.heading, s.body]), ...t.references.flatMap((r) => [r.title, r.note])].join(" ")

  it("has unique keys, enough topics and every part of a topic", () => {
    expect(new Set(CATALOG.map((t) => t.key)).size).toBe(CATALOG.length)
    expect(CATALOG.length).toBeGreaterThanOrEqual(8)
    for (const t of CATALOG) {
      expect(t.key.startsWith("curated:")).toBe(true)
      expect(t.sections.length).toBeGreaterThanOrEqual(2)
      expect(t.hook && t.takeaway).toBeTruthy()
    }
  })

  it("says of every topic that it is an unverified synthesis", () => {
    for (const t of CATALOG) expect(t.verification).toBe("unverified")
  })

  it.each(CATALOG.map((t) => [t.key, t] as const))("%s has no links, years or named studies", (_k, t) => {
    expect(text(t)).not.toMatch(/https?:|www\.|doi\b/i)
    expect(text(t)).not.toMatch(/\b(1[0-9]|20)\d{2}\b/)
    expect(text(t)).not.toMatch(/\bet al\b|estudio de|según un estudio|un estudio de|investigadores de|universidad de|publicado en/i)
  })
})

describe("today's topic", () => {
  it("is the same all day and on every device", () => {
    expect(key(todayTopic(emptyDiscovery(), TODAY))).toBe(key(todayTopic(emptyDiscovery(), TODAY)))
  })

  it("changes from day to day", () => {
    const days = Array.from({ length: 8 }, (_, i) => `2026-11-1${i}`).map((d) => key(todayTopic(emptyDiscovery(), d)))
    expect(new Set(days).size).toBeGreaterThan(1)
  })

  it("stays on screen after rating or saving it today", () => {
    const first = key(todayTopic(emptyDiscovery(), TODAY))
    expect(key(todayTopic(set(emptyDiscovery(), first, { rating: 8 }), TODAY))).toBe(first)
    expect(key(todayTopic(set(emptyDiscovery(), first, { saved: true }), TODAY))).toBe(first)
  })

  it("does not come back on later days once rated or saved", () => {
    const first = key(todayTopic(emptyDiscovery(), TODAY))
    const d = set(emptyDiscovery(), first, { rating: 8 })
    const later = Array.from({ length: 30 }, (_, i) => `2026-12-${String(i + 1).padStart(2, "0")}`).map((x) => key(todayTopic(d, x)))
    expect(later).not.toContain(first)
  })

  it("«No me interesa» and «Ya lo sé» take it away at once and for good", () => {
    const first = key(todayTopic(emptyDiscovery(), TODAY))
    for (const dismissed of ["not_interested", "already_known"] as const) {
      const d = set(emptyDiscovery(), first, { dismissed })
      expect(key(todayTopic(d, TODAY))).not.toBe(first)
      expect(key(todayTopic(d, "2026-12-01"))).not.toBe(first)
    }
  })

  it("undoing a dismissal brings it back", () => {
    const first = key(todayTopic(emptyDiscovery(), TODAY))
    const d = set(set(emptyDiscovery(), first, { dismissed: "not_interested" }), first, { dismissed: null })
    expect(key(todayTopic(d, TODAY))).toBe(first)
  })

  it("includes the user's own topics", () => {
    const d = own(emptyDiscovery())
    expect(allTopics(d).some((t) => t.key === OWN)).toBe(true)
    let found = false
    for (let i = 1; i <= 28 && !found; i++) found = key(todayTopic(d, `2026-11-${String(i).padStart(2, "0")}`)) === OWN
    expect(found).toBe(true)
  })

  it("is null once every topic has been decided", () => {
    let d = emptyDiscovery()
    for (const t of allTopics(d)) d = set(d, t.key, { dismissed: "already_known" })
    expect(todayTopic(d, TODAY)).toBeNull()
    expect(upcomingTopics(d, TODAY, 3)).toEqual([])
  })
})

describe("a disliked subject is not insisted on", () => {
  const byCategory = (c: string) => CATALOG.filter((t) => t.category === c)
  const multi = [...new Set(CATALOG.map((t) => t.category))].find((c) => byCategory(c).length >= 3)!
  const dislike = () => {
    const [a, b] = byCategory(multi)
    return set(set(emptyDiscovery(), a.key, { rating: 2 }, "2026-11-01"), b.key, { rating: 3 }, "2026-11-02")
  }

  it("needs at least two low ratings", () => {
    expect(dislikedCategories(set(emptyDiscovery(), byCategory(multi)[0].key, { rating: 1 }))).toEqual([])
    expect(dislikedCategories(dislike())).toEqual([multi])
  })

  it("a category well rated overall is not disliked", () => {
    const [a, b, c] = byCategory(multi)
    expect(dislikedCategories(set(set(set(emptyDiscovery(), a.key, { rating: 2 }), b.key, { rating: 3 }), c.key, { rating: 10 }))).toEqual([])
  })

  it("leaves that category out while others remain", () => {
    const d = dislike()
    for (let i = 1; i <= 28; i++) expect(todayTopic(d, `2026-12-${String(i).padStart(2, "0")}`)!.category).not.toBe(multi)
  })

  it("offers it again when nothing else is left", () => {
    let d = dislike()
    for (const t of allTopics(d)) if (t.category !== multi) d = set(d, t.key, { dismissed: "already_known" })
    expect(todayTopic(d, "2026-12-01")!.category).toBe(multi)
  })
})

describe("the feedback", () => {
  const first = CATALOG[0].key

  it("keeps rating, bookmark and dismissal independently", () => {
    const d = set(set(emptyDiscovery(), first, { rating: 9 }), first, { saved: true })
    expect(d.feedback[first]).toMatchObject({ rating: 9, saved: true, dismissed: null, decidedOn: TODAY })
  })

  it("a rating can be changed and removed", () => {
    expect(set(set(emptyDiscovery(), first, { rating: 9 }), first, { rating: 4 }).feedback[first].rating).toBe(4)
    expect(set(set(emptyDiscovery(), first, { rating: 9 }), first, { rating: null }).feedback[first].rating).toBeNull()
  })

  it("lists what was saved and what was rated, the latest first", () => {
    const d = set(set(emptyDiscovery(), CATALOG[0].key, { saved: true }, "2026-11-01"), CATALOG[1].key, { rating: 7 }, "2026-11-05")
    expect(savedTopics(d).map((t) => t.key)).toEqual([CATALOG[0].key])
    expect(historyTopics(d).map((h) => h.topic.key)).toEqual([CATALOG[1].key, CATALOG[0].key])
  })

  it("the history leaves out a topic whose feedback was fully undone", () => {
    expect(historyTopics(set(set(emptyDiscovery(), first, { rating: 7 }), first, { rating: null }))).toEqual([])
  })
})

describe("the user's own topics", () => {
  it("say they were written by the user, and carry the source they gave", () => {
    const t = topicByKey(own(emptyDiscovery(), OWN, { sourceTitle: "Un libro", sourceUrl: "https://ejemplo.org/x" }), OWN)!
    expect(t).toMatchObject({ origin: "own", verification: "user_written", title: "Mi tema", sections: [{ body: "Lo que quiero recordar" }] })
    expect(t.references).toEqual([{ title: "Un libro", note: "Fuente indicada por ti, sin comprobar.", url: "https://ejemplo.org/x" }])
  })

  it("without a source have no references", () => {
    expect(topicByKey(own(emptyDiscovery()), OWN)!.references).toEqual([])
  })

  it("are validated: title and text needed, limits, known category, safe link", () => {
    const ok = { title: " T ", category: CATEGORIES[0], body: " B ", sourceTitle: "", sourceUrl: "" }
    expect(validateOwnTopic(ok)).toEqual({ ok: true, title: "T", category: CATEGORIES[0], body: "B", sourceTitle: null, sourceUrl: null })
    expect(validateOwnTopic({ ...ok, title: " " })).toMatchObject({ ok: false, field: "title" })
    expect(validateOwnTopic({ ...ok, body: "" })).toMatchObject({ ok: false, field: "body" })
    expect(validateOwnTopic({ ...ok, title: "x".repeat(TOPIC_LIMITS.title + 1) })).toMatchObject({ ok: false, field: "title" })
    expect(validateOwnTopic({ ...ok, body: "x".repeat(TOPIC_LIMITS.body + 1) })).toMatchObject({ ok: false, field: "body" })
    expect(validateOwnTopic({ ...ok, category: "Inventada" })).toMatchObject({ ok: false, field: "category" })
    expect(validateOwnTopic({ ...ok, sourceUrl: "javascript:alert(1)" })).toMatchObject({ ok: false, field: "sourceUrl" })
    expect(validateOwnTopic({ ...ok, sourceUrl: "https://ejemplo.org" })).toMatchObject({ ok: true, sourceUrl: "https://ejemplo.org/" })
  })

  it("can be removed; adding the same id twice changes nothing", () => {
    const d = own(emptyDiscovery())
    expect(own(d, OWN, { title: "Otro" })).toBe(d)
    expect(topicByKey(removeOwnTopic(d, OWN), OWN)).toBeNull()
  })

  it("a removed topic leaves the history", () => {
    const d = set(own(emptyDiscovery()), OWN, { rating: 9 })
    expect(historyTopics(removeOwnTopic(d, OWN))).toEqual([])
  })
})
