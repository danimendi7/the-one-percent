/**
 * Single source of truth for what each analytics figure means. The UI renders these
 * texts next to the numbers, and reviews (M3.4) store METRICS_VERSION with their frozen
 * snapshot, so an old review never changes when a formula is improved.
 * v2 (M3.1): adds the goal metrics; habit formulas are unchanged.
 */
export const METRICS_VERSION = 2

export type MetricId = "completion" | "perfect_days" | "exempt" | "in_progress" | "weekly_trend" | "weekday" | "streak"

export type GoalMetricId = "goal_outcome" | "goal_effort" | "goal_pace" | "goal_projection" | "goal_status"

export interface MetricDefinition<Id extends string = MetricId> {
  id: Id
  label: string
  /** One sentence, shown in the drilldown header and the "Cómo se calcula" panel. */
  formula: string
}

export const METRICS: Record<MetricId, MetricDefinition> = {
  completion: {
    id: "completion",
    label: "Cumplimiento",
    formula: "Oportunidades cumplidas / oportunidades aplicables (cumplidas + fallidas + pendientes de hoy).",
  },
  perfect_days: {
    id: "perfect_days",
    label: "Días completos",
    formula: "Días con al menos un hábito programado en los que se cumplieron todos.",
  },
  exempt: {
    id: "exempt",
    label: "Exentos",
    formula: "Oportunidades que caen en días de descanso: no cuentan ni a favor ni en contra.",
  },
  in_progress: {
    id: "in_progress",
    label: "Semanales en curso",
    formula: "Objetivos «N veces por semana» de la semana abierta aún no alcanzados: fuera del denominador hasta que cierre.",
  },
  weekly_trend: {
    id: "weekly_trend",
    label: "Tendencia semanal",
    formula: "Cumplimiento de cada semana (lunes a domingo, hasta hoy en la semana actual).",
  },
  weekday: {
    id: "weekday",
    label: "Por día de la semana",
    formula: "Cumplimiento de los días programados agrupados por día de la semana; los objetivos semanales no se reparten por días.",
  },
  streak: {
    id: "streak",
    label: "Racha",
    formula: "Oportunidades cumplidas seguidas hasta la última cerrada; hoy pendiente y la semana abierta no la rompen.",
  },
}

/** General rules shown under "Cómo se calcula". */
export const GENERAL_RULES = [
  "Si no hay ninguna oportunidad aplicable se muestra N/D, nunca 0% ni 100%.",
  "Solo cuentan los días programados según la versión de horario vigente ese día; cambiar un horario no recalcula el pasado.",
  "Los objetivos «N veces por semana» se evalúan por semana completa, no por día.",
  "Hoy cuenta como pendiente; los días de descanso y los días futuros no cuentan.",
  "Un hábito numérico solo se cumple con un valor registrado: la ausencia de dato nunca es éxito.",
  "Los hábitos archivados conservan su historial en estas cifras.",
  "Pulsa cualquier cifra o elemento de un gráfico para ver los registros exactos que la componen.",
] as const

/** Goal figures (M3.1). Shown in each goal's "Cómo se calcula" and frozen in reviews like the rest. */
export const GOAL_METRICS: Record<GoalMetricId, MetricDefinition<GoalMetricId>> = {
  goal_outcome: {
    id: "goal_outcome",
    label: "Resultado",
    formula:
      "Numérico: (actual − partida) / (meta − partida), entre 0 % y 100 %. Hitos: cumplidos / totales. Por hábitos: cumplimiento del sistema / umbral.",
  },
  goal_effort: {
    id: "goal_effort",
    label: "Esfuerzo",
    formula:
      "Cumplimiento de los hábitos vinculados desde el inicio del objetivo, con las mismas reglas que Análisis. Con pesos: Σ peso·cumplidas / Σ peso·aplicables.",
  },
  goal_pace: {
    id: "goal_pace",
    label: "Ritmo necesario",
    formula: "Lo que falta hasta la meta dividido entre los días que quedan hasta la fecha límite.",
  },
  goal_projection: {
    id: "goal_projection",
    label: "Tendencia",
    formula:
      "Último valor: recta de mínimos cuadrados sobre las mediciones (≥ 3 en ≥ 14 días). Acumulado: ritmo medio diario desde el inicio (≥ 3 registros y ≥ 14 días). Hitos: hitos cumplidos por día (≥ 2 y ≥ 14 días).",
  },
  goal_status: {
    id: "goal_status",
    label: "Estado",
    formula:
      "Con tendencia: «En ritmo» si la proyección llega a la meta en la fecha, «Por detrás» si no. Sin tendencia: progreso frente a la recta ideal (tiempo transcurrido), con ±5–10 puntos de margen. Por hábitos: cumplimiento frente al umbral.",
  },
}

export const GOAL_RULES = [
  "El esfuerzo y el resultado se muestran por separado: cumplir hábitos no mueve el resultado automáticamente.",
  "Si no hay datos suficientes se muestra N/D con el motivo, nunca 0 % ni una proyección inventada.",
  "Un objetivo alimentado por un hábito lee sus registros: no admite mediciones manuales y nada se registra dos veces.",
  "Los hitos con valor se cumplen solos el primer día en que los datos reales los alcanzan.",
  "Un objetivo padre solo agrega a sus subobjetivos si lo activas: media de su resultado.",
] as const
