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
}

/** A reflection conflict: kept durably until the user chooses «Aplicar el mío» or «Mantener la otra». */
export const isNoteConflict = (n: SyncNotice) => n.kind === "conflict" && n.code === "note_conflict" && n.op?.type === "checkin.set"
/**
 * Review sections the server did not take (M3.4c, D47 generalized): a section changed meanwhile on
 * another device, a review deleted or already closed elsewhere, or a refused value. The user's text
 * is kept durably, like a reflection, until they decide; it is never dropped on its own.
 */
export const isReviewText = (n: SyncNotice) => n.op?.type === "review.save"
/** Notices that hold text the user has not decided about: persisted and never closed on their own. */
export const isDurableNotice = (n: SyncNotice) => isNoteConflict(n) || isReviewText(n)
const RESOLVED_KEEP = 100
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
  /** Review closes waiting to run (or needing a new decision). */
  closeIntents: CloseIntent[]
  /** Reviews (`kind:periodStart`) with writes still in the queue. */
  pendingReviews: string[]
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
}

const MAX_BACKOFF_MS = 60_000

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
  /** The last attempt failed for lack of network (the visible status turns «syncing» while retrying). */
  private offline = false
  private listeners = new Set<() => void>()
  private snapshot: EngineSnapshot | null = null
  private running: Promise<void> | null = null
  private rerun = false
  private failures = 0
  private cancelRetry: (() => void) | null = null
  private readonly now: () => number
  private readonly overlap: number
  private readonly batchSize: number
  private readonly schedule: (fn: () => void, ms: number) => () => void
  /** Estimated server clock minus device clock (ms). */
  private clockOffset = 0
  private lastHybrid = 0

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
  async start(): Promise<void> {
    // A copy saved by an older version may lack newer fields (e.g. goals): upgrade it in place, never discard it.
    const stored = upgradePersisted(await this.deps.storage.load().catch(() => null), this.localToday("Europe/Madrid"))
    if (stored) {
      this.cache = stored.cache
      this.queue = stored.queue
      this.resolvedNotes = stored.resolvedNotes ?? []
      // Reflections still waiting for a decision come back on reopening.
      this.notices = (stored.pendingNotes ?? []).filter((n) => !this.resolvedNotes.includes(n.id))
      // So do review closes the user asked for and that have not run yet.
      this.closeIntents = this.orphansWaiting((stored.closeIntents ?? []).filter((c) => !this.resolvedNotes.includes(c.id)))
      this.ready = true
      this.invalidate()
    }
    await this.sync({ full: true })
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
        closeIntents: this.closeIntents,
        pendingReviews: [...new Set(this.queue.map((q) => reviewOf(q.op)).filter((k): k is string => k !== null))],
      }
    }
    return this.snapshot
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
      return this.status === "offline" || this.status === "error" || !this.cache.features?.reviews ? "local" : "pending"
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
      serverSupports: !!this.cache.features?.reviews,
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
    this.queue = enqueue(this.queue, op, this.now(), this.inFlight)
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
    if (this.running) {
      this.rerun = true
      return this.running
    }
    this.cancelRetry?.()
    this.cancelRetry = null
    this.running = this.cycle(!!opts.full).finally(() => {
      this.running = null
      if (this.rerun) {
        this.rerun = false
        void this.sync()
      }
    })
    return this.running
  }

  /** Stop for good: no further network calls, retries or writes to local storage. */
  stop(): void {
    this.stopped = true
    this.cancelRetry?.()
    this.listeners.clear()
  }
  private stopped = false

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
        if (q.op.type === "review.save") {
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
    return !op.type.startsWith("review.") || !!this.cache.features?.reviews
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
      if (c.state !== "waiting" || c.opId) {
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
    const subject =
      op.type === "review.save" || op.type === "review.close" || op.type === "review.delete"
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

  private async persist(): Promise<void> {
    if (this.stopped) return
    try {
      await this.mergeStoredNotes()
      const pendingNotes = this.notices.filter(isDurableNotice)
      await this.deps.storage.save({ cache: this.cache, queue: this.queue, pendingNotes, resolvedNotes: this.resolvedNotes, closeIntents: this.closeIntents })
      this.persisted = true
    } catch {
      this.persisted = false
    }
  }

  /**
   * Another tab of the same user may have raised or decided reflection conflicts since this one
   * loaded: adopt them before writing, so one tab's save never drops another's pending reflection.
   */
  private async mergeStoredNotes(): Promise<void> {
    const stored = await this.deps.storage.load().catch(() => null)
    if (!stored) return
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

  private localToday(timezone: string): LocalDate {
    return localDateInZone(new Date(this.now()), timezone)
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
