import { cleanLine, cleanText, compactIsbn, isbn10to13, isValidIsbn10, isValidIsbn13, normalizeNames, normalizeTopics, safeUrl } from "@/features/knowledge/domain/text"
import { LIMITS } from "@/features/knowledge/domain/types"
import { coverKeyOf } from "./covers"
import { DESCRIPTION_MAX, TOPIC_SUGGESTIONS_MAX } from "./types"

/**
 * Turns provider values (untrusted, any type) into values that already satisfy the domain rules
 * of validation.ts, so a confirmed result is accepted by createItem without retouching. Every
 * function takes `unknown` and returns null (or []) instead of guessing.
 */

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–",
  laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", iexcl: "¡", iquest: "¿",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", uuml: "ü", ccedil: "ç",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", Uuml: "Ü", Ccedil: "Ç",
  agrave: "à", egrave: "è", ograve: "ò", ouml: "ö", auml: "ä", euml: "ë", iuml: "ï",
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      // Surrogates, NUL and out-of-range code points are dropped, not turned into characters.
      return cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) ? String.fromCodePoint(cp) : ""
    }
    return NAMED[e] ?? m
  })
}

/** Plain text from text that may hold HTML: tags removed (never rendered), entities decoded. */
export function plainText(s: string): string {
  const withBreaks = s
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
  // Decoding after removing tags: an encoded «&lt;b&gt;» stays visible text, never markup.
  return cleanText(decodeEntities(withBreaks).replace(/\t/g, " "))
}

/** One clean line (title, name) within `max`, cut at a word boundary; null if nothing is left. */
export function textLine(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null
  let s = cleanLine(plainText(v))
  if (s.length > max) {
    const cut = s.slice(0, max)
    const space = cut.lastIndexOf(" ")
    s = (space > max * 0.6 ? cut.slice(0, space) : cut).trim()
  }
  return s === "" ? null : s
}

/**
 * D7: a description as plain text of at most `max` characters, cut at the end of a sentence
 * (or a word) and marked with «…» when shortened. Blank-line runs collapse to one.
 */
export function description(v: unknown, max = DESCRIPTION_MAX): string | null {
  if (typeof v !== "string") return null
  let s = plainText(v)
    .split("\n")
    .map((l) => l.replace(/ {2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  if (s.length > max) {
    const room = s.slice(0, max - 1)
    const sentence = Math.max(room.lastIndexOf(". "), room.lastIndexOf("! "), room.lastIndexOf("? "), room.lastIndexOf("\n"))
    const end = sentence > max * 0.5 ? sentence + 1 : room.lastIndexOf(" ") > max * 0.5 ? room.lastIndexOf(" ") : max - 1
    s = room.slice(0, end).trim() + "…"
  }
  return s === "" ? null : s
}

/** A year from a number or free text («2020-03-23», «January 23, 2024», «c1967»). */
export function yearOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isInteger(v) && v >= 1000 && v <= 2100 ? v : null
  if (typeof v !== "string") return null
  const m = /(?:^|\D)(1\d{3}|20\d{2}|2100)(?!\d)/.exec(v)
  return m ? Number(m[1]) : null
}

/** MARC/ISO 639-2 codes used by Open Library (`/languages/spa`) to ISO 639-1. */
const LANG: Record<string, string> = {
  spa: "es", eng: "en", fre: "fr", fra: "fr", ger: "de", deu: "de", ita: "it", por: "pt", cat: "ca",
  baq: "eu", eus: "eu", glg: "gl", rum: "ro", ron: "ro", dut: "nl", nld: "nl", chi: "zh", zho: "zh",
  jpn: "ja", rus: "ru", pol: "pl", gre: "el", ell: "el", tur: "tr", swe: "sv", dan: "da", nor: "no",
  fin: "fi", cze: "cs", ces: "cs", hun: "hu", heb: "he", ara: "ar", kor: "ko", lat: "la",
}

/** ISO 639-1 when known; otherwise the provider's own short code; never a guess. */
export function languageOf(v: unknown): string | null {
  if (typeof v !== "string") return null
  const code = v.replace(/^\/languages\//, "").trim().toLowerCase()
  if (!/^[a-z]{2,3}$/.test(code)) return null
  return LANG[code] ?? code
}

/** Valid ISBN-13 and ISBN-10 out of a mixed list; an ISBN-10 alone also gives its ISBN-13. */
export function isbnsOf(values: unknown): { isbn13: string | null; isbn10: string | null } {
  const list = Array.isArray(values) ? values.filter((x): x is string => typeof x === "string").map(compactIsbn) : []
  const isbn13 = list.find((x) => x.length === 13 && isValidIsbn13(x)) ?? null
  const isbn10 = list.find((x) => x.length === 10 && isValidIsbn10(x)) ?? null
  return { isbn13: isbn13 ?? (isbn10 ? isbn10to13(isbn10) : null), isbn10 }
}

/** Names cleaned, deduplicated (accent- and case-insensitive) and within the domain limits. */
export function creatorsOf(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const names = values.map((v) => textLine(v, LIMITS.creator)).filter((x): x is string => x !== null)
  return normalizeNames(names).slice(0, LIMITS.creators)
}

/**
 * D6: subjects or genres as suggestions. Long or structured subjects («History -- Spain --
 * 20th century») are skipped rather than cut, so a suggestion reads as a real topic.
 */
export function topicSuggestionsOf(values: unknown, exclude: readonly string[] = []): string[] {
  if (!Array.isArray(values)) return []
  const skip = new Set(exclude.map((x) => x.toLowerCase()))
  const raw = values
    .map((v) => (typeof v === "string" ? cleanLine(plainText(v)) : ""))
    .filter((s) => s !== "" && s.length <= LIMITS.topic && !/--|[:;=]|https?:/.test(s) && !skip.has(s.toLowerCase()))
  return normalizeTopics(raw).slice(0, TOPIC_SUGGESTIONS_MAX)
}

export function positiveInt(v: unknown, max: number): number | null {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= max ? v : null
}

export function instantOf(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 40) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

/** An https URL on one of the given hosts, without credentials; tracking `uo` removed (Apple). */
export function providerUrl(v: unknown, hosts: readonly string[]): string | null {
  const s = typeof v === "string" ? safeUrl(v) : null
  if (!s) return null
  const u = new URL(s)
  if (u.protocol !== "https:" || u.port !== "" || !hosts.includes(u.hostname)) return null
  u.searchParams.delete("uo")
  return u.href.length <= LIMITS.url ? u.href : null
}

// ---------- covers: canonical provider URLs only (M4g.2 serves them through the proxy) ----------

export function openLibraryCover(id: unknown): string | null {
  return positiveInt(id, 999_999_999) === null ? null : `https://covers.openlibrary.org/b/id/${id}-L.jpg`
}

/** Apple artwork in the exact shape the cover proxy can serve (covers.ts); anything else is no cover. */
export function appleArtwork(v: unknown): string | null {
  return typeof v === "string" && coverKeyOf(v)?.provider === "apple" ? v : null
}

/** The only cover URLs the app stores from providers; the M4g.2 proxy serves nothing else. */
export function isCanonicalCoverUrl(url: string): boolean {
  return coverKeyOf(url) !== null
}
