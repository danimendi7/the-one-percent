import type { LocalDate } from "@/features/habits/domain/dates"

/**
 * Daily Discovery (PRD §4.2). There is no source retrieval, so nothing here can claim to be verified:
 * a curated text is an unverified synthesis, and a topic written by the user says so.
 */
export type VerificationStatus = "unverified" | "user_written"
export const VERIFICATION_LABEL: Record<VerificationStatus, string> = { unverified: "Síntesis sin verificar", user_written: "Escrito por ti" }

export interface TopicReference {
  title: string
  note: string
  /** Only ever a link the user typed: the catalog has none. */
  url?: string
}

export interface Topic {
  /** `curated:<slug>` or the id of an own topic. */
  key: string
  title: string
  category: string
  minutes: number
  origin: "curated" | "own"
  verification: VerificationStatus
  hook: string | null
  sections: { heading: string; body: string }[]
  takeaway: string | null
  recallQuestion: string | null
  references: TopicReference[]
}

export interface OwnTopic {
  id: string
  title: string
  category: string
  body: string
  sourceTitle: string | null
  sourceUrl: string | null
  createdAt: string
}

export type Dismissal = "not_interested" | "already_known"

export interface TopicFeedback {
  topicKey: string
  /** 1–10 (D10). */
  rating: number | null
  saved: boolean
  dismissed: Dismissal | null
  /** Local date of the last change: a topic decided before today does not come back. */
  decidedOn: LocalDate
  updatedAt: string
}

export type FeedbackFields = Partial<Pick<TopicFeedback, "rating" | "saved" | "dismissed">>

export interface DiscoveryState {
  topics: Record<string, OwnTopic>
  feedback: Record<string, TopicFeedback>
}
