import { applyEdit, closeReview, emptyDraft } from "./close"
import { normalizeDecision, reviewFields } from "./content"
import type { ReviewSnapshot } from "./snapshot"
import { reviewKey, type ContentKey, type Decision, type Evaluation, type Review, type ReviewField, type ReviewKind, type ReviewMap } from "./types"
import type { LocalDate } from "@/features/habits/domain/dates"

/**
 * Pure pieces of Life Review sync (M3.4c), shared by the engine, the optimistic view and the
 * test server. The wire format of a section is its desired state: a content answer is a string
 * (null or empty clears it), decisions and evaluations are whole lists.
 */
export type SectionValue = string | null | Decision[] | Evaluation[]
export type ReviewFields = Partial<Record<ReviewField, SectionValue>>

/** JSON with sorted keys: the server stores jsonb, which does not keep key order. */
export function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x
  )
}

/** A section's value as the server stores it (trimmed answer or null, normalized decisions). */
export function normalizeSection(field: ReviewField, value: unknown): SectionValue {
  if (field === "decisions") return ((value as Decision[] | null) ?? []).map(normalizeDecision)
  if (field === "evaluations") return (value as Evaluation[] | null) ?? []
  return typeof value === "string" && value.trim() ? value.trim() : null
}

/** Current value of a section of a review (null/empty when the review does not exist). */
export function sectionOf(review: Review | undefined, field: ReviewField): SectionValue {
  if (!review) return normalizeSection(field, null)
  if (field === "decisions") return normalizeSection(field, review.decisions)
  if (field === "evaluations") return normalizeSection(field, review.evaluations)
  return normalizeSection(field, review.content[field.slice("content.".length) as ContentKey])
}

export function sameSection(field: ReviewField, a: unknown, b: unknown): boolean {
  return canonical(normalizeSection(field, a)) === canonical(normalizeSection(field, b))
}

/**
 * What the user sees of a review, as one string: closing compares the review the user asked to
 * close with the one the server holds after syncing, and only closes if they are the same.
 */
export function reviewFingerprint(review: Review | undefined, kind: ReviewKind): string {
  const fields = reviewFields(kind)
  return canonical(Object.fromEntries(fields.map((f) => [f, sectionOf(review, f)])))
}

/**
 * Conflict base of a section, as this device last saw it from the server: the section's
 * server_seq; 0 when the review exists but the section was never written; null when the review
 * does not exist for this device (never seen, or deleted). With 0 a review deleted meanwhile on
 * another device is a conflict (`review_deleted`) instead of being brought back silently.
 */
export function sectionBase(cached: Review | undefined, field: ReviewField): number | null {
  if (!cached) return null
  return cached.fieldSeqs?.[field] ?? 0
}

/** Optimistic edit: applies each section to the draft (created on the first edit). A closed review is left unchanged. */
export function applySave(reviews: ReviewMap, kind: ReviewKind, periodStart: LocalDate, fields: ReviewFields, at: string): ReviewMap {
  const key = reviewKey(kind, periodStart)
  let review: Review
  try {
    review = reviews[key] ?? emptyDraft(kind, periodStart, at)
  } catch {
    return reviews
  }
  for (const [field, value] of Object.entries(fields) as [ReviewField, SectionValue][]) {
    const r = applyEdit(review, field, value, at)
    if (!r.ok) return reviews
    review = r.review
  }
  return { ...reviews, [key]: review }
}

/** Optimistic close: the review shows as closed with the snapshot being sent. */
export function applyCloseOp(reviews: ReviewMap, kind: ReviewKind, periodStart: LocalDate, snapshot: ReviewSnapshot): ReviewMap {
  const key = reviewKey(kind, periodStart)
  let review: Review
  try {
    review = reviews[key] ?? emptyDraft(kind, periodStart, snapshot.computedAt)
    review = closeReview(review, snapshot, snapshot.computedAt)
  } catch {
    return reviews
  }
  return { ...reviews, [key]: review }
}

/** Optimistic delete. */
export function applyDelete(reviews: ReviewMap, kind: ReviewKind, periodStart: LocalDate): ReviewMap {
  const key = reviewKey(kind, periodStart)
  if (!(key in reviews)) return reviews
  const next = { ...reviews }
  delete next[key]
  return next
}

