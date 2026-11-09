# Matriz funcional

Estado medido el 2026-11-09 sobre `0530bdd`, ya integrado en `skynet/integracion` (PR #2). Se actualiza al cerrar cada tarea.

**Estados:** IV = implementada y validada · P = implementada parcialmente · SP = implementada sin pruebas suficientes · ND = planificada pero no desarrollada · NV = no verificable con la información disponible.

**Validación:** «CI» es la suite E2E e integración en verde sobre `d5d4b36` (run 42638530217, PR #6; una pasada con 0 flaky). Ninguna fila incluye prueba en dispositivo real.

| Módulo | Funcionalidad | Estado actual | Evidencia | Trabajo pendiente | Prioridad |
| --- | --- | --- | --- | --- | --- |
| Command Center | Hábitos del día, cumplimiento, semana y 30 días | IV | `overview-view.tsx`, `e2e/habits.spec.ts`, CI | — | — |
| Command Center | Objetivos, Deep Work, check-in, revisión, biblioteca | P | Componentes reales en `overview-view.tsx` | Integración final de indicadores (F1) | Media |
| Command Center | Tarjeta «Tema de hoy» | P | Usa `FEATURED_TOPIC` de datos demo | Conectar a Discovery real (D5) | Media |
| Command Center | Distinguir sin datos, descanso, incumplimiento y error de sincronización | SP | `cell-state.ts`, `sync-status.tsx` | Prueba específica (F1) | Media |
| Habit Engine | Crear, editar, archivar, frecuencias, calendario | IV | `features/habits`, `e2e/habits.spec.ts`, CI | — | — |
| Habit Engine | Registro rápido y descansos sin contar como incumplimiento | IV | `cell-state.ts`, `metrics.ts`, tests, CI | — | — |
| Habit Engine | Rachas y cumplimiento a 30 días | IV | `habit-metrics.tsx`, `metrics.ts`, CI | — | — |
| Habit Engine | Historial de auditoría de cambios | IV | `audit_logs`, `habits/domain/history.ts`, `habit-history.int.test.ts`, `account.spec.ts`, CI | — | — |
| Habit Engine | Sincronización y offline | IV | `features/sync` (14 tests), `sync.int.test.ts`, `offline.spec.ts`, CI | — | — |
| Life Analytics | Descriptivo: series, heatmap, comparativas | SP | `analytics-view.tsx`, `catalog.ts`, `domain/comparisons.ts`, `e2e/analytics.spec.ts`; comparativas pendientes de la CI de su PR | CI (B3) | Media |
| Life Analytics | Diagnóstico: cruces multivariables | SP | `domain/relations.ts`, `relations-panel.tsx`, `e2e/analytics.spec.ts`; pendientes de la CI de su PR | CI (B1, B2) | Alta |
| Life Analytics | Predictivo | SP | `goal_projection`, `domain/projections.ts`, `forecast-panel.tsx`; pendiente de la CI de su PR | CI (B4) | Baja |
| Life Analytics | Prescriptivo | ND | Sin código | Experimentos por reglas (E3) | Media |
| Life Analytics | Dimensión de aprendizaje | SP | `domain/learning.ts`, `learning-panel.tsx`; pendiente de la CI de su PR | CI (B5) | Media |
| Goals & Systems | Objetivos, métricas, hitos, fechas, hábitos vinculados | IV | `features/goals`, `goals.int.test.ts`, E2E, CI | — | — |
| Goals & Systems | Progreso real frente a esperado | IV | `domain/progress.ts` y su test, CI | — | — |
| Goals & Systems | Estados archivado y en revisión | IV | `goalStatusView`, `supabase/migrations/20261109090000_goal_review.sql`, `e2e/goals.spec.ts`, `tests/integration/goals.int.test.ts`, CI | — | — |
| Goals & Systems | Obstáculos y ajustes de procesos | IV | `goal-log.tsx`, `supabase/migrations/20261109100000_goal_process_log.sql`, `e2e/goals.spec.ts`, `tests/integration/goals.int.test.ts`, CI | — | — |
| Goals & Systems | Vínculo con libros | IV | `goal-books.tsx`, `goals/domain/books.ts`, `supabase/migrations/20261109110000_goal_books.sql`, `e2e/goals.spec.ts`, `tests/integration/goals.int.test.ts`, CI | Objetivo «leer N libros» con resultado derivado (aplazado, P15) | Baja |
| Deep Work | Temporizador, proyectos, duración prevista y real, calidad | IV | `focus_sessions`, `rating`, `focus.int.test.ts`, E2E, CI | — | — |
| Deep Work | Estadísticas por día, semana y proyecto | IV | `domain/metrics.ts`, `focus-analytics.tsx`, CI | — | — |
| Deep Work | Interrupciones | IV | `InterruptionsInput`, `supabase/migrations/20261109120000_focus_interruptions.sql`, `e2e/focus.spec.ts`, `tests/integration/focus.int.test.ts`, CI | Usarlas en métricas e insights (E1) | Media |
| Deep Work | Cruces con sueño, energía y estrés | P | Solo `mind_energy_focus` | Con B2 | Media |
| Knowledge OS | Libros y podcasts: altas, estados, notas, sincronización | IV | `features/library`, `library*.int.test.ts`, E2E, CI | — | — |
| Knowledge OS | Altas asistidas, metadatos, portadas, duplicados (M4g.1–4) | IV | `/api/metadata/*`, `/api/covers`, `add-book`, `add-podcast`, `covers`, CI | — | — |
| Knowledge OS | Persistencia antes de navegar (M4-H1, D106) | IV | `offline-save.spec.ts`, CI | — | — |
| Knowledge OS | Avisos que no deciden un texto (D108) | IV | Commit `0530bdd`, CI | — | — |
| Knowledge OS | Borradores temporales de asistentes (M4g.5 §23-1, D102) | IV | `metadata/assistant-draft.ts`, `add-book.spec.ts`, `add-podcast.spec.ts`, CI | — | — |
| Knowledge OS | Atribución de ediciones separadas (M4g.5 §23-2, D101) | IV | `metadata/attribution.ts`, `add-book.spec.ts`, CI | — | — |
| Knowledge OS | Actualizar datos de lo ya guardado (M4g.5 §8) | IV | `metadata/diff.ts`, `metadata-update.tsx`, `e2e/metadata-update.spec.ts`, CI | — | — |
| Knowledge OS | Repaso de privacidad e integridad (M4g.5 §23-6) | IV | `docs/security-checklist.md`, casos M y N con vínculos en `library-sync.int.test.ts`, CI | — | — |
| Knowledge OS | Asistentes en el iPhone: espacio y 44 px (M4g.5 §23-3) | SP | `e2e/assistant-iphone.spec.ts`, CI, capturas `iphone-teclado-*`; teclado simulado | Prueba real en iPhone con `docs/guia-dispositivo.md` (Dani) | Media |
| Knowledge OS | Medición en iPhone y guía de VoiceOver y sin red (M4g.5 §23-4/5) | NV | `docs/guia-dispositivo.md` escrita; nadie la ha ejecutado | Ejecutar la guía y apuntar el resultado (Dani) | Media |
| Knowledge OS | Cerebro: ideas, búsqueda, relaciones | IV | `brain-view.tsx`, `knowledge/domain`, `knowledge.spec.ts`, CI | — | — |
| Knowledge OS | Active Recall | IV | `features/recall`, `/knowledge/brain/repaso`, `20261109150000_recall.sql`, `recall.int.test.ts`, `recall*.spec.ts`, `offline.spec.ts`, CI | Conexión con Analytics (D6) | Media |
| Knowledge OS | Daily Discovery / Tema de hoy | P | Pantalla demo, no guarda nada | D4, D5 | Alta |
| Mind & Energy | Check-in, historial, tendencias, filtros | IV | `features/mind`, `checkins.int.test.ts`, E2E, CI | — | — |
| Life Review | Semanal y mensual, decisiones, cierre | IV | `features/reviews`, `reviews*.int.test.ts`, E2E, CI | Corrección del e2e flaky (A2) | Alta |
| Life Review | Revisión diaria | IV | `kind = 'day'` en `features/reviews`, `20261109130000_daily_reviews.sql`, `reviews.int.test.ts`, `reviews*.spec.ts`, CI | — | — |
| AI Intelligence | Insights basados en reglas | ND | `/intelligence` es estática | E1, E2 | Alta |
| AI Intelligence | Arquitectura de proveedor opcional | ND | Solo variables en `.env.example` | E4 | Media |
| AI Intelligence | IA generativa | ND | — | Pendiente autorizable: requiere proveedor | — |
| Motivation Engine | Perfiles, reglas, horas de silencio, tope diario | ND | Ajustes demo que no guardan | E5, E6 | Alta |
| Notificaciones | Bandeja dentro de la app | ND | Sin código | E7 | Alta |
| Notificaciones | Push | ND | Sin `pushManager` en `src` | E8; el envío programado puede requerir autorización | Media |
| Transversal | PWA y arranque sin red | SP | `manifest.ts`, `public/sw.js`, `upgrade.spec.ts`, CI; iPhone sin probar | Prueba real con `docs/guia-dispositivo.md` (Dani) | Media |
| Transversal | Autenticación, lista de acceso y RLS | IV | `account.spec.ts`, `metadata-auth.int.test.ts`, M2.5 | Repaso final (A7) | Alta |
| Transversal | Respaldo y restauración | SP | `backup*.mjs`, `restore-drill.mjs`, `backup-strategy.md`; simulacro sin repetir | Simulacro (F3) | Media |
| Transversal | Exportación | IV | `settings-view.tsx`, E2E, CI | — | — |
| Transversal | Accesibilidad | SP | `e2e/a11y.spec.ts`, CI; VoiceOver sin probar | Revisión (F2) | Media |
| Transversal | Rendimiento | SP | `bench-*`, informes M4 | Medición de vistas clave (F2) | Baja |
| Transversal | Uso en dispositivo real (móvil y ordenador) | NV | Depende de Dani | Guía (A8, F4) | Media |

Los bloqueadores de Instagram Reels y YouTube Shorts están **excluidos** por decisión expresa.
