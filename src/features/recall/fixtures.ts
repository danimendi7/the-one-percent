import { addDays, type LocalDate } from "@/features/habits/domain/dates"
import { ALGORITHM_VERSION, newSchedule, type Schedule } from "./domain/schedule"
import type { RecallCard, RecallState } from "./domain/types"

/** Example cards of the demo (the screen labels them as such). They point at demo ideas of the Library. */
export function createDemoRecall(today: LocalDate): RecallState {
  const review = (dueOn: LocalDate, intervalDays: number, reps: number): Schedule => ({ state: "review", reps, lapses: 0, easeFactor: 2.5, intervalDays, dueOn })
  const card = (id: string, question: string, answer: string, sourceId: string | null, schedule: Schedule, daysAgo: number | null): RecallCard => ({
    id,
    question,
    answer,
    sourceType: sourceId ? "note" : null,
    sourceId,
    schedule,
    suspendedOn: null,
    firstAnsweredOn: daysAgo === null ? null : addDays(today, -daysAgo),
    lastAnsweredAt: daysAgo === null ? null : `${addDays(today, -daysAgo)}T09:00:00.000Z`,
    algorithmVersion: ALGORITHM_VERSION,
    createdAt: `${addDays(today, -14)}T09:00:00.000Z`,
  })
  const cards = [
    card("demo-card-1", "¿Por qué conviene construir una base aeróbica?", "Porque sostiene la salud a largo plazo y permite entrenar más sin agotarse.", "demo-note-1", review(addDays(today, -1), 6, 2), 7),
    card("demo-card-2", "¿Qué hace que un hábito sea fácil de repetir?", "Reducir la fricción: que empezar cueste menos que no hacerlo.", null, review(today, 1, 1), 1),
    card("demo-card-3", "¿Qué pierde valor cuando no eliges en qué concentrarte?", "Tu atención: lo urgente acaba ocupando el sitio de lo importante.", null, newSchedule(today), null),
    card("demo-card-4", "¿Cuántas horas de sueño suelen bastar a un adulto?", "Entre siete y nueve, con horarios regulares.", null, review(addDays(today, 2), 6, 2), 4),
  ]
  return { cards: Object.fromEntries(cards.map((c) => [c.id, c])), attempts: {} }
}
