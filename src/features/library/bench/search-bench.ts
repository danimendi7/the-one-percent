import { moveNote, updateItem, updateNote } from "@/features/knowledge/domain/ops"
import { buildIndex, explainMatch, indexBuilder, search, type KnowledgeIndex, type SearchQuery } from "@/features/knowledge/domain/search"
import { VOLUME_5K, syntheticLibrary, type SyntheticSize } from "@/features/knowledge/domain/synthetic"
import { highlight } from "@/features/knowledge/domain/text"
import type { KnowledgeState } from "@/features/knowledge/domain/types"

/**
 * M4e search diagnostics: the SYNTHETIC library of M4a (generated text, no real titles, people or
 * notes), measured with the same functions Cerebro uses. Shared by the development page
 * (`/dev/knowledge`, to run on a real phone) and `npm run bench:search` (Chromium ×1 and ×4).
 * Its IndexedDB copy goes to a database of its own, deleted by name at the end; nothing else is
 * opened, written or deleted, and nothing leaves the device.
 */

export const BENCH_DB = "the-one-percent-bench-synthetic"

export const BENCH_SIZES = {
  "5k": VOLUME_5K,
  "10k": { ...VOLUME_5K, notes: 10_000, links: 2_000 },
} satisfies Record<string, SyntheticSize>
export type BenchSize = keyof typeof BENCH_SIZES

export interface Stats {
  median: number
  p95: number
  max: number
  runs: number
}

export interface SearchBenchResult {
  size: BenchSize
  notes: number
  items: number
  generateMs: number
  index: { coldMs: number; docs: number; tokens: number }
  /** The same build in slices of SLICE_MS, as the screen does it: total time and the longest slice. */
  sliced: { totalMs: number; slices: number; longestSliceMs: number; sliceBudgetMs: number }
  incremental: { editNoteMs: number; moveNoteMs: number; renameContentMs: number; renamedNotes: number }
  /** search() alone, per query. */
  queries: Record<string, Stats & { hits: number }>
  /** What the screen does per keystroke: search, then explain and highlight the first page. */
  typing: Stats
  /** Filters combined (no text, and with text). */
  combined: Record<string, Stats & { hits: number }>
  memoryMB: { state: number | null; index: number | null; note: string }
  storage: { writeMs: number; readMs: number; rows: number; deleted: boolean } | null
}

const now = () => performance.now()

function stats(xs: number[]): Stats {
  const s = [...xs].sort((a, b) => a - b)
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  return { median: q(0.5), p95: q(0.95), max: s[s.length - 1], runs: s.length }
}

function repeat(n: number, fn: () => void): Stats {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const t0 = now()
    fn()
    out.push(now() - t0)
  }
  return stats(out)
}

/** Chromium only, and approximate (no forced GC in a page): null elsewhere. */
function heapMB(): number | null {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
  return m ? m.usedJSHeapSize / 2 ** 20 : null
}

const PAGE = 60
/** Slice budget of the screen's build (keeps each task well under the 50 ms of a «long task»). */
export const SLICE_MS = 8

/** The last run's data, kept alive so the heap reading of the Chromium script includes it. */
export let lastRun: { state: KnowledgeState; index: KnowledgeIndex } | null = null

/** One keystroke of the search box: the query, then the visible page explained and highlighted. */
function screenSearch(state: KnowledgeState, index: KnowledgeIndex, q: SearchQuery) {
  const r = search(state, index, { ...q, limit: PAGE })
  for (const h of r.notes) {
    explainMatch(state, h.entity, r.terms)
    highlight(h.entity.body, r.terms)
  }
  return r
}

async function storageRoundTrip(state: KnowledgeState): Promise<SearchBenchResult["storage"]> {
  if (typeof indexedDB === "undefined") return null
  const open = () =>
    new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open(BENCH_DB, 1)
      r.onupgradeneeded = () => r.result.createObjectStore("note")
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
  const done = (t: IDBTransaction) =>
    new Promise<void>((res, rej) => {
      t.oncomplete = () => res()
      t.onerror = () => rej(t.error)
      t.onabort = () => rej(t.error)
    })
  const notes = Object.values(state.notes)
  const db = await open()
  try {
    let t0 = now()
    const w = db.transaction("note", "readwrite")
    for (const n of notes) w.objectStore("note").put(n, n.id)
    await done(w)
    const writeMs = now() - t0
    t0 = now()
    const r = db.transaction("note", "readonly")
    const all = r.objectStore("note").getAll()
    await done(r)
    const readMs = now() - t0
    return { writeMs, readMs, rows: (all.result as unknown[]).length, deleted: await removeBenchData(db) }
  } catch (e) {
    await removeBenchData(db)
    throw e
  }
}

/** Deletes ONLY the synthetic database, by its exact name. */
export function removeBenchData(open?: IDBDatabase): Promise<boolean> {
  open?.close()
  if (typeof indexedDB === "undefined") return Promise.resolve(false)
  return new Promise((res) => {
    const r = indexedDB.deleteDatabase(BENCH_DB)
    r.onsuccess = () => res(true)
    r.onerror = () => res(false)
    r.onblocked = () => res(false)
  })
}

export async function runSearchBench(size: BenchSize, opts: { runs?: number; storage?: boolean } = {}): Promise<SearchBenchResult> {
  const runs = opts.runs ?? 30
  const h0 = heapMB()
  let t0 = now()
  let state = syntheticLibrary(BENCH_SIZES[size])
  const generateMs = now() - t0
  const h1 = heapMB()

  t0 = now()
  const index = buildIndex(state)
  const coldMs = now() - t0
  const h2 = heapMB()

  const b = indexBuilder(state)
  let slices = 0
  let longest = 0
  t0 = now()
  for (;;) {
    const s0 = now()
    const finished = b.step(() => now() - s0 >= SLICE_MS)
    longest = Math.max(longest, now() - s0)
    slices++
    if (finished) break
  }
  const sliced = { totalMs: now() - t0, slices, longestSliceMs: longest, sliceBudgetMs: SLICE_MS }

  // Incremental updates, as the app makes them after each change.
  const ctx = { now: "2026-10-30T12:00:00.000Z", today: "2026-10-30" }
  const noteId = Object.keys(state.notes)[123]
  let r1 = updateNote(state, noteId, { body: state.notes[noteId].body + " añadido" }, ctx)
  if (r1.ok) state = r1.state
  t0 = now()
  buildIndex(state, index)
  const editNoteMs = now() - t0
  const target = Object.keys(state.items)[7]
  r1 = moveNote(state, noteId, target, ctx)
  if (r1.ok) state = r1.state
  t0 = now()
  buildIndex(state, index)
  const moveNoteMs = now() - t0
  const busiest = Object.values(state.notes).reduce<Record<string, number>>((acc, n) => (n.itemId ? ((acc[n.itemId] = (acc[n.itemId] ?? 0) + 1), acc) : acc), {})
  const [renamed, renamedNotes] = Object.entries(busiest).sort((a, b) => b[1] - a[1])[0]
  const r2 = updateItem(state, renamed, { title: state.items[renamed].title + " renombrado" }, ctx)
  if (r2.ok) state = r2.state
  t0 = now()
  buildIndex(state, index)
  const renameContentMs = now() - t0

  const rare = [...index.postings].find(([t, p]) => p.size === 1 && t.length > 6 && [...p.keys()][0].startsWith("note:"))?.[0] ?? "zzz"
  const cases: Record<string, SearchQuery> = {
    "palabra frecuente (atención)": { query: "atención" },
    "dos palabras (hábito sueño)": { query: "hábito sueño" },
    "tres palabras (método práctica memoria)": { query: "método práctica memoria" },
    [`palabra rara (${rare})`]: { query: rare },
    "prefijo corto (en)": { query: "en" },
    "sin resultados (xqzw)": { query: "xqzw" },
  }
  const queries: SearchBenchResult["queries"] = {}
  for (const [name, q] of Object.entries(cases)) queries[name] = { ...repeat(runs, () => search(state, index, { ...q, limit: PAGE })), hits: search(state, index, q).total.notes }

  // Typing «atención sueño» letter by letter, several times: every keystroke as the screen runs it.
  const typed: number[] = []
  const word = "atención sueño"
  for (let k = 0; k < Math.max(2, Math.round(runs / 10)); k++)
    for (let i = 1; i <= word.length; i++) {
      const t = now()
      screenSearch(state, index, { query: word.slice(0, i) })
      typed.push(now() - t)
    }

  const combinedCases: Record<string, SearchQuery> = {
    "libros + idea + valoración ≥ 7": { filters: { formats: ["book"], noteTypes: ["idea"], minRating: 7 } },
    "tema + estado del contenido + favoritos": { filters: { topics: ["sueño"], contentStatus: ["active", "done"], favorite: true } },
    "aplicaciones pendientes o en marcha, último año": { filters: { noteTypes: ["application"], applicationStatus: ["open", "doing"], since: "2025-10-30T00:00:00.000Z" } },
    "texto + podcasts + tema": { query: "atención", filters: { formats: ["episode"], topics: ["hábitos"] } },
  }
  const combined: SearchBenchResult["combined"] = {}
  for (const [name, q] of Object.entries(combinedCases)) combined[name] = { ...repeat(runs, () => screenSearch(state, index, q)), hits: search(state, index, q).total.notes }

  const storage = opts.storage === false ? null : await storageRoundTrip(state)
  lastRun = { state, index }
  return {
    size,
    notes: Object.keys(state.notes).length,
    items: Object.keys(state.items).length,
    generateMs,
    index: { coldMs, docs: index.docs.size, tokens: index.tokens.length },
    sliced,
    incremental: { editNoteMs, moveNoteMs, renameContentMs, renamedNotes },
    queries,
    typing: stats(typed),
    combined,
    memoryMB: {
      // Without precise memory info (or with a GC in between) the difference is meaningless: N/D.
      state: h0 !== null && h1 !== null && h1 - h0 > 0.1 ? h1 - h0 : null,
      index: h1 !== null && h2 !== null && h2 - h1 > 0.1 ? h2 - h1 : null,
      note: "Aproximada: diferencia de performance.memory sin forzar la recogida de basura (solo Chromium).",
    },
    storage,
  }
}
