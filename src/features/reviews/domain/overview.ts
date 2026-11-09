import { capitalize, formatDate, type LocalDate } from "@/features/habits/domain/dates"
import { buildReviewSnapshot, type ReviewSnapshot } from "./snapshot"
export { historyStart } from "./snapshot"
import { isAvailable, latestAvailable, periodFromStart, periodOf, previousPeriod, nextPeriod, type Period } from "./periods"
import { decisionsToEvaluate } from "./content"
import { QUESTION_KEYS, reviewKey, type Decision, type DecisionKind, type Evaluation, type EvaluationOutcome, type Review, type ReviewKind, type ReviewMap } from "./types"
import type { HabitsState } from "@/features/habits/domain/types"

/**
 * What the Life Review screens show (M3.4d), as pure functions: the review due now, the history,
 * the review steps and the decision log. No formula of its own: figures come from the snapshot.
 */

/** ready: available and never written; draft: written, not closed; closed: frozen. */
export type ReviewPhase = "ready" | "draft" | "closed"

export function phaseOf(review: Review | undefined): ReviewPhase {
  if (!review) return "ready"
  return review.status === "closed" ? "closed" : "draft"
}

export function reviewOf(reviews: ReviewMap, kind: ReviewKind, periodStart: LocalDate): Review | undefined {
  return reviews[reviewKey(kind, periodStart)]
}

/** The review of the previous period of the same kind: its decisions are evaluated here (decision 4). */
export function previousReviewOf(reviews: ReviewMap, p: Period): Review | null {
  return reviewOf(reviews, p.kind, previousPeriod(p).from) ?? null
}

export interface DueReview {
  period: Period
  review: Review | undefined
  phase: ReviewPhase
}

/** The most recent available review of a kind (the week or month just ended, or ending today). */
export function dueReview(reviews: ReviewMap, kind: ReviewKind, today: LocalDate): DueReview {
  const period = latestAvailable(kind, today)
  const review = reviewOf(reviews, kind, period.from)
  return { period, review, phase: phaseOf(review) }
}

/** Reviews of a kind, newest period first. */
export function reviewsOfKind(reviews: ReviewMap, kind: ReviewKind): Review[] {
  return Object.values(reviews)
    .filter((r) => r.kind === kind)
    .sort((a, b) => (a.periodStart < b.periodStart ? 1 : a.periodStart > b.periodStart ? -1 : 0))
}

export interface HistoryGroup {
  /** `YYYY-MM` of the period start. */
  month: string
  label: string
  reviews: Review[]
}

/** History grouped by the month of each period start («Octubre de 2026»), newest first. */
export function historyGroups(reviews: ReviewMap, kind: ReviewKind): HistoryGroup[] {
  const groups: HistoryGroup[] = []
  for (const r of reviewsOfKind(reviews, kind)) {
    const month = r.periodStart.slice(0, 7)
    let g = groups.at(-1)
    if (!g || g.month !== month) {
      g = { month, label: capitalize(formatDate(`${month}-01`, { month: "long", year: "numeric" })), reviews: [] }
      groups.push(g)
    }
    g.reviews.push(r)
  }
  return groups
}

/**
 * Past periods that can still be reviewed, newest first: from the latest available back to the
 * one containing the start of the history (or `limit` periods when there is no history yet).
 */
export function pastPeriods(kind: ReviewKind, today: LocalDate, historyStart: LocalDate | null, limit = 26): Period[] {
  const out: Period[] = []
  const first = historyStart ? periodOf(kind, historyStart).from : null
  for (let p = latestAvailable(kind, today); out.length < limit; p = previousPeriod(p)) {
    if (first && p.from < first) break
    out.push(p)
  }
  return out
}

/**
 * The figures a review shows: frozen once closed, live (same builder, same inputs) while it is a
 * draft or not written yet. Null when the period is not reviewable (invalid, future, too large).
 */
export function figuresFor(state: HabitsState, review: Review | undefined, p: Period, today: LocalDate): ReviewSnapshot | null {
  if (review?.status === "closed" && review.snapshot) return review.snapshot
  if (!isAvailable(p, today)) return null
  try {
    return buildReviewSnapshot({ state, kind: p.kind, periodStart: p.from, today, computedAt: "" })
  } catch {
    return null
  }
}

/** Two headline figures of a closed review for the history rows. */
export function headline(s: ReviewSnapshot): { completion: number | null; applicable: number; focusMinutes: number } {
  return { completion: s.habits.current.rate, applicable: s.habits.current.applicable, focusMinutes: s.focus.current.minutes }
}

export type StepId = "figures" | "reflection" | "evaluations" | "decisions" | "close"

/** The review steps (plan §6.2): the evaluation step only when the previous review left decisions; a day has neither. */
export function reviewSteps(previous: Pick<Review, "decisions"> | null, kind: ReviewKind = "week"): StepId[] {
  if (kind === "day") return ["figures", "reflection", "close"]
  return previous && previous.decisions.length > 0 ? ["figures", "reflection", "evaluations", "decisions", "close"] : ["figures", "reflection", "decisions", "close"]
}

export const STEP_LABEL: Record<StepId, string> = {
  figures: "Cifras",
  reflection: "Reflexión",
  evaluations: "Decisiones anteriores",
  decisions: "Próximo periodo",
  close: "Cerrar",
}

/** «2 de 3 preguntas · 1 decisión · 1 por evaluar», for the «Ahora» card and the editor header. */
export function progressLabel(review: Pick<Review, "kind" | "content" | "decisions" | "evaluations"> | undefined, previous: Pick<Review, "decisions"> | null, questions: number): string {
  const answered = review ? Object.entries(review.content).filter(([k, v]) => k !== "note" && v?.trim()).length : 0
  const decisions = review?.decisions.length ?? 0
  const pending = decisionsToEvaluate(previous, review?.evaluations ?? []).length
  const parts = [`${answered} de ${questions} preguntas`, decisions === 1 ? "1 decisión" : `${decisions} decisiones`]
  if (pending > 0) parts.push(`${pending} por evaluar`)
  return parts.join(" · ")
}

/** The progress line of a review of any kind: a daily review only counts its questions. */
export function reviewProgress(kind: ReviewKind, review: Pick<Review, "kind" | "content" | "decisions" | "evaluations"> | undefined, previous: Pick<Review, "decisions"> | null): string {
  const label = progressLabel(review, previous, QUESTION_KEYS[kind].length)
  return kind === "day" ? label.split(" · ")[0] : label
}

export interface LogEntry {
  kind: ReviewKind
  /** Period of the review that made the decision. */
  period: Period
  decision: Decision
  evaluation: Evaluation | null
  /** Period start of the review that evaluated it, if any. */
  evaluatedIn: LocalDate | null
}

/** Every decision with its later evaluation (stored in the next review of the same kind), newest first. */
export function decisionLog(reviews: ReviewMap): LogEntry[] {
  const out: LogEntry[] = []
  for (const kind of ["week", "month"] as const) {
    for (const r of reviewsOfKind(reviews, kind)) {
      const period = periodFromStart(kind, r.periodStart)
      if (!period) continue
      const next = reviewOf(reviews, kind, nextPeriod(period).from)
      for (const d of r.decisions) {
        const evaluation = next?.evaluations.find((e) => e.decisionId === d.id && e.from === r.periodStart) ?? null
        out.push({ kind, period, decision: d, evaluation, evaluatedIn: evaluation ? next!.periodStart : null })
      }
    }
  }
  return out.sort((a, b) => (a.period.from < b.period.from ? 1 : a.period.from > b.period.from ? -1 : a.kind === "month" ? -1 : 1))
}

export interface LogFilter {
  kind: ReviewKind | "all"
  decision: DecisionKind | "all"
  outcome: EvaluationOutcome | "pending" | "all"
}

export function filterLog(entries: readonly LogEntry[], f: LogFilter): LogEntry[] {
  return entries.filter(
    (e) =>
      (f.kind === "all" || e.kind === f.kind) &&
      (f.decision === "all" || e.decision.kind === f.decision) &&
      (f.outcome === "all" || (f.outcome === "pending" ? e.evaluation === null : e.evaluation?.outcome === f.outcome))
  )
}

/** «Cumplidas 4 de 6 evaluadas»: a count with its n, never a score. */
export function logSummary(entries: readonly LogEntry[]): { done: number; evaluated: number } {
  const evaluated = entries.filter((e) => e.evaluation)
  return { done: evaluated.filter((e) => e.evaluation!.outcome === "done").length, evaluated: evaluated.length }
}
