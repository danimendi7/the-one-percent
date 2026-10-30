import type {
  ContentItem,
  CoverRef,
  EntityRef,
  ExternalRef,
  KnowledgeLink,
  KnowledgeNote,
  Platform,
  PodcastShow,
} from "@/features/knowledge/domain/types"

/**
 * Wire format of the Library (supabase/migrations/*_library.sql, M4b): field names are the column
 * names. Pure conversions between the knowledge domain (M4a) and what apply_ops receives and
 * pull_library returns. Connected to the sync engine in M4c.
 */

export type WireFields = Record<string, unknown>

const cover = (c: CoverRef | null) =>
  c === null ? { cover_source: null, cover_ref: null } : { cover_source: c.source, cover_ref: c.source === "external" ? c.url : c.path }
const external = (e: ExternalRef | null) =>
  e === null ? { external_provider: null, external_id: null, external_attribution: null } : { external_provider: e.provider, external_id: e.id, external_attribution: e.attribution }

/** Editable fields of a show (everything but its id and stamps). */
export function showFields(s: PodcastShow): WireFields {
  return { title: s.title, publisher: s.publisher, description: s.description, topics: s.topics, ...cover(s.cover), source_url: s.sourceUrl, ...external(s.external) }
}

/** Editable fields of a book or episode; the kind travels next to them on create. */
export function itemFields(i: ContentItem): WireFields {
  const common = {
    title: i.title,
    subtitle: i.subtitle,
    creators: i.creators,
    description: i.description,
    topics: i.topics,
    language: i.language,
    status: i.status,
    favorite: i.favorite,
    rating: i.rating,
    started_on: i.startedOn,
    finished_on: i.finishedOn,
    ...cover(i.cover),
    source_url: i.sourceUrl,
    ...external(i.external),
  }
  if (i.kind === "book") {
    const b = i.book
    return {
      ...common,
      isbn13: b.isbn13,
      isbn10: b.isbn10,
      page_count: b.pageCount,
      current_page: b.currentPage,
      progress_percent: b.progressPercent,
      publisher: b.publisher,
      published_year: b.publishedYear,
    }
  }
  const e = i.episode
  return {
    ...common,
    show_id: e.showId,
    platform: e.platform,
    duration_seconds: e.durationSeconds,
    published_on: e.publishedOn,
    episode_number: e.episodeNumber,
    position_seconds: e.positionSeconds,
  }
}

export function noteFields(n: KnowledgeNote): WireFields {
  return {
    item_id: n.itemId,
    note_type: n.type,
    body: n.body,
    page: n.locator?.page ?? null,
    position_seconds: n.locator?.positionSeconds ?? null,
    locator_label: n.locator?.label ?? null,
    starred: n.starred,
    application_status: n.applicationStatus,
    application_habit_id: n.applicationLink?.type === "habit" ? n.applicationLink.id : null,
    application_goal_id: n.applicationLink?.type === "goal" ? n.applicationLink.id : null,
    application_link_title: n.applicationLink?.title ?? null,
    topics: n.topics,
  }
}

/**
 * The fields that differ between two versions of an entity: the body of an update operation
 * (D68 merges field by field). Arrays are compared by value.
 */
export function changedFields(before: WireFields, after: WireFields): WireFields {
  const out: WireFields = {}
  for (const [k, v] of Object.entries(after)) if (JSON.stringify(before[k] ?? null) !== JSON.stringify(v ?? null)) out[k] = v
  return out
}

// ---------- rows from pull_library ----------

export type WireRow = Record<string, unknown> & { id: string; server_seq: number; deleted: boolean; field_seqs?: Record<string, number> }
export interface WireChange {
  t: "show" | "item" | "note" | "link"
  seq: number
  row: WireRow
}

const s = (v: unknown) => (v === null || v === undefined ? null : String(v))
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
/**
 * Instants as ISO strings in UTC, like the domain (PostgreSQL sends «+00:00»). A missing or broken
 * instant becomes the epoch instead of throwing: one damaged row must never make a whole device copy
 * unreadable (M4c, found by the volume benchmark).
 */
const iso = (v: unknown) => {
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString()
}
const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])

function coverOf(r: WireRow): CoverRef | null {
  if (r.cover_source === "external") return { source: "external", url: String(r.cover_ref) }
  if (r.cover_source === "upload") return { source: "upload", path: String(r.cover_ref) }
  return null
}
function externalOf(r: WireRow): ExternalRef | null {
  return r.external_provider ? { provider: r.external_provider as ExternalRef["provider"], id: String(r.external_id), attribution: s(r.external_attribution) } : null
}

export function rowToShow(r: WireRow): PodcastShow {
  return {
    id: r.id,
    title: String(r.title),
    publisher: s(r.publisher),
    description: s(r.description),
    topics: arr(r.topics),
    cover: coverOf(r),
    sourceUrl: s(r.source_url),
    external: externalOf(r),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  }
}

export function rowToItem(r: WireRow): ContentItem {
  const common = {
    id: r.id,
    title: String(r.title),
    subtitle: s(r.subtitle),
    creators: arr(r.creators),
    description: s(r.description),
    topics: arr(r.topics),
    language: s(r.language),
    status: r.status as ContentItem["status"],
    favorite: r.favorite === true,
    rating: n(r.rating),
    startedOn: s(r.started_on),
    finishedOn: s(r.finished_on),
    cover: coverOf(r),
    sourceUrl: s(r.source_url),
    external: externalOf(r),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  }
  if (r.kind === "book") {
    return {
      ...common,
      kind: "book",
      book: {
        isbn13: s(r.isbn13),
        isbn10: s(r.isbn10),
        pageCount: n(r.page_count),
        currentPage: n(r.current_page),
        progressPercent: n(r.progress_percent),
        publisher: s(r.publisher),
        publishedYear: n(r.published_year),
      },
    }
  }
  return {
    ...common,
    kind: "episode",
    episode: {
      showId: s(r.show_id),
      platform: (r.platform ?? null) as Platform | null,
      durationSeconds: n(r.duration_seconds),
      publishedOn: s(r.published_on),
      episodeNumber: n(r.episode_number),
      positionSeconds: n(r.position_seconds),
    },
  }
}

export function rowToNote(r: WireRow): KnowledgeNote {
  const page = n(r.page)
  const positionSeconds = n(r.position_seconds)
  const label = s(r.locator_label)
  const linkId = s(r.application_habit_id) ?? s(r.application_goal_id)
  return {
    id: r.id,
    itemId: s(r.item_id),
    type: r.note_type as KnowledgeNote["type"],
    format: "plain",
    body: String(r.body),
    locator: page === null && positionSeconds === null && label === null ? null : { page, positionSeconds, label },
    starred: r.starred === true,
    applicationStatus: (r.application_status ?? null) as KnowledgeNote["applicationStatus"],
    applicationLink: linkId ? { type: r.application_habit_id ? "habit" : "goal", id: linkId, title: String(r.application_link_title) } : null,
    topics: arr(r.topics),
    // The moment the user wrote it (offline captures keep it), not when it reached the server.
    createdAt: iso(r.captured_at),
    updatedAt: iso(r.updated_at),
  }
}

export function rowToLink(r: WireRow): KnowledgeLink {
  const a: EntityRef = { type: r.a_type as EntityRef["type"], id: String(r.a_id) }
  const b: EntityRef = { type: r.b_type as EntityRef["type"], id: String(r.b_id) }
  return { key: `${a.type}:${a.id}|${b.type}:${b.id}`, a, b, origin: "manual", createdAt: iso(r.created_at) }
}
