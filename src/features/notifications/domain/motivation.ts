import type { LocalDate, Weekday } from "@/features/habits/domain/dates"
import { isoWeekday } from "@/features/habits/domain/dates"
import { habitOpportunities, type EvalContext } from "@/features/habits/domain/metrics"
import type { HabitsState } from "@/features/habits/domain/types"
import { dueReview, historyStart } from "@/features/reviews/domain/overview"
import { dailyQueue } from "@/features/recall/domain/schedule"

/**
 * Motivation Engine (PRD §5): which reminders are due now, as a pure function of the data, the
 * local time and the user's settings. The same evaluation runs again at send time (§5.2), so a
 * reminder computed earlier is dropped if the habit was done meanwhile. Nothing is said about a
 * habit already done or exempt, nor about habits on a planned rest day; the copy is original,
 * quotes nobody and never shows check-in details.
 */
export type Tone = "calm" | "balanced" | "hardcore"
export type RuleId = "morning" | "due" | "late" | "allDone" | "review" | "recall" | "focus"
/** Priority when the daily cap leaves room for fewer than are due. */
export const RULE_ORDER: RuleId[] = ["late", "due", "morning", "review", "recall", "focus", "allDone"]
export const RULE_LABEL: Record<RuleId, string> = {
  morning: "Activación matinal",
  due: "Hábitos programados para hoy",
  late: "Hábitos pendientes por la tarde",
  allDone: "Todos los hábitos del día cumplidos",
  review: "Revisión semanal pendiente",
  recall: "Tarjetas de repaso pendientes",
  focus: "Recordatorio de bloque de foco",
}

export interface MotivationSettings {
  enabled: boolean
  tone: Tone
  /** Strong language, only with the Hardcore tone. */
  profanity: boolean
  dailyCap: number
  /** HH:MM; may wrap midnight. */
  quietStart: string
  quietEnd: string
  minGapMinutes: number
  daysOff: Weekday[]
  rules: Record<RuleId, boolean>
  /** When each rule starts to apply (HH:MM). */
  times: Record<Exclude<RuleId, "allDone">, string>
}

export const DEFAULT_SETTINGS: MotivationSettings = {
  enabled: true,
  tone: "balanced",
  profanity: false,
  dailyCap: 4,
  quietStart: "22:00",
  quietEnd: "08:00",
  minGapMinutes: 60,
  daysOff: [],
  rules: { morning: true, due: true, late: true, allDone: false, review: true, recall: false, focus: false },
  times: { morning: "08:00", due: "13:00", late: "19:00", review: "18:00", recall: "20:00", focus: "10:00" },
}

export interface SentNudge {
  key: string
  rule: RuleId
  at: string
  localDate: LocalDate
  /** Local minutes since midnight when it was sent. */
  minutes: number
}

export interface Nudge {
  /** Idempotency key (rule + local date or period): at most one per key (§5.2). */
  key: string
  rule: RuleId
  title: string
  body: string
  habitIds?: string[]
}

export interface EvalInput {
  state: HabitsState
  today: LocalDate
  /** Local minutes since midnight, in the profile timezone. */
  minutes: number
  settings: MotivationSettings
  /** Reminders already sent (any day; only today's count). */
  sent: SentNudge[]
}

export interface Evaluation {
  nudges: Nudge[]
  /** Why each enabled rule says nothing now: the rule simulator of §5.3. */
  skipped: { rule: RuleId | "all"; reason: string }[]
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

export function inQuietHours(s: Pick<MotivationSettings, "quietStart" | "quietEnd">, minutes: number): boolean {
  const start = toMinutes(s.quietStart)
  const end = toMinutes(s.quietEnd)
  if (start === end) return false
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end
}

/** Today's scheduled habits still pending: neither done nor exempt. Weekly targets have no daily verdict. */
function pendingToday(state: HabitsState, today: LocalDate): { pending: string[]; total: number } {
  const ctx: EvalContext = { entries: state.entries, restDays: new Set(state.restDays), today }
  const opps = state.habits.flatMap((h) => habitOpportunities(h, { from: today, to: today }, ctx)).filter((o) => o.kind === "day" && o.status !== "exempt")
  return { pending: opps.filter((o) => o.status === "pending").map((o) => o.habitId), total: opps.length }
}

const HABIT_RULES: RuleId[] = ["morning", "due", "late", "allDone"]

export function nudgeCopy(rule: RuleId, s: MotivationSettings, n: number, names: string): { title: string; body: string } {
  const h = `${n} ${plural(n, "hábito", "hábitos")}`
  const strong = s.tone === "hardcore" && s.profanity
  switch (rule) {
    case "morning":
      return { title: "Hoy", body: { calm: `Buenos días. Hoy tienes ${h} programados, a tu ritmo.`, balanced: `Hoy tienes ${h}: ${names}.`, hardcore: `${h} hoy: ${names}. Empieza ya.` }[s.tone] }
    case "due":
    case "late": {
      const later = rule === "late"
      const body = strong
        ? `${h} ${plural(n, "pendiente", "pendientes")}: ${names}. Deja de marear la perdiz y hazlo. Ahora.`
        : {
            calm: `Cuando puedas: ${later ? "aún " : ""}te ${plural(n, "queda", "quedan")} ${h} para hoy (${names}). Uno pequeño también cuenta.`,
            balanced: `${plural(n, "Queda", "Quedan")} ${h} por hoy: ${names}. Unos minutos ahora y el día queda cerrado.`,
            hardcore: `${h} ${plural(n, "pendiente", "pendientes")}: ${names}. Nadie lo va a hacer por ti. Ahora.`,
          }[s.tone]
      return { title: later ? "Antes de que acabe el día" : "Hábitos de hoy", body }
    }
    case "allDone":
      return { title: "Día completo", body: { calm: "Has cumplido todo lo de hoy. Buen trabajo.", balanced: "Todos los hábitos de hoy, cumplidos.", hardcore: "Todo hecho. Mañana, igual." }[s.tone] }
    case "review":
      return { title: "Revisión semanal", body: { calm: "Tu revisión de la semana está lista cuando quieras.", balanced: "Tu revisión semanal está lista: unos 5 minutos.", hardcore: "Revisión semanal pendiente. Ciérrala hoy." }[s.tone] }
    case "recall":
      return { title: "Repaso", body: { calm: `Tienes ${n} ${plural(n, "tarjeta", "tarjetas")} por repasar, sin prisa.`, balanced: `Tienes ${n} ${plural(n, "tarjeta", "tarjetas")} por repasar hoy.`, hardcore: `${n} ${plural(n, "tarjeta", "tarjetas")} esperando. Repásalas.` }[s.tone] }
    case "focus":
      return { title: "Bloque de foco", body: { calm: "¿Te apetece un bloque de foco hoy?", balanced: "Aún no has hecho ningún bloque de foco hoy.", hardcore: "Cero minutos de foco hoy. Un bloque, ya." }[s.tone] }
  }
}

/** Every enabled rule that is due now by its own condition and time, before silence, cap and spacing. */
function candidates(input: EvalInput, skipped: Evaluation["skipped"]): Nudge[] {
  const { state, today, minutes, settings: s } = input
  const out: Nudge[] = []
  const rest = state.restDays.includes(today)
  const { pending, total } = pendingToday(state, today)
  const names = pending.map((id) => state.habits.find((h) => h.id === id)?.name ?? "").filter(Boolean).slice(0, 3).join(", ") + (pending.length > 3 ? "…" : "")
  const from = (rule: Exclude<RuleId, "allDone">) => minutes >= toMinutes(s.times[rule])
  const add = (rule: RuleId, key: string, n: number, extra: Partial<Nudge> = {}) => out.push({ key, rule, ...nudgeCopy(rule, s, n, names), ...extra })
  const skip = (rule: RuleId, reason: string) => skipped.push({ rule, reason })

  for (const rule of RULE_ORDER) {
    if (!s.rules[rule]) continue
    if (rest && HABIT_RULES.includes(rule)) {
      skip(rule, "Hoy es día de descanso planificado.")
      continue
    }
    switch (rule) {
      case "morning":
        if (!from("morning") || minutes >= 12 * 60) skip(rule, `Solo entre las ${s.times.morning} y las 12:00.`)
        else if (pending.length === 0) skip(rule, "No queda ningún hábito pendiente hoy.")
        else add(rule, `morning:${today}`, pending.length, { habitIds: pending })
        break
      case "due":
        if (!from("due") || from("late")) skip(rule, `Solo entre las ${s.times.due} y las ${s.times.late}.`)
        else if (pending.length === 0) skip(rule, "No queda ningún hábito pendiente hoy.")
        else add(rule, `due:${today}`, pending.length, { habitIds: pending })
        break
      case "late":
        if (!from("late")) skip(rule, `A partir de las ${s.times.late}.`)
        else if (pending.length === 0) skip(rule, "No queda ningún hábito pendiente hoy.")
        else add(rule, `late:${today}`, pending.length, { habitIds: pending })
        break
      case "allDone":
        if (total === 0 || pending.length > 0) skip(rule, "Aún quedan hábitos por hacer hoy, o no hay ninguno programado.")
        else add(rule, `allDone:${today}`, total)
        break
      case "review": {
        const due = dueReview(state.reviews, "week", today)
        const first = historyStart(state)
        if (!from("review")) skip(rule, `A partir de las ${s.times.review}.`)
        else if (!first || first > due.period.to) skip(rule, "Aún no hay datos que revisar.")
        else if (due.phase === "closed") skip(rule, "La revisión de la semana ya está cerrada.")
        else add(rule, `review:${due.period.from}`, 1)
        break
      }
      case "recall": {
        const n = dailyQueue(Object.values(state.recall.cards), today).queue.length
        if (!from("recall")) skip(rule, `A partir de las ${s.times.recall}.`)
        else if (n === 0) skip(rule, "No hay tarjetas pendientes hoy.")
        else add(rule, `recall:${today}`, n)
        break
      }
      case "focus": {
        const any = state.focusSessions.some((f) => f.localDate === today)
        if (!from("focus") || minutes >= 18 * 60) skip(rule, `Solo entre las ${s.times.focus} y las 18:00.`)
        else if (any) skip(rule, "Ya hay un bloque de foco hoy.")
        else add(rule, `focus:${today}`, 0)
        break
      }
    }
  }
  return out
}

export function evaluate(input: EvalInput): Evaluation {
  const { settings: s, today, minutes } = input
  const skipped: Evaluation["skipped"] = []
  if (!s.enabled) return { nudges: [], skipped: [{ rule: "all", reason: "Los avisos están desactivados." }] }
  if (s.daysOff.includes(isoWeekday(today))) return { nudges: [], skipped: [{ rule: "all", reason: "Hoy es uno de tus días sin avisos." }] }
  if (inQuietHours(s, minutes)) return { nudges: [], skipped: [{ rule: "all", reason: `Horas de silencio (${s.quietStart}–${s.quietEnd}).` }] }
  const sentToday = input.sent.filter((x) => x.localDate === today)
  if (sentToday.length >= s.dailyCap) return { nudges: [], skipped: [{ rule: "all", reason: `Ya se alcanzó el tope de ${s.dailyCap} avisos de hoy.` }] }
  const last = sentToday.reduce<number | null>((m, x) => (m === null || x.minutes > m ? x.minutes : m), null)
  if (last !== null && minutes - last < s.minGapMinutes) return { nudges: [], skipped: [{ rule: "all", reason: `Hace menos de ${s.minGapMinutes} min del último aviso.` }] }
  const sentKeys = new Set(input.sent.map((x) => x.key))
  const fresh = candidates(input, skipped).filter((n) => {
    if (!sentKeys.has(n.key)) return true
    skipped.push({ rule: n.rule, reason: "Ya se envió." })
    return false
  })
  // With a minimum gap, two reminders at once would break it: the most important goes now, the rest later.
  const room = Math.min(s.dailyCap - sentToday.length, s.minGapMinutes > 0 ? 1 : Infinity)
  for (const n of fresh.slice(room)) skipped.push({ rule: n.rule, reason: room === 1 && s.minGapMinutes > 0 ? "Espera a la separación mínima." : "No cabe en el tope diario." })
  return { nudges: fresh.slice(0, room), skipped }
}

/** At send time (§5.2): is this reminder still due with the data as it is now? */
export function stillDue(nudge: Nudge, input: EvalInput): boolean {
  if (!input.settings.enabled || !input.settings.rules[nudge.rule]) return false
  return candidates(input, []).some((n) => n.key === nudge.key)
}
