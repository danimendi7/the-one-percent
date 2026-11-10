import type { Grade } from "./schedule"

/** The card to show: the day's queue, with those failed in this session left for the end. */
export function currentCard<T extends { id: string }>(queue: readonly T[], failed: readonly string[]): T | null {
  const pending = queue.find((c) => !failed.includes(c.id))
  if (pending) return pending
  for (const id of failed) {
    const again = queue.find((c) => c.id === id)
    if (again) return again
  }
  return null
}

/** The cards failed in this session, in the order they will come back. */
export function afterAnswer(failed: readonly string[], cardId: string, grade: Grade): string[] {
  const rest = failed.filter((id) => id !== cardId)
  return grade === "again" ? [...rest, cardId] : rest
}

/** «hoy», «en 6 días», «en 2 meses». */
export function intervalLabel(days: number): string {
  if (days === 0) return "hoy"
  if (days === 1) return "en 1 día"
  if (days < 60) return `en ${days} días`
  return `en ${Math.round(days / 30)} meses`
}
