import { canonicalLink } from "./relations"
import { NOTE_TYPES, PLATFORMS, type ContentItem, type KnowledgeNote, type KnowledgeState, type NoteType, type PodcastShow } from "./types"

/**
 * SYNTHETIC library for volume tests and the benchmark only (M4a, requirement F). Deterministic
 * (seeded), made of generated Spanish-like text with no real titles, people or quotes, and never
 * shown in the app or mixed with demo or account data.
 */

export interface SyntheticSize {
  books: number
  shows: number
  episodes: number
  notes: number
  links: number
  /** Share of free-standing notes (no content). */
  freeShare?: number
  seed?: number
}

export const VOLUME_5K: SyntheticSize = { books: 300, shows: 40, episodes: 260, notes: 5_000, links: 1_000, freeShare: 0.05, seed: 7 }

/** mulberry32: small, fast and deterministic. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WORDS = (
  "hábito atención energía sueño método tiempo decisión sistema aprendizaje práctica memoria cuerpo mente trabajo foco " +
  "relación curiosidad pregunta idea error progreso disciplina descanso movimiento lectura escritura conversación equipo " +
  "riesgo incertidumbre estrategia prioridad objetivo resultado esfuerzo proceso entorno señal ruido datos evidencia " +
  "intuición sesgo modelo mental principio regla excepción ritmo semana mañana noche historia ciencia filosofía economía " +
  "tecnología cultura salud fuerza resistencia calma estrés ansiedad claridad propósito valor coste beneficio comunidad " +
  "familia amistad liderazgo creatividad juego paciencia constancia revisión feedback experimento hipótesis variable " +
  "medida tendencia patrón cambio inercia fricción recompensa motivación identidad compromiso límite margen calendario " +
  "y de la el en que con para por una un los las del se su más como pero sin sobre entre cuando muy también porque"
).split(" ")

const TOPICS = (
  "hábitos|productividad|sueño|nutrición|entrenamiento|longevidad|estoicismo|filosofía|historia|economía|inversión|" +
  "psicología|neurociencia|liderazgo|escritura|creatividad|aprendizaje|memoria|atención|tecnología|ciencia|biografía|" +
  "negocio|marketing|comunicación|relaciones|salud mental|meditación|deporte|educación|matemáticas|física|biología|" +
  "política|sociedad|cultura|arte|música|diseño|ética|decisiones|probabilidad|sistemas|estrategia|negociación|" +
  "finanzas personales|minimalismo|viajes|idiomas|programación"
).split("|")

const pad = (n: number, w = 4) => String(n).padStart(w, "0")
const VOCABULARY = 20_000

export function syntheticLibrary(size: SyntheticSize): KnowledgeState {
  const r = rng(size.seed ?? 1)
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]
  const int = (min: number, max: number) => min + Math.floor(r() * (max - min + 1))
  // A realistic vocabulary: about half the words are common ones, the rest come from ~20.000
  // invented words with a long-tail frequency (rank ∝ r³), so the index sees thousands of
  // distinct words like real notes do, not a handful repeated everywhere.
  const SYL = ["ma", "re", "ti", "lo", "cu", "pra", "ten", "sio", "bri", "dal", "mon", "ves", "ga", "ció", "ña", "rú", "fe", "zi", "qué", "lla", "tor", "nes", "pli", "gue"]
  const vocab = Array.from({ length: VOCABULARY }, () => {
    let w = ""
    for (let k = int(2, 4); k > 0; k--) w += pick(SYL)
    return w
  })
  const word = () => (r() < 0.5 ? pick(WORDS) : vocab[Math.floor(vocab.length * r() ** 3)])
  const sentence = (min: number, max: number) => {
    const n = int(min, max)
    const w: string[] = []
    for (let i = 0; i < n; i++) w.push(word())
    const s = w.join(" ")
    return s[0].toUpperCase() + s.slice(1) + "."
  }
  /** Text of about `chars` characters, in sentences and short paragraphs. */
  const text = (chars: number) => {
    let out = ""
    while (out.length < chars) out += (out ? (r() < 0.15 ? "\n\n" : " ") : "") + sentence(6, 18)
    return out.slice(0, chars).trimEnd().replace(/\s+\S*$/, "") || "Nota."
  }
  const topics = (min: number, max: number) => [...new Set(Array.from({ length: int(min, max) }, () => pick(TOPICS)))]
  const instant = (dayOffset: number) => new Date(Date.UTC(2024, 0, 1) + dayOffset * 86_400_000 + int(0, 86_399) * 1000).toISOString()
  const date = (dayOffset: number) => instant(dayOffset).slice(0, 10)
  const statuses = ["planned", "active", "paused", "done", "done", "done", "abandoned"] as const

  const state: KnowledgeState = { items: {}, shows: {}, notes: {}, links: {} }
  const base = (id: string, day: number) => {
    const status = pick(statuses)
    const started = status === "planned" ? null : date(day)
    return {
      id,
      title: sentence(2, 6).slice(0, -1),
      subtitle: r() < 0.3 ? sentence(3, 8).slice(0, -1) : null,
      creators: [`Autor ${pad(int(1, 400))}`, ...(r() < 0.2 ? [`Autora ${pad(int(1, 400))}`] : [])],
      description: r() < 0.7 ? text(int(150, 900)) : null,
      topics: topics(1, 4),
      language: "es",
      status,
      favorite: r() < 0.1,
      rating: status === "done" && r() < 0.8 ? int(1, 10) : null,
      startedOn: started,
      finishedOn: status === "done" ? date(day + int(3, 60)) : null,
      cover: null,
      sourceUrl: null,
      external: null,
      createdAt: instant(day),
      updatedAt: instant(day + int(0, 90)),
    }
  }

  for (let i = 0; i < size.shows; i++) {
    const id = `syn-show-${pad(i)}`
    const show: PodcastShow = {
      id,
      title: `Programa ${pad(i, 3)} · ${sentence(1, 3).slice(0, -1)}`,
      publisher: `Productora ${pad(int(1, 50), 2)}`,
      description: text(int(100, 500)),
      topics: topics(1, 3),
      cover: null,
      sourceUrl: null,
      external: null,
      createdAt: instant(int(0, 600)),
      updatedAt: instant(int(600, 700)),
    }
    state.shows[id] = show
  }
  const itemIds: string[] = []
  for (let i = 0; i < size.books; i++) {
    const id = `syn-book-${pad(i)}`
    const pages = r() < 0.9 ? int(120, 900) : null
    const b = base(id, int(0, 650))
    state.items[id] = {
      ...b,
      kind: "book",
      book: {
        isbn13: null,
        isbn10: null,
        pageCount: pages,
        currentPage: pages && b.status !== "planned" ? int(0, pages) : null,
        progressPercent: pages ? null : b.status === "planned" ? null : int(0, 100),
        publisher: `Editorial ${pad(int(1, 80), 2)}`,
        publishedYear: int(1950, 2025),
      },
    } satisfies ContentItem
    itemIds.push(id)
  }
  for (let i = 0; i < size.episodes; i++) {
    const id = `syn-ep-${pad(i)}`
    const duration = int(15, 180) * 60
    const b = base(id, int(0, 650))
    state.items[id] = {
      ...b,
      kind: "episode",
      creators: r() < 0.6 ? [`Invitada ${pad(int(1, 400))}`] : [],
      episode: {
        showId: size.shows && r() < 0.9 ? `syn-show-${pad(int(0, size.shows - 1))}` : null,
        platform: pick(PLATFORMS),
        durationSeconds: duration,
        publishedOn: date(int(0, 650)),
        episodeNumber: int(1, 400),
        positionSeconds: b.status === "active" ? int(0, duration) : null,
      },
    } satisfies ContentItem
    itemIds.push(id)
  }

  const types: NoteType[] = [...NOTE_TYPES, "idea", "idea", "learning", "quote"]
  for (let i = 0; i < size.notes; i++) {
    const id = `syn-note-${pad(i, 5)}`
    const free = !itemIds.length || r() < (size.freeShare ?? 0)
    const itemId = free ? null : pick(itemIds)
    const item = itemId ? state.items[itemId] : null
    const type = pick(types)
    // Length mix: mostly short ideas, some paragraphs, a few long notes.
    const roll = r()
    const len = roll < 0.6 ? int(60, 300) : roll < 0.9 ? int(300, 900) : roll < 0.98 ? int(900, 2000) : int(2000, 6000)
    const body = text(type === "quote" ? Math.min(len, 2000) : len)
    const locator =
      item && r() < 0.6
        ? item.kind === "book"
          ? { page: item.book.pageCount ? int(1, item.book.pageCount) : int(1, 300), positionSeconds: null, label: null }
          : { page: null, positionSeconds: int(0, item.episode.durationSeconds ?? 3600), label: null }
        : null
    const created = instant(int(0, 700))
    const note: KnowledgeNote = {
      id,
      itemId,
      type,
      format: "plain",
      body,
      locator,
      starred: r() < 0.08,
      applicationStatus: type === "application" ? pick(["open", "doing", "done", "dropped"] as const) : null,
      applicationLink: null,
      topics: r() < 0.3 ? topics(1, 2) : [],
      createdAt: created,
      updatedAt: created,
    }
    state.notes[id] = note
  }
  const noteIds = Object.keys(state.notes)
  for (let i = 0; i < size.links && noteIds.length > 1; i++) {
    const a = r() < 0.5 ? { type: "note" as const, id: pick(noteIds) } : { type: "item" as const, id: pick(itemIds) }
    const b = { type: "note" as const, id: pick(noteIds) }
    const l = canonicalLink(a, b, instant(int(0, 700)))
    if (l) state.links[l.key] = l
  }
  return state
}
