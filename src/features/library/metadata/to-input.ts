import { localDateInZone } from "@/features/habits/domain/dates"
import type { BookInput, EpisodeInput, ShowInput } from "@/features/knowledge/domain/ops"
import type { ContentStatus } from "@/features/knowledge/domain/types"
import type { BookResult, EpisodeResult, ShowResult } from "./types"

/**
 * A confirmed result as the input of the existing M4 operations (createItem / createShow): the
 * same path as a manual entry, so sync, the offline queue, notes, statuses and ratings are
 * untouched. The user's choices (status, rating, topics, keeping the description) are passed in;
 * nothing personal comes from the provider.
 */
export interface Choices {
  status?: ContentStatus
  rating?: number | null
  favorite?: boolean
  /** Topics the user picked (suggestions are never added on their own, D6). */
  topics?: string[]
  /** D7: the description can be left out. */
  keepDescription?: boolean
}

export interface BookChoices extends Choices {
  /**
   * D5: save as a separate edition of a work already in the Library. It keeps the ISBN and the
   * edition data but no external reference, so the one-record-per-work index is not involved.
   */
  separateEdition?: boolean
  /** Names when the detail answer had none (they come from the search result). */
  creators?: string[]
}

const cover = (url: string | null) => (url ? { source: "external" as const, url } : null)

function common(c: Choices) {
  return {
    ...(c.status !== undefined && { status: c.status }),
    ...(c.rating !== undefined && { rating: c.rating }),
    ...(c.favorite !== undefined && { favorite: c.favorite }),
    topics: c.topics ?? [],
  }
}

export function toBookInput(r: BookResult, c: BookChoices = {}): BookInput {
  return {
    title: r.title,
    subtitle: r.subtitle,
    creators: r.creators ?? c.creators ?? [],
    description: c.keepDescription === false ? null : r.description,
    language: r.language,
    cover: cover(r.cover),
    sourceUrl: r.sourceUrl,
    external: c.separateEdition || !r.workId ? null : { provider: "openlibrary", id: r.workId, attribution: r.attribution },
    ...common(c),
    book: { isbn13: r.isbn13, isbn10: r.isbn10, pageCount: r.pageCount, publisher: r.publisher, publishedYear: r.year ?? r.firstPublishedYear },
  }
}

export function toShowInput(s: ShowResult, c: Pick<Choices, "topics" | "keepDescription"> = {}): ShowInput {
  return {
    title: s.title,
    publisher: s.publisher,
    // Apple's search does not give a show's description; it is written by hand when wanted.
    description: null,
    topics: c.topics ?? [],
    cover: cover(s.cover),
    sourceUrl: s.sourceUrl,
    external: { provider: "itunes", id: s.id, attribution: s.attribution },
  }
}

/** `localShowId`: the show in the Library (existing or just created); `timeZone`: the profile's. */
export function toEpisodeInput(e: EpisodeResult, localShowId: string | null, timeZone: string, c: Choices = {}): EpisodeInput {
  return {
    title: e.title,
    description: c.keepDescription === false ? null : e.description,
    cover: cover(e.cover),
    sourceUrl: e.sourceUrl,
    external: { provider: "itunes", id: e.id, attribution: e.attribution },
    ...common(c),
    episode: {
      showId: localShowId,
      platform: "apple",
      durationSeconds: e.durationSeconds,
      publishedOn: e.publishedAt ? localDateInZone(new Date(e.publishedAt), timeZone) : null,
    },
  }
}
