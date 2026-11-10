import type { Experiment, ExperimentDays, ExperimentMetric } from "@/features/intelligence/domain/experiments"
import type { Indicator } from "@/features/mind/domain/types"
import type { WireExperiment } from "./types"

export function metricToWire(m: ExperimentMetric): { metric_kind: WireExperiment["metric_kind"]; metric_ref: string | null } {
  return m.kind === "habit" ? { metric_kind: "habit", metric_ref: m.habitId } : m.kind === "checkin" ? { metric_kind: "checkin", metric_ref: m.indicator } : { metric_kind: "focus", metric_ref: null }
}

export function toExperiment(w: WireExperiment): Experiment {
  const metric: ExperimentMetric = w.metric_kind === "habit" ? { kind: "habit", habitId: w.metric_ref ?? "" } : w.metric_kind === "checkin" ? { kind: "checkin", indicator: w.metric_ref as Indicator } : { kind: "focus" }
  return { id: w.id, title: w.title, metric, startOn: w.start_on, days: w.days as ExperimentDays, status: w.status, endedOn: w.ended_on, note: w.note, createdAt: w.created_at }
}
