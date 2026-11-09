import type { LocalDate } from "@/features/habits/domain/dates"
import type { HabitsState } from "@/features/habits/domain/types"
import {
  DEFAULT_THRESHOLD,
  measurementKey,
  type Checkpoint,
  type Goal,
  type GoalHabitLink,
  type GoalKind,
  type GoalPriority,
  type GoalState,
  type Horizon,
  type NumericSpec,
} from "./types"
import type { DimensionId } from "@/features/habits/domain/types"

/**
 * Pure goal transitions over the shared state (one dataset with habits). Like the habit
 * reducers they return the same reference when nothing changes (idempotent, cheap to detect),
 * and they are the same functions the sync engine will replay over server state (M3.1c).
 */

export interface GoalInput {
  title: string
  why?: string | null
  dimensionId?: DimensionId | null
  parentId?: string | null
  kind: GoalKind
  numeric?: NumericSpec | null
  threshold?: number | null
  startDate: LocalDate
  dueDate: LocalDate
  horizonOverride?: Horizon | null
  priority: GoalPriority
  aggregateChildren?: boolean
  habits: GoalHabitLink[]
  checkpoints: Checkpoint[]
}

export type GoalField =
  | "title"
  | "dates"
  | "numeric.habit"
  | "numeric.unit"
  | "numeric.values"
  | "threshold"
  | "habits"
  | "checkpoints"
  | "parent"

/** Validation shared by the form and the reducers. Messages in Spanish, keyed by field. */
export function validateGoal(input: GoalInput, state: HabitsState, selfId?: string): Partial<Record<GoalField, string>> {
  const errors: Partial<Record<GoalField, string>> = {}
  const title = input.title.trim()
  if (title.length === 0) errors.title = "Escribe el objetivo."
  else if (title.length > 80) errors.title = "Máximo 80 caracteres."
  if (input.dueDate < input.startDate) errors.dates = "La fecha límite no puede ser anterior al inicio."
  if (input.kind === "numeric") {
    const n = input.numeric
    if (!n) errors["numeric.values"] = "Define la medida."
    else {
      if (n.source === "habit") {
        const h = state.habits.find((x) => x.id === n.habitId)
        if (!h) errors["numeric.habit"] = "Elige el hábito que alimenta el objetivo."
        else if (h.type === "binary") errors["numeric.habit"] = "Solo hábitos numéricos o de duración tienen valores que sumar."
      }
      if (!n.unit.trim()) errors["numeric.unit"] = "Indica la unidad."
      if (![n.baseline, n.target].every(Number.isFinite)) errors["numeric.values"] = "Partida y meta deben ser números."
      else if (n.baseline === n.target) errors["numeric.values"] = "La meta debe ser distinta del punto de partida."
      else if (n.direction === "up" ? n.target < n.baseline : n.target > n.baseline)
        errors["numeric.values"] = n.direction === "up" ? "Para subir, la meta debe ser mayor que la partida." : "Para bajar, la meta debe ser menor que la partida."
    }
  }
  if (input.kind === "habits") {
    const t = input.threshold ?? DEFAULT_THRESHOLD
    if (!(t > 0 && t <= 1)) errors.threshold = "El umbral va de 1 % a 100 %."
    if (input.habits.length === 0) errors.habits = "Vincula al menos un hábito."
  }
  if (input.kind === "milestones" && input.checkpoints.filter((c) => c.title.trim()).length === 0)
    errors.checkpoints = "Añade al menos un hito."
  if (input.habits.some((l) => !state.habits.some((h) => h.id === l.habitId) || !(l.weight >= 1 && l.weight <= 3)))
    errors.habits = "Hay un hábito vinculado que no existe o con un peso fuera de 1–3."
  if (input.parentId) {
    if (input.parentId === selfId || (selfId && isDescendant(state.goals, input.parentId, selfId)))
      errors.parent = "Un objetivo no puede depender de sí mismo ni de sus subobjetivos."
    else if (!state.goals.some((g) => g.id === input.parentId)) errors.parent = "El objetivo padre no existe."
  }
  return errors
}

function isDescendant(goals: Goal[], candidate: string, ancestor: string): boolean {
  const seen = new Set<string>()
  let cur = goals.find((g) => g.id === candidate)
  while (cur?.parentId && !seen.has(cur.id)) {
    if (cur.parentId === ancestor) return true
    seen.add(cur.id)
    cur = goals.find((g) => g.id === cur!.parentId)
  }
  return false
}

function normalize(input: GoalInput): Omit<Goal, "id" | "state" | "createdAt" | "updatedAt"> {
  return {
    title: input.title.trim(),
    why: input.why?.trim() || null,
    dimensionId: input.dimensionId ?? null,
    parentId: input.parentId ?? null,
    kind: input.kind,
    numeric: input.kind === "numeric" && input.numeric ? { ...input.numeric, unit: input.numeric.unit.trim(), habitId: input.numeric.source === "habit" ? input.numeric.habitId ?? null : null } : null,
    threshold: input.kind === "habits" ? input.threshold ?? DEFAULT_THRESHOLD : null,
    startDate: input.startDate,
    dueDate: input.dueDate,
    horizonOverride: input.horizonOverride ?? null,
    priority: input.priority,
    aggregateChildren: !!input.aggregateChildren,
    habits: dedupeLinks(input.habits),
    checkpoints: input.checkpoints
      .filter((c) => c.title.trim())
      .map((c) => ({
        ...c,
        title: c.title.trim(),
        // Numeric milestones with a value are reached from data, never by hand.
        doneOn: input.kind === "numeric" && c.value !== null && c.value !== undefined ? null : c.doneOn ?? null,
      })),
  }
}

function dedupeLinks(links: GoalHabitLink[]): GoalHabitLink[] {
  const m = new Map<string, number>()
  for (const l of links) m.set(l.habitId, Math.round(Math.min(3, Math.max(1, l.weight))))
  return [...m].map(([habitId, weight]) => ({ habitId, weight }))
}

export function createGoal(state: HabitsState, input: GoalInput, meta: { id: string; now: string }): HabitsState {
  if (state.goals.some((g) => g.id === meta.id)) return state
  if (Object.keys(validateGoal(input, state)).length) return state
  const goal: Goal = { id: meta.id, ...normalize(input), state: "active", closedOn: null, archivedOn: null, reviewSince: null, version: 1, createdAt: meta.now, updatedAt: meta.now }
  return { ...state, goals: [...state.goals, goal] }
}

export function updateGoal(state: HabitsState, id: string, input: GoalInput, now: string): HabitsState {
  const current = state.goals.find((g) => g.id === id)
  if (!current || Object.keys(validateGoal(input, state, id)).length) return state
  const next: Goal = { ...current, ...normalize(input) }
  if (JSON.stringify({ ...next, updatedAt: "" }) === JSON.stringify({ ...current, updatedAt: "" })) return state
  return replace(state, { ...next, version: (current.version ?? 1) + 1, updatedAt: now })
}

export function setGoalState(state: HabitsState, id: string, goalState: GoalState, on: LocalDate, now: string): HabitsState {
  const g = state.goals.find((x) => x.id === id)
  if (!g || g.state === goalState) return state
  return replace(state, { ...g, state: goalState, closedOn: goalState === "active" ? null : on, updatedAt: now })
}

export function archiveGoal(state: HabitsState, id: string, on: LocalDate): HabitsState {
  const g = state.goals.find((x) => x.id === id)
  if (!g || g.archivedOn) return state
  return replace(state, { ...g, archivedOn: on })
}

export function restoreGoal(state: HabitsState, id: string): HabitsState {
  const g = state.goals.find((x) => x.id === id)
  if (!g || !g.archivedOn) return state
  return replace(state, { ...g, archivedOn: null })
}

/** Desired state: a date puts the goal in review, null takes it out. The first date is kept. */
export function setGoalReview(state: HabitsState, id: string, on: LocalDate | null): HabitsState {
  const g = state.goals.find((x) => x.id === id)
  if (!g || !!g.reviewSince === !!on) return state
  return replace(state, { ...g, reviewSince: on })
}

export type GoalStatusView = "active" | "review" | "closed" | "archived"

/**
 * The one list a goal belongs to, so none is ever left out of every filter. Archiving wins over
 * closing, as it always has on this screen, and a review only counts while the goal is open.
 */
export function goalStatusView(g: Pick<Goal, "state" | "archivedOn" | "reviewSince">): GoalStatusView {
  if (g.archivedOn) return "archived"
  if (g.state !== "active") return "closed"
  return g.reviewSince ? "review" : "active"
}

/** Desired state for one milestone: done on a date, or not done (null). */
export function setCheckpointDone(state: HabitsState, goalId: string, checkpointId: string, doneOn: LocalDate | null, today: LocalDate): HabitsState {
  const g = state.goals.find((x) => x.id === goalId)
  const cp = g?.checkpoints.find((c) => c.id === checkpointId)
  if (!g || !cp || (doneOn && doneOn > today)) return state
  if (g.kind === "numeric" && cp.value !== null && cp.value !== undefined) return state
  if ((cp.doneOn ?? null) === doneOn) return state
  return replace(state, { ...g, checkpoints: g.checkpoints.map((c) => (c.id === checkpointId ? { ...c, doneOn } : c)) })
}

export type MeasureResult =
  | { ok: true; state: HabitsState }
  | { ok: false; state: HabitsState; reason: "unknown_goal" | "not_manual" | "future" | "before_start" | "invalid_value" }

/** Desired state for a manual measurement on a day; null removes it. */
export function setMeasurement(
  state: HabitsState,
  op: { goalId: string; date: LocalDate; value: number | null; note?: string | null; opId: string; now: string; today: LocalDate }
): MeasureResult {
  const g = state.goals.find((x) => x.id === op.goalId)
  if (!g) return { ok: false, state, reason: "unknown_goal" }
  if (g.kind !== "numeric" || g.numeric?.source !== "manual") return { ok: false, state, reason: "not_manual" }
  if (op.date > op.today) return { ok: false, state, reason: "future" }
  if (op.date < g.startDate) return { ok: false, state, reason: "before_start" }
  if (op.value !== null && !Number.isFinite(op.value)) return { ok: false, state, reason: "invalid_value" }
  const key = measurementKey(op.goalId, op.date)
  const existing = state.measurements[key]
  const note = op.note?.trim() || null
  if (op.value === null ? !existing : existing && existing.value === op.value && (existing.note ?? null) === note) return { ok: true, state }
  const measurements = { ...state.measurements }
  if (op.value === null) delete measurements[key]
  else measurements[key] = { goalId: op.goalId, date: op.date, value: op.value, note, opId: op.opId, updatedAt: op.now }
  return { ok: true, state: { ...state, measurements } }
}

function replace(state: HabitsState, goal: Goal): HabitsState {
  return { ...state, goals: state.goals.map((g) => (g.id === goal.id ? goal : g)) }
}

/** Goals a habit contributes to (effort link or numeric source). */
export function goalsForHabit(state: Pick<HabitsState, "goals">, habitId: string): Goal[] {
  return state.goals.filter((g) => !g.archivedOn && (g.habits.some((l) => l.habitId === habitId) || g.numeric?.habitId === habitId))
}
