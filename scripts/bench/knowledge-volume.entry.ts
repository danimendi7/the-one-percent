/**
 * Browser side of the M4a volume benchmark (scripts/bench-knowledge.mjs). Bundled for Chromium and
 * run against a SYNTHETIC library only: no demo or account data is involved, and nothing leaves the
 * page. Each function measures one aspect and returns plain numbers.
 */
import { filterContent, shelfCounts } from "@/features/knowledge/domain/library"
import { updateNote } from "@/features/knowledge/domain/ops"
import { relatedByTopics } from "@/features/knowledge/domain/relations"
import { buildIndex, search, type KnowledgeIndex, type SearchQuery } from "@/features/knowledge/domain/search"
import { syntheticLibrary, VOLUME_5K, type SyntheticSize } from "@/features/knowledge/domain/synthetic"
import type { KnowledgeState } from "@/features/knowledge/domain/types"

let state: KnowledgeState
let index: KnowledgeIndex

const ms = (t0: number) => performance.now() - t0

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b)
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  return { median: q(0.5), p95: q(0.95), max: s[s.length - 1] }
}

function repeat(n: number, fn: () => void) {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const t0 = performance.now()
    fn()
    out.push(ms(t0))
  }
  return stats(out)
}

async function gzipSize(text: string): Promise<number> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))
  return (await new Response(stream).arrayBuffer()).byteLength
}

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("bench", 1)
    req.onupgradeneeded = () => req.result.createObjectStore("sync")
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction("sync", mode)
    const req = fn(t.objectStore("sync"))
    t.oncomplete = () => resolve(req.result)
    t.onerror = () => reject(t.error)
  })
}

/** The engine's record shape (one record per user): the library would live inside `cache.state`. */
const record = (library: KnowledgeState | null) => ({ cache: { state: { library }, cursor: 0 }, queue: [], pendingNotes: [], resolvedNotes: [], closeIntents: [], goneOps: [] })

const api = {
  presets: {
    "5k": VOLUME_5K,
    "10k": { ...VOLUME_5K, notes: 10_000, links: 2_000 },
  } satisfies Record<string, SyntheticSize>,

  generate(size: SyntheticSize) {
    const t0 = performance.now()
    state = syntheticLibrary(size)
    const notes = Object.values(state.notes)
    return {
      ms: ms(t0),
      items: Object.keys(state.items).length,
      shows: Object.keys(state.shows).length,
      notes: notes.length,
      links: Object.keys(state.links).length,
      noteChars: notes.reduce((a, n) => a + n.body.length, 0),
    }
  },

  async sizes() {
    const t0 = performance.now()
    const json = JSON.stringify(state)
    const stringifyMs = ms(t0)
    const t1 = performance.now()
    JSON.parse(json)
    const parseMs = ms(t1)
    const t2 = performance.now()
    structuredClone(state)
    const cloneMs = ms(t2)
    return { jsonBytes: new TextEncoder().encode(json).byteLength, gzipBytes: await gzipSize(json), stringifyMs, parseMs, cloneMs }
  },

  /** Writes and reads of the whole record, and the engine's save cycle (read, merge, write: engine.persist). */
  async indexedDb(runs: number) {
    const db = await idb()
    const empty = record(null)
    const full = record(state)
    const baselinePut: number[] = []
    const put: number[] = []
    const get: number[] = []
    const cycle: number[] = []
    for (let i = 0; i < runs; i++) {
      let t0 = performance.now()
      await tx(db, "readwrite", (s) => s.put(empty, "baseline"))
      baselinePut.push(ms(t0))
      t0 = performance.now()
      await tx(db, "readwrite", (s) => s.put(full, "v1:bench"))
      put.push(ms(t0))
      t0 = performance.now()
      await tx(db, "readonly", (s) => s.get("v1:bench"))
      get.push(ms(t0))
      t0 = performance.now()
      await tx(db, "readonly", (s) => s.get("v1:bench"))
      await tx(db, "readwrite", (s) => s.put(full, "v1:bench"))
      cycle.push(ms(t0))
    }
    db.close()
    return { baselinePut: stats(baselinePut), put: stats(put), get: stats(get), saveCycle: stats(cycle) }
  },

  index() {
    const t0 = performance.now()
    index = buildIndex(state)
    const coldMs = ms(t0)
    // One edit, as the quick capture would make: the reducer, then the rebuild (cached tokens for the rest).
    const id = Object.keys(state.notes)[123]
    const t1 = performance.now()
    const r = updateNote(state, id, { body: state.notes[id].body + " añadido" }, { now: new Date().toISOString(), today: "2026-10-30" })
    const reducerMs = ms(t1)
    if (r.ok) state = r.state
    // Incremental update of the existing index (what the app will do after each edit)…
    const t2 = performance.now()
    index = buildIndex(state, index)
    const incrementalMs = ms(t2)
    // …and, for comparison, a full rebuild from scratch.
    const t3 = performance.now()
    buildIndex(state)
    const fullRebuildMs = ms(t3)
    return { coldMs, reducerMs, incrementalMs, fullRebuildMs, tokens: index.tokens.length, docs: index.docs.size }
  },

  queries(runs: number) {
    // A genuinely rare word: one that appears in a single note of this library (and nowhere else).
    const rare = [...index.postings].find(([t, p]) => p.size === 1 && t.length > 6 && [...p.keys()][0].startsWith("note:"))?.[0] ?? "zzz"
    const cases: Record<string, SearchQuery> = {
      "palabra frecuente (atención)": { query: "atención" },
      "otra palabra frecuente (hipótesis)": { query: "hipótesis" },
      [`palabra rara (${rare})`]: { query: rare },
      "dos palabras (hábito sueño)": { query: "hábito sueño" },
      "prefijo corto (en)": { query: "en" },
      "solo filtros (ideas destacadas)": { filters: { noteTypes: ["idea"], starred: true } },
      "texto + filtros (atención, libros, valoración ≥ 7)": { query: "atención", filters: { formats: ["book"], minRating: 7 } },
      "filtro de tema (sueño)": { filters: { topics: ["sueño"] } },
      "todas las notas, recientes primero": {},
    }
    const out: Record<string, ReturnType<typeof stats> & { hits: number }> = {}
    for (const [name, q] of Object.entries(cases)) {
      const hits = search(state, index, q).total.notes
      out[name] = { ...repeat(runs, () => search(state, index, q)), hits }
    }
    return out
  },

  lists(runs: number) {
    const anyItem = Object.keys(state.items)[0]
    return {
      "libros por título (todos)": repeat(runs, () => filterContent(state, { kind: "book", sort: "title" })),
      "episodios con filtro de texto": repeat(runs, () => filterContent(state, { kind: "episode", query: "programa" })),
      "recuentos por estantería": repeat(runs, () => shelfCounts(state, "book")),
      "relacionados por temas": repeat(runs, () => relatedByTopics(state, anyItem)),
    }
  },
}

;(globalThis as unknown as { bench: typeof api }).bench = api
