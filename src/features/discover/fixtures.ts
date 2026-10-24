/**
 * DEMO discovery content. Written for this prototype as original synthesis.
 * No source retrieval exists yet, so it is labelled "Síntesis sin verificar"
 * (PRD §4.2: never present unverified text as verified).
 */

export type VerificationStatus = "verified" | "unverified" | "curated_classic"

export interface Topic {
  id: string
  title: string
  category: string
  minutes: number
  mode: "curated" | "ai"
  verification: VerificationStatus
  hook: string
  sections: { heading: string; body: string }[]
  takeaway: string
  recallQuestion?: string
  references: { title: string; note: string }[]
}

export const FEATURED_TOPIC: Topic = {
  id: "t-dichotomy",
  title: "La dicotomía del control: qué depende de ti",
  category: "Filosofía",
  minutes: 5,
  mode: "curated",
  verification: "unverified",
  hook:
    "Una de las herramientas mentales más antiguas y prácticas cabe en una frase: distingue lo que depende de ti de lo que no, y pon tu energía solo en lo primero.",
  sections: [
    {
      heading: "La idea",
      body:
        "Epicteto, filósofo estoico del siglo I y II, abre su Enquiridión con esta separación. Dependen de nosotros nuestros juicios, intenciones, deseos y aversiones. No dependen de nosotros el cuerpo, la reputación, los bienes o los cargos. El sufrimiento evitable aparece cuando tratamos lo segundo como si fuera lo primero.",
    },
    {
      heading: "El mecanismo",
      body:
        "La propuesta no es resignación, sino asignación de atención. Si el objetivo es «ganar la carrera», el resultado depende de rivales, clima y azar. Si el objetivo es «entrenar bien cada sesión y competir con la mejor estrategia», el objetivo vive dentro de tu control y el resultado deja de dictar tu estado de ánimo.",
    },
    {
      heading: "Un ejemplo",
      body:
        "Antes de una reunión difícil: no controlas la reacción del otro; sí controlas tu preparación, el tono y la claridad de tu propuesta. Prepararte para eso reduce la ansiedad y suele mejorar el resultado.",
    },
    {
      heading: "Matices y límites",
      body:
        "La frontera no siempre es binaria: muchas cosas dependen de nosotros solo en parte. Algunos autores modernos proponen una «tricotomía» (control total, parcial y nulo). Usada mal, la idea puede justificar pasividad ante problemas que sí admiten acción colectiva.",
    },
    {
      heading: "Uso práctico",
      body:
        "Reformula cada objetivo de resultado en uno de proceso. En THE ONE PERCENT esto ya ocurre: los hábitos miden esfuerzo y los objetivos miden resultado, por separado.",
    },
  ],
  takeaway: "Mide tu día por lo que hiciste con lo que dependía de ti, no por lo que el mundo te devolvió.",
  recallQuestion: "¿Cómo se reformula un objetivo de resultado para que dependa de ti?",
  references: [
    { title: "Epicteto, Enquiridión, capítulo 1", note: "Fuente primaria clásica. Referencia sin enlace verificado en esta demo." },
  ],
}

export const TOPIC_FEED: Pick<Topic, "id" | "title" | "category" | "minutes" | "mode" | "verification">[] = [
  { id: "t-spacing", title: "Por qué repasar espaciado vence a releer", category: "Ciencia del aprendizaje", minutes: 5, mode: "curated", verification: "unverified" },
  { id: "t-compounding", title: "Interés compuesto fuera de las finanzas", category: "Economía", minutes: 3, mode: "curated", verification: "unverified" },
  { id: "t-printing", title: "La imprenta y la explosión del conocimiento", category: "Historia", minutes: 10, mode: "curated", verification: "unverified" },
  { id: "t-lindy", title: "El efecto Lindy: lo que dura, dura", category: "Ideas", minutes: 3, mode: "curated", verification: "unverified" },
]

export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  verified: "Fuentes verificadas",
  unverified: "Síntesis sin verificar",
  curated_classic: "Fuente clásica",
}
