/**
 * Single source of truth for what each analytics figure means. The UI renders these
 * texts next to the numbers, and reviews (M3.4) store METRICS_VERSION with their frozen
 * snapshot, so an old review never changes when a formula is improved.
 */
export const METRICS_VERSION = 1

export type MetricId = "completion" | "perfect_days" | "exempt" | "in_progress" | "weekly_trend" | "weekday" | "streak"

export interface MetricDefinition {
  id: MetricId
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
