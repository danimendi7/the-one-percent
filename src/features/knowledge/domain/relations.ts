import { cmp, collator, normalize } from "./text"
import { NOTE_TYPES, type ContentItem, type EntityRef, type Episode, type KnowledgeLink, type KnowledgeNote, type KnowledgeState, type NoteType } from "./types"

/**
 * How content and knowledge relate, without copying data: notes point to their item, episodes
 * to their show, and links are stored once per pair under a canonical key. Everything else
 * (a show's notes, related content, sections) is derived here.
 */

export const refKey = (r: EntityRef): string => `${r.type}:${r.id}`

/** One key per unordered pair, so «A–B» and «B–A» are the same link. null when both ends are the same. */
export function canonicalLink(a: EntityRef, b: EntityRef, createdAt: string): KnowledgeLink | null {
  const ka = refKey(a)
  const kb = refKey(b)
  if (ka === kb) return null
  const [x, y] = ka < kb ? [a, b] : [b, a]
  return { key: `${refKey(x)}|${refKey(y)}`, a: x, b: y, origin: "manual", createdAt }
}

export function entityExists(state: KnowledgeState, r: EntityRef): boolean {
  return r.type === "item" ? !!state.items[r.id] : r.type === "show" ? !!state.shows[r.id] : !!state.notes[r.id]
}

/** The other end of every link touching `r`, oldest link first. */
export function linkedTo(state: KnowledgeState, r: EntityRef): EntityRef[] {
  const k = refKey(r)
  return Object.values(state.links)
    .filter((l) => refKey(l.a) === k || refKey(l.b) === k)
    .sort((x, y) => cmp(x.createdAt, y.createdAt))
    .map((l) => (refKey(l.a) === k ? l.b : l.a))
}

export function episodesOfShow(state: KnowledgeState, showId: string): Episode[] {
  return Object.values(state.items)
    .filter((i): i is Episode => i.kind === "episode" && i.episode.showId === showId)
    .sort(
      (a, b) =>
        cmp(b.episode.publishedOn ?? "", a.episode.publishedOn ?? "") ||
        (b.episode.episodeNumber ?? -1) - (a.episode.episodeNumber ?? -1) ||
        cmp(b.createdAt, a.createdAt)
    )
}

/** Starred first, then in reading order (page or timestamp), then oldest first. */
function noteOrder(a: KnowledgeNote, b: KnowledgeNote): number {
  return (
    Number(b.starred) - Number(a.starred) ||
    (a.locator?.page ?? a.locator?.positionSeconds ?? Infinity) - (b.locator?.page ?? b.locator?.positionSeconds ?? Infinity) ||
    cmp(a.createdAt, b.createdAt) ||
    cmp(a.id, b.id)
  )
}

export function notesOf(state: KnowledgeState, itemId: string | null): KnowledgeNote[] {
  return Object.values(state.notes)
    .filter((n) => n.itemId === itemId)
    .sort(noteOrder)
}

/** A content page's knowledge, in the common section order (plan §4.2); empty sections are kept, so the page can offer them. */
export function sectionsOf(state: KnowledgeState, itemId: string): { type: NoteType; notes: KnowledgeNote[] }[] {
  const notes = notesOf(state, itemId)
  return NOTE_TYPES.map((type) => ({ type, notes: notes.filter((n) => n.type === type) }))
}

/** Every note of every episode of a show (the show page's «Ideas de este programa»). */
export function notesOfShow(state: KnowledgeState, showId: string): KnowledgeNote[] {
  const ids = new Set(episodesOfShow(state, showId).map((e) => e.id))
  return Object.values(state.notes)
    .filter((n) => n.itemId !== null && ids.has(n.itemId))
    .sort((a, b) => cmp(b.createdAt, a.createdAt))
}

/** Topics of a show: its own plus its episodes', by frequency (the first spelling wins). */
export function showTopics(state: KnowledgeState, showId: string): string[] {
  const show = state.shows[showId]
  const counts = new Map<string, { label: string; n: number }>()
  const add = (t: string, w: number) => {
    const k = normalize(t)
    const c = counts.get(k)
    if (c) c.n += w
    else counts.set(k, { label: t, n: w })
  }
  for (const t of show?.topics ?? []) add(t, 1000)
  for (const e of episodesOfShow(state, showId)) for (const t of e.topics) add(t, 1)
  return [...counts.values()].sort((a, b) => b.n - a.n || collator.compare(a.label, b.label)).map((c) => c.label)
}

/** An item's topics, including those of its show for an episode. */
export function topicsOf(state: KnowledgeState, item: ContentItem): string[] {
  const show = item.kind === "episode" && item.episode.showId ? state.shows[item.episode.showId] : null
  return [...item.topics, ...(show?.topics ?? [])]
}

export interface Related {
  item: ContentItem
  /** Why it is suggested: the topics both share (deterministic and explained, no AI). */
  shared: string[]
}

/**
 * Content related to an item by shared topics (its show's topics count for an episode).
 * Linked items are excluded: they already show as manual links. Most shared topics first.
 */
export function relatedByTopics(state: KnowledgeState, itemId: string, limit = 6): Related[] {
  const item = state.items[itemId]
  if (!item) return []
  const mine = new Map(topicsOf(state, item).map((t) => [normalize(t), t]))
  if (!mine.size) return []
  const linked = new Set(linkedTo(state, { type: "item", id: itemId }).map(refKey))
  const out: Related[] = []
  for (const other of Object.values(state.items)) {
    if (other.id === itemId || linked.has(refKey({ type: "item", id: other.id }))) continue
    const shared = [...new Set(topicsOf(state, other).map(normalize))].filter((k) => mine.has(k)).map((k) => mine.get(k)!)
    if (shared.length) out.push({ item: other, shared })
  }
  return out.sort((a, b) => b.shared.length - a.shared.length || cmp(b.item.updatedAt, a.item.updatedAt)).slice(0, limit)
}

/** A note's topics: its own, then its content's and (for an episode) its show's. */
export function noteTopics(state: KnowledgeState, note: KnowledgeNote): string[] {
  const item = note.itemId ? state.items[note.itemId] : undefined
  return [...note.topics, ...(item ? topicsOf(state, item) : [])]
}

export interface RelatedNote {
  note: KnowledgeNote
  /** The topics both share, in this note's spelling (the explanation shown to the user). */
  shared: string[]
}

/**
 * Notes related to a note by shared topics (own or inherited), without AI. Notes of the same
 * content are left out (they are already together on its page), and so are linked ones (they
 * show as manual links). Most shared topics first, then newest.
 */
export function relatedNotes(state: KnowledgeState, noteId: string, limit = 5): RelatedNote[] {
  const note = state.notes[noteId]
  if (!note) return []
  const mine = new Map(noteTopics(state, note).map((t) => [normalize(t), t]))
  if (!mine.size) return []
  const linked = new Set(linkedTo(state, { type: "note", id: noteId }).map(refKey))
  const out: RelatedNote[] = []
  for (const other of Object.values(state.notes)) {
    if (other.id === noteId || linked.has(`note:${other.id}`)) continue
    if (note.itemId !== null && other.itemId === note.itemId) continue
    const shared = [...new Set(noteTopics(state, other).map(normalize))].filter((k) => mine.has(k)).map((k) => mine.get(k)!)
    if (shared.length) out.push({ note: other, shared })
  }
  return out.sort((a, b) => b.shared.length - a.shared.length || cmp(b.note.createdAt, a.note.createdAt)).slice(0, limit)
}
