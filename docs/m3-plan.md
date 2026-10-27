# Plan M3 · Analítica fiable, objetivos, Deep Work, check-ins y revisiones

Estado: **propuesta, no iniciada**. Se empieza solo tras tu aprobación de este plan y del informe de M2.5.

## 1. Alcance
Según `IMPLEMENTATION_PLAN.md`, M3 incluye métricas fiables con tests, drilldowns y filtros, objetivos vinculados a hábitos, temporizador de enfoque y check-in AM/PM. Criterios de salida: cifras reproducibles, sin registros duplicados y N/A correcto.

Añadido a petición tuya: **persistencia de revisiones personales** (semanales y mensuales, con reflexión y keep/change/drop). Los informes automáticos y la explicación por IA siguen en M6. En M3 la revisión la escribes tú y la app congela las cifras del periodo.

Fuera de alcance: notificaciones push (M5), biblioteca y lectura (M4), IA (M6).

## 2. Principios (heredados de M2)
- Todo dato nuevo pasa por el **motor de sync existente**: cola durable en IndexedDB, `apply_ops` idempotente, `pull_changes` con `server_seq` y lápidas, realtime e indicador de estado. No habrá un segundo mecanismo de sincronización.
- Operaciones de **estado deseado**, nunca de alternancia. Conflictos: `base_seq` para registros simples y `version` con aviso «Aplicar el mío» para textos ricos.
- Lógica de negocio como funciones puras en `src/features/*/domain`, con Vitest. Las cifras se calculan con la misma función en cliente y al congelar una revisión.
- RLS en cada tabla y FKs compuestas `(id, user_id)` para impedir vincular datos de otro usuario, con tests de integración entre usuarios.
- Zona horaria del perfil y prueba del cambio de hora de Europe/Madrid en cada métrica diaria.
- Sin datos ficticios en la cuenta real. Las demos siguen etiquetadas.

## 3. Modelo de datos (migración `goals_focus_checkins` + `reviews`)
| Tabla | Campos clave | Restricciones |
| --- | --- | --- |
| `focus_sessions` | `id, user_id, habit_id?, project, planned_output, actual_output, planned_minutes, started_at, ended_at, active_seconds, segments jsonb, rating 1–5, state (running/finished/abandoned), version, server_seq, deleted_at` | Índice único parcial: **una sola sesión `running` por usuario**. `ended_at ≥ started_at`. `active_seconds ≤ duración` |
| `goals` | `id, user_id, parent_goal_id?, dimension_id?, title, metric_type (habits/numeric/milestone), unit, baseline, target, direction (up/down), due_date, state (active/achieved/abandoned), version, server_seq, deleted_at` | Padre del mismo usuario y sin ciclos (trigger) |
| `goal_habits` | `goal_id, habit_id, user_id, weight` | FK compuestas al mismo usuario |
| `goal_measurements` | `id, goal_id, user_id, observed_on, value, note, server_seq, deleted_at` | `unique (goal_id, observed_on)` como estado deseado del día |
| `daily_checkins` | `id, user_id, local_date, phase (am/pm), mood 1–5, energy 1–5, stress 1–5, sleep_hours, intention, win, note, server_seq, deleted_at` | `unique (user_id, local_date, phase)` |
| `reviews` | `id, user_id, period_kind (week/month), period_start, period_end, metrics_snapshot jsonb, metrics_version, reflection, keep jsonb, change jsonb, drop jsonb, version, server_seq, deleted_at` | `unique (user_id, period_kind, period_start)` |

Las nuevas operaciones de `apply_op`, con auditoría y `pull_changes` ampliado:

- **Deep Work:** `focus.start`, `focus.update` (pausa, reanudar, segmentos), `focus.finish`, `focus.discard`.
- **Objetivos:** `goal.create`, `goal.update` y `goal.archive`, `goal.link_habit` y `goal.unlink_habit`, `goal.measure`.
- **Check-ins:** `checkin.set`.
- **Revisiones:** `review.save` (con `version`).

## 4. Deep Work en detalle
- **Tiempo fiable:**
  - La sesión guarda `started_at` corregido con el desfase del servidor (el mismo reloj híbrido de M2) y una lista de segmentos activos.
  - `active_seconds` se deriva de los segmentos: nunca de un contador que se congela en segundo plano.
- **Cierre de la app:** al reabrir con una sesión `running` aparece «¿Sigue en curso? Continuar / Terminar a las HH:MM / Descartar». Funciona sin conexión y en varios dispositivos: la sesión activa se ve en todos y solo puede haber una.
- **Offline:** iniciar y terminar quedan en cola. Si dos dispositivos inician a la vez, gana el primero que llega al servidor y el otro recibe un aviso y se une a esa sesión.
- **Vínculo con hábitos:**
  - Un hábito de duración (por ejemplo «Deep Work 90 min») puede alimentarse de sesiones.
  - El registro del día se **deriva** con `source_activity_type = 'focus_session'` y `source_activity_id`, sin escribir a mano dos veces (regla del spec).
  - Borrar la sesión recalcula el registro.
- **Opcional, si el navegador lo admite:** Wake Lock para que la pantalla no se apague. Sin push hasta M5.
- **Métricas:** minutos de enfoque por día y semana, sesiones completadas frente a abandonadas, valoración media y distribución por proyecto.

## 5. Objetivos
- Tres tipos de métrica:
  - **por hábitos**: cumplimiento ponderado de los hábitos vinculados, en el periodo del objetivo;
  - **numérico**: mediciones con baseline, target y dirección;
  - **hito**: sí o no.
- Progreso, ritmo necesario y proyección a la fecha límite como funciones puras. Si no hay datos aplicables se muestra **N/A**, no 0 %.
- Jerarquía padre e hijo (por ejemplo, objetivo anual → trimestral). El progreso del padre solo se agrega si lo pides, sin sumas implícitas.

## 6. Check-ins AM/PM
- **AM:** horas de sueño, energía, ánimo e intención del día.
- **PM:** ánimo, energía, estrés, logro del día y nota.
- Uno de cada fase por día y estado deseado: editar sustituye al anterior.
- Entrada en menos de 15 s desde Resumen, con zonas táctiles de 44 px y valores rápidos.
- **Privacidad:** las notas y el ánimo nunca aparecen en notificaciones (requisito para M5).
- **Analítica:** tendencias de 7 y 30 días y correlación simple con el cumplimiento de hábitos, siempre como dato descriptivo, no causal.

## 7. Revisiones personales
- Semanal (lunes a domingo, zona del perfil) y mensual.
- Al crearla se **congela** `metrics_snapshot` con las métricas del periodo: cumplimiento por hábito y dimensión, minutos de Deep Work, medias de check-ins y progreso de objetivos. También se guarda `metrics_version` para que una revisión antigua no cambie si mejora una fórmula.
- Campos: reflexión libre más listas «mantener / cambiar / dejar».
- Edición multi-dispositivo con `version`: si chocan dos ediciones, aviso con «Aplicar el mío». Una fusión manual más fina queda para M6 si hace falta.
- La pantalla `Revisiones` deja de mostrar la demo en modo cuenta.

## 8. Analítica fiable (base de todo lo anterior)
- Catálogo de métricas en `src/features/analytics/domain` (cumplimiento, rachas, minutos de enfoque, tendencias de check-in y progreso de objetivos). Cada métrica tiene:
  - una definición escrita, igual a la que se muestra en la UI;
  - tests con casos límite: N/A, descansos, cambio de horario a mitad de semana, cambio de hora (DST) y hábitos semanales.
- **Drilldown:** de una cifra al detalle de días y registros que la componen, con filtros de rango, dimensión y hábito en una sola fila.
- **Reproducibilidad:** una prueba compara la cifra de la UI, la recalculada desde cero con los datos del servidor y la congelada en la revisión.

## 9. Fases y criterios de salida
| Fase | Contenido | Salida verificable |
| --- | --- | --- |
| **M3.0** | Catálogo de métricas puras + drilldown y filtros sobre los hábitos actuales | Tests de métricas (DST, N/A, versiones); cifras iguales entre UI y recálculo |
| **M3.1** | Migración y ops de `focus_sessions`; temporizador persistente | E2E: iniciar offline, cerrar la app, reabrir y terminar; una única sesión activa entre 2 dispositivos; registro de hábito derivado sin duplicar |
| **M3.2** | Objetivos, vínculos y mediciones | Integración: no se puede vincular un hábito de otro usuario; progreso N/A correcto; E2E crear, medir y ver el progreso |
| **M3.3** | Check-ins AM/PM | Único por día y fase; edición desde 2 dispositivos converge; entrada rápida en móvil |
| **M3.4** | Revisiones con snapshot congelado | La snapshot no cambia al editar datos pasados; conflicto de edición con aviso |
| **M3.5** | Despliegue cloud y validación real | Copia cifrada + simulacro **antes** de migrar; `push-dry` revisado; migración con tu autorización; smoke 12/12; pruebas en móvil y ordenador |

Cada fase termina con `npm run check`, `npm run test:integration`, `npm run e2e`, capturas a 375 y 1440 px y un commit coherente.

**Producción:** las migraciones cloud y cada push a `main` (que despliega en Vercel) siempre con tu autorización explícita y verificando el ref.

## 10. Decisiones que necesito de ti antes de empezar
1. ¿Incluimos las revisiones personales en M3 tal como se describe (manuales con snapshot), dejando los informes automáticos e IA para M6? *(Recomendado: sí.)*
2. Deep Work y hábitos: ¿las sesiones alimentan automáticamente un hábito de duración que elijas? *(Recomendado: sí, vínculo opcional por hábito.)*
3. Campos de los check-ins AM y PM: ¿te sirven los propuestos en §6 o quieres añadir o quitar alguno?
4. Tipos de objetivo: ¿bastan hábitos, numérico e hito?

## 11. Riesgos
- **Más tipos de operación en `apply_op`:** se mitiga con una función por entidad y tests de idempotencia por cada op.
- **Temporizador en iOS en segundo plano:** el tiempo se deriva de marcas de reloj, no de intervalos, así que es correcto aunque iOS suspenda la app.
- **Plan Free:** el volumen de M3 es pequeño, sin problema de cuotas. Copia cifrada antes de cada migración.
