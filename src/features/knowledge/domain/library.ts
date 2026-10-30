import { cmp, collator, normalize, topicKeys } from "./text"
import { topicsOf } from "./relations"
import { STATUSES, type ContentItem, type ContentKind, type ContentStatus, type KnowledgeState } from "./types"

/** Shelves of the Books and Podcasts sections (plan §4.3–4.4): the same for both formats. */
export type Shelf = "all" | ContentStatus | "favorites"
export const SHELVES: readonly Shelf[] = ["all", "active", "planned", "done", "paused", "abandoned", "favorites"]

export type ContentSort = "recent" | "title" | "creator" | "rating" | "finished"

export interface ContentFilter {
  kind: ContentKind
  shelf?: Shelf
  /** Title, subtitle, creators, topics, show and ISBN (the knowledge search lives in search.ts). */
  query?: string
  topic?: string | null
  minRating?: number | null
  showId?: string | null
  sort?: ContentSort
}

/** An item's topics, plus its show's for an episode (cached normalised keys). */
function hasTopic(state: KnowledgeState, item: ContentItem, topic: string): boolean {
  if (topicKeys(item).includes(topic)) return true
  const show = item.kind === "episode" && item.episode.showId ? state.shows[item.episode.showId] : undefined
  return !!show && topicKeys(show).includes(topic)
}

function inShelf(item: ContentItem, shelf: Shelf): boolean {
  return shelf === "all" ? true : shelf === "favorites" ? item.favorite : item.status === shelf
}

function haystack(state: KnowledgeState, item: ContentItem): string {
  const show = item.kind === "episode" && item.episode.showId ? state.shows[item.episode.showId]?.title : null
  const isbn = item.kind === "book" ? [item.book.isbn13, item.book.isbn10] : []
  return normalize([item.title, item.subtitle, ...item.creators, ...topicsOf(state, item), show, ...isbn].filter(Boolean).join(" \u0000 "))
}

const byTitle = (a: ContentItem, b: ContentItem) => collator.compare(a.title, b.title) || cmp(a.id, b.id)

const SORTS: Record<ContentSort, (a: ContentItem, b: ContentItem) => number> = {
  // Last activity first: what you are on now stays at hand.
  recent: (a, b) => cmp(b.updatedAt, a.updatedAt) || byTitle(a, b),
  title: byTitle,
  creator: (a, b) => collator.compare(a.creators[0] ?? "￿", b.creators[0] ?? "￿") || byTitle(a, b),
  // Unrated content goes last, never as if it were rated 0.
  rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || byTitle(a, b),
  finished: (a, b) => cmp(b.finishedOn ?? "", a.finishedOn ?? "") || byTitle(a, b),
}

export function filterContent(state: KnowledgeState, f: ContentFilter): ContentItem[] {
  const q = f.query ? normalize(f.query) : ""
  const topic = f.topic ? normalize(f.topic) : null
  return Object.values(state.items)
    .filter(
      (i) =>
        i.kind === f.kind &&
        inShelf(i, f.shelf ?? "all") &&
        (f.minRating == null || (i.rating ?? 0) >= f.minRating) &&
        (f.showId == null || (i.kind === "episode" && i.episode.showId === f.showId)) &&
        (!topic || hasTopic(state, i, topic)) &&
        (!q || haystack(state, i).includes(q))
    )
    .sort(SORTS[f.sort ?? "recent"])
}

/** Count per shelf for the tabs (the query and other filters do not change the shelf counts). */
export function shelfCounts(state: KnowledgeState, kind: ContentKind): Record<Shelf, number> {
  const out = Object.fromEntries(SHELVES.map((s) => [s, 0])) as Record<Shelf, number>
  for (const i of Object.values(state.items)) {
    if (i.kind !== kind) continue
    out.all++
    out[i.status]++
    if (i.favorite) out.favorites++
  }
  return out
}

/**
 * Progress 0–1, or null when unknown: pages over the page count (or the manual percentage when
 * the count is unknown) for a book, position over duration for an episode. A finished item is
 * complete whatever its last recorded position.
 */
export function progressOf(item: ContentItem): number | null {
  if (item.status === "done") return 1
  if (item.kind === "book") {
    const b = item.book
    if (b.pageCount && b.currentPage !== null) return Math.min(1, b.currentPage / b.pageCount)
    return b.progressPercent !== null ? b.progressPercent / 100 : null
  }
  const e = item.episode
  return e.durationSeconds && e.positionSeconds !== null ? Math.min(1, e.positionSeconds / e.durationSeconds) : null
}

/** At the end but not marked finished: the UI suggests it, it never decides (plan §4.3). */
export function suggestsFinish(item: ContentItem): boolean {
  return item.status !== "done" && item.status !== "abandoned" && progressOf(item) === 1
}

/** The «Continuar» row of the Library home: in progress, last activity first, both formats. */
export function inProgress(state: KnowledgeState, limit = 8): ContentItem[] {
  return Object.values(state.items)
    .filter((i) => i.status === "active")
    .sort(SORTS.recent)
    .slice(0, limit)
}

/** Every status of a kind, in shelf order, for pickers. */
export const STATUS_ORDER: readonly ContentStatus[] = STATUSES
