import { localDateInZone, type LocalDate } from "@/features/habits/domain/dates"
import type { HabitsState } from "@/features/habits/domain/types"
import { uuidv4 } from "@/lib/ids"
import { emptyCache, mergePull } from "./domain/merge"
import { upgradePersisted } from "./domain/persisted"
import { enqueue, rebase } from "./domain/rebase"
import type { CloseIntent, Op, OpResult, PullPayload, QueuedOp, ReviewSyncState, ServerCache, SyncNotice, SyncStatus } from "./domain/types"
import { closeGate, emptyDraft, type CloseGate } from "@/features/reviews/domain/close"
import { buildReviewSnapshot, SnapshotError } from "@/features/reviews/domain/snapshot"
import { isAvailable, periodFromStart, periodLabel } from "@/features/reviews/domain/periods"
import { normalizeDecision, validateContent } from "@/features/reviews/domain/content"
import { applySave, reviewFingerprint, sameSection, sectionBase, sectionOf, type ReviewFields } from "@/features/reviews/domain/sync"
import { reviewKey, type Decision, type Review, type ReviewField, type ReviewKind } from "@/features/reviews/domain/types"
import type { ReviewDeleteOutcome, ReviewSaveOutcome } from "@/features/habits/store/types"
import { emptyKnowledge, type EntityRef, type KnowledgeState } from "@/features/knowledge/domain/types"
import {
  applyChanges,
  applyLibraryOps,
  emptyRows,
  enqueueLibrary,
  entityOfOp,
  isLibraryText,
  libraryBases,
  refreshBases,
  rowOf,
  rowsToState,
  type LibraryMeta,
  type LibraryRows,
} from "./domain/library-sync"
import type { WireChange, WireRow } from "./domain/library-wire"
import { isLibraryOp, type LibraryEntity, type LibraryOp, type LibraryUpdateOp, type LibraryWriteOp } from "./domain/types"
import type { LibraryStore } from "./library-store"

/** Network-level failure (offline, DNS, 5xx): the operation may or may not have reached the server. */
export class NetworkError extends Error {
  constructor(message = "network") {
    super(message)
    this.name = "NetworkError"
  }
}

export interface SyncTransport {
  applyOps(deviceId: string, ops: Op[]): Promise<{ results: OpResult[]; server_today: LocalDate; server_time?: string }>
  pull(since: number): Promise<PullPayload>
  /** M4b: one page of library changes after `since` (D71). */
  pullLibrary?(since: number, limit: number, skipDeletedUpto: number | null): Promise<LibraryPage>
}

export interface LibraryPage {
  changes: WireChange[]
  cursor: number
  has_more: boolean
  skip_deleted_upto: number
  head: number
}

/** What the UI says about the Library (M4c): «sincronizado» only when every page and every edit is on the server. */
export interface LibrarySyncInfo {
  /** The account stores the library (the server has the M4b migration) and this device keeps a copy. */
  enabled: boolean
  /** The device copy has been read (it may still be empty). */
  ready: boolean
  /** downloading: catching up; rebuilding: building a copy from scratch (first sync or lost copy). */
  phase: "idle" | "downloading" | "rebuilding"
  /** 0–1 while paging (by server_seq), null otherwise. */
  progress: number | null
  /** Library edits still in the queue. */
  pending: number
  /** Kept texts waiting for the user's decision. */
  conflicts: number
  state: "disabled" | "local" | "pending" | "synced" | "conflict" | "error"
}

export interface PersistedSync {
  cache: ServerCache
  queue: QueuedOp[]
  /**
   * Reflections that lost a conflict and wait for the user's decision (M3.3). Stored with the
   * user's copy (one IndexedDB record per user) so closing or reloading the app never loses them.
   */
  pendingNotes?: SyncNotice[]
  /** Ids decided recently, so another tab's older copy cannot bring a decided reflection back. */
  resolvedNotes?: string[]
  /** Review closes the user asked for that have not run yet (M3.4c). */
  closeIntents?: CloseIntent[]
  /**
   * Ops that left a tab's queue (answered by the server, or folded into a newer write) (M3.4d).
   * Every tab of the user shares this record: a tab merges the stored queue with its own instead
   * of writing over it, and this list keeps it from bringing back what another tab already sent.
   */
  goneOps?: string[]
}

/** A reflection conflict: kept durably until the user chooses «Aplicar el mío» or «Mantener la otra». */
export const isNoteConflict = (n: SyncNotice) => n.kind === "conflict" && n.code === "note_conflict" && n.op?.type === "checkin.set"
/**
 * Review sections the server did not take (M3.4c, D47 generalized): a section changed meanwhile on
 * another device, a review deleted or already closed elsewhere, or a refused value. The user's text
 * is kept durably, like a reflection, until they decide; it is never dropped on its own.
 */
export const isReviewText = (n: SyncNotice) => n.op?.type === "review.save"
/** Notices that hold text the user has not decided about: persisted and never closed on their own (library: D68). */
export const isDurableNotice = (n: SyncNotice) => isNoteConflict(n) || isReviewText(n) || isLibraryText(n)
const RESOLVED_KEEP = 100
/** Recently removed op ids kept for other tabs (far more than any tab persists between two reads). */
const GONE_KEEP = 500
/** Automatic retries of a close answered stale_snapshot (data changed between the pull and the close). */
const CLOSE_RETRIES = 3

export type CloseRequest = { ok: true; deferred: boolean } | { ok: false; reason: Extract<CloseGate, { action: "blocked" }>["reason"] }

export interface SyncStorage {
  load(): Promise<PersistedSync | null>
  save(data: PersistedSync): Promise<void>
}

export interface EngineSnapshot {
  state: HabitsState
  today: LocalDate
  status: SyncStatus
  pending: number
  lastSyncedAt: number | null
  lastError: string | null
  /** True once the first server pull (or a cached copy) is available. */
  ready: boolean
  notices: SyncNotice[]
  persisted: boolean
  /** The server has the goals migration (M3.1). */
  goals: boolean
  /** The server has the focus migration (M3.2). */
  focus: boolean
  /** The server has the check-ins migration (M3.3). */
  checkins: boolean
  /** The server has the reviews migration (M3.4). */
  reviews: boolean
  dailyReviews: boolean
  recall: boolean
  discovery: boolean
  experiments: boolean
  motivation: boolean
  /** Review closes waiting to run (or needing a new decision). */
  closeIntents: CloseIntent[]
  /** Reviews (`kind:periodStart`) with writes still in the queue. */
  pendingReviews: string[]
  /** The Library as this device shows it: server-confirmed copy + queued edits (M4c). */
  library: KnowledgeState
  librarySync: LibrarySyncInfo
}

export interface EngineDeps {
  transport: SyncTransport
  storage: SyncStorage
  deviceId: string
  now?: () => number
  /** Rows re-read before the cursor on incremental pulls (covers late commits). */
  overlap?: number
  batchSize?: number
  /** Retry scheduler; tests pass a manual one. */
  schedule?: (fn: () => void, ms: number) => () => void
  /**
   * Runs the read-merge-write of the device copy exclusively among this user's tabs (Web Locks in
   * the browser), so two tabs saving at once cannot drop each other's writes. Without it (tests,
   * old browsers) the merge still runs; only simultaneous saves can race.
   */
  lock?: <T>(fn: () => Promise<T>) => Promise<T>
  /** Device copy of the Library, one entry per row (N1, D72). Without it the library is not synced. */
  library?: LibraryStore
  /** Rows per pull_library page (1–1000). */
  libraryPageSize?: number
}

const MAX_BACKOFF_MS = 60_000
/** Seqs answered to this device's own library writes (bases of its consecutive edits). */
const OWN_SEQS_KEEP = 1000

export class SyncEngine {
  private cache: ServerCache
  private queue: QueuedOp[] = []
  private inFlight = new Set<string>()
  private status: SyncStatus = "synced"
  private lastSyncedAt: number | null = null
  private lastError: string | null = null
  private ready = false
  private persisted = true
  private notices: SyncNotice[] = []
  private resolvedNotes: string[] = []
  private closeIntents: CloseIntent[] = []
  /** Op ids removed from the queue (this tab or others), shared through the device copy. */
  private goneOps: string[] = []
  /** Op ids of the queue as last read from or written to the device copy. */
  private savedIds = new Set<string>()
  /** The latest write of the device copy and its outcome (M4-H1). */
  private writing: Promise<boolean> = Promise.resolve(true)
  /** The last attempt failed for lack of network (the visible status turns «syncing» while retrying). */
  private offline = false
  private listeners = new Set<() => void>()
  private snapshot: EngineSnapshot | null = null
  private running: Promise<void> | null = null
  private rerun = false
  /**
   * The start-up (load of the saved copy, then the first full cycle) while it runs (M4f). A sync()
   * asked for meanwhile, e.g. by the realtime channel connecting first, waits for it instead of
   * running a cycle with an empty queue that would then sit on the pull (found by ci/m4).
   */
  private boot: Promise<void> | null = null
  private loaded = false
  private failures = 0
  private cancelRetry: (() => void) | null = null
  private readonly now: () => number
  private readonly overlap: number
  private readonly batchSize: number
  private readonly schedule: (fn: () => void, ms: number) => () => void
  /** Estimated server clock minus device clock (ms). */
  private clockOffset = 0
  private lastHybrid = 0
  // ── Library (M4c) ──
  /** Server-confirmed rows (the device copy as last stored). */
  private libRows: LibraryRows = emptyRows()
  /** The same rows as domain entities (rebuilt only when rows change). */
  private libConfirmed: KnowledgeState = emptyKnowledge()
  private libMeta: LibraryMeta | null = null
  private libLoaded = false
  /** Newest library change on the server, as pull_changes announced it. */
  private libHead = 0
  private libPaging: { from: number; to: number; rebuilding: boolean } | null = null
  /** The device copy could not be read or written (the queue and texts are still safe in the main record). */
  private libError = false
  private ownSeqs: number[] = []

  constructor(private readonly deps: EngineDeps) {
    this.now = deps.now ?? Date.now
    this.overlap = deps.overlap ?? 500
    this.batchSize = deps.batchSize ?? 50
    this.schedule =
      deps.schedule ??
      ((fn, ms) => {
        const t = setTimeout(fn, ms)
        return () => clearTimeout(t)
      })
    this.cache = emptyCache(this.localToday("Europe/Madrid"))
  }

  // ── public API ─────────────────────────────────────────────────────────
  start(): Promise<void> {
    this.boot ??= this.loadThenSync()
    return this.boot
  }

  private async loadThenSync(): Promise<void> {
    try {
      await this.load()
    } finally {
      // Even if loading failed, later syncs must run (they would otherwise wait on this start-up).
      this.loaded = true
    }
    await this.sync({ full: true })
  }

  private async load(): Promise<void> {
    // The library copy is read in parallel with the main record: they are separate databases (D72).
    const library = this.loadLibrary()
    // A copy saved by an older version may lack newer fields (e.g. goals): upgrade it in place, never discard it.
    const stored = upgradePersisted(await this.deps.storage.load().catch(() => null), this.localToday("Europe/Madrid"))
    await library
    if (stored) {
      this.cache = stored.cache
      this.queue = stored.queue
      this.goneOps = stored.goneOps ?? []
      this.savedIds = new Set(stored.queue.map((q) => q.op.op_id))
      this.resolvedNotes = stored.resolvedNotes ?? []
      // Reflections still waiting for a decision come back on reopening.
      this.notices = (stored.pendingNotes ?? []).filter((n) => !this.resolvedNotes.includes(n.id))
      // So do review closes the user asked for and that have not run yet.
      this.closeIntents = this.orphansWaiting((stored.closeIntents ?? []).filter((c) => !this.resolvedNotes.includes(c.id)))
      this.ready = true
      this.invalidate()
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot(): EngineSnapshot {
    if (!this.snapshot) {
      const today = this.localToday(this.cache.state.timezone)
      this.snapshot = {
        state: rebase(this.cache.state, this.queue, today),
        today,
        status: this.status,
        pending: this.queue.length,
        lastSyncedAt: this.lastSyncedAt,
        lastError: this.lastError,
        ready: this.ready,
        notices: this.notices,
        persisted: this.persisted,
        goals: !!this.cache.features?.goals,
        focus: !!this.cache.features?.focus,
        checkins: !!this.cache.features?.checkins,
        reviews: !!this.cache.features?.reviews,
        dailyReviews: !!this.cache.features?.dailyReviews,
        recall: !!this.cache.features?.recall,
        discovery: !!this.cache.features?.discovery,
        experiments: !!this.cache.features?.experiments,
        motivation: !!this.cache.features?.motivation,
        closeIntents: this.closeIntents,
        pendingReviews: [...new Set(this.queue.map((q) => reviewOf(q.op)).filter((k): k is string => k !== null))],
        library: applyLibraryOps(this.libConfirmed, this.queue.map((q) => q.op)),
        librarySync: this.librarySync(),
      }
    }
    return this.snapshot
  }

  // ── Library (M4c) ──────────────────────────────────────────────────────
  private async loadLibrary(): Promise<void> {
    if (!this.deps.library) return
    try {
      const { rows, meta } = await this.deps.library.load()
      this.libRows = rows
      this.libMeta = meta
      this.libConfirmed = rowsToState(rows)
      this.libError = false
    } catch {
      // Unreadable copy: start from scratch (a rebuild); pending edits are in the main record.
      this.libRows = emptyRows()
      this.libMeta = null
      this.libConfirmed = emptyKnowledge()
      this.libError = true
    }
    this.libLoaded = true
  }

  private librarySync(): LibrarySyncInfo {
    const enabled = !!this.deps.library && !!this.cache.features?.library
    const pending = this.queue.filter((q) => isLibraryOp(q.op)).length
    const conflicts = this.notices.filter(isLibraryText).length
    const paging = this.libPaging
    const progress = paging ? (paging.to > paging.from ? Math.min(1, Math.max(0, ((this.libMeta?.cursor ?? 0) - paging.from) / (paging.to - paging.from))) : 0) : null
    let state: LibrarySyncInfo["state"]
    if (!enabled) state = pending > 0 ? "local" : "disabled"
    else if (conflicts > 0) state = "conflict"
    else if (this.libError || !this.persisted) state = "error"
    else if (pending > 0) state = this.offline || this.status === "error" ? "local" : "pending"
    else if (paging || !this.libMeta?.complete || this.libMeta.cursor < this.libHead) state = "pending"
    else state = "synced"
    return { enabled, ready: this.libLoaded, phase: paging ? (paging.rebuilding ? "rebuilding" : "downloading") : "idle", progress, pending, conflicts, state }
  }

  /**
   * Pages the library down after the main pull (D71). Each page and the cursor after it are stored
   * in one transaction BEFORE the in-memory copy changes; if storing fails, nothing moves and the
   * next cycle starts again from the last stored page. A device without a copy rebuilds from 0 with
   * the rebuild's skip_deleted_upto on every page, also after reopening mid-rebuild.
   */
  private async pullLibrary(head: number): Promise<void> {
    const store = this.deps.library!
    const pull = this.deps.transport.pullLibrary!
    this.libHead = Math.max(this.libHead, head)
    let meta = this.libMeta
    if (meta?.complete && meta.cursor >= this.libHead) return
    const size = Math.min(1000, Math.max(1, this.deps.libraryPageSize ?? 1000))
    let since = meta?.complete ? meta.cursor : (meta?.rebuildUpto != null ? meta.cursor : 0)
    let upto = meta?.complete ? null : (meta?.rebuildUpto ?? null)
    const rebuilding = !meta?.complete
    this.libPaging = { from: since, to: this.libHead, rebuilding }
    this.invalidate()
    try {
      for (;;) {
        const page = await pull(since, size, upto)
        if (rebuilding && upto === null) upto = page.skip_deleted_upto
        this.libHead = Math.max(this.libHead, page.head)
        const next: LibraryMeta = { cursor: page.cursor, rebuildUpto: rebuilding && page.has_more ? upto : null, complete: rebuilding ? !page.has_more : true }
        try {
          await store.applyPage(page.changes, next)
          this.libError = false
        } catch (e) {
          this.libError = true
          throw e
        }
        // Stored: only now does this device's copy (and cursor) move.
        if (applyChanges(this.libRows, page.changes) > 0) this.libConfirmed = rowsToState(this.libRows)
        meta = this.libMeta = { ...next, cursor: Math.max(next.cursor, this.libMeta?.cursor ?? 0) }
        since = page.cursor
        if (this.libPaging) this.libPaging = { ...this.libPaging, to: this.libHead }
        this.invalidate()
        if (!page.has_more) break
      }
    } finally {
      this.libPaging = null
      this.invalidate()
    }
  }

  /** server_seq-based bases of an edit's fields, from the confirmed copy (D68). */
  private libraryRow(entity: LibraryEntity, id: string): WireRow | undefined {
    return this.libRows[entity].get(id)
  }

  /** The server has confirmed this row (it is in the device copy). */
  libraryIsConfirmed(entity: LibraryEntity, id: string): boolean {
    return this.libRows[entity].has(id)
  }

  /**
   * What the UI says about one row (M4d; D57 precedent): «synced» only when the server has it and
   * nothing about it waits in the queue; a write only on this device is «local» or «pending».
   */
  librarySyncStateOf(entity: LibraryEntity, id: string): "saving" | "local" | "pending" | "synced" | "conflict" | "error" {
    const about = (op: Op) => isLibraryOp(op) && "id" in op && op.id === id && entityOfOp(op) === entity
    if (this.notices.some((n) => n.op && about(n.op) && isLibraryText(n))) return "conflict"
    const queued = this.queue.filter((q) => about(q.op))
    if (queued.length > 0) {
      if (!this.persisted) return "error"
      // M4-H1: never «saved on this device» before the device copy holds the write.
      if (queued.some((q) => !this.savedIds.has(q.op.op_id))) return "saving"
      return this.offline || this.status === "error" || !this.cache.features?.library ? "local" : "pending"
    }
    if (this.libError) return "error"
    return this.libRows[entity].has(id) ? "synced" : "local"
  }

  /** Creates a show, a book or episode, or a note; returns its id. The server applies it once (idempotent id). */
  libraryCreate(entity: LibraryEntity, fields: Record<string, unknown>, opts: { id?: string; kind?: "book" | "episode"; capturedAt?: string } = {}): string {
    const id = opts.id ?? uuidv4()
    const at = this.clientTime()
    const op: LibraryWriteOp = { type: `library.${entity}.create`, op_id: uuidv4(), id, fields, at }
    if (entity === "item") op.kind = opts.kind
    if (entity === "note") op.captured_at = opts.capturedAt ?? at
    this.submit(op)
    return id
  }

  /** Changes some fields; each carries the version of it this device last saw (D68). */
  libraryUpdate(entity: LibraryEntity, id: string, fields: Record<string, unknown>): void {
    if (Object.keys(fields).length === 0) return
    const op: LibraryUpdateOp = {
      type: `library.${entity}.update`,
      op_id: uuidv4(),
      id,
      fields,
      base_seqs: libraryBases(this.libraryRow(entity, id), Object.keys(fields)),
      at: this.clientTime(),
    }
    this.submit(op)
  }

  /**
   * Deletes the version this device shows. Something that never reached the server is simply
   * dropped from the queue (a content with the notes written on it). A content that is on the server
   * is not deleted while it or its notes have edits still to send: those edits would either be lost
   * or make the server refuse the delete (D55 precedent: «espera a que se sincronicen»).
   */
  libraryDelete(entity: LibraryEntity, id: string): { ok: true } | { ok: false; reason: "not_found" | "in_flight" | "pending" } {
    const row = this.libraryRow(entity, id)
    const targets = (q: QueuedOp) => isLibraryOp(q.op) && "id" in q.op && q.op.id === id && entityOfOp(q.op) === entity
    const queued = this.queue.filter(targets)
    const notes =
      entity === "item" ? new Set(Object.values(this.getSnapshot().library.notes).filter((n) => n.itemId === id).map((n) => n.id)) : new Set<string>()
    const ofNotes = (q: QueuedOp) => isLibraryOp(q.op) && "id" in q.op && entityOfOp(q.op) === "note" && notes.has(q.op.id)
    if (!row) {
      if (queued.length === 0) return { ok: false, reason: "not_found" }
      if (this.queue.some((q) => (targets(q) || ofNotes(q)) && this.inFlight.has(q.op.op_id))) return { ok: false, reason: "in_flight" }
      // Never sent: its notes were never sent either (they queue after it). Nothing reaches the server.
      if (entity === "item") this.queue = this.queue.filter((q) => !ofNotes(q))
    } else if (entity === "item" && this.queue.some((q) => (targets(q) || ofNotes(q)) && !q.op.type.endsWith(".delete"))) {
      return { ok: false, reason: "pending" }
    }
    const notesSeq =
      entity === "item" ? Math.max(0, ...[...this.libRows.note.values()].filter((n) => n.item_id === id).map((n) => Number(n.server_seq))) : undefined
    this.submit({
      type: `library.${entity}.delete`,
      op_id: uuidv4(),
      id,
      base_seq: row ? Number(row.server_seq) : 0,
      ...(notesSeq !== undefined ? { notes_seq: notesSeq } : {}),
    })
    return { ok: true }
  }

  /** «Deshacer» or recovery: sends the whole entity again; only a tombstone takes it. */
  libraryRestore(entity: LibraryEntity, id: string, fields: Record<string, unknown>, kind?: "book" | "episode"): void {
    const op: LibraryWriteOp = { type: `library.${entity}.restore`, op_id: uuidv4(), id, fields, at: this.clientTime() }
    if (entity === "item") op.kind = kind
    this.submit(op)
  }

  librarySetLink(a: EntityRef, b: EntityRef, linked: boolean): void {
    this.submit({ type: "library.link.set", op_id: uuidv4(), a_type: a.type, a_id: a.id, b_type: b.type, b_id: b.id, linked })
  }

  /**
   * The user's decision on a kept library text (D68):
   * - mine: write it again on top of the version now on the server (a field changed elsewhere);
   * - theirs: forget it;
   * - both: keep the other version and save mine as a new note next to it;
   * - restore: bring back what was deleted elsewhere, with this device's text;
   * - free: save the note as a free-standing idea (its content was deleted).
   */
  resolveLibraryText(noticeId: string, choice: "mine" | "theirs" | "both" | "restore" | "free" | "existing" | "show", target?: string): boolean {
    const n = this.notices.find((x) => x.id === noticeId)
    if (!n || !isLibraryText(n) || !n.op || !isLibraryOp(n.op) || n.op.type === "library.link.set") return false
    const op = n.op as LibraryWriteOp | LibraryUpdateOp
    const entity = entityOfOp(op)!
    const recover = { ...(n.library?.fields ?? {}), ...op.fields }
    switch (choice) {
      case "mine":
        if (n.code !== "field_conflict") return false
        this.dismissNotice(noticeId)
        this.libraryUpdate(entity, op.id, op.fields)
        return true
      case "theirs":
        this.dismissNotice(noticeId)
        return true
      case "both": {
        if (entity !== "note" || n.code !== "field_conflict") return false
        const theirs = this.libraryRow("note", op.id)
        this.dismissNotice(noticeId)
        const base = theirs ? pick(theirs, ["item_id", "note_type", "page", "position_seconds", "locator_label", "topics", "application_status"]) : {}
        this.libraryCreate("note", { ...base, ...op.fields })
        return true
      }
      case "restore":
        if (n.code !== "deleted") return false
        this.dismissNotice(noticeId)
        this.libraryRestore(entity, op.id, recover, n.library?.kind)
        return true
      case "free": {
        if (entity !== "note") return false
        this.dismissNotice(noticeId)
        // Without its content: no content and no page or minute, the text and everything else kept.
        const rest = pick(recover, Object.keys(recover).filter((k) => !["item_id", "page", "position_seconds", "locator_label"].includes(k)))
        this.libraryCreate("note", { ...rest, item_id: null })
        return true
      }
      case "existing": {
        // M4g.3: its content was refused as a duplicate of one already in the Library (created on
        // another device); the note is written again, whole, on that existing content.
        const row = target ? this.libraryRow("item", target) : undefined
        if (entity !== "note" || n.code !== "item_deleted" || !row || row.deleted) return false
        this.dismissNotice(noticeId)
        this.libraryCreate("note", { ...recover, item_id: target })
        return true
      }
      case "show": {
        // M4g.4: an episode refused because its show was refused (the same show was created on
        // another device). It is written again, whole and with the same id, on the show that
        // exists — or, without `target`, with no show — so its kept notes can follow it.
        const w = op as LibraryWriteOp
        if (entity !== "item" || n.code !== "show_not_found" || !w.type.endsWith(".create")) return false
        const show = target ? this.libraryRow("show", target) : undefined
        if (target && (!show || show.deleted)) return false
        this.dismissNotice(noticeId)
        this.libraryCreate("item", { ...recover, show_id: target ?? null }, { id: w.id, kind: w.kind ?? n.library?.kind })
        return true
      }
    }
  }

  /**
   * A library write the server did not take (D68). Texts are never dropped: a field conflict keeps
   * only the conflicting texts for the user's decision and re-sends the other fields with their
   * original bases; a write on something deleted elsewhere keeps the whole text, with what this
   * device last saw of it, so it can be restored or saved as a free idea. A refused delete only
   * informs (nothing was lost).
   */
  private libraryAnswered(op: LibraryOp, status: string | undefined, code: string | null, fields: string[] | undefined, seq: number | undefined) {
    if (status === "applied" && seq !== undefined) this.ownSeqs = [...this.ownSeqs, seq].slice(-OWN_SEQS_KEEP)
    if (status !== "conflict" && status !== "rejected") return
    if (op.type === "library.link.set" || op.type.endsWith(".delete")) {
      this.addNotice(status, op, code)
      return
    }
    const w = op as LibraryWriteOp | LibraryUpdateOp
    if (this.notices.some((n) => n.id === w.op_id) || this.resolvedNotes.includes(w.op_id)) return
    if (code === "field_conflict" && "base_seqs" in w && fields?.length) {
      const lost = Object.keys(w.fields).filter((f) => fields.includes(f))
      const rest = Object.keys(w.fields).filter((f) => !lost.includes(f))
      const later = this.queue.filter((q) => q.op.op_id !== w.op_id && !this.inFlight.has(q.op.op_id) && isLibraryOp(q.op) && "id" in q.op && q.op.id === w.id)
      const resend = rest.filter((f) => !later.some((q) => "fields" in q.op && f in (q.op.fields as object)))
      if (resend.length > 0) {
        this.queue = [...this.queue, { op: { ...w, op_id: uuidv4(), fields: pick(w.fields, resend), base_seqs: pick(w.base_seqs, resend) }, enqueuedAt: this.now(), attempts: 0 }]
      }
      this.addNotice("conflict", { ...w, fields: pick(w.fields, lost), base_seqs: pick(w.base_seqs, lost) }, code)
      return
    }
    // What this device last saw of it, so «Restaurar» can send the whole entity back.
    const seen = rowOf(this.libRows, w)
    const seenFields = seen ? pick(seen, Object.keys(seen).filter((k) => !["id", "server_seq", "deleted", "field_seqs", "version", "created_at", "updated_at", "deleted_at", "kind", "format", "captured_at"].includes(k))) : {}
    this.addNotice(status, w, code)
    this.notices = this.notices.map((n) => (n.id === w.op_id ? { ...n, library: { fields: seenFields, kind: (seen?.kind as "book" | "episode" | undefined) ?? (w as LibraryWriteOp).kind } } : n))
  }

  /**
   * Hybrid logical time for a new intent: device clock corrected with the server
   * offset, and strictly increasing on this device. Clocks only break ties between
   * truly concurrent edits; sequential edits are decided by base_seq.
   */
  clientTime(): string {
    const t = Math.max(Math.round(this.now() + this.clockOffset), this.lastHybrid + 1)
    this.lastHybrid = t
    return new Date(t).toISOString()
  }

  /**
   * Server-corrected device clock for display (timers). Unlike clientTime() it has no side
   * effects, so it can be read on every frame.
   */
  serverNow(): number {
    return Math.round(this.now() + this.clockOffset)
  }

  /** server_seq of a row as this device last saw it (entry: habitId+date, rest: date, measurement: goalId+date). */
  rowSeq(kind: "entry" | "rest" | "measurement", idOrDate: string, date?: string): number | null {
    const key = kind === "entry" ? `e:${idOrDate}:${date}` : kind === "measurement" ? `m:${idOrDate}:${date}` : `r:${idOrDate}`
    return this.cache.rowSeq[key] ?? null
  }

  diagnostics() {
    return { clockOffsetMs: Math.round(this.clockOffset), cursor: this.cache.cursor, deviceId: this.deps.deviceId, failures: this.failures }
  }

  /** Server version of a habit as last seen (for optimistic-concurrency edits). */
  habitVersion(habitId: string): number {
    return this.cache.habitVersion[habitId] ?? 1
  }

  /** Server version of a goal as last seen (the cache only holds server-confirmed state). */
  goalVersion(goalId: string): number {
    return this.cache.state.goals.find((g) => g.id === goalId)?.version ?? 1
  }

  /** Server version of a focus session as last seen (edits use optimistic concurrency). */
  focusVersion(sessionId: string): number {
    return this.cache.state.focusSessions.find((f) => f.id === sessionId)?.version ?? 1
  }

  /** note_seq of a check-in's reflection as last seen from the server (conflict base). */
  checkinNoteSeq(date: string, phase: "am" | "pm"): number | null {
    return this.cache.state.checkins[`${date}:${phase}`]?.noteSeq ?? null
  }

  // ── Life Review (M3.4c) ────────────────────────────────────────────────
  /** A review as the server last confirmed it (the conflict bases of the next edits). */
  cachedReview(kind: ReviewKind, periodStart: LocalDate): Review | undefined {
    return this.cache.state.reviews[reviewKey(kind, periodStart)]
  }

  /** Conflict base of each section about to be written (see sectionBase). */
  reviewBases(kind: ReviewKind, periodStart: LocalDate, fields: readonly ReviewField[]): Record<string, number | null> {
    const cached = this.cachedReview(kind, periodStart)
    return Object.fromEntries(fields.map((f) => [f, sectionBase(cached, f)]))
  }

  /** Sections of a review whose text waits for the user's decision (they cannot be edited meanwhile). */
  reviewFieldsWaiting(kind: ReviewKind, periodStart: LocalDate): ReviewField[] {
    const out = new Set<ReviewField>()
    for (const n of this.notices) {
      if (n.op?.type === "review.save" && n.op.kind === kind && n.op.period_start === periodStart) for (const f of Object.keys(n.op.fields)) out.add(f as ReviewField)
    }
    return [...out]
  }

  closeIntent(kind: ReviewKind, periodStart: LocalDate): CloseIntent | undefined {
    return this.closeIntents.find((c) => c.kind === kind && c.periodStart === periodStart)
  }

  /** «Guardado en este dispositivo» / pendiente / sincronizado / conflicto / error, for one review. */
  reviewSyncState(kind: ReviewKind, periodStart: LocalDate): ReviewSyncState {
    const texts = this.notices.filter((n) => n.op?.type === "review.save" && n.op.kind === kind && n.op.period_start === periodStart)
    if (texts.some((n) => n.kind === "conflict")) return "conflict"
    if (texts.length > 0 || this.closeIntent(kind, periodStart)?.state === "failed") return "error"
    const key = reviewKey(kind, periodStart)
    if (this.queue.some((q) => reviewOf(q.op) === key)) {
      // Not even on this device: storage refused the write.
      if (!this.persisted) return "error"
      return this.status === "offline" || this.status === "error" || !this.serverTakes(kind) ? "local" : "pending"
    }
    return "synced"
  }

  /**
   * «Cerrar revisión» (decisions 1 and 2). Refused outright when the review cannot close (closed,
   * not available, invalid, sections waiting for a decision, no server support). Otherwise the
   * intent is stored durably and the close runs only after a push and a pull with an empty queue:
   * offline it waits for the connection (`deferred`), and it is never sent with stale data.
   */
  requestClose(kind: ReviewKind, periodStart: LocalDate): CloseRequest {
    const snap = this.getSnapshot()
    const key = reviewKey(kind, periodStart)
    let review: Review
    try {
      review = snap.state.reviews[key] ?? emptyDraft(kind, periodStart, new Date(0).toISOString())
    } catch {
      return { ok: false, reason: "invalid_period" }
    }
    const gate = closeGate(review, snap.today, {
      online: !this.offline,
      pending: this.queue.length,
      lastPullAt: this.lastSyncedAt,
      now: this.now(),
      conflicts: this.reviewFieldsWaiting(kind, periodStart).length,
      serverSupports: this.serverTakes(kind),
    })
    if (gate.action === "blocked") return { ok: false, reason: gate.reason }
    const existing = this.closeIntent(kind, periodStart)
    // Already being sent: a second tap changes nothing (the op is idempotent).
    if (existing?.opId) return { ok: true, deferred: false }
    const intent: CloseIntent = {
      id: uuidv4(),
      kind,
      periodStart,
      fingerprint: reviewFingerprint(snap.state.reviews[key], kind),
      requestedAt: this.now(),
      opId: null,
      attempts: 0,
      state: "waiting",
    }
    if (existing) this.forget(existing.id)
    this.closeIntents = [...this.closeIntents.filter((c) => c !== existing), intent]
    this.invalidate()
    void this.persist()
    void this.sync()
    return { ok: true, deferred: gate.action === "defer" }
  }

  /**
   * Writes review sections (desired states) on the optimistic view and queues them with their
   * conflict bases. Refused, with nothing written, for a closed or closing review, a section
   * waiting for the user's decision, or invalid content. An unchanged value writes nothing.
   */
  saveReview(kind: ReviewKind, periodStart: LocalDate, fields: ReviewFields): ReviewSaveOutcome {
    const { state, today } = this.getSnapshot()
    const period = periodFromStart(kind, periodStart)
    if (!period) return { ok: false, reason: "invalid_period" }
    if (!isAvailable(period, today)) return { ok: false, reason: "not_available" }
    const key = reviewKey(kind, periodStart)
    const current = state.reviews[key]
    if (current?.status === "closed") return { ok: false, reason: "closed" }
    if (this.closeIntent(kind, periodStart)?.state === "waiting") return { ok: false, reason: "closing" }
    const keys = Object.keys(fields) as ReviewField[]
    const waiting = this.reviewFieldsWaiting(kind, periodStart)
    if (keys.some((k) => waiting.includes(k))) return { ok: false, reason: "conflict" }
    const clean: ReviewFields = Object.fromEntries(keys.map((k) => [k, k === "decisions" ? ((fields[k] ?? []) as Decision[]).map(normalizeDecision) : (fields[k] ?? null)]))
    const next = applySave(state.reviews, kind, periodStart, clean, new Date(0).toISOString())[key]
    if (!next || !validateContent(next).ok) return { ok: false, reason: "invalid" }
    // Same value as now: nothing to write (no repeated writes while the user re-reads a field).
    const changed = keys.filter((k) => !sameSection(k, sectionOf(current, k), clean[k]))
    if (changed.length === 0) return { ok: true }
    this.submit({
      type: "review.save",
      op_id: uuidv4(),
      kind,
      period_start: periodStart,
      fields: pick(clean, changed),
      base_seqs: this.reviewBases(kind, periodStart, changed),
    })
    return { ok: true }
  }

  /**
   * Exceptional delete (D52): explicit confirmation, and only the exact version the server has
   * and this device shows (never a draft still being sent, never during a close).
   */
  deleteReview(kind: ReviewKind, periodStart: LocalDate, confirm: string): ReviewDeleteOutcome {
    if (confirm !== "delete") return { ok: false, reason: "confirmation_required" }
    const cached = this.cachedReview(kind, periodStart)
    if (!cached || cached.serverSeq === undefined) return { ok: false, reason: "not_synced" }
    if (this.queue.some((q) => reviewOf(q.op) === reviewKey(kind, periodStart))) return { ok: false, reason: "pending" }
    if (this.closeIntent(kind, periodStart)) return { ok: false, reason: "closing" }
    this.submit({ type: "review.delete", op_id: uuidv4(), kind, period_start: periodStart, confirm: "delete", base_seq: cached.serverSeq })
    return { ok: true }
  }

  /** Cancels a close that has not been sent yet. */
  cancelClose(kind: ReviewKind, periodStart: LocalDate): boolean {
    const c = this.closeIntent(kind, periodStart)
    if (!c || c.opId) return false
    this.forget(c.id)
    this.closeIntents = this.closeIntents.filter((x) => x !== c)
    this.invalidate()
    void this.persist()
    return true
  }

  /**
   * The user's decision on a kept review section: «Aplicar la mía» writes it again on top of the
   * version now on the server (only for a section changed or deleted elsewhere; a closed review
   * cannot change), «Mantener la otra» forgets it. Either way the decision is durable.
   */
  resolveReviewText(id: string, field: ReviewField, choice: "mine" | "theirs"): boolean {
    const n = this.notices.find((x) => x.id === id)
    if (!n || n.op?.type !== "review.save" || !(field in n.op.fields)) return false
    const op = n.op
    if (choice === "mine" && n.code !== "review_field_conflict" && n.code !== "review_deleted") return false
    this.dropReviewFields(n, [field])
    if (choice === "mine") {
      this.submit({
        type: "review.save",
        op_id: uuidv4(),
        kind: op.kind,
        period_start: op.period_start,
        fields: { [field]: op.fields[field] },
        base_seqs: this.reviewBases(op.kind, op.period_start, [field]),
      })
    } else {
      this.invalidate()
      void this.persist()
    }
    return true
  }

  /** Optimistically apply and queue an operation, then sync in the background. */
  submit(op: Op): void {
    this.queue = enqueueLibrary(this.queue, op, this.now(), this.inFlight) ?? enqueue(this.queue, op, this.now(), this.inFlight)
    if (this.status === "synced") this.status = "pending"
    this.invalidate()
    void this.persist()
    void this.sync()
  }

  dismissNotice(id: string): void {
    const notice = this.notices.find((n) => n.id === id)
    this.notices = this.notices.filter((n) => n.id !== id)
    if (notice && isDurableNotice(notice)) {
      // A decided text: forget it durably (and in other tabs' copies).
      this.forget(id)
      void this.persist()
    }
    this.invalidate()
  }

  /** Run a sync cycle: push pending ops, then pull. Concurrent calls coalesce. */
  sync(opts: { full?: boolean } = {}): Promise<void> {
    if (this.stopped) return Promise.resolve()
    // Before the saved copy is loaded, the start-up's own full cycle is the sync.
    if (this.boot && !this.loaded) return this.boot
    // `starting` covers the synchronous start of cycle(), before `running` is assigned: a sync()
    // reached from inside it (a listener, a transport callback) must not start a second, parallel
    // cycle that would resend in-flight ops and send later edits with stale bases (M4c).
    if (this.running || this.starting) {
      this.rerun = true
      return this.running ?? Promise.resolve()
    }
    this.cancelRetry?.()
    this.cancelRetry = null
    this.starting = true
    try {
      this.running = this.cycle(!!opts.full).finally(() => {
        this.running = null
        if (this.rerun) {
          this.rerun = false
          void this.sync()
        }
      })
    } finally {
      this.starting = false
    }
    return this.running
  }

  /** Stop for good: no further network calls, retries or writes to local storage. */
  stop(): void {
    this.stopped = true
    this.cancelRetry?.()
    this.listeners.clear()
  }
  private stopped = false
  private starting = false

  // ── internals ──────────────────────────────────────────────────────────
  private async cycle(full: boolean): Promise<void> {
    this.status = "syncing"
    this.invalidate()
    try {
      const { acked, applied } = await this.push()
      const since = full || this.cache.cursor === 0 ? 0 : Math.max(0, this.cache.cursor - this.overlap)
      const sent = this.now()
      const payload = await this.deps.transport.pull(since)
      this.observeServerTime(payload.server_time, sent, this.now())
      this.cache = mergePull(this.cache, payload)
      // The library comes in pages from its own cursor (D71), before acknowledged ops leave the
      // queue, so a library edit never flickers back either.
      if (payload.library && this.deps.library && this.deps.transport.pullLibrary) await this.pullLibrary(payload.library.head)
      this.rebaseReviewBases(applied, acked)
      // Remove acknowledged ops only after the pull, so the UI never flickers back.
      this.queue = this.queue.filter((q) => !acked.has(q.op.op_id))
      this.runCloses()
      this.ready = true
      this.offline = false
      this.failures = 0
      this.lastError = null
      this.lastSyncedAt = this.now()
      this.status = this.queue.length > 0 ? "pending" : "synced"
      await this.persist()
      // Review writes wait while the server lacks the reviews migration: no busy loop over them.
      if (this.queue.some((q) => this.sendable(q.op))) this.rerun = true
    } catch (e) {
      this.failures++
      // Even without a server copy, stop showing skeletons: the UI reports the offline state.
      this.ready = true
      const offline = e instanceof NetworkError
      this.offline = offline
      this.status = offline ? "offline" : "error"
      this.lastError = e instanceof Error ? e.message : String(e)
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(this.failures, 6))
      this.cancelRetry = this.schedule(() => void this.sync(), delay)
    } finally {
      this.inFlight.clear()
      this.invalidate()
    }
  }

  /**
   * Send pending ops in order. Returns the ids the server has answered and the ops it applied.
   * Only what is queued when the push starts: a write queued meanwhile goes in the next cycle,
   * after this pull, so a review section edited while its previous write was in flight is based
   * on that write's result (rebaseReviewBases) instead of conflicting with the user's own text.
   */
  private async push(): Promise<{ acked: Set<string>; applied: Op[] }> {
    const acked = new Set<string>()
    const applied: Op[] = []
    let raisedNote = false
    const pending = this.queue.filter((q) => this.sendable(q.op))
    for (let offset = 0; offset < pending.length; offset += this.batchSize) {
      const batch = pending.slice(offset, offset + this.batchSize)
      for (const q of batch) {
        this.inFlight.add(q.op.op_id)
        q.attempts++
        // A library edit based on this device's own previous write (now confirmed) is sequential.
        if (isLibraryOp(q.op) && q.op.type.endsWith(".update")) {
          const fresh = refreshBases(q.op as LibraryUpdateOp, rowOf(this.libRows, q.op), new Set(this.ownSeqs))
          if (fresh !== q.op) q.op = fresh
        }
      }
      const sent = this.now()
      const res = await this.deps.transport.applyOps(
        this.deps.deviceId,
        batch.map((q) => q.op)
      )
      this.observeServerTime(res.server_time, sent, this.now())
      for (const r of res.results) {
        acked.add(r.op_id)
        const status = r.status === "duplicate" ? r.outcome : r.status
        const q = batch.find((b) => b.op.op_id === r.op_id)
        if (!q) continue
        if (status === "applied") applied.push(q.op)
        if (isLibraryOp(q.op)) {
          this.libraryAnswered(q.op, status, r.code ?? null, r.fields, r.seq)
          if ((status === "conflict" || status === "rejected") && isLibraryText({ id: q.op.op_id, kind: "conflict", opType: q.op.type, op: q.op })) raisedNote = true
        } else if (q.op.type === "review.save") {
          if (status === "conflict" || status === "rejected") {
            this.reviewText(q.op, status, r.code ?? null, r.fields)
            raisedNote = true
          }
        } else if (q.op.type === "review.close") this.closeAnswered(q.op.op_id, status, r.code ?? null)
        else if (status === "conflict" && r.code === "note_conflict" && q.op.type === "checkin.set") {
          this.noteConflict(q.op)
          raisedNote = true
        } else if (status === "conflict" || status === "rejected") this.addNotice(status, q.op, r.code ?? null)
      }
    }
    // Saved at once, not after the pull: the user's text must survive the app closing now.
    if (raisedNote) await this.persist()
    return { acked, applied }
  }

  /** Review writes wait on the device while the server lacks the reviews migration (never rejected there). */
  private sendable(op: Op): boolean {
    if (op.type.startsWith("library.")) return !!this.cache.features?.library
    if (op.type.startsWith("recall.")) return !!this.cache.features?.recall
    if (op.type.startsWith("discovery.")) return !!this.cache.features?.discovery
    if (op.type.startsWith("experiment.")) return !!this.cache.features?.experiments
    if (op.type === "profile.motivation") return !!this.cache.features?.motivation
    if (op.type === "review.save" || op.type === "review.close" || op.type === "review.delete") return this.serverTakes(op.kind)
    return true
  }

  /** The server has the migration for reviews of this kind (M3.4, and C5 for daily ones). */
  private serverTakes(kind: ReviewKind): boolean {
    return !!(kind === "day" ? this.cache.features?.dailyReviews : this.cache.features?.reviews)
  }

  /**
   * A review write the server did not take. The sections it did not take are kept durably for the
   * user's decision (D47 generalized); the other sections of the same write (only after a section
   * conflict, which refuses the whole write) are sent again with their original bases, unless a
   * newer queued write of this review already carries them.
   */
  private reviewText(op: Extract<Op, { type: "review.save" }>, status: "conflict" | "rejected", code: string | null, fields: string[] | undefined) {
    if (this.notices.some((n) => n.id === op.op_id) || this.resolvedNotes.includes(op.op_id)) return
    const all = Object.keys(op.fields) as ReviewField[]
    const lost = code === "review_field_conflict" && fields?.length ? all.filter((f) => fields.includes(f)) : all
    const key = reviewKey(op.kind, op.period_start)
    const later = this.queue.filter((q) => q.op.op_id !== op.op_id && !this.inFlight.has(q.op.op_id) && reviewOf(q.op) === key)
    const rest = all.filter((f) => !lost.includes(f) && !later.some((q) => q.op.type === "review.save" && f in q.op.fields))
    if (rest.length > 0) {
      const resend: Op = { ...op, op_id: uuidv4(), fields: pick(op.fields, rest), base_seqs: pick(op.base_seqs, rest) }
      this.queue = [...this.queue, { op: resend, enqueuedAt: this.now(), attempts: 0 }]
    }
    // A newer kept text of a section replaces an older one of the same section (both are the user's).
    for (const n of this.notices.filter((x) => x.op?.type === "review.save" && reviewOf(x.op) === key)) this.dropReviewFields(n, lost)
    this.addNotice(status, { ...op, fields: pick(op.fields, lost), base_seqs: pick(op.base_seqs, lost) }, code)
  }

  /** Removes decided or superseded sections from a kept review text; an empty one is forgotten durably. */
  private dropReviewFields(n: SyncNotice, fields: readonly string[]) {
    if (n.op?.type !== "review.save") return
    const left = Object.keys(n.op.fields).filter((f) => !fields.includes(f))
    if (left.length === Object.keys(n.op.fields).length) return
    if (left.length === 0) {
      this.notices = this.notices.filter((x) => x.id !== n.id)
      this.forget(n.id)
      return
    }
    const op = { ...n.op, fields: pick(n.op.fields, left), base_seqs: pick(n.op.base_seqs, left) }
    this.notices = this.notices.map((x) => (x.id === n.id ? { ...n, op } : x))
  }

  /** The answer to a close this device sent. The draft is never touched: only the intent changes. */
  private closeAnswered(opId: string, status: string | undefined, code: string | null) {
    const intent = this.closeIntents.find((c) => c.opId === opId)
    if (!intent) return
    // Applied, or another device closed it first (`already_closed`): the first close wins.
    if (status === "applied" || status === "superseded") {
      this.forget(intent.id)
      this.closeIntents = this.closeIntents.filter((c) => c !== intent)
      return
    }
    const attempts = intent.attempts + 1
    const next: CloseIntent =
      status === "conflict" && code === "stale_snapshot" && attempts < CLOSE_RETRIES
        ? // New data reached the server between the pull and the close: computed again after this pull.
          { ...intent, opId: null, attempts }
        : { ...intent, opId: null, attempts, state: status === "conflict" && code === "review_changed" ? "needs_confirmation" : "failed", code }
    this.closeIntents = this.closeIntents.map((c) => (c === intent ? next : c))
  }

  /**
   * Bases of review writes queued while an earlier write of the same review was in flight. Once
   * that write is applied and pulled, a later write of the same section built on it is based on its
   * result, so the user's own consecutive edits never conflict with each other. If the section on
   * the server is not that write's value (another device wrote after it), the base stays and the
   * conflict is real.
   */
  private rebaseReviewBases(applied: Op[], acked: Set<string>) {
    const saves = applied.filter((o): o is Extract<Op, { type: "review.save" }> => o.type === "review.save")
    if (saves.length === 0) return
    this.queue = this.queue.map((q) => {
      if (acked.has(q.op.op_id) || q.op.type !== "review.save") return q
      const op = q.op
      const cached = this.cachedReview(op.kind, op.period_start)
      if (!cached) return q
      let base_seqs = op.base_seqs
      for (const a of saves) {
        if (a.kind !== op.kind || a.period_start !== op.period_start) continue
        for (const f of Object.keys(op.fields) as ReviewField[]) {
          const b = base_seqs[f] ?? null
          let next: number | undefined
          if (f in a.fields) {
            if ((a.base_seqs[f] ?? null) === b && sameSection(f, a.fields[f], cachedSection(cached, f))) next = cached.fieldSeqs?.[f] ?? 0
          } else if (b === null && cached.fieldSeqs?.[f] === undefined) next = 0
          if (next !== undefined && next !== b) base_seqs = { ...base_seqs, [f]: next }
        }
      }
      return base_seqs === op.base_seqs ? q : { ...q, op: { ...op, base_seqs } }
    })
  }

  /**
   * Runs the close intents that can run now: after a successful pull, with nothing queued, no
   * section waiting for a decision and the review exactly as the user saw it when asking. The
   * snapshot is computed here, from the state the server just confirmed, and sent with the pull
   * cursor and the review's version (M3.4b contract).
   */
  private runCloses() {
    if (this.closeIntents.length === 0 || this.queue.length > 0 || !this.cache.features?.reviews) return
    const kept: CloseIntent[] = []
    for (const c of this.closeIntents) {
      if (c.state !== "waiting" || c.opId || !this.serverTakes(c.kind)) {
        kept.push(c)
        continue
      }
      const review = this.cachedReview(c.kind, c.periodStart)
      if (review?.status === "closed") {
        // Closed elsewhere first: nothing to send.
        this.forget(c.id)
        continue
      }
      if (this.reviewFieldsWaiting(c.kind, c.periodStart).length > 0) {
        kept.push(c)
        continue
      }
      if (reviewFingerprint(review, c.kind) !== c.fingerprint) {
        kept.push({ ...c, state: "needs_confirmation", code: "review_changed" })
        continue
      }
      try {
        const snapshot = buildReviewSnapshot({ state: this.cache.state, kind: c.kind, periodStart: c.periodStart, today: this.cache.serverToday, computedAt: this.clientTime() })
        const op: Op = {
          type: "review.close",
          op_id: uuidv4(),
          kind: c.kind,
          period_start: c.periodStart,
          snapshot,
          based_on_cursor: this.cache.cursor,
          base_seq: review?.serverSeq ?? null,
        }
        this.queue = [...this.queue, { op, enqueuedAt: this.now(), attempts: 0 }]
        kept.push({ ...c, opId: op.op_id })
      } catch (e) {
        kept.push({ ...c, state: "failed", code: e instanceof SnapshotError ? e.code : "snapshot_error" })
      }
    }
    this.closeIntents = kept
  }

  /**
   * An intent whose close op is not in this tab's queue (sent by another tab, or lost with a copy
   * that tab overwrote) waits again: it is computed anew, and if that close did reach the server
   * the review shows as closed and the intent is forgotten. It never stays «being sent» forever.
   */
  private orphansWaiting(intents: CloseIntent[]): CloseIntent[] {
    return intents.map((c) => (c.opId && !this.queue.some((q) => q.op.op_id === c.opId) ? { ...c, opId: null } : c))
  }

  private forget(id: string) {
    this.resolvedNotes = [...this.resolvedNotes.filter((r) => r !== id), id].slice(-RESOLVED_KEEP)
  }

  /**
   * The server refused the whole check-in write because its reflection changed meanwhile elsewhere.
   * The reflection waits for the user's decision (durably); the other indicators of the same write
   * are re-sent on their own with their original time, so per-field last-writer-wins still decides.
   */
  private noteConflict(op: Extract<Op, { type: "checkin.set" }>) {
    if (this.notices.some((n) => n.id === op.op_id) || this.resolvedNotes.includes(op.op_id)) return
    const { note, ...rest } = op.fields
    if (Object.keys(rest).length > 0) {
      this.queue = enqueue(this.queue, { ...op, op_id: uuidv4(), fields: rest, base_note_seq: null }, this.now(), this.inFlight)
    }
    this.addNotice("conflict", { ...op, fields: { note } }, "note_conflict")
  }

  private addNotice(kind: "conflict" | "rejected", op: Op, code: string | null) {
    // A re-sent op (e.g. the app closed before its answer was saved) answers again: one notice only.
    if (this.notices.some((n) => n.id === op.op_id)) return
    // Focus ops first: focus.edit also carries a habit_id, but its subject is the session.
    const subject = isLibraryOp(op)
      ? this.librarySubject(op)
      : op.type === "review.save" || op.type === "review.close" || op.type === "review.delete"
        ? reviewSubject(op.kind, op.period_start)
        : op.type === "checkin.set"
        ? `Check-in de ${op.phase === "am" ? "mañana" : "noche"} del ${op.local_date.split("-").reverse().join("/")}`
        : op.type === "focus.start"
        ? (op.session.project ?? "El bloque de enfoque")
        : "session_id" in op
          ? (this.cache.state.focusSessions.find((f) => f.id === op.session_id)?.project ?? "La sesión de enfoque")
          : "habit_id" in op
            ? this.cache.state.habits.find((h) => h.id === op.habit_id)?.name
            : op.type === "habit.create"
              ? op.habit.title
              : op.type === "goal.create"
                ? op.goal.title
                : "goal_id" in op
                  ? this.cache.state.goals.find((g) => g.id === op.goal_id)?.title
                  : undefined
    this.notices = [...this.notices, { id: op.op_id, kind, opType: op.type, subject, code, op }]
  }

  /** A title for library notices; never the text of a note (it may be personal). */
  private librarySubject(op: LibraryOp): string {
    if (op.type === "library.link.set") return "Un enlace entre contenidos"
    const entity = entityOfOp(op)
    if (entity === "note") return "Una nota"
    const title = ("fields" in op && typeof op.fields.title === "string" ? op.fields.title : undefined) ?? (rowOf(this.libRows, op)?.title as string | undefined)
    return title || (entity === "show" ? "Un programa" : "Un contenido")
  }

  /** NTP-style estimate: server time vs. the midpoint of the request, lightly smoothed. */
  private observeServerTime(serverTime: string | undefined, sent: number, received: number) {
    if (!serverTime) return
    const server = Date.parse(serverTime)
    if (Number.isNaN(server)) return
    const sample = server - (sent + received) / 2
    this.clockOffset = this.lastSampleAt === 0 ? sample : this.clockOffset * 0.5 + sample * 0.5
    this.lastSampleAt = received
  }
  private lastSampleAt = 0

  /**
   * M4-H1: resolves once everything queued so far is in the device copy (the IndexedDB transaction
   * completed): true, or false when storage refused it; a refused copy is written again once per
   * call, so «Reintentar» really retries. Whatever navigates or reloads after a write waits for this
   * first: offline, opening another page reloads the app and drops a write still in progress.
   */
  async whenSaved(): Promise<boolean> {
    let last: Promise<boolean>
    do {
      last = this.writing
      await last
    } while (last !== this.writing)
    if (await last) return true
    return this.persist()
  }

  private persist(): Promise<boolean> {
    const p = this.write()
    this.writing = p
    return p
  }

  private async write(): Promise<boolean> {
    if (this.stopped) return false
    const lock = this.deps.lock ?? ((fn) => fn())
    try {
      await lock(async () => {
        await this.mergeStored()
        const pendingNotes = this.notices.filter(isDurableNotice)
        await this.deps.storage.save({
          cache: this.cache,
          queue: this.queue,
          pendingNotes,
          resolvedNotes: this.resolvedNotes,
          closeIntents: this.closeIntents,
          goneOps: this.goneOps,
        })
        this.savedIds = new Set(this.queue.map((q) => q.op.op_id))
      })
      this.persisted = true
    } catch {
      this.persisted = false
    }
    // What the rows say («saving», «local», «error») depends on this outcome.
    this.invalidate()
    return this.persisted
  }

  /**
   * Several tabs of the same user share the device copy (M3.4d, risk B). Writing this tab's queue
   * over the stored one dropped writes another tab queued, and lost them for good if that tab was
   * closed before sending. Now the stored queue is merged: ops queued by other tabs are adopted
   * (shown and sent from here too; the server ledger applies each op_id once), and ops any tab
   * removed (sent, or folded into a newer write) are dropped everywhere instead of coming back.
   */
  private mergeQueue(stored: PersistedSync): void {
    const mine = new Set(this.queue.map((q) => q.op.op_id))
    const removed = [...this.savedIds].filter((id) => !mine.has(id))
    const gone = new Set([...(stored.goneOps ?? []), ...this.goneOps, ...removed])
    this.goneOps = [...gone].slice(-GONE_KEEP)
    const adopted = stored.queue.filter((q) => !mine.has(q.op.op_id) && !gone.has(q.op.op_id))
    const kept = this.queue.filter((q) => !gone.has(q.op.op_id))
    if (adopted.length === 0 && kept.length === this.queue.length) return
    this.queue = [...kept, ...adopted]
    if (this.status === "synced" && this.queue.length > 0) this.status = "pending"
    this.invalidate()
  }

  /**
   * Another tab of the same user may have queued writes, or raised or decided kept texts, since this
   * one loaded: adopt them before writing, so one tab's save never drops another's.
   */
  private async mergeStored(): Promise<void> {
    const stored = upgradePersisted(await this.deps.storage.load().catch(() => null), this.localToday("Europe/Madrid"))
    if (!stored) return
    this.mergeQueue(stored)
    const resolved = [...new Set([...this.resolvedNotes, ...(stored.resolvedNotes ?? [])])].slice(-RESOLVED_KEEP)
    const known = new Set(this.notices.map((n) => n.id))
    const adopted = (stored.pendingNotes ?? []).filter((n) => !known.has(n.id))
    const notices = [...this.notices, ...adopted].filter((n) => !isDurableNotice(n) || !resolved.includes(n.id))
    // Close intents raised in another tab are adopted too; one per review (the one being sent, else the newest).
    const intents = new Map<string, CloseIntent>()
    for (const c of [...this.closeIntents, ...(stored.closeIntents ?? [])]) {
      if (resolved.includes(c.id)) continue
      const k = reviewKey(c.kind, c.periodStart)
      const cur = intents.get(k)
      if (!cur || (!cur.opId && (c.opId || c.requestedAt > cur.requestedAt))) intents.set(k, c)
    }
    const closeIntents = this.orphansWaiting([...intents.values()])
    this.resolvedNotes = resolved
    const intentsChanged = closeIntents.length !== this.closeIntents.length || closeIntents.some((c, i) => c !== this.closeIntents[i])
    if (adopted.length > 0 || notices.length !== this.notices.length || intentsChanged) {
      this.notices = notices
      this.closeIntents = closeIntents
      this.invalidate()
    }
  }

  /**
   * Today in the profile's zone. Once the server's time is known, by the device clock corrected
   * with it: a phone a few hours off would otherwise show and write the day before or after near
   * midnight (seen in PR #15; F2). Until the first answer, by the device clock alone.
   */
  private localToday(timezone: string): LocalDate {
    return localDateInZone(new Date(this.now() + (this.lastSampleAt === 0 ? 0 : this.clockOffset)), timezone)
  }

  private invalidate() {
    this.snapshot = null
    for (const l of this.listeners) l()
  }
}

/** `kind:periodStart` of the review an op writes, or null. */
function reviewOf(op: Op): string | null {
  return op.type === "review.save" || op.type === "review.close" || op.type === "review.delete" ? reviewKey(op.kind, op.period_start) : null
}

function pick<T>(o: Record<string, T>, keys: readonly string[]): Record<string, T> {
  return Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]))
}

function cachedSection(review: Review, field: ReviewField): unknown {
  if (field === "decisions") return review.decisions
  if (field === "evaluations") return review.evaluations
  return review.content[field.slice("content.".length) as keyof Review["content"]] ?? null
}

function reviewSubject(kind: ReviewKind, periodStart: LocalDate): string {
  const p = periodFromStart(kind, periodStart)
  return p ? `Revisión: ${periodLabel(p)}` : "La revisión"
}

/** In-memory storage (tests, or when IndexedDB is unavailable). */
export function memoryStorage(initial: PersistedSync | null = null): SyncStorage & { data: PersistedSync | null } {
  const s = {
    data: initial,
    async load() {
      return s.data ? structuredClone(s.data) : null
    },
    async save(d: PersistedSync) {
      s.data = structuredClone(d)
    },
  }
  return s
}
