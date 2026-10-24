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
import type { Op, OpResult, PullPayload, WireEntry, WireHabit } from "../domain/types"

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
  /** Count of times each op_id was actually applied (never > 1). */
  applied = new Map<string, number>()

  constructor(today: LocalDate) {
    this.today = today
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
    }
  }

  private applyOne(op: Op): OpResult {
    const reject = (code: string): OpResult => ({ op_id: op.op_id, status: "rejected", code })
    switch (op.type) {
      case "entry.set": {
        const k = entryKey(op.habit_id, op.local_date)
        const existing = this.entries.get(k)
        if (existing && existing.data.client_updated_at > op.client_updated_at) return { op_id: op.op_id, status: "superseded" }
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
            client_updated_at: op.client_updated_at,
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
        if (existing && existing.data.client_updated_at > op.client_updated_at) return { op_id: op.op_id, status: "superseded" }
        this.rest.set(op.local_date, {
          seq: this.next(),
          data: { local_date: op.local_date, rest: op.rest, client_updated_at: op.client_updated_at },
        })
        return { op_id: op.op_id, status: "applied" }
      }
      case "profile.update":
        this.timezone = op.timezone
        return { op_id: op.op_id, status: "applied" }
    }
  }

  applyOps(ops: Op[]): { results: OpResult[]; server_today: LocalDate } {
    const results = ops.map((op) => {
      const prev = this.ledger.get(op.op_id)
      if (prev) return { op_id: op.op_id, status: "duplicate" as const, outcome: prev.status as never, code: prev.code }
      const r = this.applyOne(op)
      this.ledger.set(op.op_id, r)
      if (r.status === "applied") this.applied.set(op.op_id, (this.applied.get(op.op_id) ?? 0) + 1)
      return r
    })
    return { results, server_today: this.today }
  }

  pull(since: number): PullPayload {
    const full = since <= 0
    const pick = <T>(m: Map<string, Row<T>>) => [...m.values()].filter((r) => r.seq > since)
    return {
      server_today: this.today,
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
