import { addDays, type LocalDate } from "@/features/habits/domain/dates"
import type { HabitsState } from "@/features/habits/domain/types"
import { closeReview, emptyDraft } from "./domain/close"
import { latestAvailable, previousPeriod, type Period } from "./domain/periods"
import { buildReviewSnapshot } from "./domain/snapshot"
import { reviewKey, type Decision, type Evaluation, type Review, type ReviewContent, type ReviewMap } from "./domain/types"

/**
 * Demo Life Review (M3.4d, plan §6.5): two closed weekly reviews and one closed monthly review
 * before the ones due now, so the history, the evaluation step and the decision log have
 * something to show. Figures are computed from the demo records with the real snapshot builder,
 * as if each review had been closed the day after its period. Demo only; never in an account.
 */
const did = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`

function closed(state: HabitsState, p: Period, content: ReviewContent, decisions: Decision[], evaluations: Evaluation[]): Review {
  const closedOn = addDays(p.to, 1)
  const at = `${closedOn}T19:30:00.000Z`
  const draft = { ...emptyDraft(p.kind, p.from, at), content, decisions, evaluations }
  return closeReview(draft, buildReviewSnapshot({ state, kind: p.kind, periodStart: p.from, today: closedOn, computedAt: at }), at)
}

export function withDemoReviews(state: HabitsState, today: LocalDate): HabitsState {
  const reviews: ReviewMap = {}
  const add = (r: Review) => (reviews[reviewKey(r.kind, r.periodStart)] = r)
  try {
    // The week due now stays open (with last week's decisions to evaluate); the two before are closed.
    const w1 = previousPeriod(latestAvailable("week", today))
    const w2 = previousPeriod(w1)
    const w2Decisions: Decision[] = [
      { id: did(1), text: "Meditar antes de abrir el correo", kind: "start", expected: "5 de 7 días", link: { type: "habit", id: "demo-meditation", title: "Meditación" } },
      { id: did(2), text: "Bloques de foco de 90 min por la mañana", kind: "keep", expected: "4 sesiones", link: null },
    ]
    add(
      closed(state, w2, { wins: "Demo: tres mañanas seguidas de foco profundo.", struggles: "Demo: dormir tarde el jueves.", lessons: "Demo: preparar la tarea la noche antes ayuda." }, w2Decisions, [])
    )
    add(
      closed(
        state,
        w1,
        { wins: "Demo: la meditación ya sale sola.", struggles: "Demo: el fin de semana sin rutina.", note: "Demo: semana con viaje corto." },
        [
          { id: did(3), text: "Acostarme antes de las 23:30", kind: "change", expected: "5 noches", link: null },
          { id: did(4), text: "Dejar el móvil fuera del dormitorio", kind: "drop", expected: null, link: null },
        ],
        [
          { decisionId: did(1), from: w2.from, outcome: "done", note: null },
          { decisionId: did(2), from: w2.from, outcome: "partial", note: "Demo: 3 de 4" },
        ]
      )
    )
    const m1 = previousPeriod(latestAvailable("month", today))
    add(
      closed(state, m1, { pattern: "Demo: los lunes marcan la semana.", attention: "Demo: el objetivo de lectura va por detrás.", stop: "Demo: revisar el correo antes de las 10." }, [
        { id: did(5), text: "Leer 20 páginas cada noche", kind: "start", expected: "600 páginas", link: null },
      ], [])
    )
  } catch {
    // A demo too short for these periods simply has no example reviews.
  }
  return { ...state, reviews }
}
