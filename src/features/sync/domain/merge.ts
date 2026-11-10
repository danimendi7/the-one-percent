import { toOwnTopic, toTopicFeedback } from "./discovery-wire"
import { toRecallAttempt, toRecallCard } from "./recall-wire"
import type { LocalDate, Weekday } from "@/features/habits/domain/dates"
import { entryKey, type Habit, type HabitEntry, type HabitsState, type ScheduleRule } from "@/features/habits/domain/types"
import { measurementKey } from "@/features/goals/domain/types"
import { toGoal, toMeasurement } from "./goal-wire"
import type { FocusSession } from "@/features/focus/domain/types"
import { normalizeConfig } from "@/features/mind/domain/ops"
import { checkinKey, DEFAULT_CHECKIN_CONFIG } from "@/features/mind/domain/types"
import { toCheckin } from "./checkin-wire"
import { toReview } from "./review-wire"
import { reviewKey } from "@/features/reviews/domain/types"
import type { PullPayload, ServerCache, WireEntry, WireFocusSession, WireHabit, WireVersion } from "./types"

const DEFAULT_DIMENSIONS: HabitsState["dimensions"] = [
  { id: "body", name: "Cuerpo" },
  { id: "mind", name: "Mente" },
  { id: "learn", name: "Aprendizaje" },
  { id: "work", name: "Trabajo profundo" },
]

export function emptyCache(today: LocalDate, timezone = "Europe/Madrid"): ServerCache {
  return {
    state: { version: 1, timezone, dimensions: DEFAULT_DIMENSIONS, habits: [], entries: {}, restDays: [], seededOn: today, goals: [], measurements: {}, focusSessions: [], checkins: {}, checkinConfig: DEFAULT_CHECKIN_CONFIG, reviews: {}, recall: { cards: {}, attempts: {} }, discovery: { topics: {}, feedback: {} } },
    habitVersion: {},
    rowSeq: {},
    cursor: 0,
    serverToday: today,
  }
}

function toRule(v: WireVersion): ScheduleRule {
  switch (v.kind) {
    case "daily":
      return { kind: "daily" }
    case "weekdays":
      return { kind: "weekdays", weekdays: (v.weekdays ?? []).map((d) => d as Weekday) }
    case "weekly_count":
      return { kind: "weekly_count", timesPerWeek: v.target_count ?? 1 }
  }
}

export function toHabit(w: WireHabit): Habit {
  return {
    id: w.id,
    name: w.title,
    icon: w.icon,
    dimensionId: w.dimension,
    type: w.habit_type,
    ...(w.habit_type !== "binary"
      ? {
          unit: w.unit ?? undefined,
          target: w.target_value === null ? undefined : Number(w.target_value),
          direction: w.target_direction ?? "at_least",
        }
      : {}),
    schedule: w.versions.map((v) => ({ validFrom: v.valid_from, rule: toRule(v) })),
    startDate: w.start_date,
    archivedOn: w.archived_on,
    createdAt: w.created_at,
    ...(w.activity_source ? { activitySource: w.activity_source, activitySourceFrom: w.activity_source_from ?? null } : {}),
  }
}

export function toFocusSession(w: WireFocusSession): FocusSession {
  return {
    id: w.id,
    habitId: w.habit_id,
    project: w.project,
    plannedOutput: w.planned_output,
    actualOutput: w.actual_output,
    plannedMinutes: w.planned_minutes,
    segments: w.segments.map((s) => ({ start: s.start, end: s.end ?? null })),
    state: w.state,
    localDate: w.local_date,
    rating: w.rating,
    interruptions: w.interruptions ?? null,
    version: w.version,
    createdAt: w.created_at,
    updatedAt: w.updated_at,
  }
}

export function toEntry(w: WireEntry): HabitEntry {
  return {
    habitId: w.habit_id,
    date: w.local_date,
    value: w.value_bool !== null ? w.value_bool : Number(w.value_numeric),
    opId: w.client_op_id,
    updatedAt: w.client_updated_at,
  }
}

const seqKey = {
  habit: (id: string) => `h:${id}`,
  entry: (habitId: string, date: string) => `e:${habitId}:${date}`,
  rest: (date: string) => `r:${date}`,
  goal: (id: string) => `g:${id}`,
  measurement: (goalId: string, date: string) => `m:${goalId}:${date}`,
  focus: (id: string) => `f:${id}`,
  checkin: (date: string, phase: string) => `c:${date}:${phase}`,
  review: (kind: string, start: string) => `v:${kind}:${start}`,
  recallCard: (id: string) => `k:${id}`,
  discoveryTopic: (id: string) => `dt:${id}`,
  topicFeedback: (key: string) => `tf:${key}`,
}

/**
 * Merge a pull into the cache. A full pull replaces everything. An incremental
 * pull (which may overlap the previous cursor) applies a row only if it is newer
 * than what the cache holds, so re-reading rows is harmless (idempotent merge).
 */
export function mergePull(cache: ServerCache, p: PullPayload): ServerCache {
  const base = p.full ? emptyCache(p.server_today, p.profile?.timezone) : cache
  const rowSeq = { ...base.rowSeq }
  const habitVersion = { ...base.habitVersion }
  const habits = new Map(base.state.habits.map((h) => [h.id, h]))
  const entries = { ...base.state.entries }
  const rest = new Set(base.state.restDays)
  const goals = new Map(base.state.goals.map((g) => [g.id, g]))
  const measurements = { ...base.state.measurements }
  const focus = new Map(base.state.focusSessions.map((f) => [f.id, f]))
  const checkins = { ...base.state.checkins }
  const reviews = { ...base.state.reviews }
  const recallCards = { ...base.state.recall.cards }
  const recallAttempts = { ...base.state.recall.attempts }
  const discoveryTopics = { ...base.state.discovery.topics }
  const topicFeedback = { ...base.state.discovery.feedback }

  const newer = (key: string, seq: number) => !(key in rowSeq) || seq > rowSeq[key]

  for (const w of p.habits) {
    const k = seqKey.habit(w.id)
    if (!newer(k, w.server_seq)) continue
    rowSeq[k] = w.server_seq
    habitVersion[w.id] = w.version
    habits.set(w.id, toHabit(w))
  }
  for (const w of p.entries) {
    const k = seqKey.entry(w.habit_id, w.local_date)
    if (!newer(k, w.server_seq)) continue
    rowSeq[k] = w.server_seq
    const ek = entryKey(w.habit_id, w.local_date)
    if (w.deleted) delete entries[ek]
    else entries[ek] = toEntry(w)
  }
  for (const w of p.rest_days) {
    const k = seqKey.rest(w.local_date)
    if (!newer(k, w.server_seq)) continue
    rowSeq[k] = w.server_seq
    if (w.rest) rest.add(w.local_date)
    else rest.delete(w.local_date)
  }
  // A goal arrives whole (links + milestones), so it simply replaces the cached one.
  for (const w of p.goals ?? []) {
    const k = seqKey.goal(w.id)
    if (!newer(k, w.server_seq)) continue
    rowSeq[k] = w.server_seq
    goals.set(w.id, toGoal(w))
  }
  for (const w of p.measurements ?? []) {
    const k = seqKey.measurement(w.goal_id, w.observed_on)
    if (!newer(k, w.server_seq)) continue
    rowSeq[k] = w.server_seq
    const mk = measurementKey(w.goal_id, w.observed_on)
    if (w.deleted) delete measurements[mk]
    else measurements[mk] = toMeasurement(w)
  }

  for (const w of p.focus_sessions ?? []) {
    const k = seqKey.focus(w.id)
    if (!newer(k, w.server_seq)) continue
    rowSeq[k] = w.server_seq
    if (w.deleted) focus.delete(w.id)
    else focus.set(w.id, toFocusSession(w))
  }

  for (const w of p.daily_checkins ?? []) {
    const k = seqKey.checkin(w.local_date, w.phase)
    if (!newer(k, w.server_seq)) continue
    rowSeq[k] = w.server_seq
    const ck = checkinKey(w.local_date, w.phase)
    if (w.deleted) delete checkins[ck]
    else checkins[ck] = toCheckin(w)
  }

  // A review arrives whole with its section versions; a tombstone removes it from this device.
  for (const w of [...(p.reviews ?? []), ...(p.daily_reviews ?? [])]) {
    const k = seqKey.review(w.kind, w.period_start)
    if (!newer(k, w.server_seq)) continue
    rowSeq[k] = w.server_seq
    const rk = reviewKey(w.kind, w.period_start)
    if (w.deleted) delete reviews[rk]
    else reviews[rk] = toReview(w)
  }

  for (const w of p.recall_cards ?? []) {
    const k = seqKey.recallCard(w.id)
    if (!newer(k, w.server_seq)) continue
    rowSeq[k] = w.server_seq
    if (w.deleted) delete recallCards[w.id]
    else recallCards[w.id] = toRecallCard(w)
  }
  // Attempts never change, so their id is enough to apply each one once.
  for (const w of p.recall_attempts ?? []) recallAttempts[w.id] = toRecallAttempt(w)

  for (const w of p.discovery_topics ?? []) {
    const k = seqKey.discoveryTopic(w.id)
    if (!newer(k, w.server_seq)) continue
    rowSeq[k] = w.server_seq
    if (w.deleted) delete discoveryTopics[w.id]
    else discoveryTopics[w.id] = toOwnTopic(w)
  }
  for (const w of p.topic_feedback ?? []) {
    const k = seqKey.topicFeedback(w.topic_key)
    if (!newer(k, w.server_seq)) continue
    rowSeq[k] = w.server_seq
    topicFeedback[w.topic_key] = toTopicFeedback(w)
  }

  return {
    state: {
      ...base.state,
      timezone: p.profile?.timezone ?? base.state.timezone,
      dimensions: p.dimensions.length
        ? p.dimensions.map((d) => ({ id: d.slug, name: d.name }))
        : base.state.dimensions,
      habits: [...habits.values()],
      entries,
      restDays: [...rest].sort(),
      seededOn: base.state.seededOn,
      goals: [...goals.values()],
      measurements,
      focusSessions: [...focus.values()],
      checkins,
      checkinConfig: p.profile?.checkin_fields ? normalizeConfig(p.profile.checkin_fields) : base.state.checkinConfig,
      reviews,
      recall: { cards: recallCards, attempts: recallAttempts },
      discovery: { topics: discoveryTopics, feedback: topicFeedback },
    },
    habitVersion,
    rowSeq,
    cursor: Math.max(p.full ? 0 : cache.cursor, p.cursor),
    serverToday: p.server_today,
    features: { goals: p.goals !== undefined, focus: p.focus_sessions !== undefined, checkins: p.daily_checkins !== undefined, reviews: p.reviews !== undefined, dailyReviews: p.daily_reviews !== undefined, recall: p.recall_cards !== undefined, discovery: p.topic_feedback !== undefined, library: p.library !== undefined },
  }
}
