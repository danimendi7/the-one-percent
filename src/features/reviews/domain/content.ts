import { z } from "zod"
import { isLocalDate } from "@/features/habits/domain/dates"
import {
  DECISION_KINDS,
  EVALUATION_OUTCOMES,
  LIMITS,
  QUESTION_KEYS,
  type ContentKey,
  type Decision,
  type Evaluation,
  type Review,
  type ReviewContent,
  type ReviewField,
  type ReviewKind,
} from "./types"

/**
 * Validation of what a user writes in a review (decision 3). The same limits are enforced by
 * the server trigger in M3.4b; here they protect the optimistic copy and the persisted queue.
 * Text is trimmed and an empty answer is stored as «no answer», never as an empty string.
 */
const localDate = z.string().refine(isLocalDate, "invalid date")
const uuid = z.uuid()

const text = (max: number) => z.string().trim().min(1).max(max)

export function contentKeys(kind: ReviewKind): readonly ContentKey[] {
  return [...QUESTION_KEYS[kind], "note"]
}

export function contentSchema(kind: ReviewKind) {
  const shape: Partial<Record<ContentKey, z.ZodType<string | undefined>>> = {}
  for (const k of contentKeys(kind)) shape[k] = text(k === "note" ? LIMITS.note : LIMITS.answer).optional()
  return z.object(shape as Record<string, z.ZodType<string | undefined>>).strict()
}

export const decisionSchema = z
  .object({
    id: uuid,
    text: text(LIMITS.decisionText),
    kind: z.enum(DECISION_KINDS as [Decision["kind"], ...Decision["kind"][]]),
    expected: text(LIMITS.expected).nullable(),
    link: z
      .object({ type: z.enum(["habit", "goal"]), id: z.string().min(1), title: text(LIMITS.linkTitle) })
      .strict()
      .nullable(),
  })
  .strict()

export const decisionsSchema = z
  .array(decisionSchema)
  .max(LIMITS.decisions)
  .refine((ds) => new Set(ds.map((d) => d.id)).size === ds.length, "duplicate decision id")

export const evaluationSchema = z
  .object({
    decisionId: uuid,
    from: localDate,
    outcome: z.enum(EVALUATION_OUTCOMES as [Evaluation["outcome"], ...Evaluation["outcome"][]]),
    note: text(LIMITS.evaluationNote).nullable(),
  })
  .strict()

export const evaluationsSchema = z
  .array(evaluationSchema)
  .max(LIMITS.decisions)
  .refine((es) => new Set(es.map((e) => e.decisionId)).size === es.length, "duplicate evaluation")

/** Trims every answer and drops the empty ones: an empty answer is «no answer». */
export function normalizeContent(content: ReviewContent): ReviewContent {
  const out: ReviewContent = {}
  for (const [k, v] of Object.entries(content) as [ContentKey, string | undefined][]) {
    const t = v?.trim()
    if (t) out[k] = t
  }
  return out
}

/** Trims a decision's texts; an empty expected result becomes null. */
export function normalizeDecision(d: Decision): Decision {
  const expected = d.expected?.trim() || null
  return { ...d, text: d.text.trim(), expected, link: d.link ? { ...d.link, title: d.link.title.trim() } : null }
}

export type Validation = { ok: true } | { ok: false; field: ReviewField; message: string }

/** Validates a review's user content (not the snapshot). */
export function validateContent(review: Pick<Review, "kind" | "content" | "decisions" | "evaluations">): Validation {
  const content = contentSchema(review.kind).safeParse(normalizeContent(review.content))
  if (!content.success) {
    const key = String(content.error.issues[0]?.path[0] ?? "note") as ContentKey
    return { ok: false, field: `content.${key}`, message: content.error.issues[0]?.message ?? "invalid" }
  }
  const decisions = decisionsSchema.safeParse(review.decisions.map(normalizeDecision))
  if (!decisions.success) return { ok: false, field: "decisions", message: decisions.error.issues[0]?.message ?? "invalid" }
  const evaluations = evaluationsSchema.safeParse(review.evaluations)
  if (!evaluations.success) return { ok: false, field: "evaluations", message: evaluations.error.issues[0]?.message ?? "invalid" }
  return { ok: true }
}

/** Every section that conflicts on its own (decision 5). */
export function reviewFields(kind: ReviewKind): ReviewField[] {
  return [...contentKeys(kind).map((k) => `content.${k}` as const), "decisions", "evaluations"]
}

export interface SectionProgress {
  /** Questions answered (the free note does not count: it is optional by design). */
  answered: number
  questions: number
  decisions: number
  /** Decisions of the previous review still without evaluation. */
  toEvaluate: number
}

/** «2 de 3 preguntas · 1 decisión»: progress only, nothing is required to close. */
export function sectionProgress(review: Pick<Review, "kind" | "content" | "decisions" | "evaluations">, previous: Pick<Review, "decisions"> | null): SectionProgress {
  const content = normalizeContent(review.content)
  const questions = QUESTION_KEYS[review.kind]
  return {
    answered: questions.filter((k) => content[k]).length,
    questions: questions.length,
    decisions: review.decisions.length,
    toEvaluate: decisionsToEvaluate(previous, review.evaluations).length,
  }
}

/** Decisions of the previous review of the same kind that this review has not evaluated yet (decision 4). */
export function decisionsToEvaluate(previous: Pick<Review, "decisions"> | null, evaluations: readonly Evaluation[]): Decision[] {
  if (!previous) return []
  const done = new Set(evaluations.map((e) => e.decisionId))
  return previous.decisions.filter((d) => !done.has(d.id))
}

/** Desired state of the evaluations after rating one decision (replaces any earlier rating of it). */
export function setEvaluation(evaluations: readonly Evaluation[], e: Evaluation): Evaluation[] {
  return [...evaluations.filter((x) => x.decisionId !== e.decisionId), e]
}

/** Adds a decision unless the limit is reached (the UI hides «Añadir» at 3). */
export function addDecision(decisions: readonly Decision[], d: Decision): Decision[] {
  if (decisions.length >= LIMITS.decisions) return [...decisions]
  return [...decisions, d]
}
