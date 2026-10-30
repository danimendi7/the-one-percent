import { LIMITS } from "./types"

/**
 * Text helpers shared by validation, search and the forms: normalisation for matching, clean
 * user text, topics, URLs, ISBNs and timestamps. Pure and dependency-free.
 */

/** Accent- and case-insensitive form used for matching (never for display). */
export function normalize(s: string): string {
  let t = s.toLowerCase()
  // Fast path (measured in M4a): Spanish accents through a small table; the general Unicode
  // decomposition only runs when other non-ASCII letters remain. Same result as normalizeSlow.
  if (NON_ASCII.test(t)) {
    t = t.replace(FOLD_RE, (c) => FOLD[c])
    if (NEEDS_NFD.test(t)) t = t.normalize("NFD").replace(/\p{Diacritic}/gu, "")
  }
  return t.trim()
}

/** Reference implementation of `normalize`, kept for the equivalence test. */
export function normalizeSlow(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim()
}

const FOLD: Record<string, string> = {
  á: "a", à: "a", â: "a", ä: "a", ã: "a", å: "a",
  é: "e", è: "e", ê: "e", ë: "e",
  í: "i", ì: "i", î: "i", ï: "i",
  ó: "o", ò: "o", ô: "o", ö: "o", õ: "o",
  ú: "u", ù: "u", û: "u", ü: "u",
  ñ: "n", ç: "c", ý: "y", ÿ: "y",
}
const FOLD_RE = /[áàâäãåéèêëíìîïóòôöõúùûüñçýÿ]/g
const NON_ASCII = /[^\u0000-\u007f]/
/** Non-ASCII left after folding, other than Spanish punctuation that has no accents to strip. */
const NEEDS_NFD = /[^\u0000-\u007f¿¡«»“”‘’—–…·€º ª]/

/** Words of a text for the search index: letters and digits, normalised. */
export function tokenize(s: string): string[] {
  return normalize(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

/**
 * User text as stored: line breaks unified, control characters removed (tabs and line breaks
 * kept), trailing spaces per line and blank edges trimmed. Inner blank lines are kept: they are
 * the only structure plain text has (D63).
 */
export function cleanText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+$/u, ""))
    .join("\n")
    .trim()
}

/** One-line text (titles, names): any run of whitespace becomes one space. */
export function cleanLine(s: string): string {
  return cleanText(s).replace(/\s+/gu, " ")
}

/** Optional text: empty after cleaning means «not set». */
export function optionalText(s: string | null | undefined, line = false): string | null {
  if (s == null) return null
  const t = line ? cleanLine(s) : cleanText(s)
  return t === "" ? null : t
}

/**
 * Free topics (D66): cleaned, a leading «#» dropped, duplicates removed by their normalised form
 * (the first spelling wins), empty ones skipped. Limits are checked by validation, not truncated.
 */
export function normalizeTopics(topics: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of topics) {
    const t = cleanLine(raw).replace(/^#+/, "").trim()
    const key = normalize(t)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

/** Creators (authors, guests): cleaned and de-duplicated the same way. */
export function normalizeNames(names: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of names) {
    const n = cleanLine(raw)
    const key = normalize(n)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(n)
  }
  return out
}

/**
 * Only http(s) links, without credentials and within the length limit; returns the normalised
 * href, or null. Rejects `javascript:`, `data:` and the like, so a stored link is always safe to
 * render as an anchor (privacy and safety by design, plan §8.5).
 */
export function safeUrl(s: string | null | undefined): string | null {
  if (!s) return null
  const raw = s.trim()
  if (!raw || raw.length > LIMITS.url) return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null
  if (u.username || u.password || !u.hostname) return null
  return u.href.length > LIMITS.url ? null : u.href
}

/** ISBN without hyphens or spaces, uppercase X. */
export function compactIsbn(s: string): string {
  return s.replace(/[\s-]/g, "").toUpperCase()
}

export function isValidIsbn10(s: string): boolean {
  const v = compactIsbn(s)
  if (!/^\d{9}[\dX]$/.test(v)) return false
  let sum = 0
  for (let i = 0; i < 10; i++) sum += (v[i] === "X" ? 10 : Number(v[i])) * (10 - i)
  return sum % 11 === 0
}

export function isValidIsbn13(s: string): boolean {
  const v = compactIsbn(s)
  if (!/^97[89]\d{10}$/.test(v)) return false
  let sum = 0
  for (let i = 0; i < 13; i++) sum += Number(v[i]) * (i % 2 === 0 ? 1 : 3)
  return sum % 10 === 0
}

/** ISBN-10 → ISBN-13 (978 prefix), for matching both forms of the same edition. */
export function isbn10to13(s: string): string | null {
  if (!isValidIsbn10(s)) return null
  const core = "978" + compactIsbn(s).slice(0, 9)
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3)
  return core + String((10 - (sum % 10)) % 10)
}

/** «1:02:03», «12:34» or «75» (seconds) → seconds; null when it is not a timestamp. */
export function parseTimestamp(s: string): number | null {
  const t = s.trim()
  if (!/^\d+(:\d{1,2}){0,2}$/.test(t)) return null
  const parts = t.split(":").map(Number)
  if (parts.slice(1).some((p) => p > 59)) return null
  const seconds = parts.reduce((acc, p) => acc * 60 + p, 0)
  return seconds <= LIMITS.durationSeconds ? seconds : null
}

/** Seconds → «m:ss» or «h:mm:ss». */
export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

/** Text segments with the matched terms marked, mapped back to the original (accented) text. */
export function highlight(text: string, terms: readonly string[]): { text: string; match: boolean }[] {
  const wanted = terms.map(normalize).filter(Boolean)
  if (!wanted.length || !text) return [{ text, match: false }]
  // Normalised text with, for each of its characters, the index of the original character.
  let norm = ""
  const origin: number[] = []
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!
    const ch = String.fromCodePoint(cp)
    const n = ch.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    for (let k = 0; k < n.length; k++) {
      norm += n[k]
      origin.push(i)
    }
    i += ch.length
  }
  const marked = new Array<boolean>(text.length).fill(false)
  for (const w of wanted) {
    for (let at = norm.indexOf(w); at >= 0; at = norm.indexOf(w, at + 1)) {
      // Only matches that start a word, like the index (prefix search).
      if (at > 0 && /[\p{L}\p{N}]/u.test(norm[at - 1])) continue
      const from = origin[at]
      const lastOrig = origin[at + w.length - 1]
      const to = lastOrig + String.fromCodePoint(text.codePointAt(lastOrig)!).length
      for (let i = from; i < to; i++) marked[i] = true
    }
  }
  const out: { text: string; match: boolean }[] = []
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1]
    if (last && last.match === marked[i]) last.text += text[i]
    else out.push({ text: text[i], match: marked[i] })
  }
  return out
}

/** Code-unit order: right (and fast) for ISO dates, instants and ids. */
export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Spanish order for titles and names, ignoring accents and case (one shared instance: `localeCompare` with options is far slower). */
export const collator = new Intl.Collator("es", { sensitivity: "base" })

const topicKeyCache = new WeakMap<object, string[]>()

/** Normalised topics of an entity, cached per object (entities are immutable). */
export function topicKeys(entity: { topics: readonly string[] }): string[] {
  let keys = topicKeyCache.get(entity)
  if (!keys) topicKeyCache.set(entity, (keys = entity.topics.map(normalize)))
  return keys
}
