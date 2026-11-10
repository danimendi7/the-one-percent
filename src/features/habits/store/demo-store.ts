"use client"

/**
 * Demo backend: browser-only persistence (localStorage) with generated example
 * data. Used when there is no account (explore mode) or Supabase is not
 * configured. Never synced, never imported automatically into an account.
 */
import { addOwnTopic, applyFeedback, emptyDiscovery, removeOwnTopic, validateOwnTopic } from "@/features/discover/domain/ops"
import { addCard, answerOutcome, emptyRecall, recordAnswer, removeCard, setSuspended, validateCardText } from "@/features/recall/domain/ops"
import { useSyncExternalStore } from "react"
import { clearDemoLibrary, createDemoLibrary } from "@/features/library/store/demo-library"
import { localDateInZone, type LocalDate } from "../domain/dates"
import {
  addHabit,
  archiveHabit,
  restoreHabit,
  setEntry,
  setRestDay,
  updateHabit,
  type HabitInput,
} from "../domain/ops"
import type { HabitsState } from "../domain/types"
import { createDemoState } from "../fixtures/demo"
import { createDemoGoals } from "@/features/goals/fixtures"
import { withDemoFocus } from "@/features/focus/fixtures"
import { withDemoCheckins } from "@/features/mind/fixtures"
import { setCheckin, setCheckinConfig } from "@/features/mind/domain/ops"
import {
  addGoalLogEntry,
  archiveGoal,
  removeGoalLogEntry,
  createGoal,
  restoreGoal,
  setCheckpointDone,
  setGoalBook,
  setGoalReview,
  setGoalState,
  setMeasurement,
  updateGoal,
} from "@/features/goals/domain/ops"
import { discardSession, editSession, finishSession, pauseSession, resumeSession, setHabitSource, startSession } from "@/features/focus/domain/ops"
import { uuidv4 } from "@/lib/ids"
import { habitsStateSchema } from "./schema"
import { DEFAULT_CHECKIN_CONFIG } from "@/features/mind/domain/types"
import { closeGate } from "@/features/reviews/domain/close"
import { validateContent } from "@/features/reviews/domain/content"
import { isAvailable, periodFromStart } from "@/features/reviews/domain/periods"
import { buildReviewSnapshot } from "@/features/reviews/domain/snapshot"
import { applyCloseOp, applyDelete, applySave } from "@/features/reviews/domain/sync"
import { reviewKey } from "@/features/reviews/domain/types"
import type { Backend, HabitsSnapshot } from "./types"

export const STORAGE_KEY = "the-one-percent:demo:habits:v1"
const DEFAULT_TZ = "Europe/Madrid"

let snapshot: HabitsSnapshot | null = null
const listeners = new Set<() => void>()

function computeToday(timezone: string): LocalDate {
  return localDateInZone(new Date(), timezone)
}

/** Read demo data saved in this browser without creating any (used by the import flow). */
export function readDemoState(): HabitsState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = habitsStateSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return null
    const data = { ...parsed.data, recall: parsed.data.recall ?? emptyRecall(), discovery: parsed.data.discovery ?? emptyDiscovery() } as Omit<HabitsState, "goals" | "measurements" | "focusSessions" | "checkins" | "checkinConfig" | "reviews"> &
      Partial<Pick<HabitsState, "goals" | "measurements" | "focusSessions" | "checkins" | "checkinConfig" | "reviews">>
    // Before M3.4 there were no reviews.
    const reviews = data.reviews ?? {}
    // Demo saved by an older version: add what it lacks relative to when it was seeded, keeping
    // every record it has. Before M3.1 there were no goals; before M3.2 no focus sessions; before
    // M3.3 no check-ins.
    const withGoals = data.goals && data.measurements ? { ...(data as Omit<HabitsState, "focusSessions" | "checkins" | "checkinConfig" | "reviews">), reviews } : { ...data, ...createDemoGoals(data.seededOn), reviews }
    const withFocus = data.focusSessions
      ? { ...withGoals, focusSessions: data.focusSessions }
      : withDemoFocus({ ...withGoals, focusSessions: [], checkins: {}, checkinConfig: data.checkinConfig ?? DEFAULT_CHECKIN_CONFIG }, data.seededOn)
    if (data.checkins) return { ...withFocus, checkins: data.checkins, checkinConfig: data.checkinConfig ?? DEFAULT_CHECKIN_CONFIG }
    return withDemoCheckins(withFocus, data.seededOn)
  } catch {
    return null
  }
}

/** Delete this browser's demo data (callers must offer an export first). */
export function clearDemoState(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
    clearDemoLibrary()
  } catch {
    // ignore
  }
  snapshot = null
  emit()
}

function writeStorage(state: HabitsState): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

function init(): HabitsSnapshot {
  const stored = readDemoState()
  const timezone = stored?.timezone ?? DEFAULT_TZ
  const today = computeToday(timezone)
  if (stored) return { state: stored, today, persisted: true, source: "demo" }
  const state = createDemoState(today, timezone)
  return { state, today, persisted: writeStorage(state), source: "demo" }
}

function emit() {
  for (const l of listeners) l()
}

function getSnapshot(): HabitsSnapshot {
  if (!snapshot) snapshot = init()
  return snapshot
}

function commit(next: HabitsState) {
  const s = getSnapshot()
  if (next === s.state) return
  snapshot = { ...s, state: next, persisted: writeStorage(next) }
  emit()
}

function refreshToday() {
  if (!snapshot) return
  const today = computeToday(snapshot.state.timezone)
  if (today !== snapshot.today) {
    snapshot = { ...snapshot, today }
    emit()
  }
}

/** Another tab changed the demo data: adopt it (same browser only). */
function onStorage(e: StorageEvent) {
  if (e.key !== STORAGE_KEY || !snapshot) return
  const next = readDemoState()
  if (next) {
    snapshot = { ...snapshot, state: next }
    emit()
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    window.addEventListener("storage", onStorage)
    document.addEventListener("visibilitychange", refreshToday)
    window.addEventListener("focus", refreshToday)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      window.removeEventListener("storage", onStorage)
      document.removeEventListener("visibilitychange", refreshToday)
      window.removeEventListener("focus", refreshToday)
    }
  }
}

const demoLib = createDemoLibrary(() => getSnapshot().today, () => emit())

export const demoBackend: Backend = {
  source: "demo",
  subscribe,
  getSnapshot,
  library: demoLib,
  actions: {
    setEntry(habitId, date, value) {
      const s = getSnapshot()
      const result = setEntry(s.state, {
        habitId,
        date,
        value,
        opId: uuidv4(),
        now: new Date().toISOString(),
        today: s.today,
      })
      if (result.ok) commit(result.state)
      return result
    },
    addHabit(input: HabitInput) {
      const s = getSnapshot()
      const id = uuidv4()
      commit(addHabit(s.state, input, { id, today: s.today, now: new Date().toISOString() }))
      return id
    },
    updateHabit(id, input) {
      const s = getSnapshot()
      commit(updateHabit(s.state, id, input, s.today))
    },
    archiveHabit(id) {
      const s = getSnapshot()
      commit(archiveHabit(s.state, id, s.today))
    },
    restoreHabit(id) {
      commit(restoreHabit(getSnapshot().state, id))
    },
    setRestDay(date, rest) {
      commit(setRestDay(getSnapshot().state, date, rest))
    },
    addGoal(input) {
      const s = getSnapshot()
      const id = uuidv4()
      commit(createGoal(s.state, input, { id, now: new Date().toISOString() }))
      return id
    },
    updateGoal(id, input) {
      commit(updateGoal(getSnapshot().state, id, input, new Date().toISOString()))
    },
    setGoalState(id, goalState) {
      const s = getSnapshot()
      commit(setGoalState(s.state, id, goalState, s.today, new Date().toISOString()))
    },
    archiveGoal(id) {
      const s = getSnapshot()
      commit(archiveGoal(s.state, id, s.today))
    },
    addGoalLog(goalId, kind, text) {
      const s = getSnapshot()
      commit(addGoalLogEntry(s.state, goalId, { id: uuidv4(), kind, text, on: s.today }))
    },
    removeGoalLog(goalId, entryId) {
      commit(removeGoalLogEntry(getSnapshot().state, goalId, entryId))
    },
    setGoalBook(goalId, itemId, linked) {
      commit(setGoalBook(getSnapshot().state, goalId, itemId, linked))
    },
    setGoalReview(id, review) {
      const s = getSnapshot()
      commit(setGoalReview(s.state, id, review ? s.today : null))
    },
    restoreGoal(id) {
      commit(restoreGoal(getSnapshot().state, id))
    },
    setMeasurement(goalId, date, value, note) {
      const s = getSnapshot()
      const r = setMeasurement(s.state, { goalId, date, value, note, opId: uuidv4(), now: new Date().toISOString(), today: s.today })
      if (r.ok) commit(r.state)
      return r
    },
    setCheckpoint(goalId, checkpointId, doneOn) {
      const s = getSnapshot()
      commit(setCheckpointDone(s.state, goalId, checkpointId, doneOn, s.today))
    },
    // ── Focus (M3.2): the same reducers the account replays over server state ──
    startFocus(input) {
      const id = uuidv4()
      const r = startSession(getSnapshot().state, { id, ...input, at: new Date().toISOString() })
      if (!r.ok) return { ok: false, reason: r.reason }
      commit(r.state)
      return { ok: true, id }
    },
    pauseFocus(id) {
      const r = pauseSession(getSnapshot().state, id, new Date().toISOString())
      if (r.ok) commit(r.state)
    },
    resumeFocus(id) {
      const r = resumeSession(getSnapshot().state, id, new Date().toISOString())
      if (r.ok) commit(r.state)
    },
    finishFocus(id, input) {
      const r = finishSession(getSnapshot().state, id, { ...input, at: new Date().toISOString() })
      if (!r.ok) return { ok: false, reason: r.reason }
      commit(r.state)
      return { ok: true }
    },
    editFocus(id, input) {
      const r = editSession(getSnapshot().state, id, input, new Date().toISOString())
      if (!r.ok) return { ok: false, reason: r.reason }
      commit(r.state)
      return { ok: true }
    },
    discardFocus(id) {
      commit(discardSession(getSnapshot().state, id, new Date().toISOString()))
    },
    setHabitSource(habitId, source) {
      const s = getSnapshot()
      commit(setHabitSource(s.state, habitId, source, s.today))
    },
    clockNow: () => Date.now(),
    // ── Mind & Energy (M3.3): the same reducers the account replays over server state ──
    setCheckin(date, phase, values) {
      const s = getSnapshot()
      const r = setCheckin(s.state, { date, phase, values, at: new Date().toISOString(), today: s.today })
      if (!r.ok) return { ok: false, reason: r.reason }
      commit(r.state)
      return { ok: true }
    },
    setCheckinConfig(config) {
      const r = setCheckinConfig(getSnapshot().state, config)
      if (!r.ok) return { ok: false, reason: r.reason }
      commit(r.state)
      return { ok: true }
    },
    // ── Life Review (M3.4d): the same reducers as the account; closes at once (nothing to sync) ──
    saveReview(kind, periodStart, fields) {
      const s = getSnapshot()
      const period = periodFromStart(kind, periodStart)
      if (!period) return { ok: false, reason: "invalid_period" }
      if (!isAvailable(period, s.today)) return { ok: false, reason: "not_available" }
      const key = reviewKey(kind, periodStart)
      if (s.state.reviews[key]?.status === "closed") return { ok: false, reason: "closed" }
      const reviews = applySave(s.state.reviews, kind, periodStart, fields, new Date().toISOString())
      if (!reviews[key] || !validateContent(reviews[key]).ok) return { ok: false, reason: "invalid" }
      commit({ ...s.state, reviews })
      return { ok: true }
    },
    closeReview(kind, periodStart) {
      const s = getSnapshot()
      const key = reviewKey(kind, periodStart)
      const review = s.state.reviews[key]
      const at = new Date().toISOString()
      const gate = closeGate(review ?? { kind, periodStart, status: "draft", content: {}, decisions: [], evaluations: [] }, s.today, {
        online: true,
        pending: 0,
        lastPullAt: Date.now(),
        now: Date.now(),
        conflicts: 0,
        serverSupports: true,
      })
      if (gate.action === "blocked") return { ok: false, reason: gate.reason }
      const snapshot = buildReviewSnapshot({ state: s.state, kind, periodStart, today: s.today, computedAt: at })
      commit({ ...s.state, reviews: applyCloseOp(s.state.reviews, kind, periodStart, snapshot) })
      return { ok: true, deferred: false }
    },
    cancelReviewClose: () => false,
    deleteReview(kind, periodStart, confirm) {
      if (confirm !== "delete") return { ok: false, reason: "confirmation_required" }
      const s = getSnapshot()
      commit({ ...s.state, reviews: applyDelete(s.state.reviews, kind, periodStart) })
      return { ok: true }
    },
    resolveReviewText: () => false,
    reviewSyncState: () => "local",
    addDiscoveryTopic(input) {
      const v = validateOwnTopic(input)
      if (!v.ok) return v
      const s = getSnapshot()
      const id = uuidv4()
      commit({ ...s.state, discovery: addOwnTopic(s.state.discovery, { id, title: v.title, category: v.category, body: v.body, sourceTitle: v.sourceTitle, sourceUrl: v.sourceUrl, at: new Date().toISOString() }) })
      return { ok: true, id }
    },
    removeDiscoveryTopic(id) {
      const s = getSnapshot()
      commit({ ...s.state, discovery: removeOwnTopic(s.state.discovery, id) })
    },
    setTopicFeedback(topicKey, fields) {
      const s = getSnapshot()
      commit({ ...s.state, discovery: applyFeedback(s.state.discovery, topicKey, fields, s.today, new Date().toISOString()) })
    },
    addRecallCard(input) {
      const text = validateCardText(input.question, input.answer)
      if (!text.ok) return text
      const s = getSnapshot()
      const id = uuidv4()
      commit({ ...s.state, recall: addCard(s.state.recall, { id, question: text.question, answer: text.answer, sourceType: input.sourceNoteId ? "note" : null, sourceId: input.sourceNoteId, today: s.today, at: new Date().toISOString() }) })
      return { ok: true, id }
    },
    answerRecallCard(cardId, grade) {
      const s = getSnapshot()
      const card = s.state.recall.cards[cardId]
      if (!card) return false
      commit({ ...s.state, recall: recordAnswer(s.state.recall, answerOutcome(card, { attemptId: uuidv4(), grade, respondedAt: new Date().toISOString(), today: s.today })) })
      return true
    },
    suspendRecallCard(cardId, suspended) {
      const s = getSnapshot()
      commit({ ...s.state, recall: setSuspended(s.state.recall, cardId, suspended ? s.today : null) })
    },
    deleteRecallCard(cardId) {
      const s = getSnapshot()
      commit({ ...s.state, recall: removeCard(s.state.recall, cardId) })
    },
    resetDemo() {
      const s = getSnapshot()
      commit(createDemoState(s.today, s.state.timezone))
      demoLib.reset()
    },
    exportJson() {
      return JSON.stringify(getSnapshot().state, null, 2)
    },
  },
}

/** True when this browser holds demo data (for import / cleanup prompts in account mode). */
export function useHasDemoData(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("storage", cb)
      return () => window.removeEventListener("storage", cb)
    },
    () => {
      try {
        return window.localStorage.getItem(STORAGE_KEY) !== null
      } catch {
        return false
      }
    },
    () => false
  )
}
