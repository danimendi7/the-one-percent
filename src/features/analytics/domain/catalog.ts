/**
 * Single source of truth for what each analytics figure means. The UI renders these
 * texts next to the numbers, and reviews (M3.4) store METRICS_VERSION with their frozen
 * snapshot, so an old review never changes when a formula is improved.
 * v2 (M3.1): adds the goal metrics; habit formulas are unchanged.
 * v3 (M3.2): adds the focus metrics; habit and goal formulas are unchanged.
 * v4 (M3.3): adds the Mind & Energy metrics; earlier formulas are unchanged.
 */
export const METRICS_VERSION = 4

export type MetricId = "completion" | "perfect_days" | "exempt" | "in_progress" | "weekly_trend" | "weekday" | "streak"

export type FocusMetricId = "focus_minutes" | "focus_sessions" | "focus_complete" | "focus_rating" | "focus_projects" | "focus_streak"

export type MindMetricId = "mind_coverage" | "mind_average" | "mind_change" | "mind_energy_focus" | "mind_sleep_completion"

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

/** Focus figures (M3.2). Same rules: explicit base, N/D instead of invented zeros, every figure opens its sessions. */
export const FOCUS_METRICS: Record<FocusMetricId, MetricDefinition<FocusMetricId>> = {
  focus_minutes: {
    id: "focus_minutes",
    label: "Minutos de foco",
    formula: "Suma del tiempo efectivo (sin pausas) de las sesiones terminadas en el periodo, redondeada a minutos una sola vez.",
  },
  focus_sessions: {
    id: "focus_sessions",
    label: "Sesiones",
    formula: "Sesiones terminadas. Una sesión cuenta en el día en que empezó, aunque cruce la medianoche.",
  },
  focus_complete: {
    id: "focus_complete",
    label: "Bloques completos",
    formula: "Sesiones cuyo tiempo efectivo alcanzó lo previsto / sesiones terminadas. N/D sin sesiones.",
  },
  focus_rating: {
    id: "focus_rating",
    label: "Valoración media",
    formula: "Media de las valoraciones dadas (1–5), indicando cuántas sesiones se valoraron. N/D si ninguna.",
  },
  focus_projects: {
    id: "focus_projects",
    label: "Por proyecto",
    formula: "Minutos efectivos por proyecto; las sesiones sin proyecto se agrupan en «Sin proyecto».",
  },
  focus_streak: {
    id: "focus_streak",
    label: "Racha de foco",
    formula: "Días seguidos con al menos una sesión terminada hasta hoy; hoy sin sesión todavía no la rompe.",
  },
}

export const FOCUS_RULES = [
  "Solo cuentan las sesiones terminadas; descartar una sesión no cuenta nada.",
  "El tiempo sale de las marcas de inicio y fin de cada tramo, nunca de un contador: no depende de que la app esté abierta.",
  "Un hábito alimentado por Enfoque suma exactamente estos minutos en su día; no admite registros manuales.",
  "Con menos de 3 sesiones o menos de una semana de historial se indica «Pocos datos» y no se muestran tendencias.",
] as const

/**
 * Mind & Energy figures (M3.3). Descriptive only: no wellbeing score, no streaks, and the
 * comparisons are exploratory (decision 5). Reviews (M3.4) will freeze these figures, never the
 * text of the reflections.
 */
export const MIND_METRICS: Record<MindMetricId, MetricDefinition<MindMetricId>> = {
  mind_coverage: {
    id: "mind_coverage",
    label: "Días con check-in",
    formula: "Días del periodo con al menos un check-in (mañana o noche) / días del periodo.",
  },
  mind_average: {
    id: "mind_average",
    label: "Media",
    formula: "Media de los días con dato; un día con mañana y noche cuenta la media de ambas. Se indica cuántos días hay (n); sin datos, N/D.",
  },
  mind_change: {
    id: "mind_change",
    label: "Cambio",
    formula: "Diferencia entre la media del periodo y la del periodo anterior de igual duración. Solo si ambos tienen al menos 7 días con dato.",
  },
  mind_energy_focus: {
    id: "mind_energy_focus",
    label: "Energía y Deep Work",
    formula: "Energía media de los días con 60 min o más de enfoque terminado frente a los días con menos. Solo con 5 días o más en cada grupo.",
  },
  mind_sleep_completion: {
    id: "mind_sleep_completion",
    label: "Sueño y hábitos",
    formula: "Cumplimiento de hábitos de los días tras dormir 7 h o más frente a menos de 7 h (días cerrados, sin hoy). Solo con 5 días o más en cada grupo.",
  },
}

export const MIND_RULES = [
  "Los check-ins son opcionales y no suman ni restan a ningún cumplimiento: no hay rachas ni puntuación de bienestar.",
  "El estrés va de 1 (muy poco) a 5 (mucho): un valor alto no es «mejor».",
  "Las comparaciones son descriptivas: muestran lo que coincide en tus datos, no qué causa qué.",
  "Con menos de 7 días con check-in en el periodo se indica «Pocos datos» y no se muestran tendencias ni comparaciones.",
  "Las reflexiones son privadas: no se usan en ninguna cifra, ni en notificaciones ni en IA.",
] as const
