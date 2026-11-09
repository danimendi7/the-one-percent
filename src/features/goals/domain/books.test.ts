import { describe, expect, it } from "vitest"
import type { Book, ContentItem } from "@/features/knowledge/domain/types"
import { goalBooksProgress, linkableBooks } from "./books"

const book = (id: string, p: { status?: Book["status"]; title?: string; pageCount?: number | null; currentPage?: number | null; progressPercent?: number | null } = {}) =>
  ({
    id,
    kind: "book",
    title: p.title ?? id,
    status: p.status ?? "planned",
    book: { pageCount: p.pageCount ?? null, currentPage: p.currentPage ?? null, progressPercent: p.progressPercent ?? null },
  }) as unknown as Book
const episode = { id: "ep", kind: "episode", title: "Ep", status: "done", episode: { durationSeconds: null, positionSeconds: null } } as unknown as ContentItem
const items = (...list: ContentItem[]) => Object.fromEntries(list.map((i) => [i.id, i]))

describe("books of a goal", () => {
  it("counts finished books and gives each one its reading progress", () => {
    const p = goalBooksProgress(["a", "b", "c"], items(book("a", { status: "done" }), book("b", { status: "active", pageCount: 200, currentPage: 50 }), book("c")))
    expect([p.finished, p.total, p.share]).toEqual([1, 3, 1 / 3])
    expect(p.rows.map((r) => r.progress)).toEqual([1, 0.25, null])
  })

  it("lists an abandoned book but stops expecting it", () => {
    const p = goalBooksProgress(["a", "b"], items(book("a", { status: "done" }), book("b", { status: "abandoned" })))
    expect([p.rows.length, p.finished, p.total, p.share]).toEqual([2, 1, 1, 1])
  })

  it("leaves out what is no longer a book in the Library, without touching the ids", () => {
    const ids = ["gone", "ep", "a"]
    const p = goalBooksProgress(ids, items(episode, book("a")))
    expect(p.rows.map((r) => r.book.id)).toEqual(["a"])
    expect(ids).toEqual(["gone", "ep", "a"])
  })

  it("gives no percentage when no book counts (not a made-up 0 %)", () => {
    expect(goalBooksProgress([], {}).share).toBeNull()
    expect(goalBooksProgress(undefined, {}).share).toBeNull()
    expect(goalBooksProgress(["a"], items(book("a", { status: "abandoned" }))).share).toBeNull()
  })

  it("offers only books not linked yet, by title", () => {
    const list = linkableBooks(["b"], items(book("c", { title: "Zen" }), book("b"), book("a", { title: "Ábaco" }), episode))
    expect(list.map((b) => b.id)).toEqual(["a", "c"])
  })
})
