import { addDays, diffDays, minDate, type LocalDate } from "@/features/habits/domain/dates"
import { completion, type DateRange } from "@/features/habits/domain/metrics"
import type { HabitsState } from "@/features/habits/domain/types"
import { sessionsIn, summarizeSessions } from "@/features/focus/domain/metrics"
import { average, series } from "@/features/mind/domain/metrics"
import { INDICATORS, type Indicator } from "@/features/mind/domain/types"
import type { Insight } from "./insights"

/**
 * Improvement experiments (Plan Maestro 5.9: «propuesta de experimentos de mejora verificables»).
 * The user names one change, one thing to measure and a length; the app compares the days of the
 * experiment with as many days just before, from the records that already exist. Two stretches of
 * one person's life: the result is a description with its n, never proof of a cause.
 */
export type ExperimentMetric = { kind: "habit"; habitId: string } | { kind: "checkin"; indicator: Indicator } | { kind: "focus" }
export const EXPERIMENT_DAYS = [7, 14, 21, 28] as const
export type ExperimentDays = (typeof EXPERIMENT_DAYS)[number]
export type ExperimentStatus = "active" | "finished" | "abandoned"

export interface Experiment {
  id: string
  /** The change being tried, in the user's words. */
  title: string
  metric: ExperimentMetric
  startOn: LocalDate
  days: ExperimentDays
  status: ExperimentStatus
  endedOn: LocalDate | null
  /** What the user concluded, when closing it. */
  note: string | null
  createdAt: string
}

export type ExperimentMap = Record<string, Experiment>

export const EXPERIMENT_LIMITS = { title: 140, note: 1000 } as const
export const MAX_ACTIVE = 3
/** Days (or chances) needed on each side before a difference is shown. */
const MIN_N = 5
const MIN_CHECKIN_DAYS = 4

export function emptyExperiments(): ExperimentMap {
  return {}
}

export type ExperimentValidation = { ok: true; title: string } | { ok: false; field: "title" | "metric" | "days"; reason: "empty" | "too_long" | "invalid" }

export function validateExperiment(input: { title: string; metric: ExperimentMetric; days: number }): ExperimentValidation {
  const title = input.title.trim()
  if (!title) return { ok: false, field: "title", reason: "empty" }
  if (title.length > EXPERIMENT_LIMITS.title) return { ok: false, field: "title", reason: "too_long" }
  const m = input.metric
  if (m.kind === "checkin" ? !INDICATORS.includes(m.indicator) : m.kind === "habit" ? !m.habitId : m.kind !== "focus") return { ok: false, field: "metric", reason: "invalid" }
  if (!(EXPERIMENT_DAYS as readonly number[]).includes(input.days)) return { ok: false, field: "days", reason: "invalid" }
  return { ok: true, title }
}

export function addExperiment(map: ExperimentMap, e: Omit<Experiment, "status" | "endedOn" | "note" | "createdAt"> & { at: string }): ExperimentMap {
  if (map[e.id]) return map
  const { at, ...rest } = e
  return { ...map, [e.id]: { ...rest, status: "active", endedOn: null, note: null, createdAt: at } }
}

/** The first close wins: a closed experiment is a record of what happened. */
export function closeExperiment(map: ExperimentMap, id: string, c: { status: Exclude<ExperimentStatus, "active">; endedOn: LocalDate; note: string | null }): ExperimentMap {
  const e = map[id]
  if (!e || e.status !== "active") return map
  return { ...map, [id]: { ...e, status: c.status, endedOn: c.endedOn, note: c.note?.trim() || null } }
}

export function removeExperiment(map: ExperimentMap, id: string): ExperimentMap {
  if (!map[id]) return map
  const next = { ...map }
  delete next[id]
  return next
}

export interface Measure {
  range: DateRange
  value: number | null
  n: number
}

export interface ExperimentMeasure {
  unit: "pct" | "points" | "minutes"
  baseline: Measure
  trial: Measure
  /** trial − baseline, only with enough data on both sides. */
  delta: number | null
  enough: boolean
  finished: boolean
  /** Day of the experiment today (1-based, capped at its length). */
  day: number
  of: number
  limitations: string[]
}

function measure(state: HabitsState, metric: ExperimentMetric, range: DateRange, today: LocalDate): Measure {
  if (range.to < range.from) return { range, value: null, n: 0 }
  if (metric.kind === "habit") {
    const h = state.habits.find((x) => x.id === metric.habitId)
    if (!h) return { range, value: null, n: 0 }
    const c = completion([h], range, { entries: state.entries, restDays: new Set(state.restDays), today })
    return { range, value: c.rate, n: c.applicable }
  }
  if (metric.kind === "checkin") {
    const a = average(series(state, range, metric.indicator, "both"))
    return { range, value: a.value, n: a.n }
  }
  // Focus: minutes per day. Before the first session ever there is no data, not a run of zeros.
  const first = state.focusSessions.filter((s) => s.state === "finished").reduce<LocalDate | null>((m, s) => (m === null || s.localDate < m ? s.localDate : m), null)
  if (first === null || first > range.from) return { range, value: null, n: 0 }
  const n = diffDays(range.from, range.to) + 1
  return { range, value: summarizeSessions(sessionsIn(state, { range, project: "all" })).minutes / n, n }
}

export function measureExperiment(state: HabitsState, e: Experiment, today: LocalDate): ExperimentMeasure {
  const end = addDays(e.startOn, e.days - 1)
  const trialTo = minDate(minDate(end, e.endedOn ?? end), addDays(today, -1))
  const baseline = measure(state, e.metric, { from: addDays(e.startOn, -e.days), to: addDays(e.startOn, -1) }, today)
  const trial = measure(state, e.metric, { from: e.startOn, to: trialTo }, today)
  const min = e.metric.kind === "checkin" ? MIN_CHECKIN_DAYS : MIN_N
  const enough = baseline.value !== null && trial.value !== null && baseline.n >= min && trial.n >= min
  const limitations = ["Compara dos tramos de tus registros: no demuestra que el cambio sea la causa.", "Otras cosas pueden haber cambiado a la vez (descansos, viajes, la época del año)."]
  if (!enough) limitations.unshift(`Hacen falta al menos ${min} ${e.metric.kind === "habit" ? "oportunidades" : "días con dato"} en cada tramo para comparar.`)
  return {
    unit: e.metric.kind === "habit" ? "pct" : e.metric.kind === "checkin" ? "points" : "minutes",
    baseline,
    trial,
    delta: enough ? trial.value! - baseline.value! : null,
    enough,
    finished: e.status !== "active" || today > end,
    day: Math.min(e.days, Math.max(1, diffDays(e.startOn, today) + 1)),
    of: e.days,
    limitations,
  }
}

export interface ExperimentSuggestion {
  /** The insight it comes from. */
  id: string
  metric: ExperimentMetric
  reason: string
}

/** Only insights with one clear thing to measure suggest an experiment; the change is the user's to choose. */
export function suggestExperiments(list: readonly Insight[]): ExperimentSuggestion[] {
  const out: ExperimentSuggestion[] = []
  for (const i of list) {
    if (i.kind === "habit_drop") out.push({ id: i.id, metric: { kind: "habit", habitId: i.id.slice("habit_drop:".length) }, reason: `«${i.variables[0]}» ha bajado en las últimas 4 semanas` })
    else if (i.kind === "interruptions") out.push({ id: i.id, metric: { kind: "focus" }, reason: "Las sesiones con interrupciones coinciden con menos minutos de foco" })
    else if (i.kind === "relation") {
      const [, a, b] = i.id.split(":")
      const side = [b, a].find((v): v is Indicator => (INDICATORS as readonly string[]).includes(v))
      if (side) out.push({ id: i.id, metric: { kind: "checkin", indicator: side }, reason: `${i.title}: van de la mano en tus registros` })
    }
  }
  return out
}
