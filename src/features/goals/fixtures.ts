/**
 * DEMO goals. Fictional, generated relative to the day the demo is created and labelled
 * as demo in the UI. Progress is NOT stored here: it is computed from these measurements
 * and from the demo habit records with the same functions an account uses.
 * They deliberately cover the three data states: plenty of history, a few points, none.
 */
import { addDays, type LocalDate } from "@/features/habits/domain/dates"
import { measurementKey, type Goal, type MeasurementMap } from "./domain/types"

export function createDemoGoals(today: LocalDate): { goals: Goal[]; measurements: MeasurementMap } {
  const at = `${today}T08:00:00.000Z`
  const base = { state: "active" as const, closedOn: null, archivedOn: null, version: 1, createdAt: at, updatedAt: at, horizonOverride: null, parentId: null, aggregateChildren: false }
  const d = (n: number) => addDays(today, n)

  const goals: Goal[] = [
    {
      ...base,
      id: "demo-goal-10k",
      title: "Correr 10 km en menos de 50 minutos",
      why: "Volver a mi mejor forma antes de la carrera de primavera.",
      dimensionId: "body",
      kind: "numeric",
      numeric: { source: "manual", habitId: null, aggregation: "last", unit: "min", baseline: 56.5, target: 50, direction: "down" },
      threshold: null,
      startDate: d(-100),
      dueDate: d(140),
      priority: "primary",
      habits: [
        { habitId: "demo-training", weight: 3 },
        { habitId: "demo-mobility", weight: 1 },
        { habitId: "demo-steps", weight: 1 },
      ],
      checkpoints: [
        { id: "cp-10k-55", title: "Bajar de 55 min", value: 55 },
        { id: "cp-10k-53", title: "Bajar de 53 min", value: 53 },
        { id: "cp-10k-51", title: "Bajar de 51 min", value: 51 },
      ],
    },
    {
      ...base,
      id: "demo-goal-meditation",
      title: "Meditar 1.500 minutos este trimestre",
      why: null,
      dimensionId: "mind",
      kind: "numeric",
      // Fed by the habit's own records: nothing to log twice.
      numeric: { source: "habit", habitId: "demo-meditation", aggregation: "sum", unit: "min", baseline: 0, target: 1500, direction: "up" },
      threshold: null,
      startDate: d(-60),
      dueDate: d(30),
      priority: "primary",
      habits: [{ habitId: "demo-meditation", weight: 1 }],
      checkpoints: [],
    },
    {
      ...base,
      id: "demo-goal-v1",
      title: "Lanzar THE ONE PERCENT V1",
      why: "Una herramienta propia para medir lo que importa.",
      dimensionId: "work",
      kind: "milestones",
      numeric: null,
      threshold: null,
      startDate: d(-90),
      dueDate: d(120),
      priority: "primary",
      habits: [{ habitId: "demo-deepwork", weight: 1 }],
      checkpoints: [
        { id: "cp-v1-0", title: "M0 · Estructura", doneOn: d(-85) },
        { id: "cp-v1-1", title: "M1 · Prototipo", doneOn: d(-60) },
        { id: "cp-v1-2", title: "M2 · Sincronización", doneOn: d(-30) },
        { id: "cp-v1-3", title: "M3 · Analítica y objetivos", dueOn: d(20), doneOn: null },
        { id: "cp-v1-4", title: "M4 · Conocimiento", doneOn: null },
        { id: "cp-v1-5", title: "M5 · Notificaciones", doneOn: null },
        { id: "cp-v1-6", title: "M6 · Lanzamiento", dueOn: d(120), doneOn: null },
      ],
    },
    {
      ...base,
      id: "demo-goal-sleep",
      title: "Desconectar antes de dormir",
      why: null,
      dimensionId: "mind",
      kind: "habits",
      numeric: null,
      threshold: 0.85,
      startDate: d(-45),
      dueDate: d(45),
      priority: "secondary",
      habits: [{ habitId: "demo-screens", weight: 1 }],
      checkpoints: [],
    },
    {
      ...base,
      id: "demo-goal-weight",
      title: "Bajar a 78 kg",
      why: null,
      dimensionId: "body",
      kind: "numeric",
      numeric: { source: "manual", habitId: null, aggregation: "last", unit: "kg", baseline: 82, target: 78, direction: "down" },
      threshold: null,
      startDate: d(-10),
      dueDate: d(400),
      priority: "secondary",
      habits: [
        { habitId: "demo-steps", weight: 1 },
        { habitId: "demo-coffee", weight: 1 },
      ],
      checkpoints: [],
    },
    {
      ...base,
      id: "demo-goal-savings",
      title: "Ahorrar 6.000 € para el año sabático",
      why: null,
      dimensionId: "work",
      kind: "numeric",
      numeric: { source: "manual", habitId: null, aggregation: "sum", unit: "€", baseline: 0, target: 6000, direction: "up" },
      threshold: null,
      startDate: d(-3),
      dueDate: d(600),
      priority: "secondary",
      habits: [],
      checkpoints: [],
    },
  ]

  const measurements: MeasurementMap = {}
  const put = (goalId: string, offset: number, value: number) => {
    const date = d(offset)
    measurements[measurementKey(goalId, date)] = { goalId, date, value, note: null, opId: `demo:${goalId}:${date}`, updatedAt: at }
  }
  ;[
    [-98, 56.5], [-88, 56.0], [-76, 55.4], [-63, 55.1], [-50, 54.2],
    [-41, 53.9], [-30, 53.1], [-19, 52.8], [-9, 52.4], [-2, 52.2],
  ].forEach(([o, v]) => put("demo-goal-10k", o, v))
  put("demo-goal-weight", -9, 82)
  put("demo-goal-weight", -2, 81.4)

  return { goals, measurements }
}
