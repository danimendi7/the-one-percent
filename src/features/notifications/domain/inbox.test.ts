import { describe, expect, it } from "vitest"
import { deliver, dismiss, localMinutesInZone, markAllRead, toSent, unread, visible, INBOX_MAX, type InboxItem } from "./inbox"
import type { Nudge } from "./motivation"

const nudge = (key: string, rule: Nudge["rule"] = "late"): Nudge => ({ key, rule, title: "T", body: "B" })
const NOW = { localDate: "2026-11-10", minutes: 19 * 60 + 30, at: "2026-11-10T18:30:00.000Z" }

describe("the inbox", () => {
  it("adds what is due, newest first, unread", () => {
    const items = deliver([], [nudge("late:1"), nudge("review:1", "review")], NOW)
    expect(items.map((i) => i.key)).toEqual(["late:1", "review:1"])
    expect(items[0]).toMatchObject({ read: false, dismissed: false, localDate: "2026-11-10", minutes: 1170, title: "T", body: "B" })
    expect(unread(items)).toBe(2)
  })

  it("never adds the same key twice", () => {
    const once = deliver([], [nudge("late:1")], NOW)
    expect(deliver(once, [nudge("late:1")], NOW)).toBe(once)
  })

  it("reading and dismissing hide or quiet an item, but it still counts as sent", () => {
    const items = deliver([], [nudge("a"), nudge("b")], NOW)
    expect(unread(markAllRead(items))).toBe(0)
    const gone = dismiss(items, "a")
    expect(visible(gone).map((i) => i.key)).toEqual(["b"])
    expect(toSent(gone).map((s) => s.key)).toEqual(["a", "b"])
  })

  it("keeps only the latest ones", () => {
    let items: InboxItem[] = []
    for (let i = 0; i < INBOX_MAX + 5; i++) items = deliver(items, [nudge(`k${i}`)], NOW)
    expect(items).toHaveLength(INBOX_MAX)
    expect(items[0].key).toBe(`k${INBOX_MAX + 4}`)
  })

  it("reads the local time of the profile, not of the device", () => {
    expect(localMinutesInZone(new Date("2026-11-10T18:30:00Z"), "Europe/Madrid")).toBe(19 * 60 + 30)
    expect(localMinutesInZone(new Date("2026-07-10T18:30:00Z"), "Europe/Madrid")).toBe(20 * 60 + 30)
    expect(localMinutesInZone(new Date("2026-11-10T18:30:00Z"), "America/New_York")).toBe(13 * 60 + 30)
  })
})
