import type { LocalDate } from "@/features/habits/domain/dates"
import { normalizeContent, normalizeDecision, validateContent } from "./content"
import { isAvailable, periodFromStart } from "./periods"
import type { ReviewSnapshot } from "./snapshot"
import type { Review, ReviewField, ReviewKind } from "./types"

/**
 * Close semantics (decisions 1, 2 and 4), as pure functions so they are deterministic and the
 * server rules of M3.4b can be tested against the same cases:
 *
 * - A review closes only from the last day of its period, with valid content, no section
 *   conflict waiting for a decision, and a device that is fully synced with a recent pull.
 * - Offline, closing is deferred (the draft stays; the close runs after reconnecting and pulling).
 * - The first close wins: a later close of the same review changes nothing (`already_closed`).
 * - A closed review is immutable: edits are refused, never applied or silently dropped by the caller.
 */

/** A pull older than this is refreshed before computing the snapshot. */
export const FRESH_PULL_MS = 60_000

export interface SyncView {
  online: boolean
  /** Operations still in the durable queue (including this review's own edits). */
  pending: number
  /** Device time of the last successful pull, or null if none yet. */
  lastPullAt: number | null
  now: number
  /** Section conflicts of this review waiting for «Aplicar la mía» / «Mantener la otra». */
  conflicts: number
  /** The server has the reviews migration (features.reviews). */
  serverSupports: boolean
}

export type CloseGate =
  | { action: "close" }
  /** Push the queue and pull, then evaluate again. */
  | { action: "sync_first"; reason: "pending" | "stale_pull" }
  /** Keep the draft and remember the intent; close after reconnecting and pulling. */
  | { action: "defer"; reason: "offline" }
  | { action: "blocked"; reason: "already_closed" | "invalid_period" | "not_available" | "invalid_content" | "conflicts" | "no_server_support" }

export function closeGate(review: Pick<Review, "kind" | "periodStart" | "status" | "content" | "decisions" | "evaluations">, today: LocalDate, sync: SyncView): CloseGate {
  if (review.status === "closed") return { action: "blocked", reason: "already_closed" }
  const period = periodFromStart(review.kind, review.periodStart)
  if (!period) return { action: "blocked", reason: "invalid_period" }
  if (!isAvailable(period, today)) return { action: "blocked", reason: "not_available" }
  if (!validateContent(review).ok) return { action: "blocked", reason: "invalid_content" }
  if (sync.conflicts > 0) return { action: "blocked", reason: "conflicts" }
  if (!sync.serverSupports) return { action: "blocked", reason: "no_server_support" }
  if (!sync.online) return { action: "defer", reason: "offline" }
  if (sync.pending > 0) return { action: "sync_first", reason: "pending" }
  if (sync.lastPullAt === null || sync.now - sync.lastPullAt > FRESH_PULL_MS) return { action: "sync_first", reason: "stale_pull" }
  return { action: "close" }
}

/** The closed review produced by a close (the snapshot comes from buildReviewSnapshot). */
export function closeReview(review: Review, snapshot: ReviewSnapshot, closedAt: string): Review {
  if (review.status === "closed") throw new Error("already_closed")
  if (snapshot.kind !== review.kind || snapshot.period.from !== review.periodStart) throw new Error("snapshot_mismatch")
  return {
    ...review,
    status: "closed",
    content: normalizeContent(review.content),
    decisions: review.decisions.map(normalizeDecision),
    snapshot,
    closedAt,
    updatedAt: closedAt,
  }
}

/** First close wins (mirrors the server rule): an incoming close of a closed review changes nothing. */
export function applyClose(current: Review, incoming: Review): { review: Review; outcome: "applied" | "already_closed" } {
  if (current.status === "closed") return { review: current, outcome: "already_closed" }
  return { review: incoming, outcome: "applied" }
}

export type EditResult = { ok: true; review: Review } | { ok: false; reason: "closed"; review: Review }

/** Applies one section edit to a draft. A closed review refuses it and is returned unchanged. */
export function applyEdit(review: Review, field: ReviewField, value: unknown, at: string): EditResult {
  if (review.status === "closed") return { ok: false, reason: "closed", review }
  if (field === "decisions") return { ok: true, review: { ...review, decisions: value as Review["decisions"], updatedAt: at } }
  if (field === "evaluations") return { ok: true, review: { ...review, evaluations: value as Review["evaluations"], updatedAt: at } }
  const key = field.slice("content.".length) as keyof Review["content"]
  const content = { ...review.content }
  if (typeof value === "string" && value.trim()) content[key] = value
  else delete content[key]
  return { ok: true, review: { ...review, content, updatedAt: at } }
}

/** A fresh draft for a period (created on the first edit; opening a review creates nothing). */
export function emptyDraft(kind: ReviewKind, periodStart: LocalDate, at: string): Review {
  const period = periodFromStart(kind, periodStart)
  if (!period) throw new Error("invalid_period")
  return { kind, periodStart, periodEnd: period.to, status: "draft", content: {}, decisions: [], evaluations: [], snapshot: null, closedAt: null, updatedAt: at }
}
