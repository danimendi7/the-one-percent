import type { Book, BookStatus } from "../fixtures"

export type Shelf = "all" | BookStatus | "favorites"
export type SortKey = "recent" | "title" | "rating"

/** Accent- and case-insensitive normalisation for search. */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim()
}

export function filterBooks(books: Book[], opts: { shelf: Shelf; query: string; sort: SortKey }): Book[] {
  const q = normalize(opts.query)
  const out = books.filter((b) => {
    if (opts.shelf === "favorites" ? !b.favorite : opts.shelf !== "all" && b.status !== opts.shelf) return false
    if (!q) return true
    return [b.title, b.author, ...b.tags].some((f) => normalize(f).includes(q))
  })
  const byTitle = (a: Book, b: Book) => a.title.localeCompare(b.title, "es")
  switch (opts.sort) {
    case "title":
      return out.sort(byTitle)
    case "rating":
      return out.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || byTitle(a, b))
    case "recent":
      return out
  }
}

export function readingProgress(b: Book): number | null {
  if (!b.pageCount || b.currentPage === undefined) return null
  return Math.min(1, b.currentPage / b.pageCount)
}
