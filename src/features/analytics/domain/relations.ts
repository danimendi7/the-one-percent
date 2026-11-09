import { eachDay, addDays, type LocalDate } from "@/features/habits/domain/dates"
import { dailyRates, type DateRange } from "@/features/habits/domain/metrics"
import type { HabitsState } from "@/features/habits/domain/types"
import { dayValue, focusMinutesByDay } from "@/features/mind/domain/metrics"

/**
 * Relations between variables of Life Analytics (Plan Maestro §5.3, «Diagnóstico»). Descriptive
 * only: every result names its period, its two variables, how many days it rests on and what it
 * cannot say (Plan Maestro, «Recomendaciones analíticas y de IA»). Below the minimum there is a
 * reason and no figure. The sentences never speak of causes.
 */

export type RelationVariableId = "completion" | "focus" | "sleep" | "energy" | "mood" | "stress"

/** How a variable reads in a sentence: «los días con más sueño». */
export const RELATION_VARIABLES: Record<RelationVariableId, { label: string; noun: string }> = {
  completion: { label: "Cumplimiento de hábitos", noun: "cumplimiento de hábitos" },
  focus: { label: "Minutos de enfoque", noun: "minutos de enfoque" },
  sleep: { label: "Sueño", noun: "sueño" },
  energy: { label: "Energía", noun: "energía" },
  mood: { label: "Ánimo", noun: "ánimo" },
  stress: { label: "Estrés", noun: "estrés" },
}

/** Days with both values a relation needs before it shows a figure. */
export const RELATION_MIN_DAYS = 14
/** Below this many days a shown relation also warns that the sample is small. */
export const RELATION_SOLID_DAYS = 30
/** Below this absolute coefficient no pattern is claimed. */
export const RELATION_CLEAR = 0.3
const RELATION_MODERATE = 0.5
const RELATION_STRONG = 0.7

export type RelationSeries = Record<RelationVariableId, ReadonlyMap<LocalDate, number>>
export type RelationStatus = "shown" | "few_days" | "no_variation"
export type RelationStrength = "unclear" | "weak" | "moderate" | "strong"

export interface Relation {
  a: RelationVariableId
  b: RelationVariableId
  period: DateRange
  /** Days with a value of both variables. */
  n: number
  status: RelationStatus
  /** Spearman's coefficient, null unless `status` is "shown". */
  rho: number | null
  strength: RelationStrength | null
  /** What can and cannot be read from it; every result has at least one. */
  limitations: string[]
  sentence: string
}

/** Ranks from 1, ties sharing their average rank. */
function ranks(xs: readonly number[]): number[] {
  const order = xs.map((x, i) => ({ x, i })).sort((p, q) => p.x - q.x)
  const out = new Array<number>(xs.length)
  for (let start = 0; start < order.length; ) {
    let end = start
    while (end + 1 < order.length && order[end + 1].x === order[start].x) end++
    const rank = (start + end) / 2 + 1
    for (let k = start; k <= end; k++) out[order[k].i] = rank
    start = end + 1
  }
  return out
}

/** Spearman's rank correlation: the scales are 1–5 ratings, so only the order is meaningful. Null if either side never varies. */
export function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null
  const rx = ranks(xs)
  const ry = ranks(ys)
  const mean = (rx.length + 1) / 2
  let cov = 0
  let varX = 0
  let varY = 0
  for (let i = 0; i < rx.length; i++) {
    cov += (rx[i] - mean) * (ry[i] - mean)
    varX += (rx[i] - mean) ** 2
    varY += (ry[i] - mean) ** 2
  }
  return varX === 0 || varY === 0 ? null : cov / Math.sqrt(varX * varY)
}

export function relationStrength(rho: number): RelationStrength {
  const r = Math.abs(rho)
  return r < RELATION_CLEAR ? "unclear" : r < RELATION_MODERATE ? "weak" : r < RELATION_STRONG ? "moderate" : "strong"
}

/**
 * Each variable by day, only on days that have it. Today is left out of the habits and of focus
 * (still open); focus counts a day without sessions as 0 only since the first session ever, so a
 * period before using it is no data rather than a run of zeros.
 */
export function relationSeries(state: HabitsState, range: DateRange, today: LocalDate): RelationSeries {
  const closedTo = range.to >= today ? addDays(today, -1) : range.to
  const completion = new Map<LocalDate, number>()
  const focus = new Map<LocalDate, number>()
  if (closedTo >= range.from) {
    for (const r of dailyRates(state.habits, { from: range.from, to: closedTo }, { entries: state.entries, restDays: new Set(state.restDays), today })) {
      if (r.applicable > 0) completion.set(r.date, r.fulfilled / r.applicable)
    }
    const firstSession = state.focusSessions.filter((s) => s.state === "finished").reduce<LocalDate | null>((min, s) => (min === null || s.localDate < min ? s.localDate : min), null)
    if (firstSession !== null) {
      const minutes = focusMinutesByDay(state, range)
      for (const date of eachDay(range.from > firstSession ? range.from : firstSession, closedTo)) focus.set(date, minutes.get(date) ?? 0)
    }
  }
  const checkin = (indicator: "sleep" | "energy" | "mood" | "stress") => {
    const out = new Map<LocalDate, number>()
    for (const date of eachDay(range.from, range.to)) {
      const v = dayValue(state, date, indicator, "both")
      if (v !== null) out.set(date, v)
    }
    return out
  }
  return { completion, focus, sleep: checkin("sleep"), energy: checkin("energy"), mood: checkin("mood"), stress: checkin("stress") }
}

const STRENGTH_TEXT: Record<Exclude<RelationStrength, "unclear">, string> = { weak: "ligeramente", moderate: "con cierta frecuencia", strong: "con frecuencia" }

function sentence(a: RelationVariableId, b: RelationVariableId, n: number, rho: number): string {
  const strength = relationStrength(rho)
  if (strength === "unclear") return `En estos ${n} días no se aprecia un patrón claro entre ${RELATION_VARIABLES[a].noun} y ${RELATION_VARIABLES[b].noun}.`
  return `En estos ${n} días, los días con más ${RELATION_VARIABLES[a].noun} coinciden ${STRENGTH_TEXT[strength]} con ${rho > 0 ? "más" : "menos"} ${RELATION_VARIABLES[b].noun}.`
}

/** One pair over the days where both have a value. */
export function relationBetween(series: RelationSeries, a: RelationVariableId, b: RelationVariableId, period: DateRange): Relation {
  const days = [...series[a].keys()].filter((d) => series[b].has(d))
  const n = days.length
  const base = { a, b, period, n }
  const pair = `${RELATION_VARIABLES[a].noun} y ${RELATION_VARIABLES[b].noun}`
  if (n < RELATION_MIN_DAYS)
    return {
      ...base,
      status: "few_days",
      rho: null,
      strength: null,
      limitations: [`Hacen falta al menos ${RELATION_MIN_DAYS} días con ambos datos; hay ${n}.`],
      sentence: `Aún no hay días suficientes para comparar ${pair}.`,
    }
  const rho = spearman(days.map((d) => series[a].get(d)!), days.map((d) => series[b].get(d)!))
  if (rho === null)
    return {
      ...base,
      status: "no_variation",
      rho: null,
      strength: null,
      limitations: ["Uno de los dos valores no cambia en este periodo, así que no hay nada que comparar."],
      sentence: `No se puede comparar ${pair}: uno de los dos no varía en este periodo.`,
    }
  const limitations = ["Muestra lo que coincide en tus datos, no qué provoca qué: otros factores pueden explicarlo."]
  if (n < RELATION_SOLID_DAYS) limitations.push(`Con ${n} días la muestra es pequeña: puede cambiar con más datos.`)
  return { ...base, status: "shown", rho, strength: relationStrength(rho), limitations, sentence: sentence(a, b, n, rho) }
}

const PAIRS: readonly [RelationVariableId, RelationVariableId][] = [
  ["sleep", "energy"],
  ["sleep", "mood"],
  ["sleep", "stress"],
  ["sleep", "completion"],
  ["sleep", "focus"],
  ["energy", "mood"],
  ["energy", "stress"],
  ["energy", "completion"],
  ["energy", "focus"],
  ["mood", "stress"],
  ["mood", "completion"],
  ["mood", "focus"],
  ["stress", "completion"],
  ["stress", "focus"],
  ["completion", "focus"],
]

export const RELATION_PAIR_COUNT = PAIRS.length

/** Every pair of the catalog: the strongest first, then those without a figure. */
export function relations(state: HabitsState, range: DateRange, today: LocalDate): Relation[] {
  const series = relationSeries(state, range, today)
  const weight = (r: Relation) => (r.rho === null ? -1 : Math.abs(r.rho))
  return PAIRS.map(([a, b]) => relationBetween(series, a, b, range)).sort((x, y) => weight(y) - weight(x))
}
