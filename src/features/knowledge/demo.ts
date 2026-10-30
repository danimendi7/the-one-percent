import { addDays, type LocalDate } from "@/features/habits/domain/dates"
import { canonicalLink } from "./domain/relations"
import type { ContentItem, KnowledgeNote, KnowledgeState, PodcastShow } from "./domain/types"

/**
 * DEMO Library for the screens of M4d (labelled «Demo» wherever it is shown, CLAUDE.md).
 * - Books: real titles and authors (as in the M1 prototype); statuses, dates, ratings and notes
 *   are fictional. Notes are the demo user's own words, never quotations attributed to an author.
 * - Podcasts: shows, episodes and the person quoted are entirely fictional and say so in their
 *   names; no real programme, guest or link is invented.
 * - No ISBNs, covers or URLs: nothing that could pass for verified external data.
 * Dates are relative to `today`, so the demo always looks current.
 */
/** Badge text (short, it lives in headers). The full statement is the comment above and the item names. */
export const DEMO_NOTICE = "Demo · datos de ejemplo"

export function demoLibrary(today: LocalDate): KnowledgeState {
  const d = (days: number) => addDays(today, -days)
  const at = (days: number, hour = 9) => `${d(days)}T${String(hour).padStart(2, "0")}:00:00.000Z`
  const base = { subtitle: null, description: null, language: "es", favorite: false, rating: null, startedOn: null, finishedOn: null, cover: null, sourceUrl: null, external: null }
  const noBook = { isbn13: null, isbn10: null, pageCount: null, currentPage: null, progressPercent: null, publisher: null, publishedYear: null }

  const items: ContentItem[] = [
    {
      ...base,
      id: "demo-book-outlive",
      kind: "book",
      title: "Outlive",
      creators: ["Peter Attia"],
      topics: ["Longevidad", "Entrenamiento"],
      status: "active",
      startedOn: d(24),
      book: { ...noBook, pageCount: 496, currentPage: 214 },
      createdAt: at(30),
      updatedAt: at(1, 21),
    },
    {
      ...base,
      id: "demo-book-habitos",
      kind: "book",
      title: "Hábitos atómicos",
      creators: ["James Clear"],
      topics: ["Hábitos", "Productividad"],
      status: "done",
      favorite: true,
      rating: 9,
      startedOn: d(120),
      finishedOn: d(96),
      book: { ...noBook, pageCount: 328, currentPage: 328 },
      createdAt: at(125),
      updatedAt: at(40),
    },
    {
      ...base,
      id: "demo-book-deepwork",
      kind: "book",
      title: "Enfócate (Deep Work)",
      creators: ["Cal Newport"],
      topics: ["Productividad", "Atención"],
      status: "done",
      rating: 8,
      startedOn: d(70),
      finishedOn: d(52),
      book: { ...noBook, pageCount: 304, currentPage: 304 },
      createdAt: at(72),
      updatedAt: at(50),
    },
    {
      ...base,
      id: "demo-book-meditaciones",
      kind: "book",
      title: "Meditaciones",
      creators: ["Marco Aurelio"],
      topics: ["Estoicismo", "Filosofía"],
      status: "paused",
      startedOn: d(60),
      book: { ...noBook, progressPercent: 35 },
      createdAt: at(61),
      updatedAt: at(33),
    },
    {
      ...base,
      id: "demo-book-dormimos",
      kind: "book",
      title: "Por qué dormimos",
      creators: ["Matthew Walker"],
      topics: ["Sueño", "Salud"],
      status: "planned",
      book: { ...noBook },
      createdAt: at(12),
      updatedAt: at(12),
    },
    {
      ...base,
      id: "demo-book-antifragil",
      kind: "book",
      title: "Antifrágil",
      creators: ["Nassim Nicholas Taleb"],
      topics: ["Decisiones", "Incertidumbre"],
      status: "abandoned",
      rating: 5,
      startedOn: d(150),
      book: { ...noBook, pageCount: 640, currentPage: 180 },
      createdAt: at(152),
      updatedAt: at(130),
    },
    {
      ...base,
      id: "demo-book-junco",
      kind: "book",
      title: "El infinito en un junco",
      creators: ["Irene Vallejo"],
      topics: ["Historia", "Lectura"],
      status: "planned",
      favorite: true,
      book: { ...noBook },
      createdAt: at(8),
      updatedAt: at(8),
    },
    {
      ...base,
      id: "demo-ep-semana",
      kind: "episode",
      title: "Planificar una semana sin saturarla (episodio de ejemplo)",
      creators: [],
      topics: ["Productividad", "Planificación"],
      status: "done",
      rating: 8,
      startedOn: d(9),
      finishedOn: d(9),
      episode: { showId: "demo-show-ritmo", platform: "spotify", durationSeconds: 46 * 60, publishedOn: d(15), episodeNumber: 12, positionSeconds: null },
      createdAt: at(10),
      updatedAt: at(9, 20),
    },
    {
      ...base,
      id: "demo-ep-dormir",
      kind: "episode",
      title: "Dormir mejor sin obsesionarse (episodio de ejemplo)",
      creators: ["Invitada de ejemplo"],
      topics: ["Sueño"],
      status: "active",
      startedOn: d(2),
      episode: { showId: "demo-show-ritmo", platform: "apple", durationSeconds: 62 * 60, publishedOn: d(6), episodeNumber: 13, positionSeconds: 27 * 60 + 40 },
      createdAt: at(3),
      updatedAt: at(2, 22),
    },
    {
      ...base,
      id: "demo-ep-entorno",
      kind: "episode",
      title: "El entorno decide antes que tú (episodio de ejemplo)",
      creators: [],
      topics: ["Hábitos"],
      status: "planned",
      episode: { showId: "demo-show-lab", platform: "youtube", durationSeconds: 38 * 60, publishedOn: d(20), episodeNumber: 4, positionSeconds: null },
      createdAt: at(5),
      updatedAt: at(5),
    },
    {
      ...base,
      id: "demo-ep-charla",
      kind: "episode",
      title: "Charla suelta: aprender a aprender (ejemplo, sin programa)",
      creators: [],
      topics: ["Aprendizaje"],
      status: "done",
      rating: 7,
      startedOn: d(18),
      finishedOn: d(18),
      episode: { showId: null, platform: "youtube", durationSeconds: 21 * 60, publishedOn: null, episodeNumber: null, positionSeconds: null },
      createdAt: at(18),
      updatedAt: at(18),
    },
  ]

  const shows: PodcastShow[] = [
    {
      id: "demo-show-ritmo",
      title: "Ritmo Lento (programa de ejemplo)",
      publisher: "Estudio ficticio",
      description: "Programa inventado para la demo: conversaciones sobre energía, descanso y planificación.",
      topics: ["Bienestar"],
      cover: null,
      sourceUrl: null,
      external: null,
      createdAt: at(10),
      updatedAt: at(10),
    },
    {
      id: "demo-show-lab",
      title: "Laboratorio de Hábitos (programa de ejemplo)",
      publisher: "Estudio ficticio",
      description: null,
      topics: ["Hábitos"],
      cover: null,
      sourceUrl: null,
      external: null,
      createdAt: at(5),
      updatedAt: at(5),
    },
  ]

  const note = (n: Partial<KnowledgeNote> & Pick<KnowledgeNote, "id" | "itemId" | "type" | "body">, days: number): KnowledgeNote => ({
    format: "plain",
    locator: null,
    starred: false,
    applicationStatus: n.type === "application" ? "open" : null,
    applicationLink: null,
    topics: [],
    ...n,
    createdAt: at(days, 21),
    updatedAt: at(days, 21),
  })
  const notes: KnowledgeNote[] = [
    note({ id: "demo-note-1", itemId: "demo-book-outlive", type: "idea", starred: true, body: "La base aeróbica es una inversión a largo plazo: se entrena pensando en dentro de veinte años.", locator: { page: 221, positionSeconds: null, label: null } }, 6),
    note({ id: "demo-note-2", itemId: "demo-book-outlive", type: "application", body: "Dos sesiones de zona 2 por semana durante un mes y revisar cómo me siento.", applicationStatus: "doing" }, 5),
    note({ id: "demo-note-3", itemId: "demo-book-outlive", type: "question", body: "¿Cómo medir la zona 2 sin pulsómetro? Probar la prueba de la conversación." }, 1),
    note({ id: "demo-note-4", itemId: "demo-book-habitos", type: "idea", starred: true, body: "Diseñar el entorno antes que confiar en la fuerza de voluntad." }, 110),
    note({ id: "demo-note-5", itemId: "demo-book-habitos", type: "application", body: "Dejar el libro de la noche sobre la almohada y el móvil fuera del dormitorio.", applicationStatus: "done" }, 100),
    note({ id: "demo-note-6", itemId: "demo-book-habitos", type: "learning", body: "Mis recaídas vienen de días sin plan, no de falta de ganas." }, 98),
    note({ id: "demo-note-7", itemId: "demo-book-deepwork", type: "learning", body: "Necesito bloques de 90 minutos sin notificaciones para escribir de verdad." }, 55),
    note({ id: "demo-note-8", itemId: "demo-book-deepwork", type: "application", body: "Bloque de escritura de 90 min los martes y jueves.", applicationStatus: "open" }, 52),
    note({ id: "demo-note-9", itemId: "demo-book-meditaciones", type: "note", body: "Leer una entrada por la mañana me ayuda más que leer diez seguidas.", locator: { page: null, positionSeconds: null, label: "Libro II" } }, 40),
    note({ id: "demo-note-10", itemId: "demo-book-antifragil", type: "note", body: "Lo dejo por ahora: demasiado denso para este momento. Volver con un tema concreto." }, 130),
    note({ id: "demo-note-11", itemId: "demo-ep-semana", type: "quote", body: "«Una semana bien planificada tiene huecos a propósito.» (frase de la persona ficticia del episodio de ejemplo)", locator: { page: null, positionSeconds: 14 * 60 + 5, label: null } }, 9),
    note({ id: "demo-note-12", itemId: "demo-ep-semana", type: "application", body: "Dejar libre la tarde del viernes como colchón.", applicationStatus: "open" }, 9),
    note({ id: "demo-note-13", itemId: "demo-ep-dormir", type: "idea", body: "La regularidad del horario importa más que dormir una hora extra el fin de semana.", locator: { page: null, positionSeconds: 21 * 60 + 30, label: null } }, 2),
    note({ id: "demo-note-14", itemId: "demo-ep-charla", type: "learning", body: "Explicar en voz alta lo que acabo de leer revela lo que no he entendido." }, 18),
    note({ id: "demo-note-15", itemId: null, type: "idea", topics: ["Revisión"], body: "El domingo, repasar las ideas de la semana antes de planificar la siguiente." }, 4),
  ]

  const links = [
    canonicalLink({ type: "item", id: "demo-book-dormimos" }, { type: "item", id: "demo-ep-dormir" }, at(2)),
    canonicalLink({ type: "note", id: "demo-note-4" }, { type: "item", id: "demo-ep-entorno" }, at(5)),
    canonicalLink({ type: "note", id: "demo-note-7" }, { type: "note", id: "demo-note-8" }, at(52)),
  ].filter((l) => l !== null)

  return {
    items: Object.fromEntries(items.map((i) => [i.id, i])),
    shows: Object.fromEntries(shows.map((s) => [s.id, s])),
    notes: Object.fromEntries(notes.map((n) => [n.id, n])),
    links: Object.fromEntries(links.map((l) => [l.key, l])),
  }
}
