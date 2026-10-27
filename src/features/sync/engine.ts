import { localDateInZone, type LocalDate } from "@/features/habits/domain/dates"
import type { HabitsState } from "@/features/habits/domain/types"
import { emptyCache, mergePull } from "./domain/merge"
import { enqueue, rebase } from "./domain/rebase"
import type { Op, OpResult, PullPayload, QueuedOp, ServerCache, SyncNotice, SyncStatus } from "./domain/types"

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
}

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
    const stored = await this.deps.storage.load().catch(() => null)
    if (stored) {
      this.cache = stored.cache
      this.queue = stored.queue
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

  /** Optimistically apply and queue an operation, then sync in the background. */
  submit(op: Op): void {
    this.queue = enqueue(this.queue, op, this.now(), this.inFlight)
    if (this.status === "synced") this.status = "pending"
    this.invalidate()
    void this.persist()
    void this.sync()
  }

  dismissNotice(id: string): void {
    this.notices = this.notices.filter((n) => n.id !== id)
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
      const acked = await this.push()
      const since = full || this.cache.cursor === 0 ? 0 : Math.max(0, this.cache.cursor - this.overlap)
      const sent = this.now()
      const payload = await this.deps.transport.pull(since)
      this.observeServerTime(payload.server_time, sent, this.now())
      this.cache = mergePull(this.cache, payload)
      // Remove acknowledged ops only after the pull, so the UI never flickers back.
      this.queue = this.queue.filter((q) => !acked.has(q.op.op_id))
      this.ready = true
      this.failures = 0
      this.lastError = null
      this.lastSyncedAt = this.now()
      this.status = this.queue.length > 0 ? "pending" : "synced"
      await this.persist()
      if (this.queue.length > 0) this.rerun = true
    } catch (e) {
      this.failures++
      // Even without a server copy, stop showing skeletons: the UI reports the offline state.
      this.ready = true
      const offline = e instanceof NetworkError
      this.status = offline ? "offline" : "error"
      this.lastError = e instanceof Error ? e.message : String(e)
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(this.failures, 6))
      this.cancelRetry = this.schedule(() => void this.sync(), delay)
    } finally {
      this.inFlight.clear()
      this.invalidate()
    }
  }

  /** Send pending ops in order. Returns the ids the server has answered. */
  private async push(): Promise<Set<string>> {
    const acked = new Set<string>()
    let offset = 0
    while (offset < this.queue.length) {
      const batch = this.queue.slice(offset, offset + this.batchSize)
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
        if (status === "conflict" || status === "rejected") this.addNotice(status, q.op, r.code ?? null)
      }
      offset += batch.length
    }
    return acked
  }

  private addNotice(kind: "conflict" | "rejected", op: Op, code: string | null) {
    const subject =
      "habit_id" in op
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
      await this.deps.storage.save({ cache: this.cache, queue: this.queue })
      this.persisted = true
    } catch {
      this.persisted = false
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
