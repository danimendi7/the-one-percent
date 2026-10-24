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

export const habitsStateSchema = z.object({
  version: z.literal(1),
  timezone: z.string().min(1),
  dimensions: z.array(z.object({ id: dimensionId, name: z.string() })),
  habits: z.array(habit),
  entries: z.record(z.string(), entry),
  restDays: z.array(localDate),
  seededOn: localDate,
})
