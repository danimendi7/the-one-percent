import { APPLICATION_STATUSES, NOTE_TYPES, STATUSES, type ApplicationStatus, type ContentStatus, type NoteType } from "./types"
import type { KnowledgeFilters, NoteFormat } from "./search"

/**
 * Cerebro's state in the URL (M4e): what is searched, filtered, grouped and shown, so it survives
 * reloading and going back. Short Spanish keys; anything unknown or malformed is ignored, never an
 * error (a URL can be typed by hand).
 */

export type BrainView = "ideas" | "aplicaciones"
export type BrainGroup = "ninguno" | "contenido" | "tema"
export type BrainPeriod = "7d" | "30d" | "12m"

export interface BrainQuery {
  q: string
  types: NoteType[]
  origins: NoteFormat[]
  topic: string | null
  minRating: number | null
  favorite: boolean
  starred: boolean
  contentStatus: ContentStatus[]
  period: BrainPeriod | null
  applications: ApplicationStatus[]
  group: BrainGroup
  view: BrainView
  /** One note on its own, with its connections. */
  note: string | null
}

export const EMPTY_BRAIN_QUERY: BrainQuery = {
  q: "",
  types: [],
  origins: [],
  topic: null,
  minRating: null,
  favorite: false,
  starred: false,
  contentStatus: [],
  period: null,
  applications: [],
  group: "ninguno",
  view: "ideas",
  note: null,
}

const ORIGIN_KEYS: Record<string, NoteFormat> = { libros: "book", podcasts: "episode", sueltas: "free" }
const ORIGIN_OUT: Record<NoteFormat, string> = { book: "libros", episode: "podcasts", free: "sueltas" }
const PERIODS: BrainPeriod[] = ["7d", "30d", "12m"]
const MAX_Q = 200

function list<T extends string>(raw: string | null, allowed: readonly T[], map?: Record<string, T>): T[] {
  if (!raw) return []
  const out: T[] = []
  for (const part of raw.split(",")) {
    const v = (map ? map[part] : (part as T)) as T | undefined
    if (v && allowed.includes(v) && !out.includes(v)) out.push(v)
  }
  return out
}

/** Reads the URL; tolerant of anything. */
export function parseBrainQuery(get: (key: string) => string | null): BrainQuery {
  const rating = Number(get("val"))
  const group = get("agrupar")
  const period = get("fecha")
  return {
    q: (get("q") ?? "").slice(0, MAX_Q),
    types: list(get("tipo"), NOTE_TYPES),
    origins: list(get("origen"), ["book", "episode", "free"] as NoteFormat[], ORIGIN_KEYS),
    topic: get("tema")?.trim().slice(0, 40) || null,
    minRating: Number.isInteger(rating) && rating >= 1 && rating <= 10 ? rating : null,
    favorite: get("fav") === "1",
    starred: get("destacadas") === "1",
    contentStatus: list(get("estado"), STATUSES),
    period: PERIODS.includes(period as BrainPeriod) ? (period as BrainPeriod) : null,
    applications: list(get("app"), APPLICATION_STATUSES),
    group: group === "contenido" || group === "tema" ? group : "ninguno",
    view: get("vista") === "aplicaciones" ? "aplicaciones" : "ideas",
    note: get("nota")?.slice(0, 100) || null,
  }
}

/** The query string (without «?»), only with what differs from the default, in a stable order. */
export function brainQueryString(b: BrainQuery): string {
  const p = new URLSearchParams()
  if (b.view !== "ideas") p.set("vista", b.view)
  if (b.note) p.set("nota", b.note)
  if (b.q.trim()) p.set("q", b.q.slice(0, MAX_Q))
  if (b.types.length) p.set("tipo", b.types.join(","))
  if (b.origins.length) p.set("origen", b.origins.map((o) => ORIGIN_OUT[o]).join(","))
  if (b.topic) p.set("tema", b.topic)
  if (b.minRating) p.set("val", String(b.minRating))
  if (b.favorite) p.set("fav", "1")
  if (b.starred) p.set("destacadas", "1")
  if (b.contentStatus.length) p.set("estado", b.contentStatus.join(","))
  if (b.period) p.set("fecha", b.period)
  if (b.applications.length) p.set("app", b.applications.join(","))
  if (b.group !== "ninguno") p.set("agrupar", b.group)
  return p.toString()
}

const DAY = 86_400_000

/** The domain filters for a query; `now` fixes «last 7 days» and the like. */
export function brainFilters(b: BrainQuery, now: Date): KnowledgeFilters {
  const f: KnowledgeFilters = {}
  if (b.types.length) f.noteTypes = b.types
  if (b.origins.length) f.formats = b.origins
  if (b.topic) f.topics = [b.topic]
  if (b.minRating) f.minRating = b.minRating
  if (b.favorite) f.favorite = true
  if (b.starred) f.starred = true
  if (b.contentStatus.length) f.contentStatus = b.contentStatus
  if (b.applications.length) f.applicationStatus = b.applications
  if (b.period) f.since = new Date(now.getTime() - (b.period === "7d" ? 7 : b.period === "30d" ? 30 : 365) * DAY).toISOString()
  if (b.view === "aplicaciones") f.noteTypes = ["application"]
  return f
}

/** How many filters are on (the «Filtros» button shows it); text, view and grouping are not filters. */
export function activeFilterCount(b: BrainQuery): number {
  return (
    Number(b.types.length > 0) +
    Number(b.origins.length > 0) +
    Number(!!b.topic) +
    Number(!!b.minRating) +
    Number(b.favorite) +
    Number(b.starred) +
    Number(b.contentStatus.length > 0) +
    Number(!!b.period) +
    Number(b.applications.length > 0)
  )
}
