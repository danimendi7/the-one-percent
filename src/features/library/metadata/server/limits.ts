/**
 * Quotas and resilience of the metadata service (docs/m4g-plan.md §5.7). All state lives in the
 * memory of one server instance: on Vercel each instance has its own and none survives a cold
 * start, so these are safety limits for one person's use, not an exact global count. JavaScript
 * runs each check-and-update synchronously, so concurrent requests in one instance cannot both
 * take the last slot. Every clock is injected.
 */
export type Clock = () => number

/** Classic token bucket: `capacity` requests at once, refilled at `perMinute`. */
export class TokenBucket {
  private tokens: number
  private at: number
  constructor(
    private readonly capacity: number,
    private readonly perMinute: number,
    private readonly now: Clock
  ) {
    this.tokens = capacity
    this.at = now()
  }

  /** Takes one token, or says in how many ms one will be available. */
  take(): { ok: true } | { ok: false; retryAfterMs: number } {
    const t = this.now()
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.at) * this.perMinute) / 60_000)
    this.at = t
    if (this.tokens >= 1) {
      this.tokens -= 1
      return { ok: true }
    }
    return { ok: false, retryAfterMs: Math.ceil(((1 - this.tokens) * 60_000) / this.perMinute) }
  }
}

/** One bucket per key (user id), with a bounded number of keys (the least recently used go). */
export class KeyedLimiter {
  private readonly buckets = new Map<string, TokenBucket>()
  constructor(
    private readonly capacity: number,
    private readonly perMinute: number,
    private readonly now: Clock,
    private readonly maxKeys = 1_000
  ) {}

  take(key: string) {
    let b = this.buckets.get(key)
    if (b) this.buckets.delete(key)
    else b = new TokenBucket(this.capacity, this.perMinute, this.now)
    this.buckets.set(key, b)
    if (this.buckets.size > this.maxKeys) this.buckets.delete(this.buckets.keys().next().value!)
    return b.take()
  }
}

/**
 * Minimum spacing between calls to a provider (Open Library: 1 per second without a contact
 * address, its most conservative limit). A caller reserves the next slot and waits for it; if the
 * wait would exceed `maxWaitMs` it is refused instead of queueing without end.
 */
export class Spacer {
  private next = 0
  constructor(
    private readonly intervalMs: number,
    private readonly maxWaitMs: number,
    private readonly now: Clock
  ) {}

  reserve(): { ok: true; waitMs: number } | { ok: false; retryAfterMs: number } {
    const t = this.now()
    const slot = Math.max(t, this.next)
    const waitMs = slot - t
    if (waitMs > this.maxWaitMs) return { ok: false, retryAfterMs: waitMs }
    this.next = slot + this.intervalMs
    return { ok: true, waitMs }
  }
}

/**
 * Stops calling a provider that is refusing or failing, so nobody hammers it:
 * - a 429 or 403 opens it for the provider's Retry-After (60 s by default, at most 5 min);
 * - `threshold` failures in a row (5xx, timeouts, network, malformed answers) open it for `coolMs`.
 * Any success closes it.
 */
export class CircuitBreaker {
  private failures = 0
  private openUntil = 0
  constructor(
    private readonly now: Clock,
    private readonly threshold = 3,
    private readonly coolMs = 120_000
  ) {}

  /** ms until it closes again, or 0 when calls may go through. */
  blockedFor(): number {
    return Math.max(0, this.openUntil - this.now())
  }

  success(): void {
    this.failures = 0
    this.openUntil = 0
  }

  refused(retryAfterS?: number): void {
    const ms = Math.min(300_000, Math.max(1_000, (retryAfterS ?? 60) * 1000))
    this.openUntil = Math.max(this.openUntil, this.now() + ms)
  }

  failure(): void {
    this.failures += 1
    if (this.failures >= this.threshold) {
      this.openUntil = Math.max(this.openUntil, this.now() + this.coolMs)
      this.failures = 0
    }
  }
}

/** Identical calls in flight share one upstream request. */
export class InFlight<T> {
  private readonly pending = new Map<string, Promise<T>>()

  run(key: string, fn: () => Promise<T>): Promise<T> {
    const running = this.pending.get(key)
    if (running) return running
    const p = fn().finally(() => this.pending.delete(key))
    this.pending.set(key, p)
    return p
  }
}

/**
 * Bounded cache with expiry, for PUBLIC catalogue data only (D-CACHE): normalised records keyed
 * by provider identifiers. Free-text searches, user ids, cookies and Library data never go in.
 * Entries over `maxEntryBytes` are not kept; the least recently used go first.
 */
export class TtlCache<V> {
  private readonly map = new Map<string, { value: V; until: number; bytes: number }>()
  private bytes = 0
  constructor(
    private readonly now: Clock,
    private readonly maxEntries = 300,
    private readonly maxBytes = 8 * 1024 * 1024,
    private readonly maxEntryBytes = 256 * 1024
  ) {}

  get(key: string): V | undefined {
    const e = this.map.get(key)
    if (!e) return undefined
    this.map.delete(key)
    if (e.until <= this.now()) {
      this.bytes -= e.bytes
      return undefined
    }
    this.map.set(key, e)
    return e.value
  }

  set(key: string, value: V, ttlMs: number): void {
    const bytes = JSON.stringify(value).length
    if (bytes > this.maxEntryBytes) return
    const old = this.map.get(key)
    if (old) {
      this.map.delete(key)
      this.bytes -= old.bytes
    }
    this.map.set(key, { value, until: this.now() + ttlMs, bytes })
    this.bytes += bytes
    while (this.map.size > this.maxEntries || this.bytes > this.maxBytes) {
      const [k, e] = this.map.entries().next().value!
      this.map.delete(k)
      this.bytes -= e.bytes
    }
  }

  get size(): number {
    return this.map.size
  }
}
