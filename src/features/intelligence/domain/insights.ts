import { addDays, startOfWeek, type LocalDate, type Weekday } from "@/features/habits/domain/dates"
import { completion, weekdayConsistency, type DateRange, type EvalContext } from "@/features/habits/domain/metrics"
import type { HabitsState } from "@/features/habits/domain/types"
import { summarizeSessions } from "@/features/focus/domain/metrics"
import { relations, RELATION_MIN_DAYS, RELATION_VARIABLES } from "@/features/analytics/domain/relations"

/**
 * Personal insights by fixed rules (Plan Maestro 5.9: «priorizar reglas e indicadores deterministas
 * cuando no exista suficiente evidencia»). No model is involved. Each rule has a window, a minimum
 * amount of data below which it says nothing, and the limits of what it shows; every insight carries
 * its period, its variables and its n. They describe what happened and never claim a cause.
 */
export type InsightKind = "week_change" | "habit_drop" | "weekday_low" | "relation" | "interruptions" | "habit_steady"

export interface Insight {
  /** Stable: the same finding keeps its id from day to day. */
  id: string
  kind: InsightKind
  title: string
  statement: string
  period: DateRange
  variables: string[]
  /** How many data points it rests on (see `nLabel`). */
  n: number
  nLabel: string
  limitations: string[]
  tone: "positive" | "negative" | "neutral"
}

export const INSIGHT_RULES: Record<InsightKind, { minN: number; description: string }> = {
  week_change: { minN: 14, description: "La última semana cerrada frente a la anterior: avisa si el cumplimiento cambia 15 puntos o más, con al menos 7 oportunidades en cada una." },
  habit_drop: { minN: 16, description: "Cada hábito, últimas 4 semanas frente a las 4 anteriores: avisa si baja 25 puntos o más, con al menos 8 oportunidades en cada tramo." },
  weekday_low: { minN: 8, description: "Últimas 8 semanas, por día de la semana: avisa si un día queda 25 puntos o más por debajo del resto, con al menos 8 oportunidades ese día." },
  relation: { minN: RELATION_MIN_DAYS, description: "Relaciones de Life Analytics en las últimas 4 semanas: solo las moderadas o fuertes, con al menos 14 días con ambos datos." },
  interruptions: { minN: 8, description: "Sesiones de Deep Work de las últimas 4 semanas con las interrupciones anotadas: compara su duración, con al menos 4 sesiones con y 4 sin interrupciones." },
  habit_steady: { minN: 14, description: "Cada hábito en las últimas 4 semanas: destaca un 90 % o más, con al menos 14 oportunidades." },
}

const ORDER: InsightKind[] = ["week_change", "habit_drop", "weekday_low", "relation", "interruptions", "habit_steady"]
const MAX_INSIGHTS = 8
const DESCRIPTIVE = "Describe lo ocurrido en tus registros; no indica la causa."
const WEEKDAY_PLURAL: Record<Weekday, string> = { 1: "lunes", 2: "martes", 3: "miércoles", 4: "jueves", 5: "viernes", 6: "sábados", 7: "domingos" }
const pct = (r: number) => `${Math.round(r * 100)} %`
const range = (today: LocalDate, fromDaysAgo: number, toDaysAgo: number): DateRange => ({ from: addDays(today, -fromDaysAgo), to: addDays(today, -toDaysAgo) })

function smallSample(n: number, solid: number): string[] {
  return n < solid ? [`Con ${n} datos la muestra es pequeña: puede cambiar pronto.`] : []
}

export function insights(state: HabitsState, today: LocalDate): Insight[] {
  const ctx: EvalContext = { entries: state.entries, restDays: new Set(state.restDays), today }
  const last4 = range(today, 28, 1)
  const prev4 = range(today, 56, 29)
  const out: Insight[] = []

  // Last closed week against the one before.
  const lastWeek = { from: addDays(startOfWeek(today), -7), to: addDays(startOfWeek(today), -1) }
  const prevWeek = { from: addDays(lastWeek.from, -7), to: addDays(lastWeek.from, -1) }
  const a = completion(state.habits, prevWeek, ctx)
  const b = completion(state.habits, lastWeek, ctx)
  if (a.applicable >= 7 && b.applicable >= 7 && a.rate !== null && b.rate !== null && Math.abs(b.rate - a.rate) >= 0.15) {
    const n = a.applicable + b.applicable
    out.push({
      id: `week_change:${lastWeek.from}`,
      kind: "week_change",
      title: b.rate > a.rate ? "La semana pasada, más cumplimiento" : "La semana pasada, menos cumplimiento",
      statement: `La semana anterior, ${a.fulfilled} de ${a.applicable} (${pct(a.rate)}); la pasada, ${b.fulfilled} de ${b.applicable} (${pct(b.rate)}).`,
      period: { from: prevWeek.from, to: lastWeek.to },
      variables: ["Cumplimiento de hábitos"],
      n,
      nLabel: `${n} oportunidades en las dos semanas`,
      limitations: [DESCRIPTIVE, "Dos semanas sueltas pueden variar por motivos puntuales (viajes, descansos, enfermedad)."],
      tone: b.rate > a.rate ? "positive" : "negative",
    })
  }

  for (const h of state.habits) {
    if (h.archivedOn && h.archivedOn <= today) continue
    const before = completion([h], prev4, ctx)
    const after = completion([h], last4, ctx)
    if (before.applicable >= 8 && after.applicable >= 8 && before.rate !== null && after.rate !== null && before.rate - after.rate >= 0.25) {
      const n = before.applicable + after.applicable
      out.push({
        id: `habit_drop:${h.id}`,
        kind: "habit_drop",
        title: `«${h.name}» ha bajado`,
        statement: `${h.name} pasó del ${pct(before.rate)} (${before.fulfilled} de ${before.applicable}) al ${pct(after.rate)} (${after.fulfilled} de ${after.applicable}) en las últimas 4 semanas.`,
        period: { from: prev4.from, to: last4.to },
        variables: [h.name],
        n,
        nLabel: `${n} oportunidades en 8 semanas`,
        limitations: [DESCRIPTIVE, ...smallSample(n, 40)],
        tone: "negative",
      })
    } else if (after.applicable >= 14 && after.rate !== null && after.rate >= 0.9) {
      out.push({
        id: `habit_steady:${h.id}`,
        kind: "habit_steady",
        title: `Constancia en «${h.name}»`,
        statement: `${h.name}: ${after.fulfilled} de ${after.applicable} veces en las últimas 4 semanas (${pct(after.rate)}).`,
        period: last4,
        variables: [h.name],
        n: after.applicable,
        nLabel: `${after.applicable} oportunidades`,
        limitations: [DESCRIPTIVE],
        tone: "positive",
      })
    }
  }

  // A weekday well below the rest, over eight weeks.
  const last8 = range(today, 56, 1)
  const byDay = weekdayConsistency(state.habits, last8, { ...ctx })
  const total = byDay.reduce((acc, d) => ({ f: acc.f + (d.rate ?? 0) * d.applicable, a: acc.a + d.applicable }), { f: 0, a: 0 })
  const lagging = byDay
    .filter((d) => d.rate !== null && d.applicable >= 8 && total.a - d.applicable > 0)
    .map((d) => ({ ...d, rest: (total.f - d.rate! * d.applicable) / (total.a - d.applicable) }))
    .filter((d) => d.rest - d.rate! >= 0.25)
    .sort((x, y) => x.rate! - x.rest - (y.rate! - y.rest))[0]
  if (lagging) {
    out.push({
      id: `weekday_low:${lagging.weekday}`,
      kind: "weekday_low",
      title: `Los ${WEEKDAY_PLURAL[lagging.weekday]}, menos`,
      statement: `Los ${WEEKDAY_PLURAL[lagging.weekday]} cumpliste el ${pct(lagging.rate!)} de lo programado, frente al ${pct(lagging.rest)} del resto de días.`,
      period: last8,
      variables: ["Cumplimiento de hábitos", "Día de la semana"],
      n: lagging.applicable,
      nLabel: `${lagging.applicable} oportunidades ese día`,
      limitations: [DESCRIPTIVE, ...smallSample(lagging.applicable, 16)],
      tone: "negative",
    })
  }

  for (const r of relations(state, last4, today)) {
    if (r.status !== "shown" || (r.strength !== "moderate" && r.strength !== "strong")) continue
    out.push({
      id: `relation:${r.a}:${r.b}`,
      kind: "relation",
      title: `${RELATION_VARIABLES[r.a].label} y ${RELATION_VARIABLES[r.b].label.toLowerCase()}`,
      statement: r.sentence,
      period: r.period,
      variables: [RELATION_VARIABLES[r.a].label, RELATION_VARIABLES[r.b].label],
      n: r.n,
      nLabel: `${r.n} días con ambos datos`,
      limitations: [DESCRIPTIVE, ...r.limitations],
      tone: "neutral",
    })
  }

  // Deep Work: sessions without interruptions against sessions with some, only where they were noted.
  const noted = state.focusSessions.filter((s) => s.state === "finished" && s.localDate >= last4.from && s.localDate <= last4.to && s.interruptions != null)
  const calm = noted.filter((s) => s.interruptions === 0)
  const broken = noted.filter((s) => (s.interruptions ?? 0) > 0)
  if (calm.length >= 4 && broken.length >= 4) {
    const avg = (list: typeof noted) => Math.round(summarizeSessions(list).minutes / list.length)
    const [x, y] = [avg(calm), avg(broken)]
    if (Math.abs(x - y) >= 10) {
      out.push({
        id: "interruptions",
        kind: "interruptions",
        title: "Interrupciones y duración",
        statement: `Las sesiones sin interrupciones duraron de media ${x} min; las que tuvieron alguna, ${y} min.`,
        period: last4,
        variables: ["Interrupciones anotadas", "Minutos de foco"],
        n: noted.length,
        nLabel: `${noted.length} sesiones con las interrupciones anotadas (${calm.length} sin, ${broken.length} con)`,
        limitations: [DESCRIPTIVE, "Solo cuenta las sesiones en las que anotaste las interrupciones.", ...smallSample(noted.length, 20)],
        tone: "neutral",
      })
    }
  }

  return out.sort((p, q) => ORDER.indexOf(p.kind) - ORDER.indexOf(q.kind)).slice(0, MAX_INSIGHTS)
}
