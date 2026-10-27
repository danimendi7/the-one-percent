import { z } from "zod"
import { isLocalDate } from "../domain/dates"

/** Validates persisted demo state; anything malformed is discarded, never trusted. */
const localDate = z.string().refine(isLocalDate, "invalid date")
const weekday = z.union([1, 2, 3, 4, 5, 6, 7].map((n) => z.literal(n)) as [
  z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>, z.ZodLiteral<4>, z.ZodLiteral<5>, z.ZodLiteral<6>, z.ZodLiteral<7>,
])

const rule = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily") }),
  z.object({ kind: z.literal("weekdays"), weekdays: z.array(weekday).min(1).max(7) }),
  z.object({ kind: z.literal("weekly_count"), timesPerWeek: z.number().int().min(1).max(7) }),
])

const dimensionId = z.enum(["body", "mind", "learn", "work"])

const habit = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  icon: z.string().min(1),
  dimensionId,
  type: z.enum(["binary", "numeric", "duration"]),
  unit: z.string().max(24).optional(),
  target: z.number().nonnegative().optional(),
  direction: z.enum(["at_least", "at_most"]).optional(),
  schedule: z.array(z.object({ validFrom: localDate, rule })).min(1),
  startDate: localDate,
  archivedOn: localDate.nullable().optional(),
  createdAt: z.string(),
})

const entry = z.object({
  habitId: z.string(),
  date: localDate,
  value: z.union([z.boolean(), z.number().nonnegative()]),
  opId: z.string(),
  updatedAt: z.string(),
})

const checkpoint = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(80),
  dueOn: localDate.nullable().optional(),
  value: z.number().finite().nullable().optional(),
  doneOn: localDate.nullable().optional(),
})

const goal = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(80),
  why: z.string().max(160).nullable().optional(),
  dimensionId: dimensionId.nullable().optional(),
  parentId: z.string().nullable().optional(),
  kind: z.enum(["habits", "numeric", "milestones"]),
  numeric: z
    .object({
      source: z.enum(["manual", "habit"]),
      habitId: z.string().nullable().optional(),
      aggregation: z.enum(["last", "sum"]),
      unit: z.string().max(24),
      baseline: z.number().finite(),
      target: z.number().finite(),
      direction: z.enum(["up", "down"]),
    })
    .nullable()
    .optional(),
  threshold: z.number().min(0).max(1).nullable().optional(),
  startDate: localDate,
  dueDate: localDate,
  horizonOverride: z.enum(["short", "medium", "long"]).nullable().optional(),
  priority: z.enum(["primary", "secondary"]),
  aggregateChildren: z.boolean().optional(),
  state: z.enum(["active", "achieved", "abandoned"]),
  closedOn: localDate.nullable().optional(),
  archivedOn: localDate.nullable().optional(),
  habits: z.array(z.object({ habitId: z.string(), weight: z.number().int().min(1).max(3) })),
  checkpoints: z.array(checkpoint),
  version: z.number().int().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const measurement = z.object({
  goalId: z.string(),
  date: localDate,
  value: z.number().finite(),
  note: z.string().max(200).nullable().optional(),
  opId: z.string(),
  updatedAt: z.string(),
})

export const habitsStateSchema = z.object({
  version: z.literal(1),
  timezone: z.string().min(1),
  dimensions: z.array(z.object({ id: dimensionId, name: z.string() })),
  habits: z.array(habit),
  entries: z.record(z.string(), entry),
  restDays: z.array(localDate),
  seededOn: localDate,
  // Absent in demo data saved before M3.1; the demo store seeds them.
  goals: z.array(goal).optional(),
  measurements: z.record(z.string(), measurement).optional(),
})
