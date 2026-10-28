import { addDays, diffDays, eachDay, startOfWeek, type LocalDate } from "@/features/habits/domain/dates"
import type { DateRange } from "@/features/habits/domain/metrics"
import type { HabitsState } from "@/features/habits/domain/types"
import { activeSeconds, minutesOf } from "./time"
import type { FocusSession } from "./types"

/**
 * Focus figures (catalog v3, src/features/analytics/domain/catalog.ts). Each figure is
 * computed from an explicit list of finished sessions, and the drilldown lists exactly
 * those sessions, so a tapped number always equals the sum of what it opens.
 */

/** "Sin proyecto" groups sessions without a project. */
export const NO_PROJECT = ""

export type FocusDataLevel = "none" | "few" | "enough"

export interface FocusScope {
  range: DateRange
  /** "all", a project name, or NO_PROJECT. */
  project: string | "all"
}

export function sameProject(s: Pick<FocusSession, "project">, project: string | "all"): boolean {
  if (project === "all") return true
  return (s.project ?? NO_PROJECT).toLocaleLowerCase("es-ES") === project.toLocaleLowerCase("es-ES")
}

/** Finished sessions in scope, newest first. */
export function sessionsIn(state: Pick<HabitsState, "focusSessions">, scope: FocusScope): FocusSession[] {
  return state.focusSessions
    .filter((s) => s.state === "finished" && s.localDate >= scope.range.from && s.localDate <= scope.range.to && sameProject(s, scope.project))
    .sort((a, b) => b.segments[0].start.localeCompare(a.segments[0].start))
}

export function isComplete(s: FocusSession): boolean {
  return activeSeconds(s.segments) >= s.plannedMinutes * 60
}

export interface ProjectRow {
  /** NO_PROJECT for sessions without one. */
  project: string
  seconds: number
  minutes: number
  sessions: number
}

export interface FocusSummary {
  seconds: number
  minutes: number
  sessions: number
  complete: number
  /** N/D (null) without sessions. */
  completeRate: number | null
  rated: number
  /** N/D (null) when no session was rated. */
  avgRating: number | null
  byProject: ProjectRow[]
  days: number
}

export function summarizeSessions(list: readonly FocusSession[]): FocusSummary {
  let seconds = 0
  let complete = 0
  let ratingSum = 0
  let rated = 0
  const projects = new Map<string, ProjectRow>()
  const days = new Set<string>()
  for (const s of list) {
    const sec = activeSeconds(s.segments)
    seconds += sec
    if (sec >= s.plannedMinutes * 60) complete++
    if (s.rating !== null) {
      rated++
      ratingSum += s.rating
    }
    days.add(s.localDate)
    const key = s.project ?? NO_PROJECT
    const k = key.toLocaleLowerCase("es-ES")
    const row = projects.get(k) ?? { project: key, seconds: 0, minutes: 0, sessions: 0 }
    row.seconds += sec
    row.sessions++
    projects.set(k, row)
  }
  const byProject = [...projects.values()]
    .map((r) => ({ ...r, minutes: minutesOf(r.seconds) }))
    .sort((a, b) => b.seconds - a.seconds || a.project.localeCompare(b.project, "es"))
  return {
    seconds,
    minutes: minutesOf(seconds),
    sessions: list.length,
    complete,
    completeRate: list.length ? complete / list.length : null,
    rated,
    avgRating: rated ? ratingSum / rated : null,
    byProject,
    days: days.size,
  }
}

/**
 * Days in a row with at least one finished session, up to today. Today without a session
 * does not break the streak yet (same rule as habits: today is still pending).
 */
export function focusStreak(state: Pick<HabitsState, "focusSessions">, today: LocalDate, project: string | "all" = "all"): number {
  const days = new Set(state.focusSessions.filter((s) => s.state === "finished" && sameProject(s, project)).map((s) => s.localDate))
  let day = days.has(today) ? today : addDays(today, -1)
  let n = 0
  while (days.has(day)) {
    n++
    day = addDays(day, -1)
  }
  return n
}

/**
 * Three data states (plan §2): none; few (under 3 sessions, or a history shorter than a
 * week) — figures shown with «Pocos datos» and no trends; enough.
 */
export function focusDataLevel(state: Pick<HabitsState, "focusSessions">, scope: FocusScope, today: LocalDate): FocusDataLevel {
  const list = sessionsIn(state, scope)
  if (list.length === 0) return "none"
  const first = state.focusSessions
    .filter((s) => s.state === "finished" && sameProject(s, scope.project))
    .reduce((m, s) => (s.localDate < m ? s.localDate : m), today)
  return list.length < 3 || diffDays(first, today) < 6 ? "few" : "enough"
}

export interface FocusPoint {
  /** Day, or the Monday of the week. */
  date: LocalDate
  minutes: number
  sessions: number
}

/** Minutes per day (short periods) or per ISO week (90 days and longer), zero-filled. */
export function focusSeries(state: Pick<HabitsState, "focusSessions">, scope: FocusScope): { unit: "day" | "week"; points: FocusPoint[] } {
  const list = sessionsIn(state, scope)
  const weekly = diffDays(scope.range.from, scope.range.to) >= 60
  const bucket = (d: LocalDate) => (weekly ? startOfWeek(d) : d)
  const keys = weekly
    ? [...new Set(eachDay(scope.range.from, scope.range.to).map(startOfWeek))]
    : eachDay(scope.range.from, scope.range.to)
  const seconds = new Map<string, number>(keys.map((k) => [k, 0]))
  const count = new Map<string, number>(keys.map((k) => [k, 0]))
  for (const s of list) {
    const k = bucket(s.localDate)
    seconds.set(k, (seconds.get(k) ?? 0) + activeSeconds(s.segments))
    count.set(k, (count.get(k) ?? 0) + 1)
  }
  return { unit: weekly ? "week" : "day", points: keys.map((k) => ({ date: k, minutes: minutesOf(seconds.get(k) ?? 0), sessions: count.get(k) ?? 0 })) }
}

/** Sessions of one bucket of the series (drilldown of a bar). */
export function sessionsInBucket(state: Pick<HabitsState, "focusSessions">, scope: FocusScope, unit: "day" | "week", date: LocalDate): FocusSession[] {
  const to = unit === "week" ? addDays(date, 6) : date
  return sessionsIn(state, { ...scope, range: { from: date < scope.range.from ? scope.range.from : date, to: to > scope.range.to ? scope.range.to : to } })
}

/** Today's and this week's focus at a glance (Focus screen, Overview). */
export function focusToday(state: Pick<HabitsState, "focusSessions">, today: LocalDate) {
  const day = summarizeSessions(sessionsIn(state, { range: { from: today, to: today }, project: "all" }))
  const week = summarizeSessions(sessionsIn(state, { range: { from: startOfWeek(today), to: today }, project: "all" }))
  return { day, week }
}
