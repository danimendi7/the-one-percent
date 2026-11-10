# THE ONE PERCENT · versión candidata

Respuesta a la orden del 2026-11-09 (Misión Maestra). Modo protegido: nada se ha publicado en `main` ni en producción. Publicar lo decides tú, con [`docs/publicacion.md`](docs/publicacion.md).

| | |
| --- | --- |
| Versión candidata | `skynet/integracion`, con esta PR fusionada encima de `faee9b2` |
| Preview de la candidata | `https://the-one-percent-git-skynet-integracion-danimendiar-3744.vercel.app`, tras el SSO de Vercel |
| Producción, sin cambios | `https://the-one-percent-kappa.vercel.app` (sigue en `main`) |
| Estado de cada tarea | [`PROGRESS.md`](PROGRESS.md) · por funcionalidad: [`docs/matriz-funcional.md`](docs/matriz-funcional.md) |

## La prueba final

- **CI completa de la última PR fusionada** (#28, run 42812714735): 1144 unitarias, 231 de integración (PostgreSQL real, RLS incluida), 6 del motor de sincronización en Chromium real, 595 E2E en móvil y escritorio y 22 de humo. Todo con 0 fallidas y 0 inestables; las únicas omisiones son las 27 previstas. Según el procedimiento de `PROGRESS.md`, cada PR se fusionó con esta misma CI en verde.
- **Humo contra el preview de la rama base** (con `faee9b2`): 10 de 22. Las otras 12 cumplen todos sus pasos y fallan solo en la comprobación final de la consola: la CSP de la app bloquea la barra de comentarios que Vercel inyecta en los previews. En la CI pasan las 22, y en producción esa barra no existe.
- **Lo que no se puede ejecutar contra un preview:** las E2E con cuenta se niegan a usar una base remota (aislamiento por diseño, D48). Se ejecutan en cada CI contra una Supabase local efímera.

## Qué hace la app y qué lo demuestra

| Módulo | Qué hay | Prueba |
| --- | --- | --- |
| Command Center | Hábitos del día, 7 y 30 días, objetivos, check-in, revisión, enfoque, tema de hoy, lectura actual y atajos. Distingue sin datos, descanso, incumplimiento y error de sincronización | `overview.spec.ts`, `overview-account.spec.ts`, `day.test.ts` |
| Habit Engine | Frecuencias versionadas, registro en un toque, descansos que no cuentan, rachas, historial de cambios, sin conexión y varios dispositivos | `habits.spec.ts`, `account.spec.ts`, `metrics.test.ts`, `sync.int.test.ts`, `habit-history.int.test.ts` |
| Life Analytics | Tendencias, comparativas de periodos cerrados, relaciones con su n y sin lenguaje causal, proyección prudente, aprendizaje y registros detrás de cada cifra | `analytics.spec.ts`, `relations.test.ts`, test que prohíbe vocabulario causal |
| Goals & Systems | Por hábitos, por medición o por un hábito; hitos, ritmo, revisión y archivo, obstáculos y ajustes, libros vinculados | `goals.spec.ts`, `goals-account.spec.ts`, `goals.int.test.ts` |
| Deep Work | Temporizador por instantes, pausa, recuperación, proyecto, interrupciones y estadísticas; alimenta hábitos | `focus.spec.ts`, `focus-account.spec.ts`, `focus.int.test.ts` |
| Knowledge OS | Libros y podcasts con altas asistidas, portadas, duplicados, borradores y actualización de datos; Cerebro, repaso espaciado y Daily Discovery | `library*.spec.ts`, `add-*.spec.ts`, `metadata-update.spec.ts`, `recall*.spec.ts`, `discover*.spec.ts`, `library-sync.int.test.ts`, `recall.int.test.ts` |
| Mind & Energy | Check-ins de mañana y noche, historial y tendencias, sin diagnósticos | `mind.spec.ts`, `mind-account.spec.ts`, `checkins.int.test.ts` |
| Life Review | Revisiones diaria, semanal y mensual con cifras congeladas y registro de decisiones | `reviews.spec.ts`, `reviews-account.spec.ts`, `reviews.int.test.ts` |
| Inteligencia | Seis reglas con mínimos de datos, experimentos de 7 a 28 días y un adaptador de IA apagado | `intelligence.spec.ts`, `insights.test.ts`, `experiments.int.test.ts`, `ai-provider.test.ts` |
| Motivation Engine y avisos | Evaluador puro con silencio, tope, separación y reevaluación; bandeja; push por dispositivo con notificación de prueba | `notifications.spec.ts`, `inbox.spec.ts`, `push-account.spec.ts`, `motivation.int.test.ts`, `push.int.test.ts`, `sw.test.ts` |
| Transversal | PWA sin conexión, RLS en cada tabla, exportación JSON y CSV, accesibilidad (axe y 44 px) y rendimiento medido | `offline*.spec.ts`, `upgrade.spec.ts`, `screen-error.spec.ts`, `export.spec.ts`, `a11y.spec.ts`, `docs/rendimiento.md` |

Cómo se usa: [`docs/guia-uso.md`](docs/guia-uso.md), con capturas de móvil y escritorio en `docs/screenshots/`.

## Criterios de finalización de la orden (§12)

1. **Requisitos obligatorios del Plan Maestro:** implementados, o con una decisión que modifica su alcance (`DECISIONS.md`). Las excepciones son pendientes autorizables: IA generativa y envío programado de push.
2. **Los módulos comparten los datos:**
   - El Resumen lee hábitos, objetivos, enfoque, check-ins, revisiones, biblioteca, descubrir y repaso.
   - Analytics cruza enfoque, sueño, energía, ánimo, estrés y aprendizaje.
   - Inteligencia usa las relaciones y las interrupciones.
   - Los objetivos se calculan con hábitos y enlazan libros; las sesiones de enfoque alimentan hábitos.
   - Pruebas: las E2E de cada módulo y `day.test.ts`.
3. **Funcionalidades críticas verificadas:** la CI completa de cada PR con 0 inestables. Cuando una inestabilidad escondía un defecto de la app, se corrigió (salto de diseño del Resumen, «hoy» con el reloj del dispositivo); cuando era una carrera de la prueba, se reforzó la prueba, nunca se debilitó.
4. **Estable en móvil y ordenador:** cada E2E corre en los dos perfiles; el móvil a 375 px, con zonas táctiles de 44 px y sin desbordamiento. **Falta el iPhone real** (`docs/guia-dispositivo.md`).
5. **Sin conexión y sincronización sin defectos críticos conocidos de integridad:** cola duradera, una sola aplicación por cambio, conflictos con decisión en los textos largos, copias antiguas que se actualizan sin perder nada y una pantalla que falla sin detener la sincronización. Límite conocido: abajo, en «Limitaciones».
6. **Sin errores bloqueantes de autenticación ni pérdida de información:** enlace mágico con allowlist, `getUser()` en servidor, RLS probada con dos usuarios y suscripciones push inaccesibles desde la API. Las migraciones de esta orden son todas aditivas.
7. **La documentación describe el estado real:** la matriz se ha reconciliado en F6, PROGRESS registra cada PR con su CI, y la seguridad, el rendimiento, la publicación y la guía de uso están en `docs/`.
8. **Versión candidata en `skynet/integracion`:** sí. Esta PR la cierra.

## Órdenes atendidas

- **2026-11-09 · Misión Maestra:** [hecha]. 43 tareas en las fases A–F, 28 PR fusionadas (#1–#28) y esta, la #29. Quedan los pendientes autorizables de abajo.

## Bloqueado o pendiente de tu autorización

| Qué | Por qué no está hecho | Qué hace falta |
| --- | --- | --- |
| **E9 · Envío programado de push** | La suscripción y la prueba ya existen (E8). Falta el planificador | Claves VAPID en Vercel; un planificador cada pocos minutos (de pago en Vercel, o `pg_cron` sobre la base compartida); una clave de servicio en el servidor. Diseño en `DECISIONS.md` |
| **F3 · Simulacro de restauración** | Necesita Docker y `pg_dump`, que la máquina de Skynet no tiene, y tu `BACKUP_PASSPHRASE` | `npm run backup -- --source cloud` y `npm run restore:drill -- <copia>` en tu PC (`docs/publicacion.md` §1) |
| **IA generativa** | Todos los proveedores son de pago por uso | Elegir y autorizar un proveedor; el adaptador ya existe y está apagado |
| **Prueba en un iPhone real** | Solo tú tienes el dispositivo | `docs/guia-dispositivo.md`: PWA instalada, VoiceOver, teclado y sin red |
| **Publicar en `main` y producción** | Decisión tuya | `docs/publicacion.md` |
| **Base de producción propia** | Hoy staging y producción son el mismo proyecto (decisión tuya del 2026-11-09) | `docs/publicacion.md` §4 |
| **Barra de comentarios de Vercel en los previews** | Ajuste del proyecto en la nube | Desactivarla deja el humo de los previews en 22 de 22 |

## Limitaciones y riesgos conocidos

- **Escribir sin conexión y cerrar la app al instante.** La pantalla muestra el cambio en cuanto se toca y la copia del dispositivo tarda unos milisegundos en guardarse (130 ms no bastaron en un runner lento). Si en ese intervalo se fuerza el cierre de la app, el cambio se pierde. Navegar o recargar dentro de la app sí espera. Hay una mejora propuesta, sin hacer: guardar la cola aparte (`PROGRESS.md`).
- **Staging es producción.** Las pruebas de Skynet y los previews escriben en la misma base que usa la app desplegada. Por eso toda migración es aditiva y compatible con `main`.
- **Rendimiento:** medido en un móvil emulado (CPU ×4, 4G), no en un teléfono real.
- **`npm audit`:** 12 avisos, todos en herramientas de desarrollo (la CLI de `shadcn` y `typescript-eslint`). Ninguno en el código que se ejecuta.

## Pruebas ejecutadas y no ejecutadas

- **Ejecutadas en cada PR (CI):** tipos, lint, unitarias, integración contra PostgreSQL, motor en Chromium, E2E completas en móvil y escritorio, humo y revisión de secretos de los informes.
- **Ejecutadas por Skynet fuera de la CI:**
  - Humo contra cada preview.
  - Ensayos de cada migración en staging, en una transacción que se deshace.
  - Medición de rendimiento (`npm run measure:views`).
  - Suite E2E demo en local.
- **No ejecutadas:**
  - Simulacro de restauración (F3).
  - Prueba en un iPhone y en un Android reales.
  - Envío push real a un dispositivo (no hay claves VAPID).
  - E2E con cuenta contra un preview (rechazadas por diseño).

## Decisiones más importantes

Todas, con su alternativa y su motivo, en `DECISIONS.md`.

- Toda migración es aditiva y compatible con el código desplegado, porque staging es producción.
- Las PR agrupan tareas relacionadas, para no agotar los minutos de CI; cada pasada cuesta 25–35 min.
- La «inteligencia» es de reglas y lo dice: nada se presenta como causa, ni como IA, sin serlo. La IA generativa queda apagada hasta que autorices un proveedor.
- El repaso espaciado usa SM-2 simplificado y versionado; Daily Discovery, un catálogo propio sin citas ni fuentes inventadas.
- Las suscripciones push solo son accesibles mediante funciones con comprobación de dueño. El permiso se pide solo al pulsar, y cada dispositivo se activa y se desactiva por separado.
- El Resumen distingue cuatro estados que podrían parecer «nada hecho»; el aviso de error de sincronización es estable entre reintentos.
- El «hoy» sigue la zona del perfil y corrige el reloj del dispositivo con el del servidor.
- Una prueba inestable se investiga hasta la causa. Si la causa estaba en la app, se arregló la app; si estaba en la prueba, se reforzó la prueba, sin `test.skip` ni más tiempo de espera.
