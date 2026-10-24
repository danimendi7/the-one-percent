"use client"

import type { SupabaseClient } from "@supabase/supabase-js"
import { setEntry, type HabitInput } from "@/features/habits/domain/ops"
import { sameRule } from "@/features/habits/domain/schedule"
import type { Backend, HabitsSnapshot } from "@/features/habits/store/types"
import { uuidv4 } from "@/lib/ids"
import { SyncEngine } from "./engine"
import { deviceId, idbStorage } from "./idb-storage"
import { supabaseTransport } from "./supabase-transport"
import type { Op } from "./domain/types"

const POLL_MS = 30_000

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
  const engine = new SyncEngine({
    transport: supabaseTransport(sb),
    storage: idbStorage(user.id),
    deviceId: deviceId(uuidv4),
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
        sync: { status: e.status, pending: e.pending, lastSyncedAt: e.lastSyncedAt, lastError: e.lastError, notices: e.notices },
        account: { userId: user.id, email: user.email },
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
  const channel = sb
    .channel(`sync:${user.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "habit_entries", filter: `user_id=eq.${user.id}` }, onRemoteChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "habits", filter: `user_id=eq.${user.id}` }, onRemoteChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "routine_calendar", filter: `user_id=eq.${user.id}` }, onRemoteChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "profiles", filter: `id=eq.${user.id}` }, onRemoteChange)
    .subscribe()
  window.addEventListener("online", onWake)
  window.addEventListener("focus", onWake)
  document.addEventListener("visibilitychange", onVisibility)
  const poll = setInterval(() => {
    if (document.visibilityState === "visible") void engine.sync()
  }, POLL_MS)
  void engine.start()

  return {
    source: "account",
    userId: user.id,
    engine,
    subscribe: (l) => engine.subscribe(l),
    getSnapshot,
    dispose() {
      clearInterval(poll)
      if (debounce) clearTimeout(debounce)
      window.removeEventListener("online", onWake)
      window.removeEventListener("focus", onWake)
      document.removeEventListener("visibilitychange", onVisibility)
      void sb.removeChannel(channel)
      engine.stop()
    },
    actions: {
      setEntry(habitId, date, value) {
        const { state, today } = view()
        // Validate against the optimistic view so the UI gets an immediate, honest answer.
        const opId = uuidv4()
        const at = now()
        const result = setEntry(state, { habitId, date, value, opId, now: at, today })
        if (result.ok && result.state !== state) {
          submit({ type: "entry.set", op_id: opId, habit_id: habitId, local_date: date, value: value === false ? null : value, client_updated_at: at })
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
        submit({ type: "rest_day.set", op_id: uuidv4(), local_date: date, rest, client_updated_at: now() })
      },
      setTimezone(timezone) {
        submit({ type: "profile.update", op_id: uuidv4(), timezone })
      },
      exportJson() {
        return JSON.stringify({ exportedAt: now(), account: user.email, data: view().state }, null, 2)
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
        engine.dismissNotice(id)
        if (notice?.op?.type === "habit.update") {
          // Re-base the user's edit on the current server version.
          submit({ ...notice.op, op_id: uuidv4(), base_version: engine.habitVersion(notice.op.habit_id) })
        }
      },
    },
  }
}
