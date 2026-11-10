import type { LocalDate } from "@/features/habits/domain/dates"
import { CATALOG } from "./catalog"
import type { DiscoveryState, OwnTopic, Topic, TopicFeedback } from "./types"

/**
 * What to read today, by rules: no model is involved. The pick is a pure function of the state and
 * the date, so it is the same all day and on every device, and a rated topic stays on screen until
 * tomorrow. PRD §4.2: topic selection must not keep insisting on a subject the user disliked.
 */
const DISLIKED_AVERAGE = 4
const DISLIKED_MIN_RATINGS = 2
const WORDS_PER_MINUTE = 200

function ownToTopic(t: OwnTopic): Topic {
  const words = t.body.split(/\s+/).filter(Boolean).length
  return {
    key: t.id,
    title: t.title,
    category: t.category,
    minutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
    origin: "own",
    verification: "user_written",
    hook: null,
    sections: [{ heading: "Tus notas", body: t.body }],
    takeaway: null,
    recallQuestion: null,
    references: t.sourceTitle || t.sourceUrl ? [{ title: t.sourceTitle ?? t.sourceUrl!, note: "Fuente indicada por ti, sin comprobar.", ...(t.sourceUrl ? { url: t.sourceUrl } : {}) }] : [],
  }
}

export function allTopics(d: DiscoveryState): Topic[] {
  return [...CATALOG, ...Object.values(d.topics).map(ownToTopic)].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

export function topicByKey(d: DiscoveryState, key: string): Topic | null {
  return allTopics(d).find((t) => t.key === key) ?? null
}

const isEmpty = (f: TopicFeedback) => f.rating === null && !f.saved && f.dismissed === null

/** Subjects with at least two ratings averaging 4 or less, counting only what was decided before `before`. */
export function dislikedCategories(d: DiscoveryState, before?: LocalDate): string[] {
  const byCategory = new Map<string, number[]>()
  for (const t of allTopics(d)) {
    const f = d.feedback[t.key]
    if (f?.rating == null || (before && f.decidedOn >= before)) continue
    byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), f.rating])
  }
  return [...byCategory].filter(([, r]) => r.length >= DISLIKED_MIN_RATINGS && r.reduce((a, b) => a + b, 0) / r.length <= DISLIKED_AVERAGE).map(([c]) => c)
}

function pool(d: DiscoveryState, today: LocalDate): Topic[] {
  const open = allTopics(d).filter((t) => {
    const f = d.feedback[t.key]
    if (!f || isEmpty(f)) return true
    return f.dismissed === null && f.decidedOn >= today
  })
  // Today's own ratings do not count yet, so rating the topic on screen never swaps it for another.
  const disliked = new Set(dislikedCategories(d, today))
  const liked = open.filter((t) => !disliked.has(t.category))
  return liked.length > 0 ? liked : open
}

/** FNV-1a: spreads consecutive dates, the same in every browser. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function todayTopic(d: DiscoveryState, today: LocalDate): Topic | null {
  const p = pool(d, today)
  return p.length > 0 ? p[hash(today) % p.length] : null
}

/** The next ones after today's, for «Siguientes». */
export function upcomingTopics(d: DiscoveryState, today: LocalDate, n: number): Topic[] {
  const p = pool(d, today)
  if (p.length === 0) return []
  const first = hash(today) % p.length
  return Array.from({ length: Math.min(n, p.length - 1) }, (_, i) => p[(first + i + 1) % p.length])
}

function decided(d: DiscoveryState, keep: (f: TopicFeedback) => boolean): { topic: Topic; feedback: TopicFeedback }[] {
  return Object.values(d.feedback)
    .filter(keep)
    .map((feedback) => ({ topic: topicByKey(d, feedback.topicKey), feedback }))
    .filter((x): x is { topic: Topic; feedback: TopicFeedback } => x.topic !== null)
    .sort((a, b) => (a.feedback.decidedOn < b.feedback.decidedOn ? 1 : a.feedback.decidedOn > b.feedback.decidedOn ? -1 : a.feedback.topicKey < b.feedback.topicKey ? -1 : 1))
}

export function savedTopics(d: DiscoveryState): Topic[] {
  return decided(d, (f) => f.saved).map((x) => x.topic)
}

/** What was rated or saved, the latest first. */
export function historyTopics(d: DiscoveryState): { topic: Topic; feedback: TopicFeedback }[] {
  return decided(d, (f) => f.rating !== null || f.saved)
}
