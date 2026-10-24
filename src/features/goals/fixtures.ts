/** DEMO fixtures for goals. Outcome values are fictional; effort is computed from real (demo) habit data. */

export interface GoalFixture {
  id: string
  title: string
  vision: string
  metric: string
  baseline: string
  current: string
  target: string
  /** Outcome progress in [0,1] (fixture) */
  outcome: number
  due: string
  /** Habit ids that count as effort (many-to-many, no duplicated logging) */
  habitIds: string[]
  checkpoints: { label: string; done: boolean }[]
}

export const GOALS: GoalFixture[] = [
  {
    id: "goal-10k",
    title: "10 km por debajo de 50 minutos",
    vision: "Salud y forma física",
    metric: "Tiempo en 10 km",
    baseline: "56:30",
    current: "52:10",
    target: "49:59",
    outcome: 0.66,
    due: "2027-03-14",
    habitIds: ["demo-training", "demo-mobility", "demo-steps"],
    checkpoints: [
      { label: "Bajar de 55:00", done: true },
      { label: "Bajar de 52:30", done: true },
      { label: "Bajar de 51:00", done: false },
      { label: "Carrera objetivo", done: false },
    ],
  },
  {
    id: "goal-books",
    title: "Leer 24 libros este año",
    vision: "Aprendizaje continuo",
    metric: "Libros terminados",
    baseline: "0",
    current: "17",
    target: "24",
    outcome: 17 / 24,
    due: "2026-12-31",
    habitIds: ["demo-reading"],
    checkpoints: [
      { label: "6 libros", done: true },
      { label: "12 libros", done: true },
      { label: "18 libros", done: false },
      { label: "24 libros", done: false },
    ],
  },
  {
    id: "goal-v1",
    title: "Lanzar THE ONE PERCENT V1",
    vision: "Construir herramientas propias",
    metric: "Hitos completados",
    baseline: "0",
    current: "2",
    target: "7",
    outcome: 2 / 7,
    due: "2027-02-28",
    habitIds: ["demo-deepwork"],
    checkpoints: [
      { label: "M0 Estructura", done: true },
      { label: "M1 Prototipo", done: true },
      { label: "M2 Sincronización", done: false },
      { label: "M6 Lanzamiento", done: false },
    ],
  },
]
