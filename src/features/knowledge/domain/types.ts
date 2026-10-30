import type { LocalDate } from "@/features/habits/domain/dates"

/**
 * Knowledge OS (docs/m4-knowledge-os-plan.md, D59–D66). One content model for books and podcast
 * episodes, podcast shows as their own entity, and one knowledge layer (notes and links) shared by
 * every format. Format-specific data lives in a nested block (`book` / `episode`) so a new format is
 * a new `kind` plus its block, never a parallel system.
 */
export type ContentKind = "book" | "episode"
export const CONTENT_KINDS: readonly ContentKind[] = ["book", "episode"]

/** D60: one status set for every format; only the labels change. */
export type ContentStatus = "planned" | "active" | "paused" | "done" | "abandoned"
export const STATUSES: readonly ContentStatus[] = ["planned", "active", "paused", "done", "abandoned"]

export const STATUS_LABEL: Record<ContentKind, Record<ContentStatus, string>> = {
  book: { planned: "Pendiente", active: "Leyendo", paused: "En pausa", done: "Terminado", abandoned: "Abandonado" },
  episode: { planned: "Pendiente", active: "En curso", paused: "En pausa", done: "Completado", abandoned: "Abandonado" },
}

export const KIND_LABEL: Record<ContentKind, { one: string; many: string }> = {
  book: { one: "Libro", many: "Libros" },
  episode: { one: "Episodio", many: "Episodios" },
}

/** D61: optional personal rating, integer 1–10 (same scale as Discover topics, D10). */
export const RATING_MIN = 1
export const RATING_MAX = 10
export type Rating = number

export type Platform = "spotify" | "apple" | "youtube" | "ivoox" | "web" | "other"
export const PLATFORMS: readonly Platform[] = ["spotify", "apple", "youtube", "ivoox", "web", "other"]
export const PLATFORM_LABEL: Record<Platform, string> = {
  spotify: "Spotify",
  apple: "Apple Podcasts",
  youtube: "YouTube",
  ivoox: "iVoox",
  web: "Web",
  other: "Otra",
}

/** Where imported metadata came from (M4g). Manual entries have no external reference. */
export type ExternalProvider = "openlibrary" | "googlebooks" | "itunes" | "spotify" | "youtube"
export const EXTERNAL_PROVIDERS: readonly ExternalProvider[] = ["openlibrary", "googlebooks", "itunes", "spotify", "youtube"]

export interface ExternalRef {
  provider: ExternalProvider
  id: string
  /** Shown next to imported data when the provider asks for it (PRD §4.1). */
  attribution: string | null
}

/** No cover means the generated typographic cover; external covers are served through the same-origin proxy (M4g). */
export type CoverRef = { source: "external"; url: string } | { source: "upload"; path: string }

export interface ContentBase {
  id: string
  kind: ContentKind
  title: string
  subtitle: string | null
  /** Authors of a book, guests of an episode. */
  creators: string[]
  description: string | null
  topics: string[]
  language: string | null
  status: ContentStatus
  favorite: boolean
  rating: Rating | null
  startedOn: LocalDate | null
  finishedOn: LocalDate | null
  cover: CoverRef | null
  sourceUrl: string | null
  external: ExternalRef | null
  /** Instants (ISO) stamped by the caller: reducers never read the clock. */
  createdAt: string
  updatedAt: string
}

export interface BookDetails {
  isbn13: string | null
  isbn10: string | null
  pageCount: number | null
  currentPage: number | null
  /** Manual progress when the page count is unknown (PRD §4.1). */
  progressPercent: number | null
  publisher: string | null
  publishedYear: number | null
}

export interface EpisodeDetails {
  /** D59: an episode may have no show (a one-off talk or video). */
  showId: string | null
  platform: Platform | null
  durationSeconds: number | null
  publishedOn: LocalDate | null
  episodeNumber: number | null
  /** Where you left it. */
  positionSeconds: number | null
}

export interface Book extends ContentBase {
  kind: "book"
  book: BookDetails
}

export interface Episode extends ContentBase {
  kind: "episode"
  episode: EpisodeDetails
}

export type ContentItem = Book | Episode

/** Groups episodes so the show's data is stored once (D59). It has no consumption status of its own. */
export interface PodcastShow {
  id: string
  title: string
  publisher: string | null
  description: string | null
  topics: string[]
  cover: CoverRef | null
  sourceUrl: string | null
  external: ExternalRef | null
  createdAt: string
  updatedAt: string
}

/** D62: one note model for every format. «Curiosidad» from the PRD is an `idea`. */
export type NoteType = "idea" | "learning" | "quote" | "application" | "note" | "question"
/** Section order on a content page. */
export const NOTE_TYPES: readonly NoteType[] = ["idea", "learning", "quote", "application", "note", "question"]

export const NOTE_LABEL: Record<NoteType, { one: string; many: string }> = {
  idea: { one: "Idea principal", many: "Ideas principales" },
  learning: { one: "Aprendizaje", many: "Aprendizajes" },
  quote: { one: "Cita", many: "Citas" },
  application: { one: "Aplicación práctica", many: "Aplicaciones prácticas" },
  note: { one: "Nota personal", many: "Notas personales" },
  question: { one: "Pregunta", many: "Preguntas" },
}

/** An episode's quotes are moments (with a timestamp), a book's are passages (with a page). */
export function noteLabel(type: NoteType, kind: ContentKind | null, plural = false): string {
  if (type === "quote" && kind === "episode") return plural ? "Momentos destacados" : "Momento destacado"
  return plural ? NOTE_LABEL[type].many : NOTE_LABEL[type].one
}

export type ApplicationStatus = "open" | "doing" | "done" | "dropped"
export const APPLICATION_STATUSES: readonly ApplicationStatus[] = ["open", "doing", "done", "dropped"]
export const APPLICATION_LABEL: Record<ApplicationStatus, string> = { open: "Pendiente", doing: "En marcha", done: "Hecha", dropped: "Descartada" }

/** An application can point to the habit or goal that carries it out (title copied, like review decisions). */
export interface ApplicationLink {
  type: "habit" | "goal"
  id: string
  title: string
}

/** Page for a book, timestamp for an episode, and an optional free label («Cap. 3»). */
export interface Locator {
  page: number | null
  positionSeconds: number | null
  label: string | null
}

/**
 * D63: text is plain in M4 (`format: "plain"`). A later rich format adds its document next to
 * `body`, and `body` stays the plain projection used by search, export and older clients, so
 * nothing written today is lost or needs converting.
 */
export type TextFormat = "plain"

export interface KnowledgeNote {
  id: string
  /** null: a free-standing idea with no book or episode (D62). */
  itemId: string | null
  type: NoteType
  format: TextFormat
  body: string
  locator: Locator | null
  starred: boolean
  /** Only for `application`. */
  applicationStatus: ApplicationStatus | null
  applicationLink: ApplicationLink | null
  topics: string[]
  createdAt: string
  updatedAt: string
}

export type EntityType = "item" | "show" | "note"
export interface EntityRef {
  type: EntityType
  id: string
}

/** Undirected link between two entities, stored once under its canonical key (relations.ts). */
export interface KnowledgeLink {
  key: string
  a: EntityRef
  b: EntityRef
  /** `manual` today; `suggested` is reserved for links proposed later and approved by the user. */
  origin: "manual"
  createdAt: string
}

/**
 * Reading or listening session (D64). Defined now so books and episodes share it; stored and
 * synced in M4h, where it can feed a habit like Focus does (D33).
 */
export interface LibrarySession {
  id: string
  itemId: string
  localDate: LocalDate
  minutes: number
  pagesFrom: number | null
  pagesTo: number | null
  note: string | null
}

export interface KnowledgeState {
  items: Record<string, ContentItem>
  shows: Record<string, PodcastShow>
  notes: Record<string, KnowledgeNote>
  links: Record<string, KnowledgeLink>
}

export function emptyKnowledge(): KnowledgeState {
  return { items: {}, shows: {}, notes: {}, links: {} }
}

/** D65: initial limits, enforced here and, from M4b, by the database. */
export const LIMITS = {
  title: 300,
  subtitle: 300,
  creator: 200,
  creators: 20,
  description: 10_000,
  note: 10_000,
  quote: 2_000,
  topic: 40,
  topics: 10,
  publisher: 200,
  language: 10,
  locatorLabel: 120,
  url: 2_048,
  externalId: 200,
  attribution: 200,
  linkTitle: 200,
  sessionNote: 500,
  sessionMinutes: 1_440,
  pages: 100_000,
  durationSeconds: 24 * 3600,
} as const
