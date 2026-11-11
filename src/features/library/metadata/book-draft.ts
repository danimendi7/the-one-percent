import { compactIsbn, isValidIsbn10, isValidIsbn13, isbn10to13 } from "@/features/knowledge/domain/text"
import { LIMITS } from "@/features/knowledge/domain/types"
import type { BookResult } from "./types"

/**
 * The confirmation sheet of the book assistant (M4g.3, docs/m4g-plan.md §17): what the provider
 * proposed, what the user changed, and which edition is chosen. Pure, so every rule is tested:
 *
 * - A field the user typed in is TOUCHED and nothing from the provider overwrites it again
 *   (choosing another edition, or the detail arriving late).
 * - Edition fields (title, subtitle, publisher, year, language, ISBN, pages, cover) follow the
 *   chosen edition when untouched — also to empty: another edition's publisher is not this one's.
 * - Work fields (authors, description) belong to the work and do not change with the edition.
 * - Nothing is invented: what no answer gives stays empty.
 */
export type DraftField = "title" | "subtitle" | "creators" | "publisher" | "year" | "language" | "isbn" | "pageCount" | "description"
const EDITION_FIELDS: readonly DraftField[] = ["title", "subtitle", "publisher", "year", "language", "isbn", "pageCount"]

export interface BookDraft {
  /** The result the draft started from, then the chosen edition (identity, link, attribution). */
  source: BookResult
  values: Record<DraftField, string>
  touched: DraftField[]
  /** The cover follows the edition unless the user decided about it. */
  cover: string | null
  useCover: boolean
  coverTouched: boolean
  keepDescription: boolean
  topicSuggestions: string[]
  /**
   * Both ISBNs of the edition shown. The sheet has one ISBN field; while it holds one of these, both
   * are saved (an edition's ISBN-10 is not lost because the field shows its ISBN-13).
   */
  isbns: { isbn13: string | null; isbn10: string | null }
}

function valuesOf(r: BookResult): Record<DraftField, string> {
  return {
    title: r.title,
    subtitle: r.subtitle ?? "",
    creators: (r.creators ?? []).join(", "),
    publisher: r.publisher ?? "",
    year: String(r.year ?? r.firstPublishedYear ?? ""),
    language: r.language ?? "",
    isbn: r.isbn13 ?? r.isbn10 ?? "",
    pageCount: r.pageCount ? String(r.pageCount) : "",
    description: r.description ?? "",
  }
}

export function createDraft(r: BookResult): BookDraft {
  return { source: r, values: valuesOf(r), touched: [], cover: r.cover, useCover: r.cover !== null, coverTouched: false, keepDescription: true, topicSuggestions: r.topicSuggestions, isbns: { isbn13: r.isbn13, isbn10: r.isbn10 } }
}

export function editField(d: BookDraft, field: DraftField, value: string): BookDraft {
  return { ...d, values: { ...d.values, [field]: value }, touched: d.touched.includes(field) ? d.touched : [...d.touched, field] }
}

export function setUseCover(d: BookDraft, use: boolean): BookDraft {
  return { ...d, useCover: use && d.cover !== null, coverTouched: true }
}

export function setKeepDescription(d: BookDraft, keep: boolean): BookDraft {
  return { ...d, keepDescription: keep }
}

/** Another edition of the same work: untouched edition fields (and an undecided cover) follow it. */
export function applyEdition(d: BookDraft, edition: BookResult): BookDraft {
  const next = valuesOf(edition)
  const values = { ...d.values }
  for (const f of EDITION_FIELDS) if (!d.touched.includes(f)) values[f] = next[f]
  // «Sin portada» chosen by the user stays chosen; otherwise the cover is the edition's (or none).
  const refused = d.coverTouched && !d.useCover
  return {
    ...d,
    // Identity stays the work's (an edition record may lack its work link); the edition's link and id are taken.
    source: { ...d.source, editionId: edition.editionId, sourceUrl: edition.sourceUrl, workTitle: d.source.workTitle ?? edition.workTitle },
    values,
    isbns: d.touched.includes("isbn") ? d.isbns : { isbn13: edition.isbn13, isbn10: edition.isbn10 },
    cover: refused ? d.cover : edition.cover,
    useCover: !refused && edition.cover !== null,
  }
}

/**
 * The detail of the chosen work and edition, arriving after the sheet opened: it may add what the
 * search did not carry (description, pages, topic suggestions). It fills untouched fields where
 * it has a value and never empties one (same edition: what the search said is still true). If the
 * user chose another edition while it travelled, only what belongs to the work is taken.
 */
export function applyDetail(d: BookDraft, detail: BookResult): BookDraft {
  const next = valuesOf({ ...detail, creators: detail.creators ?? d.source.creators })
  const values = { ...d.values }
  const sameEdition = detail.editionId === d.source.editionId
  const otherEdition = !sameEdition && !!d.source.editionId
  for (const f of Object.keys(values) as DraftField[]) {
    if (d.touched.includes(f) || next[f] === "" || (f === "title" && !sameEdition) || (otherEdition && EDITION_FIELDS.includes(f))) continue
    values[f] = next[f]
  }
  const cover = otherEdition ? d.cover : (d.cover ?? detail.cover)
  return {
    ...d,
    source: { ...d.source, workTitle: d.source.workTitle ?? detail.workTitle },
    values,
    isbns: !d.touched.includes("isbn") && (detail.isbn13 || detail.isbn10) && detail.editionId === d.source.editionId ? { isbn13: detail.isbn13, isbn10: detail.isbn10 } : d.isbns,
    cover,
    useCover: d.coverTouched ? d.useCover : cover !== null,
    topicSuggestions: detail.topicSuggestions.length ? detail.topicSuggestions : d.topicSuggestions,
  }
}

export type DraftErrors = Partial<Record<DraftField, string>>

const int = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null)

/** Spanish messages per field; empty when the draft can be saved. */
export function draftErrors(d: BookDraft): DraftErrors {
  const e: DraftErrors = {}
  const v = d.values
  if (!v.title.trim()) e.title = "Escribe al menos el título."
  else if (v.title.trim().length > LIMITS.title) e.title = `Como mucho ${LIMITS.title} caracteres.`
  const isbn = compactIsbn(v.isbn)
  if (isbn && !(isbn.length === 13 ? isValidIsbn13(isbn) : isbn.length === 10 && isValidIsbn10(isbn))) e.isbn = "Este ISBN no es válido: revisa las cifras."
  if (v.year.trim() && (int(v.year) === null || int(v.year)! < 1000 || int(v.year)! > 2100)) e.year = "Escribe el año con cuatro cifras."
  if (v.pageCount.trim() && (int(v.pageCount) === null || int(v.pageCount)! < 1 || int(v.pageCount)! > LIMITS.pages)) e.pageCount = "Escribe un número de páginas."
  if (v.language.trim() && !/^[a-zA-Z]{2,3}$/.test(v.language.trim())) e.language = "Usa un código como es, en o fr."
  if (v.description.length > 10_000) e.description = "La descripción es demasiado larga."
  return e
}

/** The draft as a result for `toBookInput`: the user's values over the provider's identity. */
export function draftResult(d: BookDraft): BookResult {
  const v = d.values
  const isbn = compactIsbn(v.isbn)
  // The ISBN shown is the edition's: keep its pair. Typed by the user: only what was typed (and its ISBN-13).
  const pair = isbn !== "" && (isbn === d.isbns.isbn13 || isbn === d.isbns.isbn10)
  const isbn13 = pair ? (d.isbns.isbn13 ?? isbn10to13(isbn)) : isbn.length === 13 ? isbn : isbn.length === 10 ? isbn10to13(isbn) : null
  const isbn10 = pair ? d.isbns.isbn10 : isbn.length === 10 ? isbn : null
  return {
    ...d.source,
    title: v.title.trim(),
    subtitle: v.subtitle.trim() || null,
    creators: v.creators
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    publisher: v.publisher.trim() || null,
    year: int(v.year),
    firstPublishedYear: null,
    language: v.language.trim().toLowerCase() || null,
    isbn13,
    isbn10,
    pageCount: int(v.pageCount),
    description: v.description.trim() || null,
    cover: d.useCover ? d.cover : null,
  }
}
