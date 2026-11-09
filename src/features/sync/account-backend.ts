"use client"

import type { SupabaseClient } from "@supabase/supabase-js"
import { setEntry, type HabitInput } from "@/features/habits/domain/ops"
import { addGoalLogEntry, cleanLogText, setCheckpointDone, setMeasurement, validateGoal } from "@/features/goals/domain/ops"
import { cleanText, editSession, finishSession, pauseSession, resumeSession, startSession } from "@/features/focus/domain/ops"
import { ACTUAL_OUTPUT_MAX, PLANNED_OUTPUT_MAX, PROJECT_MAX } from "@/features/focus/domain/types"
import { goalToWire } from "./domain/goal-wire"
import { valuesToWire } from "./domain/checkin-wire"
import { setCheckin, setCheckinConfig } from "@/features/mind/domain/ops"
import { sameRule } from "@/features/habits/domain/schedule"
import type { Backend, HabitsSnapshot } from "@/features/habits/store/types"
import { uuidv4 } from "@/lib/ids"
import { SyncEngine } from "./engine"
import { clearUserCache, deviceId, idbStorage, tabLock } from "./idb-storage"
import { idbLibraryStore, memoryLibraryStore } from "./library-store"
import { accountLibrary } from "@/features/library/store/account-library"
import { supabaseTransport } from "./supabase-transport"
import type { Op } from "./domain/types"
import type { ReviewField } from "@/features/reviews/domain/types"

const POLL_MS = 30_000
/** Faster polling while realtime is not confirmed healthy. */
const DEGRADED_POLL_MS = 10_000
/** Realtime events of the library are grouped for this long before one pull (M4c). */
const LIBRARY_DEBOUNCE_MS = 1_500

export interface AccountBackend extends Backend {
  userId: string
  engine: SyncEngine
}

/**
 * Signed-in data source: server-authoritative state with a durable local cache,
 * optimistic writes through an idempotent operation queue, realtime
 * invalidation and polling while the app is visible.
 */
export function createAccountBackend(sb: SupabaseClient, user: { id: string; email: string | null }): AccountBackend {
  // The Library's device copy lives in its own database, one entry per row (N1, D72).
  const library = typeof indexedDB !== "undefined" ? idbLibraryStore(user.id) : memoryLibraryStore()
  const engine = new SyncEngine({
    transport: supabaseTransport(sb),
    storage: idbStorage(user.id),
    deviceId: deviceId(uuidv4),
    lock: tabLock(`the-one-percent:sync:${user.id}`),
    library,
  })

  let snapshot: HabitsSnapshot | null = null
  let lastEngineSnap: ReturnType<SyncEngine["getSnapshot"]> | null = null

  function getSnapshot(): HabitsSnapshot | null {
    const e = engine.getSnapshot()
    if (!e.ready) return null
    if (e !== lastEngineSnap) {
      lastEngineSnap = e
      snapshot = {
        state: e.state,
        today: e.today,
        persisted: e.persisted,
        source: "account",
        sync: {
          status: e.status,
          pending: e.pending,
          lastSyncedAt: e.lastSyncedAt,
          lastError: e.lastError,
          notices: e.notices,
          closeIntents: e.closeIntents,
          pendingReviews: e.pendingReviews,
        },
        account: { userId: user.id, email: user.email },
        goals: e.goals,
        focus: e.focus,
        checkins: e.checkins,
        reviews: e.reviews,
      }
    }
    return snapshot
  }

  const submit = (op: Op) => engine.submit(op)
  const now = () => new Date().toISOString()

  function view() {
    return engine.getSnapshot()
  }

  function updateOp(id: string, input: HabitInput): Op | null {
    const { state, today } = view()
    const current = state.habits.find((h) => h.id === id)
    if (!current) return null
    const currentRule = current.schedule[current.schedule.length - 1].rule
    return {
      type: "habit.update",
      op_id: uuidv4(),
      habit_id: id,
      base_version: engine.habitVersion(id),
      patch: {
        title: input.name.trim(),
        icon: input.icon,
        dimension: input.dimensionId,
        ...(current.type !== "binary"
          ? { unit: input.unit ?? null, target_value: input.target ?? null, target_direction: input.direction ?? "at_least" }
          : {}),
      },
      ...(sameRule(currentRule, input.rule) ? {} : { schedule: { effective_from: today, rule: input.rule } }),
    }
  }

  // ── wiring: realtime, connectivity, visibility, polling ────────────────
  const onWake = () => void engine.sync()
  const onVisibility = () => {
    if (document.visibilityState === "visible") void engine.sync()
  }
  let debounce: ReturnType<typeof setTimeout> | null = null
  const onRemoteChange = () => {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => void engine.sync(), 250)
  }
  // One library write can touch many rows (a content with its notes and links): their events are
  // grouped into one pull, and the pull only pages if the library head moved (M4c).
  let libraryDebounce: ReturnType<typeof setTimeout> | null = null
  const onLibraryChange = () => {
    if (libraryDebounce) clearTimeout(libraryDebounce)
    libraryDebounce = setTimeout(() => void engine.sync(), LIBRARY_DEBOUNCE_MS)
  }
  // Realtime is only an invalidation signal. Changes committed between the initial pull and
  // the moment the subscription is live would otherwise wait for the next poll, so every
  // (re)subscription triggers a catch-up pull. Failed channels are retried with backoff.
  let realtimeHealthy = false
  let disposed = false
  let channel: ReturnType<typeof sb.channel> | null = null
  let resubscribe: ReturnType<typeof setTimeout> | null = null
  let attempts = 0
  const subscribe = () => {
    if (disposed) return
    channel = sb
      .channel(`sync:${user.id}:${attempts}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "habit_entries", filter: `user_id=eq.${user.id}` }, onRemoteChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "habits", filter: `user_id=eq.${user.id}` }, onRemoteChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "routine_calendar", filter: `user_id=eq.${user.id}` }, onRemoteChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles", filter: `id=eq.${user.id}` }, onRemoteChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "goals", filter: `user_id=eq.${user.id}` }, onRemoteChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "goal_measurements", filter: `user_id=eq.${user.id}` }, onRemoteChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "focus_sessions", filter: `user_id=eq.${user.id}` }, onRemoteChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_checkins", filter: `user_id=eq.${user.id}` }, onRemoteChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "reviews", filter: `user_id=eq.${user.id}` }, onRemoteChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "library_items", filter: `user_id=eq.${user.id}` }, onLibraryChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "knowledge_notes", filter: `user_id=eq.${user.id}` }, onLibraryChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "podcast_shows", filter: `user_id=eq.${user.id}` }, onLibraryChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "knowledge_links", filter: `user_id=eq.${user.id}` }, onLibraryChange)
      .subscribe((status) => {
        if (disposed) return
        if (status === "SUBSCRIBED") {
          realtimeHealthy = true
          attempts = 0
          void engine.sync()
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          realtimeHealthy = false
          const ch = channel
          channel = null
          if (ch) void sb.removeChannel(ch)
          const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempts++, 5))
          if (resubscribe) clearTimeout(resubscribe)
          resubscribe = setTimeout(subscribe, delay)
        }
      })
  }
  subscribe()
  window.addEventListener("online", onWake)
  window.addEventListener("focus", onWake)
  document.addEventListener("visibilitychange", onVisibility)
  let lastPoll = Date.now()
  const poll = setInterval(() => {
    const every = realtimeHealthy ? POLL_MS : DEGRADED_POLL_MS
    if (document.visibilityState === "visible" && Date.now() - lastPoll >= every) {
      lastPoll = Date.now()
      void engine.sync()
    }
  }, DEGRADED_POLL_MS / 2)
  void engine.start()

  return {
    source: "account",
    userId: user.id,
    engine,
    library: accountLibrary(engine),
    subscribe: (l) => engine.subscribe(l),
    getSnapshot,
    dispose() {
      clearInterval(poll)
      if (debounce) clearTimeout(debounce)
      if (libraryDebounce) clearTimeout(libraryDebounce)
      window.removeEventListener("online", onWake)
      window.removeEventListener("focus", onWake)
      document.removeEventListener("visibilitychange", onVisibility)
      disposed = true
      if (resubscribe) clearTimeout(resubscribe)
      if (channel) void sb.removeChannel(channel)
      engine.stop()
    },
    actions: {
      setEntry(habitId, date, value) {
        const { state, today } = view()
        // Validate against the optimistic view so the UI gets an immediate, honest answer.
        const opId = uuidv4()
        const at = engine.clientTime()
        const result = setEntry(state, { habitId, date, value, opId, now: at, today })
        if (result.ok && result.state !== state) {
          submit({
            type: "entry.set",
            op_id: opId,
            habit_id: habitId,
            local_date: date,
            value: value === false ? null : value,
            client_updated_at: at,
            base_seq: engine.rowSeq("entry", habitId, date),
          })
        }
        return result
      },
      addHabit(input) {
        const { today } = view()
        const id = uuidv4()
        submit({
          type: "habit.create",
          op_id: uuidv4(),
          habit: {
            id,
            title: input.name.trim(),
            icon: input.icon,
            dimension: input.dimensionId,
            habit_type: input.type,
            unit: input.type === "binary" ? null : (input.unit ?? null),
            target_value: input.type === "binary" ? null : (input.target ?? null),
            target_direction: input.type === "binary" ? null : (input.direction ?? "at_least"),
            start_date: today,
          },
          versions: [{ valid_from: today, rule: input.rule }],
        })
        return id
      },
      updateHabit(id, input) {
        const op = updateOp(id, input)
        if (op) submit(op)
      },
      archiveHabit(id) {
        submit({ type: "habit.archive", op_id: uuidv4(), habit_id: id, archived_on: view().today })
      },
      restoreHabit(id) {
        submit({ type: "habit.restore", op_id: uuidv4(), habit_id: id })
      },
      setRestDay(date, rest) {
        submit({
          type: "rest_day.set",
          op_id: uuidv4(),
          local_date: date,
          rest,
          client_updated_at: engine.clientTime(),
          base_seq: engine.rowSeq("rest", date),
        })
      },
      // ── Goals (M3.1): same queue, same optimistic reducers as the demo ──
      addGoal(input) {
        const id = uuidv4()
        if (Object.keys(validateGoal(input, view().state)).length) return id
        const w = goalToWire(input)
        submit({ type: "goal.create", op_id: uuidv4(), goal: { ...w.goal, id }, habits: w.habits, checkpoints: w.checkpoints })
        return id
      },
      updateGoal(id, input) {
        if (Object.keys(validateGoal(input, view().state, id)).length) return
        const w = goalToWire(input)
        submit({ type: "goal.update", op_id: uuidv4(), goal_id: id, base_version: engine.goalVersion(id), goal: w.goal, habits: w.habits, checkpoints: w.checkpoints })
      },
      setGoalState(id, state) {
        submit({ type: "goal.set_state", op_id: uuidv4(), goal_id: id, state, on: view().today })
      },
      archiveGoal(id) {
        submit({ type: "goal.archive", op_id: uuidv4(), goal_id: id, archived_on: view().today })
      },
      addGoalLog(goalId, kind, text) {
        const entry = { id: uuidv4(), kind, text: cleanLogText(text), on: view().today }
        if (addGoalLogEntry(view().state, goalId, entry) !== view().state) submit({ type: "goal.log_add", op_id: uuidv4(), goal_id: goalId, entry })
      },
      removeGoalLog(goalId, entryId) {
        submit({ type: "goal.log_remove", op_id: uuidv4(), goal_id: goalId, entry_id: entryId })
      },
      setGoalReview(id, review) {
        submit({ type: "goal.set_review", op_id: uuidv4(), goal_id: id, review_since: review ? view().today : null })
      },
      restoreGoal(id) {
        submit({ type: "goal.restore", op_id: uuidv4(), goal_id: id })
      },
      setMeasurement(goalId, date, value, note) {
        const { state, today } = view()
        const opId = uuidv4()
        const at = engine.clientTime()
        const result = setMeasurement(state, { goalId, date, value, note, opId, now: at, today })
        if (result.ok && result.state !== state) {
          submit({
            type: "goal.measure",
            op_id: opId,
            goal_id: goalId,
            observed_on: date,
            value,
            note: note?.trim() || null,
            client_updated_at: at,
            base_seq: engine.rowSeq("measurement", goalId, date),
          })
        }
        return result
      },
      setCheckpoint(goalId, checkpointId, doneOn) {
        const { state, today } = view()
        if (setCheckpointDone(state, goalId, checkpointId, doneOn, today) === state) return
        submit({ type: "goal.checkpoint.set", op_id: uuidv4(), goal_id: goalId, checkpoint_id: checkpointId, done_on: doneOn })
      },
      // ── Focus (M3.2): validated on the optimistic view, then queued like everything else ──
      startFocus(input) {
        const id = uuidv4()
        const at = engine.clientTime()
        const session = {
          id,
          habit_id: input.habitId,
          project: cleanText(input.project, PROJECT_MAX),
          planned_output: cleanText(input.plannedOutput, PLANNED_OUTPUT_MAX),
          planned_minutes: input.plannedMinutes,
          started_at: at,
        }
        const r = startSession(view().state, { id, habitId: session.habit_id, project: session.project, plannedOutput: session.planned_output, plannedMinutes: session.planned_minutes, at })
        if (!r.ok) return { ok: false, reason: r.reason }
        submit({ type: "focus.start", op_id: uuidv4(), session })
        return { ok: true, id }
      },
      pauseFocus(id) {
        const at = engine.clientTime()
        const r = pauseSession(view().state, id, at)
        if (r.ok && r.state !== view().state) submit({ type: "focus.pause", op_id: uuidv4(), session_id: id, at })
      },
      resumeFocus(id) {
        const at = engine.clientTime()
        const r = resumeSession(view().state, id, at)
        if (r.ok && r.state !== view().state) submit({ type: "focus.resume", op_id: uuidv4(), session_id: id, at })
      },
      finishFocus(id, input) {
        const at = engine.clientTime()
        const actual = cleanText(input.actualOutput, ACTUAL_OUTPUT_MAX)
        const r = finishSession(view().state, id, { at, trimTo: input.trimTo, actualOutput: actual, rating: input.rating })
        if (!r.ok) return { ok: false, reason: r.reason }
        submit({ type: "focus.finish", op_id: uuidv4(), session_id: id, at, trim_to: input.trimTo ?? null, actual_output: actual, rating: input.rating ?? null })
        return { ok: true }
      },
      editFocus(id, input) {
        const at = engine.clientTime()
        const r = editSession(view().state, id, input, at)
        if (!r.ok) return { ok: false, reason: r.reason }
        submit({
          type: "focus.edit",
          op_id: uuidv4(),
          session_id: id,
          base_version: engine.focusVersion(id),
          segments: input.segments,
          habit_id: input.habitId,
          project: cleanText(input.project, PROJECT_MAX),
          planned_output: cleanText(input.plannedOutput, PLANNED_OUTPUT_MAX),
          actual_output: cleanText(input.actualOutput, ACTUAL_OUTPUT_MAX),
          rating: input.rating,
          at,
        })
        return { ok: true }
      },
      discardFocus(id) {
        submit({ type: "focus.discard", op_id: uuidv4(), session_id: id })
      },
      setHabitSource(habitId, source) {
        submit({ type: "habit.set_source", op_id: uuidv4(), habit_id: habitId, source, from: view().today })
      },
      clockNow: () => engine.serverNow(),
      // ── Mind & Energy (M3.3): one op per change, validated on the optimistic view ──
      setCheckin(date, phase, values) {
        const { state, today } = view()
        const at = engine.clientTime()
        const r = setCheckin(state, { date, phase, values, at, today })
        if (!r.ok) return { ok: false, reason: r.reason }
        if (r.state === state) return { ok: true }
        const clean = "note" in values ? { ...values, note: r.state.checkins[`${date}:${phase}`]?.note ?? null } : values
        submit({
          type: "checkin.set",
          op_id: uuidv4(),
          local_date: date,
          phase,
          fields: valuesToWire(clean),
          at,
          base_note_seq: "note" in values ? engine.checkinNoteSeq(date, phase) : null,
        })
        return { ok: true }
      },
      setCheckinConfig(config) {
        const r = setCheckinConfig(view().state, config)
        if (!r.ok) return { ok: false, reason: r.reason }
        if (r.state !== view().state) submit({ type: "profile.checkin_fields", op_id: uuidv4(), am: r.state.checkinConfig.am, pm: r.state.checkinConfig.pm })
        return { ok: true }
      },
      // ── Life Review (M3.4c): sections are desired states; conflicts and closes are durable ──
      saveReview(kind, periodStart, fields) {
        return engine.saveReview(kind, periodStart, fields)
      },
      closeReview(kind, periodStart) {
        return engine.requestClose(kind, periodStart)
      },
      cancelReviewClose(kind, periodStart) {
        return engine.cancelClose(kind, periodStart)
      },
      deleteReview(kind, periodStart, confirm) {
        return engine.deleteReview(kind, periodStart, confirm)
      },
      resolveReviewText(noticeId, field, choice) {
        return engine.resolveReviewText(noticeId, field, choice)
      },
      reviewSyncState(kind, periodStart) {
        return engine.reviewSyncState(kind, periodStart)
      },
      setTimezone(timezone) {
        submit({ type: "profile.update", op_id: uuidv4(), timezone })
      },
      exportJson() {
        return JSON.stringify({ exportedAt: now(), account: user.email, data: view().state }, null, 2)
      },
      async clearLocalCopy() {
        // Stop first so nothing re-persists the cache after it is deleted.
        engine.stop()
        await clearUserCache(user.id)
        await library.clear()
      },
      diagnostics() {
        return engine.diagnostics()
      },
      submitOps(ops) {
        for (const op of ops) submit(op)
      },
      syncNow() {
        void engine.sync({ full: true })
      },
      dismissNotice(id) {
        engine.dismissNotice(id)
      },
      reapplyNotice(id) {
        const notice = view().notices.find((n) => n.id === id)
        if (notice?.op?.type === "review.save") {
          // «Aplicar la mía» for every kept section (only a conflict; a closed review cannot change).
          for (const field of Object.keys(notice.op.fields) as ReviewField[]) engine.resolveReviewText(id, field, "mine")
          return
        }
        engine.dismissNotice(id)
        if (notice?.op?.type === "habit.update") {
          // Re-base the user's edit on the current server version.
          submit({ ...notice.op, op_id: uuidv4(), base_version: engine.habitVersion(notice.op.habit_id) })
        } else if (notice?.op?.type === "goal.update") {
          submit({ ...notice.op, op_id: uuidv4(), base_version: engine.goalVersion(notice.op.goal_id) })
        } else if (notice?.op?.type === "checkin.set") {
          // «Aplicar el mío»: the user chose their reflection over the one written meanwhile.
          const op = notice.op
          submit({ ...op, op_id: uuidv4(), at: engine.clientTime(), base_note_seq: engine.checkinNoteSeq(op.local_date, op.phase) })
        } else if (notice?.op?.type === "focus.edit") {
          submit({ ...notice.op, op_id: uuidv4(), base_version: engine.focusVersion(notice.op.session_id), at: engine.clientTime() })
        }
      },
    },
  }
}
