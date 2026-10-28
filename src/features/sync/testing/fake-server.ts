/**
 * In-memory stand-in for the Supabase RPCs, mirroring public.apply_ops /
 * public.pull_changes semantics (ledger idempotency, LWW entries, habit
 * version conflicts, tombstones, change cursor). Used by engine tests;
 * parity with the real SQL is covered by the integration suite.
 */
import { isEligibleDay } from "@/features/habits/domain/schedule"
import { entryKey, type HabitsState } from "@/features/habits/domain/types"
import type { LocalDate } from "@/features/habits/domain/dates"
import { NetworkError, type SyncTransport } from "../engine"
import { applyOp } from "../domain/rebase"
import type { Op, OpResult, PullPayload, WireEntry, WireHabit, WireMeasurement } from "../domain/types"
import { goalToWireRow } from "../domain/goal-wire"
import { setMeasurement } from "@/features/goals/domain/ops"
import { measurementKey, type Goal } from "@/features/goals/domain/types"

interface Row<T> {
  data: T
  seq: number
}

export class FakeServer {
  today: LocalDate
  private seq = 0
  private ledger = new Map<string, OpResult>()
  private habits = new Map<string, Row<WireHabit>>()
  private entries = new Map<string, Row<WireEntry>>()
  private rest = new Map<string, Row<{ local_date: LocalDate; rest: boolean; client_updated_at: string }>>()
  private timezone = "Europe/Madrid"
  private goals = new Map<string, Row<Goal>>()
  private measures = new Map<string, Row<WireMeasurement>>()
  /** Count of times each op_id was actually applied (never > 1). */
  applied = new Map<string, number>()

  /** Server clock (ms). Independent from device clocks in tests. */
  serverNow: () => number

  constructor(today: LocalDate, serverNow: () => number = Date.now) {
    this.today = today
    this.serverNow = serverNow
  }

  /** Mirrors the SQL: clamp future device times; sequential edits (base_seq current) win. */
  private resolve(
    existing: { seq: number; data: { client_updated_at: string } } | undefined,
    clientTime: string,
    baseSeq: number | null
  ): { win: boolean; time: string } {
    let t = Math.min(Date.parse(clientTime), this.serverNow() + 60_000)
    if (!existing) return { win: true, time: new Date(t).toISOString() }
    const stored = Date.parse(existing.data.client_updated_at)
    if (baseSeq !== null && existing.seq <= baseSeq) {
      t = Math.max(t, stored + 1)
      return { win: true, time: new Date(t).toISOString() }
    }
    return { win: stored <= t, time: new Date(t).toISOString() }
  }

  private next() {
    return ++this.seq
  }

  private state(): HabitsState {
    const entries: HabitsState["entries"] = {}
    for (const { data: e } of this.entries.values()) {
      if (!e.deleted)
        entries[entryKey(e.habit_id, e.local_date)] = {
          habitId: e.habit_id,
          date: e.local_date,
          value: e.value_bool ?? Number(e.value_numeric),
          opId: e.client_op_id,
          updatedAt: e.client_updated_at,
        }
    }
    return {
      version: 1,
      timezone: this.timezone,
      dimensions: [],
      habits: [...this.habits.values()].map(({ data: w }) => ({
        id: w.id,
        name: w.title,
        icon: w.icon,
        dimensionId: w.dimension,
        type: w.habit_type,
        unit: w.unit ?? undefined,
        target: w.target_value ?? undefined,
        direction: w.target_direction ?? undefined,
        schedule: w.versions.map((v) => ({
          validFrom: v.valid_from,
          rule:
            v.kind === "daily"
              ? { kind: "daily" as const }
              : v.kind === "weekdays"
                ? { kind: "weekdays" as const, weekdays: (v.weekdays ?? []) as never }
                : { kind: "weekly_count" as const, timesPerWeek: v.target_count ?? 1 },
        })),
        startDate: w.start_date,
        archivedOn: w.archived_on,
        createdAt: w.created_at,
      })),
      entries,
      restDays: [...this.rest.values()].filter((r) => r.data.rest).map((r) => r.data.local_date),
      seededOn: this.today,
      goals: [...this.goals.values()].map((r) => r.data),
      measurements: Object.fromEntries(
        [...this.measures.values()]
          .filter((r) => !r.data.deleted)
          .map(({ data: m }) => [
            measurementKey(m.goal_id, m.observed_on),
            { goalId: m.goal_id, date: m.observed_on, value: Number(m.value), note: m.note, opId: m.client_op_id, updatedAt: m.client_updated_at },
          ])
      ),
      focusSessions: [],
    }
  }

  private applyOne(op: Op): OpResult {
    const reject = (code: string): OpResult => ({ op_id: op.op_id, status: "rejected", code })
    switch (op.type) {
      case "entry.set": {
        const k = entryKey(op.habit_id, op.local_date)
        const existing = this.entries.get(k)
        const decision = this.resolve(existing, op.client_updated_at, op.base_seq)
        if (!decision.win) return { op_id: op.op_id, status: "superseded" }
        const habit = this.habits.get(op.habit_id)
        if (!habit) return reject("habit_not_found")
        if (op.local_date > this.today) return reject("future_date")
        const clearing = op.value === null || op.value === false
        if (!clearing) {
          const s = this.state()
          const h = s.habits.find((x) => x.id === op.habit_id)!
          if (!isEligibleDay(h, op.local_date)) return reject("not_eligible")
          if (s.restDays.includes(op.local_date)) return reject("rest_day")
        }
        this.entries.set(k, {
          seq: this.next(),
          data: {
            habit_id: op.habit_id,
            local_date: op.local_date,
            value_bool: typeof op.value === "boolean" ? op.value : null,
            value_numeric: typeof op.value === "number" ? op.value : null,
            deleted: clearing,
            client_op_id: op.op_id,
            client_updated_at: decision.time,
            server_seq: 0,
          },
        })
        return { op_id: op.op_id, status: "applied" }
      }
      case "habit.create": {
        if (this.habits.has(op.habit.id)) return { op_id: op.op_id, status: "applied" }
        this.habits.set(op.habit.id, {
          seq: this.next(),
          data: {
            ...op.habit,
            archived_on: null,
            version: 1,
            created_at: new Date().toISOString(),
            server_seq: 0,
            versions: op.versions.map((v) => ({
              valid_from: v.valid_from,
              kind: v.rule.kind,
              weekdays: v.rule.kind === "weekdays" ? [...v.rule.weekdays] : null,
              target_count: v.rule.kind === "weekly_count" ? v.rule.timesPerWeek : null,
            })),
          },
        })
        return { op_id: op.op_id, status: "applied" }
      }
      case "habit.update":
      case "habit.archive":
      case "habit.restore": {
        const row = this.habits.get(op.habit_id)
        if (!row) return reject("habit_not_found")
        if (op.type === "habit.update" && row.data.version !== op.base_version) return { op_id: op.op_id, status: "conflict" }
        const next = applyOp(this.state(), op, this.today).habits.find((h) => h.id === op.habit_id)!
        this.habits.set(op.habit_id, {
          seq: this.next(),
          data: {
            ...row.data,
            title: next.name,
            icon: next.icon,
            dimension: next.dimensionId,
            unit: next.unit ?? null,
            target_value: next.target ?? null,
            target_direction: next.direction ?? null,
            archived_on: next.archivedOn ?? null,
            version: row.data.version + 1,
            versions: next.schedule.map((v) => ({
              valid_from: v.validFrom,
              kind: v.rule.kind,
              weekdays: v.rule.kind === "weekdays" ? [...v.rule.weekdays] : null,
              target_count: v.rule.kind === "weekly_count" ? v.rule.timesPerWeek : null,
            })),
          },
        })
        return { op_id: op.op_id, status: "applied" }
      }
      case "rest_day.set": {
        const existing = this.rest.get(op.local_date)
        const decision = this.resolve(existing, op.client_updated_at, op.base_seq)
        if (!decision.win) return { op_id: op.op_id, status: "superseded" }
        this.rest.set(op.local_date, {
          seq: this.next(),
          data: { local_date: op.local_date, rest: op.rest, client_updated_at: decision.time },
        })
        return { op_id: op.op_id, status: "applied" }
      }
      case "profile.update":
        this.timezone = op.timezone
        return { op_id: op.op_id, status: "applied" }
      case "goal.measure": {
        const k = measurementKey(op.goal_id, op.observed_on)
        const existing = this.measures.get(k)
        const decision = this.resolve(existing, op.client_updated_at, op.base_seq)
        if (!decision.win) return { op_id: op.op_id, status: "superseded" }
        const r = setMeasurement(this.state(), { goalId: op.goal_id, date: op.observed_on, value: op.value, note: op.note, opId: op.op_id, now: decision.time, today: this.today })
        if (!r.ok && op.value !== null) return reject(r.reason)
        this.measures.set(k, {
          seq: this.next(),
          data: { goal_id: op.goal_id, observed_on: op.observed_on, value: op.value, note: op.note, deleted: op.value === null, client_op_id: op.op_id, client_updated_at: decision.time, server_seq: 0 },
        })
        return { op_id: op.op_id, status: "applied" }
      }
      case "goal.create":
      case "goal.update":
      case "goal.set_state":
      case "goal.archive":
      case "goal.restore":
      case "goal.checkpoint.set": {
        const id = op.type === "goal.create" ? op.goal.id : op.goal_id
        const existing = this.goals.get(id)
        if (op.type === "goal.create" && existing) return { op_id: op.op_id, status: "applied" }
        if (op.type !== "goal.create" && !existing) return reject("goal_not_found")
        if (op.type === "goal.update" && existing!.data.version !== op.base_version) return { op_id: op.op_id, status: "conflict" }
        const before = this.state()
        const after = applyOp(before, op, this.today)
        const goal = after.goals.find((g) => g.id === id)
        if (!goal || (after === before && op.type === "goal.create")) return reject("invalid_goal")
        if (after !== before) {
          // Like the SQL: every definition/state change bumps the version.
          const bump = op.type === "goal.set_state" || op.type === "goal.archive" || op.type === "goal.restore"
          this.goals.set(id, { seq: this.next(), data: bump ? { ...goal, version: (existing?.data.version ?? 1) + 1 } : goal })
        }
        return { op_id: op.op_id, status: "applied" }
      }
    }
  }

  applyOps(ops: Op[]): { results: OpResult[]; server_today: LocalDate; server_time: string } {
    const results = ops.map((op) => {
      const prev = this.ledger.get(op.op_id)
      if (prev) return { op_id: op.op_id, status: "duplicate" as const, outcome: prev.status as never, code: prev.code }
      const r = this.applyOne(op)
      this.ledger.set(op.op_id, r)
      if (r.status === "applied") this.applied.set(op.op_id, (this.applied.get(op.op_id) ?? 0) + 1)
      return r
    })
    return { results, server_today: this.today, server_time: new Date(this.serverNow()).toISOString() }
  }

  pull(since: number): PullPayload {
    const full = since <= 0
    const pick = <T>(m: Map<string, Row<T>>) => [...m.values()].filter((r) => r.seq > since)
    return {
      server_today: this.today,
      server_time: new Date(this.serverNow()).toISOString(),
      full,
      profile: { timezone: this.timezone, locale: "es-ES", server_seq: 0 },
      dimensions: [],
      habits: pick(this.habits).map((r) => ({ ...r.data, server_seq: r.seq })),
      entries: pick(this.entries)
        .filter((r) => !full || !r.data.deleted)
        .map((r) => ({ ...r.data, server_seq: r.seq })),
      rest_days: pick(this.rest)
        .filter((r) => !full || r.data.rest)
        .map((r) => ({ ...r.data, server_seq: r.seq })),
      goals: pick(this.goals).map((r) => goalToWireRow(r.data, r.seq)),
      measurements: pick(this.measures)
        .filter((r) => !full || !r.data.deleted)
        .map((r) => ({ ...r.data, server_seq: r.seq })),
      cursor: Math.max(since, this.seq),
    }
  }

  entryCount() {
    return [...this.entries.values()].filter((r) => !r.data.deleted).length
  }
}

/** Transport over a FakeServer with switchable network failures. */
export function fakeTransport(server: FakeServer) {
  const t = {
    online: true,
    /** Apply on the server but drop the response (lost ack). */
    dropNextResponse: false,
    calls: 0,
    async applyOps(_device: string, ops: Op[]) {
      t.calls++
      if (!t.online) throw new NetworkError("offline")
      const res = server.applyOps(structuredClone(ops))
      if (t.dropNextResponse) {
        t.dropNextResponse = false
        throw new NetworkError("response lost")
      }
      return structuredClone(res)
    },
    async pull(since: number) {
      if (!t.online) throw new NetworkError("offline")
      return structuredClone(server.pull(since))
    },
  }
  return t satisfies SyncTransport
}
