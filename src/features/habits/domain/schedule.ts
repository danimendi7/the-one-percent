import { isoWeekday, type LocalDate } from "./dates"
import type { Habit, HabitEntry, ScheduleRule, ScheduleVersion } from "./types"

/** Schedule version in force on `date`, or null if the habit is inactive. */
export function versionOn(habit: Habit, date: LocalDate): ScheduleVersion | null {
  if (date < habit.startDate) return null
  if (habit.archivedOn && date >= habit.archivedOn) return null
  let current: ScheduleVersion | null = null
  for (const v of habit.schedule) {
    if (v.validFrom <= date) current = v
    else break
  }
  return current
}

export function ruleOn(habit: Habit, date: LocalDate): ScheduleRule | null {
  return versionOn(habit, date)?.rule ?? null
}

/**
 * Whether a value can be recorded for `date`. Weekly-count habits accept any
 * active day; fixed schedules only accept their scheduled days.
 */
export function isEligibleDay(habit: Habit, date: LocalDate): boolean {
  const rule = ruleOn(habit, date)
  if (!rule) return false
  switch (rule.kind) {
    case "daily":
    case "weekly_count":
      return true
    case "weekdays":
      return rule.weekdays.includes(isoWeekday(date))
  }
}

/**
 * Replace the schedule from `from` onward without touching earlier versions.
 * Versions starting on/after `from` are superseded.
 */
export function changeSchedule(
  habit: Habit,
  rule: ScheduleRule,
  from: LocalDate
): Habit {
  const effective = from < habit.startDate ? habit.startDate : from
  const kept = habit.schedule.filter((v) => v.validFrom < effective)
  const last = kept[kept.length - 1]
  if (last && sameRule(last.rule, rule)) return { ...habit, schedule: kept }
  return { ...habit, schedule: [...kept, { validFrom: effective, rule }] }
}

export function sameRule(a: ScheduleRule, b: ScheduleRule): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === "weekdays" && b.kind === "weekdays") {
    return [...a.weekdays].sort().join() === [...b.weekdays].sort().join()
  }
  if (a.kind === "weekly_count" && b.kind === "weekly_count") {
    return a.timesPerWeek === b.timesPerWeek
  }
  return true
}

/**
 * Completion semantics (DATABASE_ARCHITECTURE §Computation contracts):
 * binary → value is true; numeric → meets target in its direction.
 * A missing value is never success, including for "at most" limits.
 */
export function isFulfilled(habit: Habit, entry: HabitEntry | undefined): boolean {
  if (!entry) return false
  if (habit.type === "binary") return entry.value === true
  if (typeof entry.value !== "number" || habit.target === undefined) return false
  return habit.direction === "at_most"
    ? entry.value <= habit.target
    : entry.value >= habit.target
}
