import { cmp, normalize, tokenize, topicKeys as topicKeysOf } from "./text"
import type { ApplicationStatus, ContentItem, ContentStatus, EntityRef, KnowledgeNote, KnowledgeState, NoteType, PodcastShow } from "./types"

/**
 * Local knowledge search (D67): runs on the device copy, works offline and sends no query
 * anywhere. An inverted index of normalised word tokens with per-field weights; every query term
 * must match (AND), as a whole word or as a word prefix.
 *
 * Reducers keep unchanged entities as the same object, so `buildIndex(state, previous)` updates
 * the previous index in place and only re-indexes what changed (measured in M4a: a full rebuild
 * after each edit was too slow on a throttled CPU with 5.000 notes).
 *
 * M4e: a note is also found by where it comes from (its content's title and authors, its show), at
 * a low weight, so «attia zona» finds the Outlive note about zone 2. Its document therefore depends
 * on its content and show: when those change, only their own notes are re-indexed.
 */

type DocKind = EntityRef["type"]

interface Doc {
  ref: EntityRef
  /** Best weight of each token in the document. */
  weights: Map<string, number>
  /** The entity the document was built from, and those it borrows text from (content, show). */
  source: object
  dep1: object | undefined
  dep2: object | undefined
  /** Build in which the entity was last seen (stale documents are those of older builds). */
  gen: number
}

export interface KnowledgeIndex {
  docs: Map<string, Doc>
  postings: Map<string, Map<string, number>>
  /** Unique tokens, sorted, for prefix lookup by binary search. */
  tokens: string[]
  gen?: number
}

/** Field weights: a match in a title counts more than one in a long text. */
const W = { title: 8, isbn: 8, creator: 5, topic: 5, subtitle: 4, publisher: 4, show: 3, label: 2, body: 1, context: 0.5 } as const

type Fields = [text: string | null | undefined, weight: number][]

function weigh(fields: Fields): Map<string, number> {
  const out = new Map<string, number>()
  for (const [text, w] of fields) {
    if (!text) continue
    for (const t of tokenize(text)) if ((out.get(t) ?? 0) < w) out.set(t, w)
  }
  return out
}

function itemFields(item: ContentItem, show: PodcastShow | undefined): Fields {
  return [
    [item.title, W.title],
    [item.subtitle, W.subtitle],
    ...item.creators.map((c): [string, number] => [c, W.creator]),
    ...item.topics.map((t): [string, number] => [t, W.topic]),
    [item.description, W.body],
    ...(item.kind === "book"
      ? ([
          [item.book.isbn13, W.isbn],
          [item.book.isbn10, W.isbn],
          [item.book.publisher, W.publisher],
        ] as Fields)
      : ([[show?.title, W.show]] as Fields)),
  ]
}

function showFields(show: PodcastShow): Fields {
  return [[show.title, W.title], [show.publisher, W.publisher], ...show.topics.map((t): [string, number] => [t, W.topic]), [show.description, W.body]]
}

function noteFields(note: KnowledgeNote, item: ContentItem | undefined, show: PodcastShow | undefined): Fields {
  return [
    [note.body, W.body],
    ...note.topics.map((t): [string, number] => [t, W.topic]),
    [note.locator?.label, W.label],
    // Where it comes from, weighted below its own words.
    [item?.title, W.context],
    ...(item?.creators ?? []).map((c): [string, number] => [c, W.context]),
    [show?.title, W.context],
  ]
}


const key = (type: DocKind, id: string) => `${type}:${id}`

/**
 * Builds the index, or brings `previous` up to date with `state` (mutating and returning it):
 * entities that are the same object as when they were indexed are skipped, changed ones are
 * re-tokenised and removed ones dropped. Pass `previous` only for an index of this same dataset.
 */
export function buildIndex(state: KnowledgeState, previous?: KnowledgeIndex): KnowledgeIndex {
  const b = indexBuilder(state, previous)
  b.step(() => false)
  return b.index
}

export interface IndexBuilder {
  /** The index being built; complete (and searchable) once `step` has returned true. */
  readonly index: KnowledgeIndex
  /** Share of the entities done, from 0 to 1. */
  readonly progress: number
  /** Indexes entities until `yieldNow()` says to stop; returns true when the index is complete. */
  step(yieldNow: () => boolean): boolean
}

/**
 * The same work as `buildIndex`, in slices (M4e): the first build of a large library took 1,2 s
 * on a 4× slower CPU with 5.000 notes, so the screen builds it a few milliseconds at a time and
 * stays responsive. The result is identical to `buildIndex(state, previous)`.
 */
export function indexBuilder(state: KnowledgeState, previous?: KnowledgeIndex): IndexBuilder {
  const index: KnowledgeIndex = previous ?? { docs: new Map(), postings: new Map(), tokens: [] }
  const { docs, postings } = index
  const added = new Set<string>()
  const removed = new Set<string>()
  const gen = (index.gen = (index.gen ?? 0) + 1)

  const drop = (k: string, doc: Doc) => {
    for (const t of doc.weights.keys()) {
      const p = postings.get(t)
      if (!p) continue
      p.delete(k)
      if (p.size === 0) {
        postings.delete(t)
        if (added.has(t)) added.delete(t)
        else removed.add(t)
      }
    }
    docs.delete(k)
  }
  const put = (type: DocKind, id: string, source: object, dep1: object | undefined, dep2: object | undefined, fields: () => Fields) => {
    const k = type + ":" + id
    const old = docs.get(k)
    if (old && old.source === source && old.dep1 === dep1 && old.dep2 === dep2) {
      old.gen = gen
      return
    }
    if (old) drop(k, old)
    const weights = weigh(fields())
    docs.set(k, { ref: { type, id }, weights, source, dep1, dep2, gen })
    for (const [t, w] of weights) {
      let p = postings.get(t)
      if (!p) {
        postings.set(t, (p = new Map()))
        if (removed.has(t)) removed.delete(t)
        else added.add(t)
      }
      p.set(k, w)
    }
  }

  const showOf = (i: ContentItem | undefined) => (i?.kind === "episode" && i.episode.showId ? state.shows[i.episode.showId] : undefined)
  // A cursor over the three lists (no per-entity allocation: an incremental update walks them all).
  const shows = Object.values(state.shows)
  const items = Object.values(state.items)
  const notes = Object.values(state.notes)
  const total = shows.length + items.length + notes.length
  const one = (at: number) => {
    if (at < shows.length) {
      const sh = shows[at]
      return put("show", sh.id, sh, undefined, undefined, () => showFields(sh))
    }
    at -= shows.length
    if (at < items.length) {
      const i = items[at]
      const show = showOf(i)
      return put("item", i.id, i, show, undefined, () => itemFields(i, show))
    }
    const n = notes[at - items.length]
    const item = n.itemId ? state.items[n.itemId] : undefined
    const show = showOf(item)
    put("note", n.id, n, item, show, () => noteFields(n, item, show))
  }
  let next = 0
  let done = false

  const finish = () => {
    if (previous) {
      const stale: [string, Doc][] = []
      for (const e of docs) if (e[1].gen !== gen) stale.push(e)
      for (const [k, doc] of stale) drop(k, doc)
    }
    // Few changes (an edit) splice the sorted token list; many (a first build) sort it once.
    if (!previous || added.size + removed.size > 64) index.tokens = [...postings.keys()].sort()
    else {
      for (const t of removed) {
        const at = lowerBound(index.tokens, t)
        if (index.tokens[at] === t) index.tokens.splice(at, 1)
      }
      for (const t of added) index.tokens.splice(lowerBound(index.tokens, t), 0, t)
    }
    done = true
  }

  return {
    index,
    get progress() {
      return total ? next / total : 1
    },
    step(yieldNow) {
      if (done) return true
      while (next < total) {
        one(next++)
        // Check the clock every 16 entities, not on each one.
        if ((next & 15) === 0 && yieldNow()) return false
      }
      finish()
      return true
    },
  }
}

/** Query terms: normalised words; single letters are dropped («y», «a»), single digits are kept. */
export function queryTerms(query: string): string[] {
  return [...new Set(tokenize(query))].filter((t) => t.length > 1 || /\d/.test(t))
}

function lowerBound(xs: string[], target: string): number {
  let lo = 0
  let hi = xs.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (xs[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Score of every document matching one term: whole-word matches count fully, prefix matches 60 %. */
function termScores(index: KnowledgeIndex, term: string): Map<string, number> {
  const out = new Map<string, number>()
  for (let i = lowerBound(index.tokens, term); i < index.tokens.length && index.tokens[i].startsWith(term); i++) {
    const token = index.tokens[i]
    const factor = token === term ? 1 : 0.6
    for (const [doc, w] of index.postings.get(token)!) {
      const s = w * factor
      if ((out.get(doc) ?? 0) < s) out.set(doc, s)
    }
  }
  return out
}

export type NoteFormat = "book" | "episode" | "free"

export interface KnowledgeFilters {
  noteTypes?: NoteType[]
  formats?: NoteFormat[]
  topics?: string[]
  /** A content's notes; null = only free-standing ones. */
  itemId?: string | null
  showId?: string
  /** Notes whose content is rated at least this (free notes never match). */
  minRating?: number
  /** Notes of a content in one of these states (free notes never match). */
  contentStatus?: ContentStatus[]
  /** Notes of a favourite content. */
  favorite?: boolean
  starred?: boolean
  applicationStatus?: ApplicationStatus[]
  /** Creation instants (ISO), inclusive bounds. */
  since?: string
  until?: string
}

export type SearchSort = "relevance" | "recent" | "oldest"

export interface SearchQuery {
  query?: string
  filters?: KnowledgeFilters
  sort?: SearchSort
  limit?: number
}

export interface Hit<T> {
  entity: T
  score: number
}

export interface SearchResult {
  terms: string[]
  notes: Hit<KnowledgeNote>[]
  items: Hit<ContentItem>[]
  shows: Hit<PodcastShow>[]
  /** Matches before the limit, per group. */
  total: { notes: number; items: number; shows: number }
}

function noteFormat(state: KnowledgeState, n: KnowledgeNote): NoteFormat {
  return n.itemId === null ? "free" : (state.items[n.itemId]?.kind ?? "free")
}

function noteMatches(state: KnowledgeState, n: KnowledgeNote, f: KnowledgeFilters, topicKeys: Set<string> | null): boolean {
  if (f.noteTypes?.length && !f.noteTypes.includes(n.type)) return false
  if (f.formats?.length && !f.formats.includes(noteFormat(state, n))) return false
  if (f.itemId !== undefined && n.itemId !== f.itemId) return false
  if (f.starred && !n.starred) return false
  if (f.applicationStatus?.length && (n.applicationStatus === null || !f.applicationStatus.includes(n.applicationStatus))) return false
  if (f.since && n.createdAt < f.since) return false
  if (f.until && n.createdAt > f.until) return false
  const item = n.itemId ? state.items[n.itemId] : undefined
  if (f.showId && !(item?.kind === "episode" && item.episode.showId === f.showId)) return false
  if (f.minRating != null && (item?.rating ?? 0) < f.minRating) return false
  if (f.contentStatus?.length && !(item && f.contentStatus.includes(item.status))) return false
  if (f.favorite && !item?.favorite) return false
  if (topicKeys) {
    // A note carries its own topics and inherits its content's (and its show's).
    const show = item?.kind === "episode" && item.episode.showId ? state.shows[item.episode.showId] : undefined
    const has = (keys: string[]) => keys.some((t) => topicKeys.has(t))
    if (!has(topicKeysOf(n)) && !(item && has(topicKeysOf(item))) && !(show && has(topicKeysOf(show)))) return false
  }
  return true
}

/** True when a filter only makes sense for notes, so content and shows are left out of the results. */
function noteOnly(f: KnowledgeFilters): boolean {
  return !!(f.noteTypes?.length || f.formats?.length || f.itemId !== undefined || f.starred || f.applicationStatus?.length || f.since || f.until || f.showId || f.minRating != null || f.contentStatus?.length || f.favorite || f.topics?.length)
}

export function search(state: KnowledgeState, index: KnowledgeIndex, q: SearchQuery): SearchResult {
  const terms = queryTerms(q.query ?? "")
  const f = q.filters ?? {}
  const limit = q.limit ?? 50
  const topicKeys = f.topics?.length ? new Set(f.topics.map(normalize)) : null
  const sort = q.sort ?? (terms.length ? "relevance" : "recent")

  let scores: Map<string, number> | null = null
  for (const term of terms) {
    const s = termScores(index, term)
    if (!scores) scores = s
    else {
      const next = new Map<string, number>()
      for (const [doc, v] of scores) {
        const w = s.get(doc)
        if (w !== undefined) next.set(doc, v + w)
      }
      scores = next
    }
    if (scores.size === 0) break
  }

  const notes: Hit<KnowledgeNote>[] = []
  const items: Hit<ContentItem>[] = []
  const shows: Hit<PodcastShow>[] = []
  const candidates: Iterable<[string, number]> = scores ?? Object.keys(state.notes).map((id): [string, number] => [key("note", id), 0])
  for (const [k, score] of candidates) {
    const sep = k.indexOf(":")
    const type = k.slice(0, sep) as DocKind
    const id = k.slice(sep + 1)
    if (type === "note") {
      const n = state.notes[id]
      if (n && noteMatches(state, n, f, topicKeys)) notes.push({ entity: n, score: n.starred ? score * 1.2 : score })
    } else if (!noteOnly(f)) {
      if (type === "item" && state.items[id]) items.push({ entity: state.items[id], score })
      if (type === "show" && state.shows[id]) shows.push({ entity: state.shows[id], score })
    }
  }

  const order = <T extends { updatedAt: string; createdAt: string }>(a: Hit<T>, b: Hit<T>) =>
    sort === "oldest"
      ? cmp(a.entity.createdAt, b.entity.createdAt)
      : sort === "recent"
        ? cmp(b.entity.createdAt, a.entity.createdAt)
        : b.score - a.score || cmp(b.entity.updatedAt, a.entity.updatedAt)
  notes.sort(order)
  items.sort(order)
  shows.sort(order)
  return {
    terms,
    notes: notes.slice(0, limit),
    items: items.slice(0, limit),
    shows: shows.slice(0, limit),
    total: { notes: notes.length, items: items.length, shows: shows.length },
  }
}

export type MatchField = "text" | "topics" | "locator" | "source"

/**
 * Why a note matched (shown under the result): its own text, its topics, its locator label, or
 * only where it comes from (content title, authors, show). Each term counts as a word or a prefix,
 * like the index.
 */
export function explainMatch(state: KnowledgeState, note: KnowledgeNote, terms: readonly string[]): MatchField[] {
  if (!terms.length) return []
  const item = note.itemId ? state.items[note.itemId] : undefined
  const show = item?.kind === "episode" && item.episode.showId ? state.shows[item.episode.showId] : undefined
  const fields: [MatchField, (string | null | undefined)[]][] = [
    ["text", [note.body]],
    ["topics", note.topics],
    ["locator", [note.locator?.label]],
    ["source", [item?.title, ...(item?.creators ?? []), show?.title]],
  ]
  const out: MatchField[] = []
  for (const [field, texts] of fields) {
    const tokens = texts.flatMap((t) => (t ? tokenize(t) : []))
    if (terms.some((term) => tokens.some((tok) => tok.startsWith(term)))) out.push(field)
  }
  return out
}
