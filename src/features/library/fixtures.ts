/**
 * DEMO library. Titles/authors are real books; page counts are illustrative
 * (they vary by edition) and statuses, ratings and notes are fictional.
 * Covers are generated typographic placeholders: no third-party images.
 */

export type BookStatus = "want" | "reading" | "finished" | "on_hold"
export type NoteType = "idea" | "quote" | "curiosity" | "reflection" | "question" | "application"

export interface BookNote {
  id: string
  type: NoteType
  body: string
  page?: number
}

export interface Book {
  id: string
  title: string
  author: string
  year?: number
  pageCount: number | null
  currentPage?: number
  status: BookStatus
  favorite: boolean
  rating?: number
  tags: string[]
  /** Hue for the generated cover */
  hue: number
  startedOn?: string
  finishedOn?: string
  notes: BookNote[]
}

export const STATUS_LABEL: Record<BookStatus, string> = {
  want: "Quiero leer",
  reading: "Leyendo",
  finished: "Terminado",
  on_hold: "En pausa",
}

export const NOTE_LABEL: Record<NoteType, string> = {
  idea: "Idea",
  quote: "Cita",
  curiosity: "Curiosidad",
  reflection: "Reflexión",
  question: "Pregunta",
  application: "Aplicación",
}

export const BOOKS: Book[] = [
  {
    id: "b-outlive",
    title: "Outlive",
    author: "Peter Attia",
    year: 2023,
    pageCount: 496,
    currentPage: 214,
    status: "reading",
    favorite: false,
    tags: ["salud", "longevidad"],
    hue: 200,
    startedOn: "2026-10-02",
    notes: [
      { id: "n1", type: "idea", body: "Entrenar la base aeróbica (zona 2) como inversión a largo plazo, no como sesión aislada.", page: 221 },
      { id: "n2", type: "application", body: "Dos sesiones de zona 2 por semana en el plan de Movilidad.", page: 230 },
    ],
  },
  {
    id: "b-junco",
    title: "El infinito en un junco",
    author: "Irene Vallejo",
    year: 2019,
    pageCount: 452,
    currentPage: 96,
    status: "reading",
    favorite: false,
    tags: ["historia", "libros"],
    hue: 32,
    startedOn: "2026-10-15",
    notes: [],
  },
  {
    id: "b-cartas",
    title: "Cartas a Lucilio",
    author: "Séneca",
    pageCount: null,
    status: "reading",
    favorite: false,
    tags: ["filosofía", "estoicismo"],
    hue: 14,
    notes: [{ id: "n3", type: "reflection", body: "La carta sobre el tiempo: lo que se pierde por descuido es lo más vergonzoso." }],
  },
  {
    id: "b-meditaciones",
    title: "Meditaciones",
    author: "Marco Aurelio",
    pageCount: 256,
    status: "finished",
    favorite: true,
    rating: 10,
    tags: ["filosofía", "estoicismo"],
    hue: 268,
    finishedOn: "2026-03-08",
    notes: [{ id: "n4", type: "idea", body: "Separar lo que depende de mí de lo que no, cada mañana." }],
  },
  {
    id: "b-frankl",
    title: "El hombre en busca de sentido",
    author: "Viktor E. Frankl",
    year: 1946,
    pageCount: 168,
    status: "finished",
    favorite: true,
    rating: 9,
    tags: ["psicología", "sentido"],
    hue: 350,
    finishedOn: "2026-01-20",
    notes: [],
  },
  {
    id: "b-habitos",
    title: "Hábitos atómicos",
    author: "James Clear",
    year: 2018,
    pageCount: 328,
    status: "finished",
    favorite: false,
    rating: 8,
    tags: ["hábitos", "productividad"],
    hue: 84,
    finishedOn: "2026-02-11",
    notes: [{ id: "n5", type: "application", body: "Diseñar el entorno antes que confiar en la fuerza de voluntad." }],
  },
  {
    id: "b-kahneman",
    title: "Pensar rápido, pensar despacio",
    author: "Daniel Kahneman",
    year: 2011,
    pageCount: 672,
    status: "finished",
    favorite: false,
    rating: 8,
    tags: ["psicología", "decisiones"],
    hue: 222,
    finishedOn: "2026-06-30",
    notes: [],
  },
  {
    id: "b-deepwork",
    title: "Enfócate (Deep Work)",
    author: "Cal Newport",
    year: 2016,
    pageCount: 304,
    status: "finished",
    favorite: false,
    rating: 7,
    tags: ["productividad", "enfoque"],
    hue: 168,
    finishedOn: "2026-04-17",
    notes: [],
  },
  {
    id: "b-sapiens",
    title: "Sapiens",
    author: "Yuval Noah Harari",
    year: 2011,
    pageCount: 496,
    status: "finished",
    favorite: false,
    rating: 7,
    tags: ["historia"],
    hue: 45,
    finishedOn: "2026-08-02",
    notes: [],
  },
  {
    id: "b-sleep",
    title: "Por qué dormimos",
    author: "Matthew Walker",
    year: 2017,
    pageCount: 368,
    currentPage: 120,
    status: "on_hold",
    favorite: false,
    tags: ["salud", "sueño"],
    hue: 238,
    notes: [],
  },
  {
    id: "b-range",
    title: "Amplitud (Range)",
    author: "David Epstein",
    year: 2019,
    pageCount: 352,
    status: "want",
    favorite: false,
    tags: ["aprendizaje"],
    hue: 120,
    notes: [],
  },
  {
    id: "b-antifragil",
    title: "Antifrágil",
    author: "Nassim Nicholas Taleb",
    year: 2012,
    pageCount: 640,
    status: "want",
    favorite: false,
    tags: ["riesgo", "decisiones"],
    hue: 6,
    notes: [],
  },
]
