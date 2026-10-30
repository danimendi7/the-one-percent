import { describe, expect, it } from "vitest"
import { demoLibrary } from "@/features/knowledge/demo"
import { createItem, createNote, type Ctx } from "@/features/knowledge/domain/ops"
import { emptyKnowledge } from "@/features/knowledge/domain/types"
import { changedFields, itemFields, noteFields, rowToItem, rowToLink, rowToNote, rowToShow, showFields, type WireRow } from "./library-wire"

const ctx: Ctx = { now: "2026-10-30T10:00:00.000Z", today: "2026-10-30" }
const demo = demoLibrary("2026-10-30")

/** What pull_library would return for an entity written with these fields. */
const row = (id: string, fields: Record<string, unknown>, extra: Record<string, unknown>): WireRow => ({ id, server_seq: 1, deleted: false, ...fields, ...extra })

describe("library wire format (M4b)", () => {
  it("books, episodes and shows survive the round trip", () => {
    for (const i of Object.values(demo.items)) {
      const back = rowToItem(row(i.id, itemFields(i), { kind: i.kind, created_at: i.createdAt, updated_at: i.updatedAt }))
      expect(back).toEqual(i)
    }
    for (const s of Object.values(demo.shows)) expect(rowToShow(row(s.id, showFields(s), { created_at: s.createdAt, updated_at: s.updatedAt }))).toEqual(s)
  })

  it("notes survive the round trip, including locators, applications and their links", () => {
    let st = ok(createItem(emptyKnowledge(), "book", "b1", { title: "X", book: { pageCount: 100 } }, ctx)).state
    st = ok(createNote(st, "n1", { itemId: "b1", type: "application", body: "Hacer", locator: { page: 3, label: "Cap. 1" }, applicationLink: { type: "goal", id: "g1", title: "Meta" } }, ctx)).state
    const all = [...Object.values(demo.notes), st.notes.n1]
    for (const n of all) expect(rowToNote(row(n.id, noteFields(n), { captured_at: n.createdAt, updated_at: n.updatedAt }))).toEqual(n)
    expect(noteFields(st.notes.n1)).toMatchObject({ application_goal_id: "g1", application_habit_id: null, page: 3, locator_label: "Cap. 1" })
  })

  it("format blocks map to their own columns only", () => {
    const book = Object.values(demo.items).find((i) => i.kind === "book")!
    const ep = Object.values(demo.items).find((i) => i.kind === "episode")!
    expect(Object.keys(itemFields(book))).not.toContain("show_id")
    expect(Object.keys(itemFields(ep))).not.toContain("isbn13")
  })

  it("links come back with their canonical key", () => {
    const l = Object.values(demo.links)[0]
    expect(rowToLink(row("x", {}, { a_type: l.a.type, a_id: l.a.id, b_type: l.b.type, b_id: l.b.id, created_at: l.createdAt }))).toEqual(l)
  })

  it("an update sends only the fields that changed", () => {
    const i = demo.items["demo-book-outlive"]
    const next = { ...i, rating: 8, topics: [...i.topics, "Salud"] }
    expect(changedFields(itemFields(i), itemFields(next))).toEqual({ rating: 8, topics: ["Longevidad", "Entrenamiento", "Salud"] })
    expect(changedFields(itemFields(i), itemFields(i))).toEqual({})
  })
})

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify((r as unknown as { error: unknown }).error))
  return r as Extract<T, { ok: true }>
}
