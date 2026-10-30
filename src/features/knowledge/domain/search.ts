import { cmp, normalize, tokenize, topicKeys as topicKeysOf } from "./text"
import type { ApplicationStatus, ContentItem, EntityRef, KnowledgeNote, KnowledgeState, NoteType, PodcastShow } from "./types"

/**
 * Local knowledge search (D67): runs on the device copy, works offline and sends no query
 * anywhere. An inverted index of normalised word tokens with per-field weights; every query term
 * must match (AND), as a whole word or as a word prefix.
 *
 * Reducers keep unchanged entities as the same object, so `buildIndex(state, previous)` updates
 * the previous index in place and only re-indexes what changed (measured in M4a: a full rebuild
 * after each edit was too slow on a throttled CPU with 5.000 notes).
 */

type DocKind = EntityRef["type"]

interface Doc {
  ref: EntityRef
  /** Best weight of each token in the document. */
  weights: Map<string, number>
  /** The entity (and, for an episode, its show) the document was built from. */
  source: object
  dep: PodcastShow | undefined
}

export interface KnowledgeIndex {
  docs: Map<string, Doc>
  postings: Map<string, Map<string, number>>
  /** Unique tokens, sorted, for prefix lookup by binary search. */
  tokens: string[]
}

/** Field weights: a match in a title counts more than one in a long text. */
const W = { title: 8, isbn: 8, creator: 5, topic: 5, subtitle: 4, publisher: 4, show: 3, label: 2, body: 1 } as const

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

function noteFields(note: KnowledgeNote): Fields {
  return [[note.body, W.body], ...note.topics.map((t): [string, number] => [t, W.topic]), [note.locator?.label, W.label]]
}

const key = (type: DocKind, id: string) => `${type}:${id}`

/**
 * Builds the index, or brings `previous` up to date with `state` (mutating and returning it):
 * entities that are the same object as when they were indexed are skipped, changed ones are
 * re-tokenised and removed ones dropped. Pass `previous` only for an index of this same dataset.
 */
export function buildIndex(state: KnowledgeState, previous?: KnowledgeIndex): KnowledgeIndex {
  const index: KnowledgeIndex = previous ?? { docs: new Map(), postings: new Map(), tokens: [] }
  const { docs, postings } = index
  const added = new Set<string>()
  let removedTokens = false
  const seen = new Set<string>()

  const drop = (k: string, doc: Doc) => {
    for (const t of doc.weights.keys()) {
      const p = postings.get(t)
      if (!p) continue
      p.delete(k)
      if (p.size === 0) {
        postings.delete(t)
        removedTokens = true
      }
    }
    docs.delete(k)
  }
  const put = (ref: EntityRef, source: object, dep: PodcastShow | undefined, fields: () => Fields) => {
    const k = key(ref.type, ref.id)
    seen.add(k)
    const old = docs.get(k)
    if (old && old.source === source && old.dep === dep) return
    if (old) drop(k, old)
    const weights = weigh(fields())
    docs.set(k, { ref, weights, source, dep })
    for (const [t, w] of weights) {
      let p = postings.get(t)
      if (!p) {
        postings.set(t, (p = new Map()))
        added.add(t)
      }
      p.set(k, w)
    }
  }

  for (const s of Object.values(state.shows)) put({ type: "show", id: s.id }, s, undefined, () => showFields(s))
  for (const i of Object.values(state.items)) {
    const show = i.kind === "episode" && i.episode.showId ? state.shows[i.episode.showId] : undefined
    put({ type: "item", id: i.id }, i, show, () => itemFields(i, show))
  }
  for (const n of Object.values(state.notes)) put({ type: "note", id: n.id }, n, undefined, () => noteFields(n))
  if (previous) for (const [k, doc] of [...docs]) if (!seen.has(k)) drop(k, doc)

  if (!previous) index.tokens = [...postings.keys()].sort()
  else if (removedTokens || added.size > 64) index.tokens = [...postings.keys()].sort()
  else for (const t of added) index.tokens.splice(lowerBound(index.tokens, t), 0, t)
  return index
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
  return !!(f.noteTypes?.length || f.formats?.length || f.itemId !== undefined || f.starred || f.applicationStatus?.length || f.since || f.until || f.showId || f.minRating != null || f.topics?.length)
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
