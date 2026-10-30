import type { LocalDate } from "@/features/habits/domain/dates"
import { compactIsbn, isbn10to13, normalizeNames, normalizeTopics, optionalText, safeUrl, cleanLine, cleanText } from "./text"
import { canonicalLink, entityExists, refKey } from "./relations"
import { firstIssue, itemSchema, linkSchema, noteSchema, showSchema } from "./validation"
import type {
  ApplicationLink,
  ApplicationStatus,
  Book,
  BookDetails,
  ContentItem,
  ContentKind,
  ContentStatus,
  CoverRef,
  EntityRef,
  Episode,
  EpisodeDetails,
  ExternalRef,
  KnowledgeLink,
  KnowledgeNote,
  KnowledgeState,
  Locator,
  NoteType,
  PodcastShow,
} from "./types"

/**
 * Pure transitions of the knowledge state, shared by both formats. Like the other reducers they
 * return the same state reference when nothing changes and never read the clock: `now` (instant)
 * and `today` (local date in the profile's zone) come from the caller. The same functions back the
 * demo now and replay queued writes over server state in M4c.
 */
export interface Ctx {
  now: string
  today: LocalDate
}

export type KnowledgeError =
  | { code: "invalid"; detail: string }
  | { code: "not_found"; detail: string }
  | { code: "kind_mismatch"; detail: string }
  | { code: "duplicate"; detail: string }

export type Result<T = object> = ({ ok: true; state: KnowledgeState } & T) | { ok: false; error: KnowledgeError }

const fail = (code: KnowledgeError["code"], detail: string): { ok: false; error: KnowledgeError } => ({ ok: false, error: { code, detail } })

// ---------- input shapes (what forms send; cleaned here) ----------

export interface ContentInput {
  title: string
  subtitle?: string | null
  creators?: string[]
  description?: string | null
  topics?: string[]
  language?: string | null
  status?: ContentStatus
  favorite?: boolean
  rating?: number | null
  startedOn?: LocalDate | null
  finishedOn?: LocalDate | null
  cover?: CoverRef | null
  sourceUrl?: string | null
  external?: ExternalRef | null
}

export type BookInput = ContentInput & { book?: Partial<BookDetails> }
export type EpisodeInput = ContentInput & { episode?: Partial<EpisodeDetails> }

export type ShowInput = Pick<ContentInput, "title" | "description" | "topics" | "cover" | "sourceUrl" | "external"> & { publisher?: string | null }

export interface NoteInput {
  itemId: string | null
  type: NoteType
  body: string
  locator?: Partial<Locator> | null
  starred?: boolean
  applicationStatus?: ApplicationStatus | null
  applicationLink?: ApplicationLink | null
  topics?: string[]
}

// ---------- cleaning ----------

function cleanBase(input: Partial<ContentInput>) {
  const out: Partial<ContentItem> = {}
  if (input.title !== undefined) out.title = cleanLine(input.title)
  if (input.subtitle !== undefined) out.subtitle = optionalText(input.subtitle, true)
  if (input.creators !== undefined) out.creators = normalizeNames(input.creators)
  if (input.description !== undefined) out.description = optionalText(input.description)
  if (input.topics !== undefined) out.topics = normalizeTopics(input.topics)
  if (input.language !== undefined) out.language = optionalText(input.language, true)
  if (input.status !== undefined) out.status = input.status
  if (input.favorite !== undefined) out.favorite = input.favorite
  if (input.rating !== undefined) out.rating = input.rating
  if (input.startedOn !== undefined) out.startedOn = input.startedOn
  if (input.finishedOn !== undefined) out.finishedOn = input.finishedOn
  if (input.cover !== undefined) out.cover = input.cover
  if (input.sourceUrl !== undefined) out.sourceUrl = input.sourceUrl === null || input.sourceUrl.trim() === "" ? null : (safeUrl(input.sourceUrl) ?? input.sourceUrl)
  if (input.external !== undefined) out.external = input.external
  return out
}

function cleanBook(b: Partial<BookDetails>): Partial<BookDetails> {
  const out: Partial<BookDetails> = { ...b }
  if (b.isbn13 !== undefined) out.isbn13 = b.isbn13 ? compactIsbn(b.isbn13) : null
  if (b.isbn10 !== undefined) out.isbn10 = b.isbn10 ? compactIsbn(b.isbn10) : null
  if (b.publisher !== undefined) out.publisher = optionalText(b.publisher, true)
  return out
}

const EMPTY_BOOK: BookDetails = { isbn13: null, isbn10: null, pageCount: null, currentPage: null, progressPercent: null, publisher: null, publishedYear: null }
const EMPTY_EPISODE: EpisodeDetails = { showId: null, platform: null, durationSeconds: null, publishedOn: null, episodeNumber: null, positionSeconds: null }

/**
 * Dates follow the status unless the user set them (D60): starting fills `startedOn` and
 * finishing fills `finishedOn` with today. Finishing never invents a start date, nothing is
 * cleared automatically, and a date the user typed always wins.
 */
function withStatusDates<T extends ContentItem>(prev: T | null, next: T, explicit: Partial<ContentInput>, today: LocalDate): T {
  if (prev && prev.status === next.status) return next
  let out = next
  // Reopening something already finished (a re-read) keeps its dates: today would contradict the recorded end.
  if (next.status === "active" && !out.startedOn && explicit.startedOn === undefined && (!out.finishedOn || out.finishedOn >= today)) out = { ...out, startedOn: today }
  if (next.status === "done" && !out.finishedOn && explicit.finishedOn === undefined) out = { ...out, finishedOn: today }
  return out
}

function checkItem(state: KnowledgeState, item: ContentItem): KnowledgeError | null {
  const parsed = itemSchema.safeParse(item)
  if (!parsed.success) return { code: "invalid", detail: firstIssue(parsed.error) }
  if (item.kind === "episode" && item.episode.showId && !state.shows[item.episode.showId]) return { code: "not_found", detail: `show ${item.episode.showId}` }
  const ext = item.external
  if (ext) {
    const dup = Object.values(state.items).find(
      (o) => o.id !== item.id && o.kind === item.kind && o.external?.provider === ext.provider && o.external.id === ext.id
    )
    // PRD §4.1: one record per external id; another edition is a different external id.
    if (dup) return { code: "duplicate", detail: dup.id }
  }
  return null
}

// ---------- content ----------

export function createItem(state: KnowledgeState, kind: "book", id: string, input: BookInput, ctx: Ctx): Result<{ item: Book }>
export function createItem(state: KnowledgeState, kind: "episode", id: string, input: EpisodeInput, ctx: Ctx): Result<{ item: Episode }>
export function createItem(state: KnowledgeState, kind: ContentKind, id: string, input: BookInput & EpisodeInput, ctx: Ctx): Result<{ item: ContentItem }> {
  if (state.items[id]) return fail("duplicate", id)
  const common = {
    id,
    title: "",
    subtitle: null,
    creators: [],
    description: null,
    topics: [],
    language: null,
    status: "planned" as ContentStatus,
    favorite: false,
    rating: null,
    startedOn: null,
    finishedOn: null,
    cover: null,
    sourceUrl: null,
    external: null,
    ...cleanBase(input),
    createdAt: ctx.now,
    updatedAt: ctx.now,
  }
  const book = { ...EMPTY_BOOK, ...cleanBook(input.book ?? {}) }
  // Both forms of the same edition are matched by ISBN-13 (duplicate warning, M4g).
  if (book.isbn10 && !book.isbn13) book.isbn13 = isbn10to13(book.isbn10)
  let item: ContentItem =
    kind === "book"
      ? { ...common, kind: "book", book }
      : { ...common, kind: "episode", episode: { ...EMPTY_EPISODE, ...(input.episode ?? {}) } }
  item = withStatusDates(null, item, input, ctx.today)
  const err = checkItem(state, item)
  if (err) return { ok: false, error: err }
  return { ok: true, state: { ...state, items: { ...state.items, [id]: item } }, item }
}

export type ItemPatch = Partial<ContentInput> & { book?: Partial<BookDetails>; episode?: Partial<EpisodeDetails> }

/** Field-level update (the sync unit in M4c is a field, D68). Unchanged fields keep their value. */
export function updateItem(state: KnowledgeState, id: string, patch: ItemPatch, ctx: Ctx): Result<{ item: ContentItem }> {
  const prev = state.items[id]
  if (!prev) return fail("not_found", id)
  if (patch.book && prev.kind !== "book") return fail("kind_mismatch", "book fields on an episode")
  if (patch.episode && prev.kind !== "episode") return fail("kind_mismatch", "episode fields on a book")
  let next = { ...prev, ...cleanBase(patch) } as ContentItem
  if (next.kind === "book" && patch.book) next = { ...next, book: { ...next.book, ...cleanBook(patch.book) } }
  if (next.kind === "episode" && patch.episode) next = { ...next, episode: { ...next.episode, ...patch.episode } }
  next = withStatusDates(prev, next, patch, ctx.today)
  if (sameItem(prev, next)) return { ok: true, state, item: prev }
  next = { ...next, updatedAt: ctx.now }
  const err = checkItem(state, next)
  if (err) return { ok: false, error: err }
  return { ok: true, state: { ...state, items: { ...state.items, [id]: next } }, item: next }
}

function sameItem(a: ContentItem, b: ContentItem): boolean {
  return JSON.stringify({ ...a, updatedAt: "" }) === JSON.stringify({ ...b, updatedAt: "" })
}

/** What a delete removed, so «Deshacer» can put exactly that back (plan P14, pending approval). */
export interface Removed {
  items: ContentItem[]
  shows: PodcastShow[]
  notes: KnowledgeNote[]
  links: KnowledgeLink[]
  /** Episodes whose show was deleted: they stay, without a show. */
  detached: { itemId: string; showId: string }[]
}

const noneRemoved = (): Removed => ({ items: [], shows: [], notes: [], links: [], detached: [] })

function dropLinksTo(links: Record<string, KnowledgeLink>, gone: Set<string>, removed: Removed): Record<string, KnowledgeLink> {
  const out: Record<string, KnowledgeLink> = {}
  for (const [k, l] of Object.entries(links)) {
    if (gone.has(refKey(l.a)) || gone.has(refKey(l.b))) removed.links.push(l)
    else out[k] = l
  }
  return out
}

/** Deleting a book or episode deletes its notes and every link touching them (the UI confirms first when there are notes). */
export function deleteItem(state: KnowledgeState, id: string): Result<{ removed: Removed }> {
  const item = state.items[id]
  if (!item) return fail("not_found", id)
  const removed = noneRemoved()
  removed.items.push(item)
  const items = { ...state.items }
  delete items[id]
  const notes: Record<string, KnowledgeNote> = {}
  const gone = new Set([refKey({ type: "item", id })])
  for (const [k, n] of Object.entries(state.notes)) {
    if (n.itemId === id) {
      removed.notes.push(n)
      gone.add(refKey({ type: "note", id: k }))
    } else notes[k] = n
  }
  return { ok: true, state: { ...state, items, notes, links: dropLinksTo(state.links, gone, removed) }, removed }
}

/** Puts back what a delete removed, untouched (same ids, texts and dates). */
export function restoreRemoved(state: KnowledgeState, removed: Removed): KnowledgeState {
  const shows = { ...state.shows }
  for (const s of removed.shows) shows[s.id] = s
  const items = { ...state.items }
  for (const i of removed.items) items[i.id] = i
  for (const d of removed.detached) {
    const ep = items[d.itemId]
    if (ep?.kind === "episode" && ep.episode.showId === null) items[d.itemId] = { ...ep, episode: { ...ep.episode, showId: d.showId } }
  }
  const notes = { ...state.notes }
  for (const n of removed.notes) notes[n.id] = n
  const links = { ...state.links }
  for (const l of removed.links) if (entityExists({ ...state, shows, items, notes }, l.a) && entityExists({ ...state, shows, items, notes }, l.b)) links[l.key] = l
  return { ...state, shows, items, notes, links }
}

// ---------- shows ----------

function cleanShow(input: Partial<ShowInput>): Partial<PodcastShow> {
  const out: Partial<PodcastShow> = {}
  if (input.title !== undefined) out.title = cleanLine(input.title)
  if (input.publisher !== undefined) out.publisher = optionalText(input.publisher, true)
  if (input.description !== undefined) out.description = optionalText(input.description)
  if (input.topics !== undefined) out.topics = normalizeTopics(input.topics)
  if (input.cover !== undefined) out.cover = input.cover
  if (input.sourceUrl !== undefined) out.sourceUrl = input.sourceUrl === null || input.sourceUrl.trim() === "" ? null : (safeUrl(input.sourceUrl) ?? input.sourceUrl)
  if (input.external !== undefined) out.external = input.external
  return out
}

function checkShow(state: KnowledgeState, show: PodcastShow): KnowledgeError | null {
  const parsed = showSchema.safeParse(show)
  if (!parsed.success) return { code: "invalid", detail: firstIssue(parsed.error) }
  const ext = show.external
  if (ext) {
    const dup = Object.values(state.shows).find((o) => o.id !== show.id && o.external?.provider === ext.provider && o.external.id === ext.id)
    if (dup) return { code: "duplicate", detail: dup.id }
  }
  return null
}

export function createShow(state: KnowledgeState, id: string, input: ShowInput, ctx: Ctx): Result<{ show: PodcastShow }> {
  if (state.shows[id]) return fail("duplicate", id)
  const show: PodcastShow = {
    id,
    title: "",
    publisher: null,
    description: null,
    topics: [],
    cover: null,
    sourceUrl: null,
    external: null,
    ...cleanShow(input),
    createdAt: ctx.now,
    updatedAt: ctx.now,
  }
  const err = checkShow(state, show)
  if (err) return { ok: false, error: err }
  return { ok: true, state: { ...state, shows: { ...state.shows, [id]: show } }, show }
}

export function updateShow(state: KnowledgeState, id: string, patch: Partial<ShowInput>, ctx: Ctx): Result<{ show: PodcastShow }> {
  const prev = state.shows[id]
  if (!prev) return fail("not_found", id)
  const next = { ...prev, ...cleanShow(patch) }
  if (JSON.stringify(next) === JSON.stringify(prev)) return { ok: true, state, show: prev }
  const stamped = { ...next, updatedAt: ctx.now }
  const err = checkShow(state, stamped)
  if (err) return { ok: false, error: err }
  return { ok: true, state: { ...state, shows: { ...state.shows, [id]: stamped } }, show: stamped }
}

/**
 * Deleting a show never deletes knowledge: its episodes stay, without a show, with all their
 * notes. Only links to the show itself go.
 */
export function deleteShow(state: KnowledgeState, id: string, ctx: Ctx): Result<{ removed: Removed }> {
  const show = state.shows[id]
  if (!show) return fail("not_found", id)
  const removed = noneRemoved()
  removed.shows.push(show)
  const shows = { ...state.shows }
  delete shows[id]
  let items = state.items
  for (const it of Object.values(state.items)) {
    if (it.kind === "episode" && it.episode.showId === id) {
      if (items === state.items) items = { ...state.items }
      items[it.id] = { ...it, episode: { ...it.episode, showId: null }, updatedAt: ctx.now }
      removed.detached.push({ itemId: it.id, showId: id })
    }
  }
  const links = dropLinksTo(state.links, new Set([refKey({ type: "show", id })]), removed)
  return { ok: true, state: { ...state, shows, items, links }, removed }
}

// ---------- notes ----------

function cleanLocator(l: Partial<Locator> | null | undefined): Locator | null {
  if (!l) return null
  const out: Locator = { page: l.page ?? null, positionSeconds: l.positionSeconds ?? null, label: optionalText(l.label ?? null, true) }
  return out.page === null && out.positionSeconds === null && out.label === null ? null : out
}

function checkNote(state: KnowledgeState, note: KnowledgeNote): KnowledgeError | null {
  const parsed = noteSchema.safeParse(note)
  if (!parsed.success) return { code: "invalid", detail: firstIssue(parsed.error) }
  if (note.itemId === null) return null
  const item = state.items[note.itemId]
  if (!item) return { code: "not_found", detail: `item ${note.itemId}` }
  const l = note.locator
  // A page belongs to a book, a timestamp to an episode (and stays within its duration).
  if (l?.page != null && item.kind !== "book") return { code: "kind_mismatch", detail: "page on an episode" }
  if (l?.positionSeconds != null && item.kind !== "episode") return { code: "kind_mismatch", detail: "timestamp on a book" }
  if (l?.page != null && item.kind === "book" && item.book.pageCount !== null && l.page > item.book.pageCount) return { code: "invalid", detail: "locator.page: beyond the last page" }
  if (l?.positionSeconds != null && item.kind === "episode" && item.episode.durationSeconds !== null && l.positionSeconds > item.episode.durationSeconds)
    return { code: "invalid", detail: "locator.positionSeconds: beyond the end" }
  return null
}

function applicationFields(type: NoteType, status: ApplicationStatus | null | undefined, link: ApplicationLink | null | undefined) {
  return type === "application"
    ? { applicationStatus: status ?? "open", applicationLink: link ? { ...link, title: cleanLine(link.title) } : null }
    : { applicationStatus: null, applicationLink: null }
}

export function createNote(state: KnowledgeState, id: string, input: NoteInput, ctx: Ctx): Result<{ note: KnowledgeNote }> {
  if (state.notes[id]) return fail("duplicate", id)
  const note: KnowledgeNote = {
    id,
    itemId: input.itemId,
    type: input.type,
    format: "plain",
    body: cleanText(input.body),
    locator: input.itemId === null ? null : cleanLocator(input.locator),
    starred: input.starred ?? false,
    ...applicationFields(input.type, input.applicationStatus, input.applicationLink),
    topics: normalizeTopics(input.topics ?? []),
    createdAt: ctx.now,
    updatedAt: ctx.now,
  }
  const err = checkNote(state, note)
  if (err) return { ok: false, error: err }
  return { ok: true, state: { ...state, notes: { ...state.notes, [id]: note } }, note }
}

export type NotePatch = Partial<Omit<NoteInput, "itemId">>

export function updateNote(state: KnowledgeState, id: string, patch: NotePatch, ctx: Ctx): Result<{ note: KnowledgeNote }> {
  const prev = state.notes[id]
  if (!prev) return fail("not_found", id)
  const type = patch.type ?? prev.type
  const next: KnowledgeNote = {
    ...prev,
    type,
    body: patch.body !== undefined ? cleanText(patch.body) : prev.body,
    locator: patch.locator !== undefined ? (prev.itemId === null ? null : cleanLocator(patch.locator)) : prev.locator,
    starred: patch.starred ?? prev.starred,
    topics: patch.topics !== undefined ? normalizeTopics(patch.topics) : prev.topics,
    // Changing the type away from «aplicación» drops its status and link; back to it starts «Pendiente».
    ...applicationFields(
      type,
      patch.applicationStatus !== undefined ? patch.applicationStatus : prev.applicationStatus,
      patch.applicationLink !== undefined ? patch.applicationLink : prev.applicationLink
    ),
  }
  if (JSON.stringify(next) === JSON.stringify(prev)) return { ok: true, state, note: prev }
  const stamped = { ...next, updatedAt: ctx.now }
  const err = checkNote(state, stamped)
  if (err) return { ok: false, error: err }
  return { ok: true, state: { ...state, notes: { ...state.notes, [id]: stamped } }, note: stamped }
}

/**
 * Moves a note to another book or episode, or makes it free-standing. A locator that does not
 * fit the new place (a page on an episode) is dropped; the text never is.
 */
export function moveNote(state: KnowledgeState, id: string, itemId: string | null, ctx: Ctx): Result<{ note: KnowledgeNote }> {
  const prev = state.notes[id]
  if (!prev) return fail("not_found", id)
  if (prev.itemId === itemId) return { ok: true, state, note: prev }
  const target = itemId === null ? null : state.items[itemId]
  if (itemId !== null && !target) return fail("not_found", `item ${itemId}`)
  const keep = target && prev.locator && (target.kind === "book" ? prev.locator.positionSeconds === null : prev.locator.page === null)
  const locator = target && prev.locator ? (keep ? prev.locator : prev.locator.label ? { page: null, positionSeconds: null, label: prev.locator.label } : null) : null
  const next: KnowledgeNote = { ...prev, itemId, locator, updatedAt: ctx.now }
  const err = checkNote(state, next)
  if (err) return { ok: false, error: err }
  return { ok: true, state: { ...state, notes: { ...state.notes, [id]: next } }, note: next }
}

export function deleteNote(state: KnowledgeState, id: string): Result<{ removed: Removed }> {
  const note = state.notes[id]
  if (!note) return fail("not_found", id)
  const removed = noneRemoved()
  removed.notes.push(note)
  const notes = { ...state.notes }
  delete notes[id]
  return { ok: true, state: { ...state, notes, links: dropLinksTo(state.links, new Set([refKey({ type: "note", id })]), removed) }, removed }
}

// ---------- links ----------

/** Desired state (D6): linking twice or unlinking a missing link changes nothing. */
export function setLink(state: KnowledgeState, a: EntityRef, b: EntityRef, linked: boolean, ctx: Ctx): Result {
  const link = canonicalLink(a, b, ctx.now)
  if (!link) return fail("invalid", "an entity cannot link to itself")
  if (!linked) {
    if (!state.links[link.key]) return { ok: true, state }
    const links = { ...state.links }
    delete links[link.key]
    return { ok: true, state: { ...state, links } }
  }
  if (state.links[link.key]) return { ok: true, state }
  if (!entityExists(state, a)) return fail("not_found", refKey(a))
  if (!entityExists(state, b)) return fail("not_found", refKey(b))
  const parsed = linkSchema.safeParse(link)
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error))
  return { ok: true, state: { ...state, links: { ...state.links, [link.key]: link } } }
}
