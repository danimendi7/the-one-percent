/** DEMO recall cards created manually from book notes and discovery topics. */

export interface RecallCardFixture {
  id: string
  question: string
  answer: string
  source: { type: "book" | "topic"; label: string; href: string }
}

export const RECALL_CARDS: RecallCardFixture[] = [
  {
    id: "c1",
    question: "¿Cómo se reformula un objetivo de resultado para que dependa de ti?",
    answer: "Convirtiéndolo en un objetivo de proceso: qué harás tú (preparación, ejecución, constancia) en lugar del resultado final, que depende también de factores externos.",
    source: { type: "topic", label: "La dicotomía del control", href: "/knowledge/discover" },
  },
  {
    id: "c2",
    question: "Según «Hábitos atómicos», ¿qué conviene diseñar antes que confiar en la fuerza de voluntad?",
    answer: "El entorno: hacer visibles y fáciles los buenos hábitos, e invisibles y difíciles los malos.",
    source: { type: "book", label: "Hábitos atómicos", href: "/knowledge/library" },
  },
  {
    id: "c3",
    question: "¿Qué propone Attia sobre el entrenamiento aeróbico de base (zona 2)?",
    answer: "Tratarlo como una inversión sostenida a largo plazo para la salud metabólica, no como sesiones aisladas.",
    source: { type: "book", label: "Outlive", href: "/knowledge/library" },
  },
]
