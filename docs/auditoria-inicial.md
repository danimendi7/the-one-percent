# Auditoría inicial (2026-11-09)

Resumen de la situación al recibir la Misión Maestra. El detalle por funcionalidad está en `docs/matriz-funcional.md`; las fases, en `docs/roadmap.md`.

## Conclusión
El núcleo está construido y bien probado (hábitos, sincronización, objetivos, Deep Work, check-ins, revisiones semanales y mensuales, biblioteca y Cerebro). **El trabajo más avanzado no está en `main` ni en `skynet/integracion`**, sino en una rama sin integrar. Faltan por construir, o son solo pantallas demo: Active Recall, Daily Discovery real, Motivation Engine y notificaciones, Inteligencia, revisión diaria, análisis multivariable e historial de auditoría visible.

## Historial de ramas
Base de comparación: `skynet/integracion` (`9a090a4`) = `origin/main` (`b8388f7`, producción) + la configuración de Skynet.

| Rama | Relación | Conclusión |
| --- | --- | --- |
| `fix/library-notice-autodismiss` = `origin/ci/library-notice-d108` (`0530bdd`) | +24 commits sobre `b8388f7` | **La más avanzada**: M4g.1–M4g.4, M4-H1 en asistentes (D106), reconciliación (D107) y D108. Es la que se integra (tarea A1) |
| `m4g/reconcile`, `origin/ci/m4g-reconcile` (`01a1c9b`) | Contenida en la anterior | CI en verde (run 41596809641) |
| `m4g/h1` (`97fc740`), `origin/ci/m4g` (`c44ed44`) | Contenidas en la anterior | Nada que recuperar |
| `hotfix/m4-offline-save`, `origin/ci/m4-h1`, `origin/ci/m4` | Contenidas en `b8388f7` o anteriores | Nada que recuperar |
| `main` local (`2b9feb6`) | Divergente: 16 por delante de `f66b3b9` | Su único commit fuera de la rama avanzada tiene el mismo árbol que `77f0b61`. **Nada que recuperar**, y no se toca |
| `respaldo/sin-confirmar-20261109-1105` | Solo añade el `.docx` | Fuente de `docs/plan-maestro.md` |

**Trabajo sin confirmar recuperado:** el worktree copiado `the-one-percent-fix-notices` difiere de su rama en un único archivo con contenido propio, `e2e/reviews-account.spec.ts`: convierte en determinista el cierre simultáneo de una revisión desde dos navegadores. Es la respuesta a la CI en rojo de D108 (run 41654144424, criterio «0 flaky»). Se incorpora en la tarea A2.

No hay etiquetas. El historial de M3 y M4 está documentado en `docs/reports/` y `docs/decisions.md` (estos llegan completos con A1).

## Línea base técnica
Medida sobre `0530bdd` en esta máquina (Node 26.13 local; la CI y `engines` usan Node 24):

| Comprobación | Resultado |
| --- | --- |
| `typecheck` | Correcto |
| `lint` | Correcto |
| Unitarias | 735 de 735, en 59 archivos |
| `build` | **Sin medir**: falló por usar un `node_modules` enlazado en un worktree temporal, no por el código. Se mide en A1 |
| Integración y E2E | **No ejecutables aquí**: no hay Docker para la Supabase local. Se validan en la CI de cada PR |

Evidencia de CI anterior: `01a1c9b` en verde (run 41596809641); `0530bdd` en rojo solo por el criterio «0 flaky» (run 41654144424).

## Hallazgos principales
1. **Sin integrar:** 121 archivos y unas 12.600 líneas de M4g siguen fuera de `skynet/integracion`.
2. **Pantallas demo:** Inteligencia (`/intelligence`), Notificaciones (`/settings/notifications`) y Descubrir (`/knowledge/discover`) son estáticas y están etiquetadas como demo. La tarjeta «Tema de hoy» del Command Center también usa esos datos demo.
3. **Diferencias con el Plan Maestro:** no hay revisión diaria (solo `week` y `month`); los objetivos tienen `active`, `achieved` y `abandoned`, sin «archivado» ni «en revisión»; Deep Work no registra interrupciones; el historial de auditoría se guarda (`audit_logs`) pero no se muestra.
4. **M4g.5 tiene dos definiciones** en `docs/m4g-plan.md`: §8 (actualizar datos de lo ya guardado) y §23 (endurecimiento). Se atienden las dos (ver `DECISIONS.md`).
5. **Validación manual pendiente:** las guías de M4 (iPhone, VoiceOver) dependen de Dani. Quedan como «no verificable» hasta entonces.

## Riesgos
- **Staging y producción son la misma base** (decisión de Dani, 2026-11-09). La app desplegada en `main` usa esa base, así que toda migración debe ser aditiva y compatible con el código desplegado. Antes de publicar hay que separarlas: `docs/publicacion.md` lo explicará (tarea F5).
- **Sin previews de Vercel** en este repositorio (la API de deployments no devuelve ninguno): la validación de las PR es la CI, no un preview.
- **Minutos de GitHub Actions:** el repositorio es privado y cada PR ejecuta la CI completa (unos 16–40 min). Las tareas se agrupan en PR por bloque para no agotar el cupo.
- **Node 26 local frente a 24 en la CI:** la CI es la referencia.

## Primer bloque de trabajo
Fase A: integrar la rama avanzada (A1), recuperar la corrección del e2e (A2) y cerrar M4g.5 (A3–A9). Plan completo en `PROGRESS.md`.
