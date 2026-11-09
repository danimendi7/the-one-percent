import { progressOf } from "@/features/knowledge/domain/library"
import type { Book, ContentItem } from "@/features/knowledge/domain/types"

export interface GoalBookRow {
  book: Book
  /** 0–1, or null when the Library does not know it. */
  progress: number | null
}

export interface GoalBooksProgress {
  rows: GoalBookRow[]
  finished: number
  /** Linked books that still count: an abandoned one is listed but no longer expected. */
  total: number
  /** finished / total; null when no book counts, never a made-up 0 %. */
  share: number | null
}

/** Reading progress of a goal's books. Ids of books no longer in the Library are left out. */
export function goalBooksProgress(bookIds: string[] | undefined, items: Record<string, ContentItem>): GoalBooksProgress {
  const rows = (bookIds ?? []).flatMap((id) => {
    const item = items[id]
    return item?.kind === "book" ? [{ book: item, progress: progressOf(item) }] : []
  })
  const counted = rows.filter((r) => r.book.status !== "abandoned")
  const finished = counted.filter((r) => r.book.status === "done").length
  return { rows, finished, total: counted.length, share: counted.length ? finished / counted.length : null }
}

/** Books that can still be linked, by title. */
export function linkableBooks(bookIds: string[] | undefined, items: Record<string, ContentItem>): Book[] {
  const linked = new Set(bookIds ?? [])
  return Object.values(items)
    .filter((i): i is Book => i.kind === "book" && !linked.has(i.id))
    .sort((a, b) => a.title.localeCompare(b.title, "es"))
}
