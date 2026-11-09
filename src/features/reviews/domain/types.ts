import type { LocalDate } from "@/features/habits/domain/dates"
import type { ReviewSnapshot } from "./snapshot"

/**
 * Life Review (docs/m3.4-life-review-plan.md). A review is identified by user + kind + period
 * start (decision 6), so two devices can never create two reviews for the same week or month.
 * While it is a draft its figures are live; closing freezes them in `snapshot` once and for all
 * (decision 1), and a closed review is immutable (decision 4).
 */
export type ReviewKind = "day" | "week" | "month"
export type ReviewStatus = "draft" | "closed"

/** Short questions (decision 3). Every answer is optional: a review can close with none. */
export const QUESTION_KEYS = {
  day: ["observations", "adjustments"],
  week: ["wins", "struggles", "lessons"],
  month: ["pattern", "attention", "stop"],
} as const satisfies Record<ReviewKind, readonly string[]>

export type DayQuestion = (typeof QUESTION_KEYS.day)[number]
export type WeekQuestion = (typeof QUESTION_KEYS.week)[number]
export type MonthQuestion = (typeof QUESTION_KEYS.month)[number]
export type ContentKey = DayQuestion | WeekQuestion | MonthQuestion | "note"

export const QUESTION_LABEL: Record<ContentKey, string> = {
  observations: "¿Qué has observado?",
  adjustments: "¿Qué vas a ajustar?",
  wins: "¿Qué salió bien?",
  struggles: "¿Qué costó?",
  lessons: "¿Qué aprendiste?",
  pattern: "¿Qué patrón ves en el mes?",
  attention: "¿Qué objetivo necesita atención?",
  stop: "¿Qué dejas de hacer?",
  note: "Nota libre",
}

export type ReviewContent = Partial<Record<ContentKey, string>>

export type DecisionKind = "start" | "keep" | "change" | "drop"
export const DECISION_KINDS: readonly DecisionKind[] = ["start", "keep", "change", "drop"]
export const DECISION_KIND_LABEL: Record<DecisionKind, string> = { start: "Empezar", keep: "Mantener", change: "Cambiar", drop: "Dejar" }

export interface DecisionLink {
  type: "habit" | "goal"
  id: string
  /** Copied when linking, so the decision stays readable if the habit or goal is renamed or deleted. */
  title: string
}

export interface Decision {
  /** Stable id (uuid): the next review evaluates it by this id. */
  id: string
  text: string
  kind: DecisionKind
  /** Simple, measurable expected result, e.g. «4 sesiones de 90 min» (optional). */
  expected: string | null
  link: DecisionLink | null
}

export type EvaluationOutcome = "done" | "partial" | "missed" | "dropped"
export const EVALUATION_OUTCOMES: readonly EvaluationOutcome[] = ["done", "partial", "missed", "dropped"]
export const EVALUATION_LABEL: Record<EvaluationOutcome, string> = { done: "Cumplida", partial: "Parcial", missed: "No cumplida", dropped: "Ya no aplica" }

/** Stored in the review that evaluates (the next one of the same kind): the evaluated review never changes. */
export interface Evaluation {
  decisionId: string
  /** Period start of the review the decision belongs to. */
  from: LocalDate
  outcome: EvaluationOutcome
  note: string | null
}

export interface Review {
  kind: ReviewKind
  periodStart: LocalDate
  periodEnd: LocalDate
  status: ReviewStatus
  content: ReviewContent
  decisions: Decision[]
  evaluations: Evaluation[]
  /** Frozen on close; null while it is a draft. */
  snapshot: ReviewSnapshot | null
  /** Server clock (ISO) of the close. */
  closedAt: string | null
  updatedAt: string
  /**
   * Account mode (M3.4c): server_seq of each section and of the row as this device last saw them.
   * Edits send them as their base, so a section changed meanwhile on another device is a conflict
   * instead of a silent overwrite. Absent on drafts the server has not confirmed yet.
   */
  fieldSeqs?: Record<string, number>
  serverSeq?: number
}

/** Reviews of a dataset, keyed `kind:periodStart` (reviewKey). */
export type ReviewMap = Record<string, Review>

/** Sections that conflict independently (decision 5): each answer, the decisions and the evaluations. */
export type ReviewField = `content.${ContentKey}` | "decisions" | "evaluations"

export const LIMITS = {
  answer: 600,
  note: 1000,
  decisions: 3,
  decisionText: 140,
  expected: 80,
  evaluationNote: 140,
  linkTitle: 120,
  /** Server and client refuse larger snapshots (plan §3). */
  snapshotBytes: 65_536,
  /** Closing later than this after the period ends marks the review «cerrada más tarde» (informative). */
  lateCloseDays: 14,
} as const

export function reviewKey(kind: ReviewKind, periodStart: LocalDate): string {
  return `${kind}:${periodStart}`
}
