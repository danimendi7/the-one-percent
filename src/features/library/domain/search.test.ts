import { describe, expect, it } from "vitest"
import { BOOKS } from "../fixtures"
import { filterBooks, normalize, readingProgress } from "./search"

describe("library search", () => {
  it("is accent and case insensitive across title, author and tags", () => {
    expect(normalize("Séneca")).toBe("seneca")
    expect(filterBooks(BOOKS, { shelf: "all", query: "seneca", sort: "recent" }).map((b) => b.id)).toEqual(["b-cartas"])
    expect(filterBooks(BOOKS, { shelf: "all", query: "ESTOICISMO", sort: "recent" })).toHaveLength(2)
  })

  it("shelves are independent of the favourite flag", () => {
    const favs = filterBooks(BOOKS, { shelf: "favorites", query: "", sort: "recent" })
    expect(favs.every((b) => b.favorite)).toBe(true)
    expect(favs.every((b) => b.status === "finished")).toBe(true)
    expect(filterBooks(BOOKS, { shelf: "reading", query: "", sort: "recent" }).every((b) => b.status === "reading")).toBe(true)
  })

  it("sorts by rating with unrated last", () => {
    const sorted = filterBooks(BOOKS, { shelf: "all", query: "", sort: "rating" })
    expect(sorted[0].rating).toBe(10)
    expect(sorted.at(-1)?.rating).toBeUndefined()
  })

  it("supports unknown page counts", () => {
    expect(readingProgress(BOOKS.find((b) => b.id === "b-cartas")!)).toBeNull()
    expect(readingProgress(BOOKS.find((b) => b.id === "b-outlive")!)).toBeCloseTo(214 / 496)
  })
})
