/**
 * In-memory stand-in for the Supabase RPCs, mirroring public.apply_ops /
 * public.pull_changes semantics (ledger idempotency, LWW entries, habit
 * version conflicts, tombstones, change cursor). Used by engine tests;
 * parity with the real SQL is covered by the integration suite.
 */
import { normalizeMotivation } from "@/features/notifications/domain/settings"
import { isEligibleDay } from "@/features/habits/domain/schedule"
import { entryKey, type HabitsState } from "@/features/habits/domain/types"
import type { LocalDate } from "@/features/habits/domain/dates"
import { NetworkError, type SyncTransport } from "../engine"
import { applyOp } from "../domain/rebase"
import type { Op, OpResult, PullPayload, WireEntry, WireFocusSession, WireHabit, WireMeasurement } from "../domain/types"
import { goalToWireRow } from "../domain/goal-wire"
import { setMeasurement } from "@/features/goals/domain/ops"
import { measurementKey, type Goal } from "@/features/goals/domain/types"
import { isFocusFed } from "@/features/habits/domain/ops"
import { activeSession, discardSession, editSession, finishSession, pauseSession, resumeSession, setHabitSource, startSession, type FocusResult } from "@/features/focus/domain/ops"
import { activeSeconds } from "@/features/focus/domain/time"
import type { FocusSession } from "@/features/focus/domain/types"
import { cleanNote, normalizeConfig, validateConfig, validValue } from "@/features/mind/domain/ops"
import { addDays } from "@/features/habits/domain/dates"
import { CHECKIN_FIELDS, DEFAULT_CHECKIN_CONFIG, type CheckinConfig } from "@/features/mind/domain/types"
import { toCheckin, WIRE_FIELD } from "../domain/checkin-wire"
import type { WireCheckin, WireDiscoveryTopic, WireRecallAttempt, WireRecallCard, WireReview, WireTopicFeedback, WireExperiment } from "../domain/types"
import { toOwnTopic, toTopicFeedback } from "../domain/discovery-wire"
import { toExperiment } from "../domain/experiment-wire"
import { validateCardText } from "@/features/recall/domain/ops"
import { toRecallAttempt, toRecallCard } from "../domain/recall-wire"
import { toReview } from "../domain/review-wire"
import { periodFromStart, previousPeriod } from "@/features/reviews/domain/periods"
import { contentKeys, validateContent } from "@/features/reviews/domain/content"
import { normalizeSection, sameSection } from "@/features/reviews/domain/sync"
import { reviewKey, type ReviewField } from "@/features/reviews/domain/types"

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
  private sessions = new Map<string, Row<{ session: FocusSession; deleted: boolean }>>()
  /** false: behave like a server without the focus migration (no focus_sessions in pulls). */
  focusSupported = true
  private checkins = new Map<string, Row<WireCheckin>>()
  private checkinConfig: CheckinConfig | null = null
  /** false: behave like a server without the check-ins migration (M3.3). */
  checkinsSupported = true
  private reviews = new Map<string, Row<WireReview>>()
  /** false: behave like a server without the reviews migration (M3.4). */
  reviewsSupported = true
  /** false: behave like a server without the daily reviews migration (C5). */
  dailyReviewsSupported = true
  /** false: behave like a server without the Active Recall migration (D2). */
  recallSupported = true
  private recallCards = new Map<string, Row<WireRecallCard>>()
  private recallAttemptRows = new Map<string, Row<WireRecallAttempt>>()
  /** false: behave like a server without the Daily Discovery migration (D4). */
  discoverySupported = true
  /** false: behave like a server without the experiments migration (E3). */
  experimentsSupported = true
  /** false: behave like a server without the notification settings migration (E6). */
  motivationSupported = true
  private motivationSettings: unknown = null
  private experimentRows = new Map<string, Row<WireExperiment>>()
  private discoveryTopics = new Map<string, Row<WireDiscoveryTopic>>()
  private feedbackRows = new Map<string, Row<WireTopicFeedback> & { stamps: Record<string, number> }>()
  /** Latest change of any data a snapshot is computed from (private.review_data_cursor). */
  private dataSeq = 0
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
    this.dataSeq = ++this.seq
    return this.seq
  }

  /** A review change: it moves the cursor but is not data a snapshot reads. */
  private nextReview() {
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
        activitySource: w.activity_source ?? null,
        activitySourceFrom: w.activity_source_from ?? null,
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
      focusSessions: [...this.sessions.values()].filter((r) => !r.data.deleted).map((r) => r.data.session),
      checkins: Object.fromEntries([...this.checkins].filter(([, r]) => !r.data.deleted).map(([k, r]) => [k, toCheckin({ ...r.data, server_seq: r.seq })])),
      checkinConfig: normalizeConfig(this.checkinConfig ?? DEFAULT_CHECKIN_CONFIG),
      motivation: normalizeMotivation(this.motivationSettings),
      experiments: Object.fromEntries([...this.experimentRows].filter(([, r]) => !r.data.deleted).map(([k, r]) => [k, toExperiment({ ...r.data, server_seq: r.seq })])),
      discovery: {
        topics: Object.fromEntries([...this.discoveryTopics].filter(([, r]) => !r.data.deleted).map(([k, r]) => [k, toOwnTopic({ ...r.data, server_seq: r.seq })])),
        feedback: Object.fromEntries([...this.feedbackRows].map(([k, r]) => [k, toTopicFeedback({ ...r.data, server_seq: r.seq })])),
      },
      recall: {
        cards: Object.fromEntries([...this.recallCards].filter(([, r]) => !r.data.deleted).map(([k, r]) => [k, toRecallCard({ ...r.data, server_seq: r.seq })])),
        attempts: Object.fromEntries([...this.recallAttemptRows].map(([k, r]) => [k, toRecallAttempt({ ...r.data, server_seq: r.seq })])),
      },
      reviews: Object.fromEntries([...this.reviews].filter(([, r]) => !r.data.deleted).map(([k, r]) => [k, toReview({ ...r.data, server_seq: r.seq })])),
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
        if (isFocusFed(this.state().habits.find((h) => h.id === op.habit_id)!, op.local_date)) return reject("derived_entry")
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
        this.next()
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
      case "goal.set_review":
      case "goal.log_add":
      case "goal.log_remove":
      case "goal.book_set":
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
          const bump = op.type === "goal.set_state" || op.type === "goal.archive" || op.type === "goal.restore" || op.type === "goal.set_review"
          this.goals.set(id, { seq: this.next(), data: bump ? { ...goal, version: (existing?.data.version ?? 1) + 1 } : goal })
        }
        return { op_id: op.op_id, status: "applied" }
      }
      case "habit.set_source": {
        const row = this.habits.get(op.habit_id)
        if (!row) return reject("habit_not_found")
        if (op.source && row.data.habit_type !== "duration") return reject("not_duration_habit")
        const after = setHabitSource(this.state(), op.habit_id, op.source, op.from < row.data.start_date ? row.data.start_date : op.from)
        const h = after.habits.find((x) => x.id === op.habit_id)!
        if ((row.data.activity_source ?? null) !== (h.activitySource ?? null))
          this.habits.set(op.habit_id, {
            seq: this.next(),
            data: { ...row.data, activity_source: h.activitySource ?? null, activity_source_from: h.activitySourceFrom ?? null, version: row.data.version + 1 },
          })
        return { op_id: op.op_id, status: "applied" }
      }
      case "focus.start":
      case "focus.pause":
      case "focus.resume":
      case "focus.finish":
      case "focus.edit":
      case "focus.discard":
        return this.applyFocus(op)
      case "checkin.set":
        return this.applyCheckin(op)
      case "profile.checkin_fields":
        if (!validateConfig({ am: op.am, pm: op.pm })) return reject("invalid_config")
        this.checkinConfig = normalizeConfig({ am: op.am, pm: op.pm })
        return { op_id: op.op_id, status: "applied" }
      case "review.save":
      case "review.close":
      case "review.delete":
        if (!this.reviewsSupported) return reject("unknown_op_type")
        if (op.kind === "day" && !this.dailyReviewsSupported) return reject("invalid_period")
        return this.applyReview(op)
      case "profile.motivation":
        if (!this.motivationSupported) return reject("unknown_op_type")
        this.motivationSettings = op.settings
        this.nextReview()
        return { op_id: op.op_id, status: "applied" }
      case "experiment.create":
      case "experiment.close":
      case "experiment.delete":
        return this.experimentsSupported ? this.applyExperiment(op) : reject("unknown_op_type")
      case "discovery.topic.create":
      case "discovery.topic.delete":
      case "discovery.feedback.set":
        return this.discoverySupported ? this.applyDiscovery(op) : reject("unknown_op_type")
      case "recall.create":
      case "recall.answer":
      case "recall.suspend":
      case "recall.delete":
        return this.recallSupported ? this.applyRecall(op) : reject("unknown_op_type")
      default:
        // Like a server without the library migration (M4b): the library is tested against real PostgreSQL.
        return reject("unknown_op_type")
    }
  }

  /** Writes a review row the way the trigger does: new server_seq, section versions of what changed. */
  private writeReview(key: string, next: Omit<WireReview, "field_seqs" | "server_seq" | "version" | "updated_at">, old: Row<WireReview> | undefined) {
    const seq = this.nextReview()
    const live = old && !old.data.deleted ? old.data : undefined
    const seqs: Record<string, number> = { ...(live?.field_seqs ?? {}) }
    for (const k of contentKeys(next.kind)) if ((next.content[k] ?? null) !== (live?.content[k] ?? null)) seqs[`content.${k}`] = seq
    if (JSON.stringify(next.decisions) !== JSON.stringify(live?.decisions ?? [])) seqs.decisions = seq
    if (JSON.stringify(next.evaluations) !== JSON.stringify(live?.evaluations ?? [])) seqs.evaluations = seq
    this.reviews.set(key, {
      seq,
      data: { ...next, field_seqs: next.deleted ? {} : seqs, version: (old?.data.version ?? 0) + 1, updated_at: new Date(this.serverNow()).toISOString(), server_seq: seq },
    })
  }

  /** Mirrors private.review_op (supabase/migrations/*_reviews.sql). */
  private applyReview(op: Extract<Op, { type: "review.save" | "review.close" | "review.delete" }>): OpResult {
    const done = (status: OpResult["status"], code?: string, fields?: string[]): OpResult => ({ op_id: op.op_id, status, ...(code ? { code } : {}), ...(fields ? { fields } : {}) })
    const period = periodFromStart(op.kind, op.period_start)
    if (!period) return done("rejected", "invalid_period")
    if (period.to > this.today) return done("rejected", "not_available")
    const key = reviewKey(op.kind, op.period_start)
    let row = this.reviews.get(key)

    if (op.type === "review.delete") {
      if (op.confirm !== "delete") return done("rejected", "confirmation_required")
      if (!row || row.data.deleted) return done("applied")
      if (op.base_seq !== row.seq) return done("conflict", "review_changed")
      this.writeReview(key, { ...row.data, status: "draft", content: {}, decisions: [], evaluations: [], snapshot: null, metrics_version: null, snapshot_version: null, timezone: null, closed_at: null, deleted: true }, row)
      return done("applied")
    }

    const created = !row
    if (!row) {
      this.writeReview(key, { kind: op.kind, period_start: period.from, period_end: period.to, status: "draft", content: {}, decisions: [], evaluations: [], snapshot: null, metrics_version: null, snapshot_version: null, timezone: null, closed_at: null, deleted: false }, undefined)
      row = this.reviews.get(key)!
    }
    const d = row.data

    if (op.type === "review.save") {
      const allowed = new Set<string>([...contentKeys(op.kind).map((k) => `content.${k}`), "decisions", "evaluations"])
      const keys = Object.keys(op.fields)
      if (keys.length === 0 || keys.some((k) => !allowed.has(k))) return done("rejected", "invalid_value")
      if (d.status === "closed" && !d.deleted) return done("rejected", "review_closed")
      if (d.deleted && Object.values(op.base_seqs).some((b) => b !== null && b !== undefined)) return done("conflict", "review_deleted")
      const content: Record<string, string> = d.deleted ? {} : { ...d.content }
      let decisions = d.deleted ? [] : d.decisions
      let evaluations = d.deleted ? [] : d.evaluations
      const conflicts: string[] = []
      for (const k of keys as ReviewField[]) {
        const val = normalizeSection(k, op.fields[k])
        const cur = k === "decisions" ? decisions : k === "evaluations" ? evaluations : (content[k.slice(8)] ?? null)
        const curSeq = d.deleted ? undefined : d.field_seqs[k]
        if (curSeq !== undefined && curSeq !== (op.base_seqs[k] ?? null) && !sameSection(k, cur, val)) {
          conflicts.push(k)
          continue
        }
        if (k === "decisions") decisions = val as typeof decisions
        else if (k === "evaluations") evaluations = val as typeof evaluations
        else if (val === null) delete content[k.slice(8)]
        else content[k.slice(8)] = val as string
      }
      if (conflicts.length > 0) return done("conflict", "review_field_conflict", conflicts)
      const prevStart = previousPeriod(period).from
      if (!validateContent({ kind: op.kind, content, decisions, evaluations }).ok || evaluations.some((e) => e.from !== prevStart)) return done("rejected", "invalid_value")
      const unknownLink = decisions.some((x) => x.link && !(x.link.type === "habit" ? this.habits.has(x.link.id) : this.goals.has(x.link.id)))
      if (unknownLink) return done("rejected", "invalid_link")
      const same = JSON.stringify(content) === JSON.stringify(d.content) && JSON.stringify(decisions) === JSON.stringify(d.decisions) && JSON.stringify(evaluations) === JSON.stringify(d.evaluations)
      if (!d.deleted && same) return done("applied")
      this.writeReview(key, { ...d, content, decisions, evaluations, deleted: false }, row)
      return done("applied")
    }

    // review.close: first close wins; the review the user saw; data not newer than the snapshot.
    if (d.status === "closed" && !d.deleted) return done("superseded", "already_closed")
    const baseOk = d.deleted ? op.base_seq === null || op.base_seq === row.seq : created ? op.base_seq === null : op.base_seq === row.seq
    if (!baseOk) return done("conflict", "review_changed")
    if (typeof op.based_on_cursor !== "number") return done("rejected", "invalid_value")
    if (this.dataSeq > op.based_on_cursor) return done("conflict", "stale_snapshot")
    const snap = op.snapshot
    if (!snap || snap.v !== 1 || snap.kind !== op.kind || snap.period.from !== period.from || snap.period.to !== period.to || snap.asOf !== period.to) return done("rejected", "invalid_snapshot")
    if (snap.timezone !== this.timezone) return done("conflict", "stale_snapshot")
    this.writeReview(
      key,
      { ...d, status: "closed", snapshot: snap, metrics_version: snap.metricsVersion, snapshot_version: snap.v, timezone: this.timezone, closed_at: new Date(this.serverNow()).toISOString(), deleted: false },
      row
    )
    return done("applied")
  }

  /** Mirrors private.experiment_op (supabase/migrations/*_experiments.sql). */
  private applyExperiment(op: Extract<Op, { type: "experiment.create" | "experiment.close" | "experiment.delete" }>): OpResult {
    const done = (status: OpResult["status"], code?: string): OpResult => ({ op_id: op.op_id, status, ...(code ? { code } : {}) })
    const write = (data: WireExperiment) => this.experimentRows.set(data.id, { seq: this.nextReview(), data })
    if (op.type === "experiment.create") {
      if (!this.experimentRows.has(op.experiment.id)) write({ ...op.experiment, title: op.experiment.title.trim(), status: "active", ended_on: null, note: null, created_at: op.at, deleted: false, server_seq: 0 })
      return done("applied")
    }
    const row = this.experimentRows.get(op.experiment_id)
    if (op.type === "experiment.delete") {
      if (row && !row.data.deleted) write({ ...row.data, title: "", note: null, deleted: true })
      return done("applied")
    }
    if (!row || row.data.deleted) return done("rejected", "experiment_not_found")
    if (row.data.status !== "active") return done("superseded", "already_closed")
    write({ ...row.data, status: op.status, ended_on: op.ended_on, note: op.note?.trim() || null })
    return done("applied")
  }

  motivation(): unknown {
    return this.motivationSettings
  }

  experiment(id: string): WireExperiment | null {
    return this.experimentRows.get(id)?.data ?? null
  }

  /** Mirrors private.discovery_op (supabase/migrations/*_discovery.sql). */
  private applyDiscovery(op: Extract<Op, { type: "discovery.topic.create" | "discovery.topic.delete" | "discovery.feedback.set" }>): OpResult {
    const done = (status: OpResult["status"], code?: string): OpResult => ({ op_id: op.op_id, status, ...(code ? { code } : {}) })
    if (op.type === "discovery.topic.create") {
      if (this.discoveryTopics.has(op.topic.id)) return done("applied")
      this.discoveryTopics.set(op.topic.id, { seq: this.nextReview(), data: { ...op.topic, created_at: op.at, deleted: false, server_seq: 0 } })
      return done("applied")
    }
    if (op.type === "discovery.topic.delete") {
      const row = this.discoveryTopics.get(op.topic_id)
      if (row && !row.data.deleted) this.discoveryTopics.set(op.topic_id, { seq: this.nextReview(), data: { ...row.data, title: "", body: "", source_title: null, source_url: null, deleted: true } })
      return done("applied")
    }
    const at = Date.parse(op.at)
    const row = this.feedbackRows.get(op.topic_key)
    const next: WireTopicFeedback = row ? { ...row.data } : { topic_key: op.topic_key, rating: null, saved: false, dismissed: null, decided_on: op.local_date, updated_at: op.at, server_seq: 0 }
    const stamps = { ...(row?.stamps ?? {}) }
    let changed = !row
    for (const [k, v] of Object.entries(op.fields) as [keyof typeof op.fields, never][]) {
      if ((stamps[k] ?? -Infinity) > at) continue
      next[k] = v
      stamps[k] = at
      changed = true
    }
    if (changed) this.feedbackRows.set(op.topic_key, { seq: this.nextReview(), stamps, data: { ...next, decided_on: op.local_date, updated_at: op.at } })
    return done("applied")
  }

  /** Server-side view of the discovery tables (tests). */
  discoveryTopic(id: string): WireDiscoveryTopic | null {
    return this.discoveryTopics.get(id)?.data ?? null
  }

  topicFeedback(key: string): WireTopicFeedback | null {
    return this.feedbackRows.get(key)?.data ?? null
  }

  /** Mirrors private.recall_op (supabase/migrations/*_recall.sql). */
  private applyRecall(op: Extract<Op, { type: "recall.create" | "recall.answer" | "recall.suspend" | "recall.delete" }>): OpResult {
    const done = (status: OpResult["status"], code?: string): OpResult => ({ op_id: op.op_id, status, ...(code ? { code } : {}) })
    const write = (next: WireRecallCard) => this.recallCards.set(next.id, { data: next, seq: this.nextReview() })
    if (op.type === "recall.create") {
      if (this.recallCards.has(op.card.id)) return done("applied")
      const text = validateCardText(op.card.question, op.card.answer)
      if (!text.ok || op.local_date > this.today) return done("rejected", "invalid_value")
      write({ id: op.card.id, source_type: op.card.source_type, source_id: op.card.source_id, question: text.question, answer: text.answer, state: "new", reps: 0, lapses: 0, ease_factor: 2.5, interval_days: 0, due_on: op.local_date, algorithm_version: op.algorithm_version, suspended_on: null, first_answered_on: null, last_answered_at: null, created_at: op.at, deleted: false, server_seq: 0 })
      return done("applied")
    }
    const row = this.recallCards.get(op.card_id)
    if (op.type === "recall.delete") {
      if (row && !row.data.deleted) write({ ...row.data, question: "", answer: "", source_type: null, source_id: null, deleted: true })
      return done("applied")
    }
    if (!row) return done("rejected", "card_not_found")
    if (row.data.deleted) return done("superseded", "card_deleted")
    if (op.type === "recall.suspend") {
      write({ ...row.data, suspended_on: op.suspended_on })
      return done("applied")
    }
    this.recallAttemptRows.set(op.attempt_id, {
      seq: this.nextReview(),
      data: { id: op.attempt_id, card_id: op.card_id, grade: op.grade, responded_at: op.responded_at, local_date: op.local_date, due_on_before: op.due_on_before, due_on_after: op.schedule.due_on, interval_days: op.schedule.interval_days, algorithm_version: op.algorithm_version, server_seq: 0 },
    })
    const latest = row.data.last_answered_at === null || Date.parse(op.responded_at) >= Date.parse(row.data.last_answered_at)
    const first = row.data.first_answered_on === null || op.local_date < row.data.first_answered_on ? op.local_date : row.data.first_answered_on
    write(latest ? { ...row.data, ...op.schedule, last_answered_at: op.responded_at, first_answered_on: first } : { ...row.data, first_answered_on: first })
    return done("applied")
  }

  /** Server-side view of the recall tables (tests). */
  recallCard(id: string): WireRecallCard | null {
    return this.recallCards.get(id)?.data ?? null
  }

  recallAttempts(): WireRecallAttempt[] {
    return [...this.recallAttemptRows.values()].map((r) => r.data)
  }

  /** Server-side view of a review (tests). */
  review(kind: string, periodStart: string): (WireReview & { seq: number }) | null {
    const r = this.reviews.get(`${kind}:${periodStart}`)
    return r ? { ...r.data, seq: r.seq } : null
  }

  /** Mirrors private.apply_checkin_op: per-field last-writer-wins, reflection conflicts, tombstones. */
  private applyCheckin(op: Extract<Op, { type: "checkin.set" }>): OpResult {
    const done = (status: OpResult["status"], code?: string): OpResult => ({ op_id: op.op_id, status, ...(code ? { code } : {}) })
    if (op.local_date > addDays(this.today, 1)) return done("rejected", "future_date")
    const fields = { ...op.fields }
    if ("note" in fields) fields.note = cleanNote(fields.note)
    for (const f of CHECKIN_FIELDS) {
      const k = WIRE_FIELD[f]
      if (k in fields && !validValue(f, fields[k])) return done("rejected", "invalid_value")
    }
    const key = `${op.local_date}:${op.phase}`
    const row = this.checkins.get(key)
    const prev: WireCheckin = row?.data ?? {
      local_date: op.local_date, phase: op.phase, sleep_hours: null, energy: null, mood: null, stress: null, note: null,
      field_stamps: {}, note_seq: null, updated_at: "", deleted: true, server_seq: 0,
    }
    if ("note" in fields && prev.note !== null && prev.note !== fields.note && prev.note_seq !== op.base_note_seq) return done("conflict", "note_conflict")
    const t = Math.min(Date.parse(op.at), this.serverNow() + 60_000)
    const at = new Date(t).toISOString()
    const next: WireCheckin = { ...prev, field_stamps: { ...prev.field_stamps } }
    let changed = false
    let noteChanged = false
    for (const [k, v] of Object.entries(fields) as [keyof typeof fields, number | string | null][]) {
      const stamp = next.field_stamps[k]
      if (stamp && Date.parse(stamp) > t) continue
      if (next[k] !== v) {
        changed = true
        if (k === "note") noteChanged = true
      }
      ;(next as unknown as Record<string, unknown>)[k] = v
      next.field_stamps[k] = at
    }
    if (!changed) return done("applied")
    const seq = this.next()
    next.deleted = CHECKIN_FIELDS.every((f) => next[WIRE_FIELD[f]] === null)
    next.updated_at = new Date(this.serverNow()).toISOString()
    if (noteChanged) next.note_seq = seq
    this.checkins.set(key, { seq, data: next })
    return done("applied")
  }

  /** Mirrors private.apply_focus_op: server clamps, conflicts and the derived habit day. */
  private applyFocus(op: Extract<Op, { type: `focus.${string}` }>): OpResult {
    const done = (status: OpResult["status"], code?: string): OpResult => ({ op_id: op.op_id, status, ...(code ? { code } : {}) })
    const clamp = (t: string) => new Date(Math.min(Date.parse(t), this.serverNow() + 60_000)).toISOString()
    const nowIso = new Date(this.serverNow()).toISOString()
    const before = this.state()
    let r: FocusResult
    if (op.type === "focus.start") {
      if (this.sessions.has(op.session.id)) return done("applied")
      if (activeSession(before)) return done("conflict", "session_active")
      const s = op.session
      r = startSession(before, { id: s.id, habitId: s.habit_id, project: s.project, plannedOutput: s.planned_output, plannedMinutes: s.planned_minutes, at: clamp(s.started_at) })
    } else {
      const row = this.sessions.get(op.session_id)
      if (!row) return done("rejected", "session_not_found")
      if (op.type === "focus.discard") {
        if (row.data.deleted) return done("applied")
        r = { ok: true, state: discardSession(before, op.session_id, nowIso) }
      } else if (op.type === "focus.edit") {
        if (row.data.deleted) return done("rejected", "session_not_found")
        if (row.data.session.state !== "finished") return done("rejected", "not_finished")
        if ((row.data.session.version ?? 1) !== op.base_version) return done("conflict")
        const input = { segments: op.segments, habitId: op.habit_id, project: op.project, plannedOutput: op.planned_output, actualOutput: op.actual_output, rating: op.rating, interruptions: op.interruptions }
        r = editSession(before, op.session_id, input, nowIso)
      } else {
        if (row.data.deleted || row.data.session.state === "finished") return done("superseded", "not_active")
        r =
          op.type === "focus.pause"
            ? pauseSession(before, op.session_id, clamp(op.at))
            : op.type === "focus.resume"
              ? resumeSession(before, op.session_id, clamp(op.at))
              : finishSession(before, op.session_id, { at: clamp(op.at), trimTo: op.trim_to, actualOutput: op.actual_output, rating: op.rating, interruptions: op.interruptions })
      }
    }
    if (!r.ok) return done("rejected", r.reason)
    this.commitFocus(before, r.state)
    return done("applied")
  }

  /** Write back changed sessions (with tombstones) and the derived entries they produced. */
  private commitFocus(before: HabitsState, after: HabitsState) {
    const afterIds = new Set(after.focusSessions.map((f) => f.id))
    for (const prev of before.focusSessions) {
      if (!afterIds.has(prev.id)) this.sessions.set(prev.id, { seq: this.next(), data: { session: { ...prev, version: (prev.version ?? 1) + 1 }, deleted: true } })
    }
    const prevById = new Map(before.focusSessions.map((f) => [f.id, f]))
    for (const f of after.focusSessions) if (prevById.get(f.id) !== f) this.sessions.set(f.id, { seq: this.next(), data: { session: f, deleted: false } })
    for (const k of new Set([...Object.keys(before.entries), ...Object.keys(after.entries)])) {
      const a = after.entries[k]
      const b = before.entries[k]
      if (a?.value === b?.value) continue
      const e = (a ?? b)!
      this.entries.set(k, {
        seq: this.next(),
        data: {
          habit_id: e.habitId,
          local_date: e.date,
          value_bool: null,
          value_numeric: a ? Number(a.value) : null,
          deleted: !a,
          client_op_id: `focus:${this.seq}`,
          client_updated_at: new Date(this.serverNow()).toISOString(),
          server_seq: 0,
        },
      })
    }
  }

  applyOps(ops: Op[]): { results: OpResult[]; server_today: LocalDate; server_time: string } {
    const results = ops.map((op) => {
      const prev = this.ledger.get(op.op_id)
      if (prev) return { op_id: op.op_id, status: "duplicate" as const, outcome: prev.status as never, code: prev.code, ...(prev.fields ? { fields: prev.fields } : {}) }
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
      profile: { timezone: this.timezone, locale: "es-ES", server_seq: 0, ...(this.motivationSupported ? { motivation: this.motivationSettings } : {}), ...(this.checkinsSupported ? { checkin_fields: this.checkinConfig } : {}) },
      ...(this.checkinsSupported
        ? {
            daily_checkins: pick(this.checkins)
              .filter((r) => !full || !r.data.deleted)
              .map((r) => ({ ...r.data, server_seq: r.seq })),
          }
        : {}),
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
      ...(this.focusSupported
        ? {
            focus_sessions: pick(this.sessions)
              .filter((r) => !full || !r.data.deleted)
              .map((r): WireFocusSession => {
                const f = r.data.session
                return {
                  id: f.id,
                  habit_id: f.habitId,
                  project: f.project,
                  planned_output: f.plannedOutput,
                  actual_output: f.actualOutput,
                  planned_minutes: f.plannedMinutes,
                  segments: f.segments,
                  state: f.state,
                  active_seconds: activeSeconds(f.segments),
                  local_date: f.localDate,
                  rating: f.rating,
                  interruptions: f.interruptions ?? null,
                  version: f.version ?? 1,
                  created_at: f.createdAt,
                  updated_at: f.updatedAt,
                  deleted: r.data.deleted,
                  server_seq: r.seq,
                }
              }),
          }
        : {}),
      ...(this.reviewsSupported
        ? {
            reviews: pick(this.reviews)
              .filter((r) => r.data.kind !== "day" && (!full || !r.data.deleted))
              .map((r) => ({ ...r.data, server_seq: r.seq })),
          }
        : {}),
      ...(this.experimentsSupported
        ? {
            experiments: pick(this.experimentRows)
              .filter((r) => !full || !r.data.deleted)
              .map((r) => ({ ...r.data, server_seq: r.seq })),
          }
        : {}),
      ...(this.discoverySupported
        ? {
            discovery_topics: pick(this.discoveryTopics)
              .filter((r) => !full || !r.data.deleted)
              .map((r) => ({ ...r.data, server_seq: r.seq })),
            topic_feedback: pick(this.feedbackRows).map((r) => ({ ...r.data, server_seq: r.seq })),
          }
        : {}),
      ...(this.recallSupported
        ? {
            recall_cards: pick(this.recallCards)
              .filter((r) => !full || !r.data.deleted)
              .map((r) => ({ ...r.data, server_seq: r.seq })),
            recall_attempts: pick(this.recallAttemptRows).map((r) => ({ ...r.data, server_seq: r.seq })),
          }
        : {}),
      ...(this.reviewsSupported && this.dailyReviewsSupported
        ? {
            daily_reviews: pick(this.reviews)
              .filter((r) => r.data.kind === "day" && (!full || !r.data.deleted))
              .map((r) => ({ ...r.data, server_seq: r.seq })),
          }
        : {}),
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
    /** The next pull fails (e.g. the connection drops right after the push was answered). */
    failNextPull: false,
    calls: 0,
    /** Runs right before the server applies a batch (e.g. another device writes in between). */
    beforeApply: null as null | ((ops: Op[]) => void),
    /** Runs right before the server answers a pull. */
    beforePull: null as null | (() => void),
    async applyOps(_device: string, ops: Op[]) {
      t.calls++
      if (!t.online) throw new NetworkError("offline")
      t.beforeApply?.(ops)
      const res = server.applyOps(structuredClone(ops))
      if (t.dropNextResponse) {
        t.dropNextResponse = false
        throw new NetworkError("response lost")
      }
      return structuredClone(res)
    },
    async pull(since: number) {
      if (!t.online) throw new NetworkError("offline")
      if (t.failNextPull) {
        t.failNextPull = false
        throw new NetworkError("pull failed")
      }
      t.beforePull?.()
      return structuredClone(server.pull(since))
    },
  }
  return t satisfies SyncTransport
}
