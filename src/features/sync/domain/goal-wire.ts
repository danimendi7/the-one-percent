import type { GoalInput } from "@/features/goals/domain/ops"
import { DEFAULT_THRESHOLD, type Goal, type Measurement } from "@/features/goals/domain/types"
import type { WireCheckpoint, WireGoal, WireGoalFields, WireGoalLink, WireMeasurement } from "./types"

/** Goal ⇄ wire conversions (the server keeps snake_case; see supabase/migrations/*_goals.sql). */

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export function goalToWire(input: GoalInput): { goal: WireGoalFields; habits: WireGoalLink[]; checkpoints: WireCheckpoint[] } {
  const n = input.kind === "numeric" ? input.numeric : null
  return {
    goal: {
      title: input.title.trim(),
      why: input.why?.trim() || null,
      parent_id: input.parentId ?? null,
      dimension: input.dimensionId ?? null,
      metric_type: input.kind,
      source: n?.source ?? null,
      source_habit_id: n?.source === "habit" ? (n.habitId ?? null) : null,
      aggregation: n?.aggregation ?? null,
      unit: n ? n.unit.trim() : null,
      baseline: n?.baseline ?? null,
      target: n?.target ?? null,
      direction: n?.direction ?? null,
      threshold: input.kind === "habits" ? (input.threshold ?? DEFAULT_THRESHOLD) : null,
      start_date: input.startDate,
      due_date: input.dueDate,
      horizon_override: input.horizonOverride ?? null,
      priority: input.priority,
      aggregate_children: !!input.aggregateChildren,
    },
    habits: input.habits.map((l) => ({ habit_id: l.habitId, weight: l.weight })),
    checkpoints: input.checkpoints
      .filter((c) => c.title.trim())
      .map((c) => ({ id: c.id, title: c.title.trim(), due_on: c.dueOn ?? null, value: c.value ?? null, done_on: c.doneOn ?? null })),
  }
}

export function wireToInput(g: WireGoalFields, habits: WireGoalLink[], checkpoints: WireCheckpoint[]): GoalInput {
  return {
    title: g.title,
    why: g.why,
    dimensionId: g.dimension,
    parentId: g.parent_id,
    kind: g.metric_type,
    numeric:
      g.metric_type === "numeric"
        ? {
            source: g.source ?? "manual",
            habitId: g.source_habit_id,
            aggregation: g.aggregation ?? "last",
            unit: g.unit ?? "",
            baseline: num(g.baseline) ?? 0,
            target: num(g.target) ?? 0,
            direction: g.direction ?? "up",
          }
        : null,
    threshold: num(g.threshold),
    startDate: g.start_date,
    dueDate: g.due_date,
    horizonOverride: g.horizon_override,
    priority: g.priority,
    aggregateChildren: g.aggregate_children,
    habits: habits.map((l) => ({ habitId: l.habit_id, weight: Number(l.weight) })),
    checkpoints: checkpoints.map((c) => ({ id: c.id, title: c.title, dueOn: c.due_on ?? null, value: num(c.value), doneOn: c.done_on ?? null })),
  }
}

export function toGoal(w: WireGoal): Goal {
  const i = wireToInput(w, w.habits, w.checkpoints)
  return {
    id: w.id,
    title: i.title,
    why: i.why ?? null,
    dimensionId: i.dimensionId ?? null,
    parentId: i.parentId ?? null,
    kind: i.kind,
    numeric: i.numeric ?? null,
    threshold: i.threshold ?? null,
    startDate: i.startDate,
    dueDate: i.dueDate,
    horizonOverride: i.horizonOverride ?? null,
    priority: i.priority,
    aggregateChildren: !!i.aggregateChildren,
    state: w.state,
    closedOn: w.closed_on,
    archivedOn: w.archived_on,
    reviewSince: w.review_since ?? null,
    processLog: w.process_log ?? [],
    habits: i.habits,
    checkpoints: i.checkpoints,
    version: w.version,
    createdAt: w.created_at,
    updatedAt: w.updated_at,
  }
}

/** Domain goal → pull payload row (used by the in-memory test server). */
export function goalToWireRow(g: Goal, serverSeq: number): WireGoal {
  const w = goalToWire({ ...g, habits: g.habits, checkpoints: g.checkpoints })
  return {
    ...w.goal,
    id: g.id,
    state: g.state,
    closed_on: g.closedOn ?? null,
    archived_on: g.archivedOn ?? null,
    review_since: g.reviewSince ?? null,
    process_log: g.processLog ?? [],
    version: g.version ?? 1,
    created_at: g.createdAt,
    updated_at: g.updatedAt,
    server_seq: serverSeq,
    habits: w.habits,
    checkpoints: w.checkpoints,
  }
}

export function toMeasurement(w: WireMeasurement): Measurement {
  return { goalId: w.goal_id, date: w.observed_on, value: Number(w.value), note: w.note, opId: w.client_op_id, updatedAt: w.client_updated_at }
}
