import { canonicalLink } from "@/features/knowledge/domain/relations"
import type { ContentItem, EntityRef, KnowledgeLink, KnowledgeNote, KnowledgeState, PodcastShow } from "@/features/knowledge/domain/types"
import { itemFields, noteFields, rowToItem, rowToLink, rowToNote, rowToShow, showFields, type WireChange, type WireRow } from "./library-wire"
import { isLibraryOp, type LibraryEntity, type LibraryOp, type LibraryUpdateOp, type LibraryWriteOp, type Op, type QueuedOp, type SyncNotice } from "./types"

/**
 * Client side of the Library sync (M4c, D71–D73). Pure: the server-confirmed rows as pull_library
 * sends them, the optimistic view (confirmed rows + queued operations), queue compaction and the
 * conflict bases. The engine owns the I/O (library-store.ts, transport) and calls these.
 */

export type LibTable = "show" | "item" | "note" | "link"
export const LIB_TABLES: readonly LibTable[] = ["show", "item", "note", "link"]

/** Server-confirmed rows by table and id (with their field_seqs: the bases of the next edits). */
export type LibraryRows = Record<LibTable, Map<string, WireRow>>

export function emptyRows(): LibraryRows {
  return { show: new Map(), item: new Map(), note: new Map(), link: new Map() }
}

/** Where a device stands in the library pull (stored with the rows, in the same transaction). */
export interface LibraryMeta {
  /** Last server_seq whose page is stored on this device. */
  cursor: number
  /** A rebuild in progress: the skip_deleted_upto its first page returned (resume with it). */
  rebuildUpto: number | null
  /** A full copy has been built at least once (otherwise the next pull is a rebuild from 0). */
  complete: boolean
}

/**
 * Applies a pulled page to the confirmed rows: per row, only a newer server_seq replaces what is
 * there, and a tombstone removes it. Returns how many rows changed. Mutates `rows` (owned by the
 * engine); idempotent, so applying the same page twice changes nothing.
 */
export function applyChanges(rows: LibraryRows, changes: readonly WireChange[]): number {
  let changed = 0
  for (const c of changes) {
    const map = rows[c.t]
    const prev = map.get(c.row.id)
    if (prev && Number(prev.server_seq) >= c.seq) continue
    if (c.row.deleted) {
      if (map.delete(c.row.id)) changed++
    } else {
      map.set(c.row.id, c.row)
      changed++
    }
  }
  return changed
}

// Entities are converted once per row object (rows are immutable once pulled).
const converted = new WeakMap<WireRow, ContentItem | PodcastShow | KnowledgeNote | KnowledgeLink>()
function convert<T extends ContentItem | PodcastShow | KnowledgeNote | KnowledgeLink>(row: WireRow, fn: (r: WireRow) => T): T {
  let e = converted.get(row) as T | undefined
  if (!e) converted.set(row, (e = fn(row)))
  return e
}

/** The confirmed library as domain entities (links keyed canonically, like the domain). */
export function rowsToState(rows: LibraryRows): KnowledgeState {
  const state: KnowledgeState = { items: {}, shows: {}, notes: {}, links: {} }
  for (const r of rows.show.values()) state.shows[r.id] = convert(r, rowToShow)
  for (const r of rows.item.values()) state.items[r.id] = convert(r, rowToItem)
  for (const r of rows.note.values()) state.notes[r.id] = convert(r, rowToNote)
  for (const r of rows.link.values()) {
    const l = convert(r, rowToLink)
    state.links[l.key] = l
  }
  return state
}

const entityOf = (op: LibraryOp): LibraryEntity | null => (op.type === "library.link.set" ? null : (op.type.split(".")[1] as LibraryEntity))
const actionOf = (op: LibraryOp) => op.type.split(".")[2] as "create" | "restore" | "update" | "delete" | "set"

/** Copy-on-first-write draft of a KnowledgeState: one copy per record per rebase, not one per op. */
function draft(base: KnowledgeState) {
  const copied = new Set<keyof KnowledgeState>()
  const s: KnowledgeState = { ...base }
  const w = <K extends keyof KnowledgeState>(k: K): KnowledgeState[K] => {
    if (!copied.has(k)) {
      s[k] = { ...base[k] } as KnowledgeState[K]
      copied.add(k)
    }
    return s[k]
  }
  return { s, w }
}

function fieldsOf(e: ContentItem | PodcastShow | KnowledgeNote, entity: LibraryEntity): Record<string, unknown> {
  return entity === "item" ? itemFields(e as ContentItem) : entity === "show" ? showFields(e as PodcastShow) : noteFields(e as KnowledgeNote)
}

function toEntity(entity: LibraryEntity, row: WireRow) {
  return entity === "item" ? rowToItem(row) : entity === "show" ? rowToShow(row) : rowToNote(row)
}

/**
 * The optimistic view: the confirmed library with the queued library operations on top, in queue
 * order (optimistic, like rebase() for the rest of the app). Records are copied at most once.
 */
export function applyLibraryOps(base: KnowledgeState, ops: readonly Op[]): KnowledgeState {
  const lib = ops.filter(isLibraryOp)
  if (lib.length === 0) return base
  const { s, w } = draft(base)
  const table = (e: LibraryEntity) => (e === "item" ? "items" : e === "show" ? "shows" : "notes") as "items" | "shows" | "notes"
  for (const op of lib) {
    if (op.type === "library.link.set") {
      const link = canonicalLink({ type: op.a_type, id: op.a_id }, { type: op.b_type, id: op.b_id }, new Date(0).toISOString())
      if (!link) continue
      const links = w("links")
      if (op.linked) links[link.key] = links[link.key] ?? link
      else delete links[link.key]
      continue
    }
    const entity = entityOf(op)!
    const action = actionOf(op)
    const t = table(entity)
    if (action === "create" || action === "restore") {
      const o = op as LibraryWriteOp
      const row: WireRow = {
        ...o.fields,
        id: o.id,
        kind: o.kind,
        server_seq: 0,
        deleted: false,
        created_at: o.at,
        updated_at: o.at,
        captured_at: o.captured_at ?? o.at,
      }
      ;(w(t) as Record<string, unknown>)[o.id] = toEntity(entity, row)
    } else if (action === "update") {
      const o = op as LibraryUpdateOp
      const cur = s[t][o.id] as ContentItem | PodcastShow | KnowledgeNote | undefined
      if (!cur) continue
      const row: WireRow = {
        ...fieldsOf(cur, entity),
        ...o.fields,
        id: o.id,
        kind: (cur as ContentItem).kind,
        server_seq: 0,
        deleted: false,
        created_at: cur.createdAt,
        updated_at: o.at,
        captured_at: cur.createdAt,
      }
      ;(w(t) as Record<string, unknown>)[o.id] = toEntity(entity, row)
    } else if (action === "delete") {
      removeEntity(s, w, entity, op.id)
    }
  }
  return s
}

/** Mirrors the server cascade: a content takes its notes and links; a show only detaches its episodes. */
function removeEntity(s: KnowledgeState, w: ReturnType<typeof draft>["w"], entity: LibraryEntity, id: string) {
  const gone = new Set<string>([`${entity}:${id}`])
  if (entity === "item") {
    if (!s.items[id]) return
    delete w("items")[id]
    for (const n of Object.values(s.notes)) {
      if (n.itemId === id) {
        delete w("notes")[n.id]
        gone.add(`note:${n.id}`)
      }
    }
  } else if (entity === "show") {
    if (!s.shows[id]) return
    delete w("shows")[id]
    for (const i of Object.values(s.items)) {
      if (i.kind === "episode" && i.episode.showId === id) w("items")[i.id] = { ...i, episode: { ...i.episode, showId: null } }
    }
  } else {
    if (!s.notes[id]) return
    delete w("notes")[id]
  }
  for (const [k, l] of Object.entries(s.links)) {
    if (gone.has(`${l.a.type}:${l.a.id}`) || gone.has(`${l.b.type}:${l.b.id}`)) delete w("links")[k]
  }
}

const targetOf = (op: Op): string | null => (isLibraryOp(op) && op.type !== "library.link.set" ? `${entityOf(op)}:${op.id}` : null)
const pairOf = (op: Op): string | null =>
  op.type === "library.link.set"
    ? (canonicalLink({ type: op.a_type, id: op.a_id }, { type: op.b_type, id: op.b_id }, "")?.key ?? null)
    : null

/**
 * Enqueue a library op with compaction (unsent ops only; anything in flight is never touched):
 * - an edit of something created or edited and not sent yet folds into that op (newest value per
 *   field; the base of the first unsent write of a field is kept, D55);
 * - deleting something never sent drops its unsent ops instead of sending a create and a delete;
 * - a link's desired state replaces the previous unsent one for the same pair.
 * Returns null when the op is not a library op (the caller compacts it as before).
 */
export function enqueueLibrary(queue: readonly QueuedOp[], op: Op, now: number, inFlight: ReadonlySet<string>): QueuedOp[] | null {
  if (!isLibraryOp(op)) return null
  const unsent = (q: QueuedOp) => !inFlight.has(q.op.op_id)
  if (op.type === "library.link.set") {
    const pair = pairOf(op)
    return [...queue.filter((q) => !(unsent(q) && pairOf(q.op) === pair)), { op, enqueuedAt: now, attempts: 0 }]
  }
  const target = targetOf(op)
  const action = actionOf(op)
  if (action === "update") {
    const u = op as LibraryUpdateOp
    const prev = queue.find((q) => unsent(q) && targetOf(q.op) === target && (actionOf(q.op as LibraryOp) !== "delete"))
    if (prev) {
      const p = prev.op as LibraryWriteOp | LibraryUpdateOp
      const merged: Op =
        "base_seqs" in p
          ? { ...p, fields: { ...p.fields, ...u.fields }, base_seqs: { ...u.base_seqs, ...p.base_seqs }, at: u.at }
          : { ...p, fields: { ...p.fields, ...u.fields }, at: u.at }
      return queue.map((q) => (q === prev ? { op: merged, enqueuedAt: prev.enqueuedAt, attempts: 0 } : q))
    }
  }
  if (action === "delete") {
    const created = queue.some((q) => unsent(q) && targetOf(q.op) === target && actionOf(q.op as LibraryOp) === "create")
    const sentBefore = queue.some((q) => !unsent(q) && targetOf(q.op) === target)
    const rest = queue.filter((q) => !(unsent(q) && targetOf(q.op) === target))
    // Never reached the server: nothing to delete there.
    if (created && !sentBefore) return rest
    return [...rest, { op, enqueuedAt: now, attempts: 0 }]
  }
  return [...queue, { op, enqueuedAt: now, attempts: 0 }]
}

/**
 * Conflict bases of the fields of an edit: the version of each field this device last saw from the
 * server, or null when it never saw one (D68). A field this device wrote itself and the server
 * already confirmed (`own`: seqs answered to this device) is a sequential edit on its own text.
 */
export function libraryBases(row: WireRow | undefined, fields: readonly string[]): Record<string, number | null> {
  const seqs = (row?.field_seqs ?? {}) as Record<string, number>
  return Object.fromEntries(fields.map((f) => [f, seqs[f] ?? null]))
}

/**
 * Just before sending: a base older than the field's current version is moved up when that version
 * is this device's own confirmed write (consecutive edits of the same text never conflict with
 * each other; a write from another device in between keeps the old base and still conflicts).
 */
export function refreshBases(op: LibraryUpdateOp, row: WireRow | undefined, own: ReadonlySet<number>): LibraryUpdateOp {
  const seqs = (row?.field_seqs ?? {}) as Record<string, number>
  let base_seqs = op.base_seqs
  for (const f of Object.keys(op.fields)) {
    const cur = seqs[f]
    const base = base_seqs[f] ?? null
    if (cur !== undefined && own.has(cur) && (base === null || base < cur)) base_seqs = { ...base_seqs, [f]: cur }
  }
  return base_seqs === op.base_seqs ? op : { ...op, base_seqs }
}

/** The confirmed row an op targets (for bases, the newest seen version, and recovery copies). */
export function rowOf(rows: LibraryRows, op: LibraryOp): WireRow | undefined {
  const e = entityOf(op)
  return e && "id" in op ? rows[e].get(op.id) : undefined
}

/** Library ops whose answer holds text the user wrote: kept durably on a conflict or refusal (D68). */
export function isLibraryText(n: SyncNotice): boolean {
  const op = n.op
  if (!op || !isLibraryOp(op) || op.type === "library.link.set") return false
  return actionOf(op) !== "delete"
}

/** Text fields protected by the server (never decided by clock). */
export const PROTECTED = { note: ["body"], item: ["description"], show: ["description"] } as const

export function entityOfOp(op: LibraryOp): LibraryEntity | null {
  return entityOf(op)
}

export function linkRefs(op: Extract<LibraryOp, { type: "library.link.set" }>): [EntityRef, EntityRef] {
  return [
    { type: op.a_type, id: op.a_id },
    { type: op.b_type, id: op.b_id },
  ]
}
