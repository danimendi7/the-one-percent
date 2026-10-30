import { z } from "zod"
import { isLocalDate } from "@/features/habits/domain/dates"
import { isValidIsbn10, isValidIsbn13, normalize, safeUrl } from "./text"
import {
  APPLICATION_STATUSES,
  EXTERNAL_PROVIDERS,
  LIMITS,
  NOTE_TYPES,
  PLATFORMS,
  RATING_MAX,
  RATING_MIN,
  STATUSES,
  type ContentItem,
  type KnowledgeLink,
  type KnowledgeNote,
  type LibrarySession,
  type PodcastShow,
} from "./types"

/**
 * Schemas of the stored entities. Reducers (ops.ts) build an entity from cleaned input and check
 * it here, so every invariant lives in one place; the same schemas will validate the persisted
 * copy and pulled rows (M4c), and the database repeats them as CHECKs (M4b).
 */
const id = z.string().min(1).max(100)
const instant = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "invalid instant")
const localDate = z.string().refine(isLocalDate, "invalid date")
const line = (max: number) => z.string().min(1).max(max).refine((s) => s.trim() === s && !/\s{2,}|\n/.test(s), "not a clean line")
const block = (max: number) => z.string().min(1).max(max).refine((s) => s.trim() === s, "not trimmed")
const url = z.string().refine((s) => safeUrl(s) === s, "unsafe url")

const uniqueNormalized = (xs: string[]) => new Set(xs.map(normalize)).size === xs.length
const topics = z.array(line(LIMITS.topic)).max(LIMITS.topics).refine(uniqueNormalized, "duplicate topic")
const creators = z.array(line(LIMITS.creator)).max(LIMITS.creators).refine(uniqueNormalized, "duplicate name")

const cover = z
  .discriminatedUnion("source", [
    z.object({ source: z.literal("external"), url }).strict(),
    z.object({ source: z.literal("upload"), path: z.string().min(1).max(500) }).strict(),
  ])
  .nullable()

const external = z
  .object({
    provider: z.enum(EXTERNAL_PROVIDERS as [string, ...string[]]),
    id: z.string().min(1).max(LIMITS.externalId),
    attribution: line(LIMITS.attribution).nullable(),
  })
  .strict()
  .nullable()

const rating = z.number().int().min(RATING_MIN).max(RATING_MAX).nullable()
const count = (max: number) => z.number().int().min(0).max(max)

const base = {
  id,
  title: line(LIMITS.title),
  subtitle: line(LIMITS.subtitle).nullable(),
  creators,
  description: block(LIMITS.description).nullable(),
  topics,
  language: line(LIMITS.language).nullable(),
  status: z.enum(STATUSES as [string, ...string[]]),
  favorite: z.boolean(),
  rating,
  startedOn: localDate.nullable(),
  finishedOn: localDate.nullable(),
  cover,
  sourceUrl: url.nullable(),
  external,
  createdAt: instant,
  updatedAt: instant,
}

const bookSchema = z
  .object({
    ...base,
    kind: z.literal("book"),
    book: z
      .object({
        isbn13: z.string().refine(isValidIsbn13, "invalid ISBN-13").nullable(),
        isbn10: z.string().refine(isValidIsbn10, "invalid ISBN-10").nullable(),
        pageCount: count(LIMITS.pages).min(1).nullable(),
        currentPage: count(LIMITS.pages).nullable(),
        progressPercent: z.number().min(0).max(100).nullable(),
        publisher: line(LIMITS.publisher).nullable(),
        publishedYear: z.number().int().min(-3000).max(3000).nullable(),
      })
      .strict()
      .refine((b) => b.pageCount === null || b.currentPage === null || b.currentPage <= b.pageCount, "current page beyond the last one"),
  })
  .strict()

const episodeSchema = z
  .object({
    ...base,
    kind: z.literal("episode"),
    episode: z
      .object({
        showId: id.nullable(),
        platform: z.enum(PLATFORMS as [string, ...string[]]).nullable(),
        durationSeconds: count(LIMITS.durationSeconds).min(1).nullable(),
        publishedOn: localDate.nullable(),
        episodeNumber: count(1_000_000).nullable(),
        positionSeconds: count(LIMITS.durationSeconds).nullable(),
      })
      .strict()
      .refine((e) => e.durationSeconds === null || e.positionSeconds === null || e.positionSeconds <= e.durationSeconds, "position beyond the end"),
  })
  .strict()

export const itemSchema = z
  .discriminatedUnion("kind", [bookSchema, episodeSchema])
  .refine((i) => !i.startedOn || !i.finishedOn || i.startedOn <= i.finishedOn, { message: "finished before it started", path: ["finishedOn"] }) as unknown as z.ZodType<ContentItem>

export const showSchema = z
  .object({
    id,
    title: line(LIMITS.title),
    publisher: line(LIMITS.publisher).nullable(),
    description: block(LIMITS.description).nullable(),
    topics,
    cover,
    sourceUrl: url.nullable(),
    external,
    createdAt: instant,
    updatedAt: instant,
  })
  .strict() as unknown as z.ZodType<PodcastShow>

const locator = z
  .object({
    page: count(LIMITS.pages).nullable(),
    positionSeconds: count(LIMITS.durationSeconds).nullable(),
    label: line(LIMITS.locatorLabel).nullable(),
  })
  .strict()
  .refine((l) => l.page !== null || l.positionSeconds !== null || l.label !== null, "empty locator")
  .nullable()

export const noteSchema = z
  .object({
    id,
    itemId: id.nullable(),
    type: z.enum(NOTE_TYPES as [string, ...string[]]),
    format: z.literal("plain"),
    body: block(LIMITS.note),
    locator,
    starred: z.boolean(),
    applicationStatus: z.enum(APPLICATION_STATUSES as [string, ...string[]]).nullable(),
    applicationLink: z
      .object({ type: z.enum(["habit", "goal"]), id, title: line(LIMITS.linkTitle) })
      .strict()
      .nullable(),
    topics,
    createdAt: instant,
    updatedAt: instant,
  })
  .strict()
  .refine((n) => n.type !== "quote" || n.body.length <= LIMITS.quote, { message: "quote too long", path: ["body"] })
  .refine((n) => (n.type === "application") === (n.applicationStatus !== null), { message: "status only for applications", path: ["applicationStatus"] })
  .refine((n) => n.type === "application" || n.applicationLink === null, { message: "link only for applications", path: ["applicationLink"] })
  .refine((n) => n.itemId !== null || n.locator === null, { message: "a free note has no locator", path: ["locator"] }) as unknown as z.ZodType<KnowledgeNote>

const ref = z.object({ type: z.enum(["item", "show", "note"]), id }).strict()
export const linkSchema = z
  .object({ key: z.string().min(1), a: ref, b: ref, origin: z.literal("manual"), createdAt: instant })
  .strict() as unknown as z.ZodType<KnowledgeLink>

export const sessionSchema = z
  .object({
    id,
    itemId: id,
    localDate,
    minutes: z.number().int().min(1).max(LIMITS.sessionMinutes),
    pagesFrom: count(LIMITS.pages).nullable(),
    pagesTo: count(LIMITS.pages).nullable(),
    note: block(LIMITS.sessionNote).nullable(),
  })
  .strict()
  .refine((s) => s.pagesFrom === null || s.pagesTo === null || s.pagesFrom <= s.pagesTo, "pages go backwards") as unknown as z.ZodType<LibrarySession>

/** First problem of a failed check, as a short path + message for errors and tests. */
export function firstIssue(error: z.ZodError): string {
  const i = error.issues[0]
  return i ? `${i.path.join(".") || "(root)"}: ${i.message}` : "invalid"
}
