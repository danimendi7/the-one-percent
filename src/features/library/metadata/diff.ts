import { formatDate, localDateInZone } from "@/features/habits/domain/dates"
import type { ItemPatch, ShowInput } from "@/features/knowledge/domain/ops"
import { cleanLine, formatTimestamp, isbn10to13 } from "@/features/knowledge/domain/text"
import { PLATFORM_LABEL, type Book, type ContentItem, type CoverRef, type Episode, type ExternalProvider, type ExternalRef, type KnowledgeState, type Platform, type PodcastShow } from "@/features/knowledge/domain/types"
import { isOpenLibrary } from "./attribution"
import { applyDetail, createDraft, draftResult } from "./book-draft"
import { isbn13Of } from "./duplicates"
import type { BookResult, EpisodeResult, ShowResult } from "./types"

/**
 * «Buscar datos» / «Actualizar datos» (M4g.5, docs/m4g-plan.md §5.13): what a provider knows about
 * something already saved, compared field by field. Pure. The rules, so nothing is lost:
 *
 * - An empty field is offered preselected; a field with another value is offered unselected. A
 *   title is never empty, so it is always asked.
 * - What the provider does not know offers nothing: a comparison never empties a field.
 * - Status, rating, favorite, dates, progress, topics and notes have no row at all.
 * - A value that cannot hold (fewer pages than the user has read, a link another record already
 *   has) is shown with its reason and cannot be marked.
 * - Applying is one update with only the marked fields, and the record is compared again first:
 *   a marked field that changed since it was shown is not overwritten (`staleFields`).
 */
export type DiffField = "title" | "subtitle" | "creators" | "cover" | "description" | "pageCount" | "publisher" | "publishedYear" | "language" | "isbn" | "durationSeconds" | "publishedOn" | "platform" | "sourceUrl" | "external"

type Patch = ItemPatch | Partial<ShowInput>

export interface DiffRow {
  field: DiffField
  label: string
  /** `fill`: the record has nothing here. `replace`: it holds something else. */
  kind: "fill" | "replace"
  current: string | null
  proposed: string
  /** Why it cannot be applied; such a row is never marked. */
  blocked: string | null
  patch: Patch
  /** Only for covers: what to draw instead of text. */
  preview?: { current: CoverRef | null; proposed: CoverRef }
  /** The value this row was computed from, to notice that it changed. */
  stamp: string
}

interface Offer<V> {
  field: DiffField
  label: string
  current: V | null
  proposed: V | null
  same: (a: V, b: V) => boolean
  show: (v: V) => string
  patch: (v: V) => Patch
  blocked?: (v: V) => string | null
  preview?: (current: V | null, proposed: V) => DiffRow["preview"]
}

function rowOf<V>(o: Offer<V>): DiffRow | null {
  if (o.proposed === null) return null
  if (o.current !== null && o.same(o.current, o.proposed)) return null
  return {
    field: o.field,
    label: o.label,
    kind: o.current === null ? "fill" : "replace",
    current: o.current === null ? null : o.show(o.current),
    proposed: o.show(o.proposed),
    blocked: o.blocked?.(o.proposed) ?? null,
    patch: o.patch(o.proposed),
    ...(o.preview && { preview: o.preview(o.current, o.proposed) }),
    stamp: JSON.stringify(o.current),
  }
}

const rows = (offers: (DiffRow | null)[]): DiffRow[] => offers.filter((r): r is DiffRow => r !== null)

/** Capitals and spacing are not a change; an accent is (it may be the correction someone wants). */
const textKey = (s: string) => cleanLine(s).toLocaleLowerCase("es")
const sameText = (a: string, b: string) => textKey(a) === textKey(b)
const sameValue = <T>(a: T, b: T) => a === b
const asIs = (s: string) => s

const textRow = (field: DiffField, label: string, current: string | null, proposed: string | null, patch: (v: string) => Patch) => rowOf<string>({ field, label, current: current || null, proposed: proposed || null, same: sameText, show: asIs, patch })

/** A provider's description is cut at a sentence end: the start of a longer text is nothing new. */
const descriptionRow = (current: string | null, proposed: string | null) =>
  rowOf<string>({ field: "description", label: "Descripción", current: current || null, proposed: proposed || null, same: (a, b) => textKey(a).startsWith(textKey(b)), show: asIs, patch: (description) => ({ description }) })

const sameNames = (a: string[], b: string[]) => {
  const keys = (x: string[]) => [...x.map(textKey)].sort().join("\n")
  return keys(a) === keys(b)
}

const coverOf = (url: string | null): CoverRef | null => (url ? { source: "external", url } : null)
const sameCover = (a: CoverRef, b: CoverRef) => a.source === "external" && b.source === "external" && a.url === b.url

const coverRow = (current: CoverRef | null, proposed: string | null) =>
  rowOf<CoverRef>({
    field: "cover",
    label: "Portada",
    current,
    proposed: coverOf(proposed),
    same: sameCover,
    show: (v) => (v.source === "upload" ? "Tu portada" : "Portada externa"),
    patch: (cover) => ({ cover }),
    preview: (now, next) => ({ current: now, proposed: next }),
  })

const urlRow = (current: string | null, proposed: string | null) => rowOf<string>({ field: "sourceUrl", label: "Enlace", current, proposed, same: sameValue, show: asIs, patch: (sourceUrl) => ({ sourceUrl }) })

const PROVIDER_NAME: Record<ExternalProvider, string> = { openlibrary: "Open Library", googlebooks: "Google Books", itunes: "Apple Podcasts", spotify: "Spotify", youtube: "YouTube" }

const externalRow = (current: ExternalRef | null, proposed: ExternalRef | null, holder: { title: string } | undefined) =>
  rowOf<ExternalRef>({
    field: "external",
    label: "Vínculo con la fuente",
    current,
    proposed,
    same: (a, b) => a.provider === b.provider && a.id === b.id,
    show: (v) => PROVIDER_NAME[v.provider],
    patch: (external) => ({ external }),
    blocked: () => (holder ? `Ya está vinculado a «${holder.title}»: cada obra solo puede tener una ficha vinculada.` : null),
  })

/** Another item of the same kind already holding this reference (the database refuses a second one). */
function itemHolding(state: KnowledgeState, item: ContentItem, ref: ExternalRef | null) {
  return ref ? Object.values(state.items).find((o) => o.id !== item.id && o.kind === item.kind && o.external?.provider === ref.provider && o.external.id === ref.id) : undefined
}

function notesOf(state: KnowledgeState, itemId: string) {
  return Object.values(state.notes).filter((n) => n.itemId === itemId)
}

export function diffBook(state: KnowledgeState, item: Book, r: BookResult): DiffRow[] {
  const b = item.book
  const external = r.workId ? { provider: "openlibrary" as const, id: r.workId, attribution: r.attribution } : null
  const isbn13 = r.isbn13 ?? (r.isbn10 ? isbn10to13(r.isbn10) : null)
  const reached = Math.max(b.currentPage ?? 0, ...notesOf(state, item.id).map((n) => n.locator?.page ?? 0))
  type Isbn = { isbn13: string | null; isbn10: string | null }
  return rows([
    textRow("title", "Título", item.title, r.title, (title) => ({ title })),
    textRow("subtitle", "Subtítulo", item.subtitle, r.subtitle, (subtitle) => ({ subtitle })),
    rowOf<string[]>({ field: "creators", label: "Autor o autores", current: item.creators.length ? item.creators : null, proposed: r.creators?.length ? r.creators : null, same: sameNames, show: (v) => v.join(", "), patch: (creators) => ({ creators }) }),
    coverRow(item.cover, r.cover),
    descriptionRow(item.description, r.description),
    rowOf<number>({
      field: "pageCount",
      label: "Páginas",
      current: b.pageCount,
      proposed: r.pageCount,
      same: sameValue,
      show: String,
      patch: (pageCount) => ({ book: { pageCount } }),
      blocked: (v) => (v < reached ? `Tu progreso o tus notas llegan a la página ${reached}: este número no encaja.` : null),
    }),
    textRow("publisher", "Editorial", b.publisher, r.publisher, (publisher) => ({ book: { publisher } })),
    rowOf<number>({ field: "publishedYear", label: "Año", current: b.publishedYear, proposed: r.year ?? r.firstPublishedYear, same: sameValue, show: String, patch: (publishedYear) => ({ book: { publishedYear } }) }),
    textRow("language", "Idioma", item.language, r.language, (language) => ({ language })),
    rowOf<Isbn>({
      field: "isbn",
      label: "ISBN",
      current: b.isbn13 || b.isbn10 ? { isbn13: b.isbn13, isbn10: b.isbn10 } : null,
      proposed: isbn13 || r.isbn10 ? { isbn13, isbn10: r.isbn10 } : null,
      same: (x, y) => isbn13Of(x.isbn13, x.isbn10) === isbn13Of(y.isbn13, y.isbn10),
      show: (v) => v.isbn13 ?? v.isbn10 ?? "",
      patch: (v) => ({ book: { isbn13: v.isbn13, isbn10: v.isbn10 } }),
    }),
    urlRow(item.sourceUrl, r.sourceUrl),
    externalRow(item.external, external, itemHolding(state, item, external)),
  ])
}

export function diffEpisode(state: KnowledgeState, item: Episode, r: EpisodeResult, timeZone: string): DiffRow[] {
  const e = item.episode
  const external = { provider: "itunes" as const, id: r.id, attribution: r.attribution }
  const reached = Math.max(e.positionSeconds ?? 0, ...notesOf(state, item.id).map((n) => n.locator?.positionSeconds ?? 0))
  return rows([
    textRow("title", "Título", item.title, r.title, (title) => ({ title })),
    coverRow(item.cover, r.cover),
    descriptionRow(item.description, r.description),
    rowOf<number>({
      field: "durationSeconds",
      label: "Duración",
      current: e.durationSeconds,
      proposed: r.durationSeconds,
      same: sameValue,
      show: formatTimestamp,
      patch: (durationSeconds) => ({ episode: { durationSeconds } }),
      blocked: (v) => (v < reached ? `Tu progreso o tus notas llegan al minuto ${formatTimestamp(reached)}: esta duración no encaja.` : null),
    }),
    rowOf<string>({
      field: "publishedOn",
      label: "Fecha",
      current: e.publishedOn,
      proposed: r.publishedAt ? localDateInZone(new Date(r.publishedAt), timeZone) : null,
      same: sameValue,
      show: (v) => formatDate(v, { day: "numeric", month: "short", year: "numeric" }),
      patch: (publishedOn) => ({ episode: { publishedOn } }),
    }),
    rowOf<Platform>({ field: "platform", label: "Plataforma", current: e.platform, proposed: "apple", same: sameValue, show: (v) => PLATFORM_LABEL[v], patch: (platform) => ({ episode: { platform } }) }),
    urlRow(item.sourceUrl, r.sourceUrl),
    externalRow(item.external, external, itemHolding(state, item, external)),
  ])
}

export function diffShow(state: KnowledgeState, show: PodcastShow, r: ShowResult): DiffRow[] {
  const external = { provider: "itunes" as const, id: r.id, attribution: r.attribution }
  const holder = Object.values(state.shows).find((o) => o.id !== show.id && o.external?.provider === external.provider && o.external.id === external.id)
  return rows([
    textRow("title", "Nombre", show.title, r.title, (title) => ({ title })),
    textRow("publisher", "Autor o productora", show.publisher, r.publisher, (publisher) => ({ publisher })),
    coverRow(show.cover, r.cover),
    urlRow(show.sourceUrl, r.sourceUrl),
    externalRow(show.external, external, holder),
  ])
}

/**
 * The search result completed with its detail, as the book assistant does. The names stay a list:
 * the draft keeps them in one text and would split «Garcia Marquez, Gabriel» at its comma.
 */
export function withDetail(chosen: BookResult, detail: BookResult): BookResult {
  return { ...draftResult(applyDetail(createDraft(chosen), detail)), creators: detail.creators ?? chosen.creators }
}

export type UpdateTarget = { entity: "item" | "show"; id: string }
export type Proposal = { kind: "book"; result: BookResult } | { kind: "episode"; result: EpisodeResult } | { kind: "show"; result: ShowResult }

/** The comparison with the record as it is now; null when there is no such record any more. */
export function diffTarget(state: KnowledgeState, target: UpdateTarget, proposal: Proposal, timeZone: string): DiffRow[] | null {
  if (target.entity === "show") {
    if (!Object.hasOwn(state.shows, target.id) || proposal.kind !== "show") return null
    return diffShow(state, state.shows[target.id], proposal.result)
  }
  if (!Object.hasOwn(state.items, target.id)) return null
  const item = state.items[target.id]
  if (item.kind === "book" && proposal.kind === "book") return diffBook(state, item, proposal.result)
  if (item.kind === "episode" && proposal.kind === "episode") return diffEpisode(state, item, proposal.result, timeZone)
  return null
}

/** What the sheet starts with marked: only empty fields that can be filled. */
export function defaultSelection(list: readonly DiffRow[]): Set<DiffField> {
  return new Set(list.filter((r) => r.kind === "fill" && !r.blocked).map((r) => r.field))
}

/** The one update of an application: only the marked fields, a book's or episode's together. */
export function patchOf(list: readonly DiffRow[], selected: ReadonlySet<DiffField>): Patch {
  const out: Record<string, unknown> = {}
  for (const r of list) {
    if (!selected.has(r.field) || r.blocked) continue
    for (const [k, v] of Object.entries(r.patch)) out[k] = k === "book" || k === "episode" ? { ...(out[k] as object | undefined), ...(v as object) } : v
  }
  return out as Patch
}

/** Marked fields that no longer are what was shown: they must be reviewed again, never overwritten. */
export function staleFields(shown: readonly DiffRow[], fresh: readonly DiffRow[], selected: ReadonlySet<DiffField>): DiffField[] {
  return shown
    .filter((r) => selected.has(r.field))
    .filter((r) => {
      const now = fresh.find((x) => x.field === r.field)
      return !now || now.stamp !== r.stamp || now.blocked !== r.blocked
    })
    .map((r) => r.field)
}

/** The Open Library edition a saved link points to, if it is an edition's. */
export function editionIdOf(url: string | null): string | null {
  if (!url || !isOpenLibrary(url)) return null
  return /^\/books\/(OL\d+M)(?:\/|$)/.exec(new URL(url).pathname)?.[1] ?? null
}

export type Lookup = { kind: "book"; work: string; edition: string | null } | { kind: "show"; id: string } | { kind: "episode"; id: string; show: string }

/** Where a saved record can be found again without searching; null: it has to be searched. */
export function directLookup(state: KnowledgeState, target: UpdateTarget): Lookup | null {
  if (target.entity === "show") {
    const show = Object.hasOwn(state.shows, target.id) ? state.shows[target.id] : undefined
    return show?.external?.provider === "itunes" ? { kind: "show", id: show.external.id } : null
  }
  const item = Object.hasOwn(state.items, target.id) ? state.items[target.id] : undefined
  if (!item) return null
  if (item.kind === "book") return item.external?.provider === "openlibrary" ? { kind: "book", work: item.external.id, edition: editionIdOf(item.sourceUrl) } : null
  const show = item.episode.showId ? state.shows[item.episode.showId] : undefined
  return item.external?.provider === "itunes" && show?.external?.provider === "itunes" ? { kind: "episode", id: item.external.id, show: show.external.id } : null
}

/** «Actualizar datos» only with a reference this app knows how to look up. */
export function updateLabel(record: { external: ExternalRef | null }): "Actualizar datos" | "Buscar datos" {
  return record.external?.provider === "openlibrary" || record.external?.provider === "itunes" ? "Actualizar datos" : "Buscar datos"
}
