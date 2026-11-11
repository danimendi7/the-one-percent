import type { LocalDate } from "@/features/habits/domain/dates"
import { safeUrl } from "@/features/knowledge/domain/text"
import type { DiscoveryState, FeedbackFields, OwnTopic } from "./types"

/** Mirrored by the checks of supabase/migrations/*_discovery.sql. */
export const TOPIC_LIMITS = { title: 200, body: 10_000, sourceTitle: 300 } as const
export const CATEGORIES = ["Filosofía", "Ciencia", "Historia", "Economía", "Tecnología", "Cultura", "Libros", "Otros"] as const

export function emptyDiscovery(): DiscoveryState {
  return { topics: {}, feedback: {} }
}

export interface OwnTopicInput {
  title: string
  category: string
  body: string
  sourceTitle: string
  sourceUrl: string
}

export type OwnTopicResult =
  | { ok: true; title: string; category: string; body: string; sourceTitle: string | null; sourceUrl: string | null }
  | { ok: false; field: "title" | "category" | "body" | "sourceTitle" | "sourceUrl"; reason: "empty" | "too_long" | "invalid" }

export function validateOwnTopic(input: OwnTopicInput): OwnTopicResult {
  const title = input.title.trim()
  const body = input.body.trim()
  const sourceTitle = input.sourceTitle.trim()
  const rawUrl = input.sourceUrl.trim()
  if (!title) return { ok: false, field: "title", reason: "empty" }
  if (title.length > TOPIC_LIMITS.title) return { ok: false, field: "title", reason: "too_long" }
  if (!(CATEGORIES as readonly string[]).includes(input.category)) return { ok: false, field: "category", reason: "invalid" }
  if (!body) return { ok: false, field: "body", reason: "empty" }
  if (body.length > TOPIC_LIMITS.body) return { ok: false, field: "body", reason: "too_long" }
  if (sourceTitle.length > TOPIC_LIMITS.sourceTitle) return { ok: false, field: "sourceTitle", reason: "too_long" }
  const sourceUrl = rawUrl ? safeUrl(rawUrl) : null
  if (rawUrl && !sourceUrl) return { ok: false, field: "sourceUrl", reason: "invalid" }
  return { ok: true, title, category: input.category, body, sourceTitle: sourceTitle || null, sourceUrl }
}

export interface NewOwnTopic extends Omit<OwnTopic, "createdAt"> {
  at: string
}

export function addOwnTopic(d: DiscoveryState, t: NewOwnTopic): DiscoveryState {
  if (d.topics[t.id]) return d
  const { at, ...rest } = t
  return { ...d, topics: { ...d.topics, [t.id]: { ...rest, createdAt: at } } }
}

export function removeOwnTopic(d: DiscoveryState, id: string): DiscoveryState {
  if (!d.topics[id]) return d
  const topics = { ...d.topics }
  delete topics[id]
  return { ...d, topics }
}

/** Each field is a desired state, independent of the others (one device can rate while another saves). */
export function applyFeedback(d: DiscoveryState, topicKey: string, fields: FeedbackFields, localDate: LocalDate, at: string): DiscoveryState {
  const current = d.feedback[topicKey] ?? { topicKey, rating: null, saved: false, dismissed: null, decidedOn: localDate, updatedAt: at }
  return { ...d, feedback: { ...d.feedback, [topicKey]: { ...current, ...fields, decidedOn: localDate, updatedAt: at } } }
}
