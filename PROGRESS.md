# Progreso

Plan de la Misión Maestra (orden del 2026-11-09). Fases y estimaciones en `docs/roadmap.md`; estado por funcionalidad en `docs/matriz-funcional.md`.

**Comprobación común a toda tarea con PR:** CI de la PR en verde (`gh pr checks`), que incluye tipos, lint, unitarias, integración, E2E y el criterio de 0 flaky.

## Tareas

| ID | Tarea | Criterio de aceptación | MVP | Esfuerzo | Depende de | Estado | PR / preview |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A0 | Auditoría, Plan Maestro, matriz, roadmap y plan | Existen los documentos de la orden §4 y §7 | Sí | high | — | hecha | #1 |
| A1 | Integrar `fix/library-notice-autodismiss` (M4g, H1, D108) y añadir `npm run verify` | `npm run verify` correcto; `git diff` de la rama frente a la integrada vacío salvo configuración de Skynet | Sí | high | A0 | hecha | #2 |
| A2 | Recuperar la corrección del e2e de cierre simultáneo | `reviews-account.spec.ts` igual al del worktree copiado; 0 flaky en CI | Sí | medium | A1 | hecha | #2 |
| A3 | M4g.5: borrar y volver espera a `saved()`; aviso si un guardado se rechaza tras salir | E2E: borrar y volver sin red conserva el borrado tras recargar; unitarias de la decisión de aviso (el aviso en sí no tiene E2E) | Sí | high | A1 | hecha | #3 |
| A4 | M4g.5 §23-1: borradores temporales de asistentes (D102) | Unitarias de caducidad y limpieza; E2E: reabrir recupera lo escrito | Sí | high | A1 | hecha | #3 |
| A5 | M4g.5 §23-2: atribución de ediciones separadas (D101) | Unitaria de la derivación; E2E: la ficha muestra la fuente | Sí | medium | A1 | hecha | #3 |
| A6 | M4g.5 §8: buscar y actualizar datos de lo ya guardado | Unitarias del comparador; E2E: solo rellena vacíos; un único `update` por aplicación | Sí | xhigh | A1 | en curso | #4 |
| A7 | M4g.5 §23-6: repaso de privacidad e integridad y prueba de integración | Test de integración de los casos M y N con vínculos; `/dev/*` con 404; sin secretos en el repo | Sí | xhigh | A1 | pendiente | — |
| A8 | M4g.5 §23-3/4/5: ajustes de iPhone y guía de VoiceOver, teclado y sin red | Capturas a 375 px sin solapes; `docs/guia-dispositivo.md` | Sí | medium | A1 | pendiente | — |
| A9 | Cierre de M4g.5 en matriz y documentación | Matriz actualizada con evidencia | Sí | medium | A3–A8 | pendiente | — |
| B1 | Dominio de relaciones entre variables con tamaño de muestra y limitaciones | Unitarias: sin resultado por debajo del mínimo; incluye periodo, n y variables | Sí | high | A1 | pendiente | — |
| B2 | Vista «Relaciones» en Analytics, sin lenguaje causal | E2E de la vista; test que prohíbe vocabulario causal | Sí | high | B1 | pendiente | — |
| B3 | Comparativas semanales y mensuales explícitas | Unitarias del cálculo; E2E | Sí | high | A1 | pendiente | — |
| B4 | Proyecciones prudentes con datos suficientes | Unitaria: sin proyección con pocos datos | Sí | medium | B1 | pendiente | — |
| B5 | Métricas de aprendizaje en Analytics | Unitarias; E2E con datos de biblioteca | Sí | high | A1 | pendiente | — |
| C1 | Objetivos: estados archivado y en revisión (migración aditiva) | Integración: conserva los datos; E2E de filtros | Sí | xhigh | A1 | pendiente | — |
| C2 | Objetivos: registro de obstáculos y ajustes | Unitarias; E2E | Sí | high | C1 | pendiente | — |
| C3 | Objetivos vinculados a libros | Unitaria del progreso; E2E | Sí | high | C1 | pendiente | — |
| C4 | Deep Work: anotar interrupciones (migración aditiva) | Integración y E2E; sesiones antiguas intactas | Sí | xhigh | A1 | pendiente | — |
| C5 | Revisión diaria (migración aditiva) | Integración; E2E del ciclo; revisiones anteriores intactas | Sí | xhigh | A1 | pendiente | — |
| C6 | Historial de cambios de un hábito | Integración con RLS; E2E | Sí | high | A1 | pendiente | — |
| D1 | Active Recall: dominio de repaso espaciado | Unitarias de Again/Hard/Good/Easy y calendario | Sí | high | A9 | pendiente | — |
| D2 | Active Recall: persistencia, RLS y sincronización | Integración de RLS y sincronización | Sí | xhigh | D1 | pendiente | — |
| D3 | Active Recall: sesión de repaso desde ideas | E2E, también sin red | Sí | high | D2 | pendiente | — |
| D4 | Daily Discovery real: temas propios, valoración persistente, sin citas inventadas | Integración; E2E; lo no verificado se etiqueta | Sí | xhigh | A9 | pendiente | — |
| D5 | Tema de hoy en Command Center con datos reales | E2E; sin datos muestra estado vacío | Sí | medium | D4 | pendiente | — |
| D6 | Conexión de repasos con Cerebro y Analytics | Unitarias; E2E | Sí | high | D3, B5 | pendiente | — |
| E1 | Motor de insights por reglas con periodo, variables, n y limitaciones | Unitarias; ninguno con muestra insuficiente | Sí | high | B1, C4 | pendiente | — |
| E2 | Pantalla Inteligencia real, etiquetada como reglas | E2E; sin etiquetas demo | Sí | high | E1 | pendiente | — |
| E3 | Experimentos de mejora medibles | Unitarias; E2E | Sí | high | E2 | pendiente | — |
| E4 | Adaptador de proveedor IA apagado por defecto | Unitaria: sin proveedor no hay llamadas | Sí | medium | E1 | pendiente | — |
| E5 | Motivation Engine: reglas y evaluador puro (silencio, tope, reevaluación) | Unitarias: nada para hábito hecho o en descanso | Sí | xhigh | A1 | pendiente | — |
| E6 | Ajustes reales de notificaciones (migración aditiva) | Integración; E2E; sin etiqueta demo | Sí | high | E5 | pendiente | — |
| E7 | Bandeja dentro de la app | E2E; respeta tope y silencio | Sí | high | E6 | pendiente | — |
| E8 | Push: suscripción por dispositivo y permiso tras acción clara | Test de navegador; alta y baja independientes por dispositivo | Sí | xhigh | E7 | pendiente | — |
| F1 | Integración final del Command Center y sus estados | E2E de los cuatro estados del Plan §5.1 | Sí | high | B–E | pendiente | — |
| F2 | Accesibilidad y rendimiento de vistas clave | `a11y.spec.ts` ampliado; mediciones documentadas | Sí | high | F1 | pendiente | — |
| F3 | Simulacro de respaldo y restauración | `restore:drill` correcto, con resultado documentado | Sí | high | F1 | pendiente | — |
| F4 | Guía de uso y validación móvil | `docs/guia-uso.md`; capturas móvil y escritorio | Sí | medium | F2 | pendiente | — |
| F5 | `docs/publicacion.md`: publicar, revertir, separar la base | Procedimiento completo revisado contra el repo | Sí | medium | F2 | pendiente | — |
| F6 | Documentación final y versión candidata (DONE.md) | Criterios §12 de la orden con evidencia | Sí | high | F1–F5 | pendiente | — |

Estados: pendiente · en curso · hecha · bloqueada · PR lista para fusionar

## Bloqueos

_Ninguno por ahora._

**Limitación conocida:** la prueba de humo contra un preview da 10 de 22. Las 12 restantes pasan todos sus pasos y fallan solo en la aserción final de la consola, porque la CSP de la app bloquea la barra de comentarios que Vercel inyecta en los previews (`vercel.live/_next-live/feedback/feedback.js`). En la CI, sobre el build local, pasan las 22. Medido en la PR #3.

**Pendiente autorizable (Dani):** proveedor de IA generativa; servicio de envío programado de push si tuviera coste; publicación en `main` y producción; prueba real en iPhone; desactivar la barra de comentarios de Vercel en los previews (ajuste del proyecto en la nube), que dejaría en verde esa prueba de humo.

## Cambios de alcance

- 2026-11-09: el plan se agrupa en PR por bloque para no agotar los minutos de CI (ver `DECISIONS.md`).
