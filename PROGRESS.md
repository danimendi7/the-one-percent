# Progreso

> **Orden 3 · Auditoría de secretos (2026-11-11): APTO PARA PÚBLICO.** No hay ningún secreto en el historial, las PR, los registros ni los artefactos de la CI, así que no hay nada que rotar. Dani decide dos cosas que no son secretos: su correo personal sigue en el historial (60 commits y versiones antiguas de 4 documentos), y `.perfil`, que el guardián no deja abrir a Skynet, conviene que lo mire Dani. El detalle y el siguiente paso están en [`docs/reports/auditoria-secretos.md`](docs/reports/auditoria-secretos.md).

Plan de la Misión Maestra (orden del 2026-11-09), de la Orden 2 (2026-11-11, tareas G y E9a–E9c), de la Orden 3 (2026-11-11, auditoría de secretos, tareas S) y de la Orden 4 (2026-11-11, retomar la Orden 2: G4). Fases y estimaciones en `docs/roadmap.md`; estado por funcionalidad en `docs/matriz-funcional.md`.

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
| A6 | M4g.5 §8: buscar y actualizar datos de lo ya guardado | Unitarias del comparador; E2E: solo rellena vacíos; un único `update` por aplicación | Sí | xhigh | A1 | hecha | #4 |
| A7 | M4g.5 §23-6: repaso de privacidad e integridad y prueba de integración | Test de integración de los casos M y N con vínculos; `/dev/*` con 404; sin secretos en el repo | Sí | xhigh | A1 | hecha | #5 |
| A8 | M4g.5 §23-3/4/5: ajustes de iPhone y guía de VoiceOver, teclado y sin red | Capturas a 375 px sin solapes; `docs/guia-dispositivo.md` | Sí | medium | A1 | hecha | #6 |
| A9 | Cierre de M4g.5 en matriz y documentación | Matriz actualizada con evidencia | Sí | medium | A3–A8 | hecha | #7 |
| B1 | Dominio de relaciones entre variables con tamaño de muestra y limitaciones | Unitarias: sin resultado por debajo del mínimo; incluye periodo, n y variables | Sí | high | A1 | hecha | #7 |
| B2 | Vista «Relaciones» en Analytics, sin lenguaje causal | E2E de la vista; test que prohíbe vocabulario causal | Sí | high | B1 | hecha | #7 |
| B3 | Comparativas semanales y mensuales explícitas | Unitarias del cálculo; E2E | Sí | high | A1 | hecha | #7 |
| B4 | Proyecciones prudentes con datos suficientes | Unitaria: sin proyección con pocos datos | Sí | medium | B1 | hecha | #7 |
| B5 | Métricas de aprendizaje en Analytics | Unitarias; E2E con datos de biblioteca | Sí | high | A1 | hecha | #7 |
| C1 | Objetivos: estados archivado y en revisión (migración aditiva) | Integración: conserva los datos; E2E de filtros | Sí | xhigh | A1 | hecha | #8 |
| C2 | Objetivos: registro de obstáculos y ajustes | Unitarias; E2E | Sí | high | C1 | hecha | #9 |
| C3 | Objetivos vinculados a libros | Unitaria del progreso; E2E | Sí | high | C1 | hecha | #10 |
| C4 | Deep Work: anotar interrupciones (migración aditiva) | Integración y E2E; sesiones antiguas intactas | Sí | xhigh | A1 | hecha | #11 |
| C5 | Revisión diaria (migración aditiva) | Integración; E2E del ciclo; revisiones anteriores intactas | Sí | xhigh | A1 | hecha | #12 |
| C6 | Historial de cambios de un hábito | Integración con RLS; E2E | Sí | high | A1 | hecha | #13 |
| D1 | Active Recall: dominio de repaso espaciado | Unitarias de Again/Hard/Good/Easy y calendario | Sí | high | A9 | hecha | #14 |
| D2 | Active Recall: persistencia, RLS y sincronización | Integración de RLS y sincronización | Sí | xhigh | D1 | hecha | #14 |
| D3 | Active Recall: sesión de repaso desde ideas | E2E, también sin red | Sí | high | D2 | hecha | #15 |
| D4 | Daily Discovery real: temas propios, valoración persistente, sin citas inventadas | Integración; E2E; lo no verificado se etiqueta | Sí | xhigh | A9 | hecha | #16 |
| D5 | Tema de hoy en Command Center con datos reales | E2E; sin datos muestra estado vacío | Sí | medium | D4 | hecha | #16 |
| D6 | Conexión de repasos con Cerebro y Analytics | Unitarias; E2E | Sí | high | D3, B5 | hecha | #17 |
| E1 | Motor de insights por reglas con periodo, variables, n y limitaciones | Unitarias; ninguno con muestra insuficiente | Sí | high | B1, C4 | hecha | #18 |
| E2 | Pantalla Inteligencia real, etiquetada como reglas | E2E; sin etiquetas demo | Sí | high | E1 | hecha | #18 |
| E3 | Experimentos de mejora medibles | Unitarias; E2E | Sí | high | E2 | hecha | #19 |
| E4 | Adaptador de proveedor IA apagado por defecto | Unitaria: sin proveedor no hay llamadas | Sí | medium | E1 | hecha | #20 |
| E5 | Motivation Engine: reglas y evaluador puro (silencio, tope, reevaluación) | Unitarias: nada para hábito hecho o en descanso | Sí | xhigh | A1 | hecha | #21 |
| E6 | Ajustes reales de notificaciones (migración aditiva) | Integración; E2E; sin etiqueta demo | Sí | high | E5 | hecha | #22 |
| E7 | Bandeja dentro de la app | E2E; respeta tope y silencio | Sí | high | E6 | hecha | #23 |
| E8 | Push: suscripción por dispositivo y permiso tras acción clara | Test de navegador; alta y baja independientes por dispositivo | Sí | xhigh | E7 | hecha | #24 |
| E9 | Envío programado de push en servidor (reglas del Motivation Engine reevaluadas al enviar, registro de entregas sin duplicados) | Hecha cuando lo estén E9a–E9c (Orden 2 autoriza VAPID y `pg_cron`) | Sí | xhigh | E9a, E9b, E9c | en curso | #35 |
| F1 | Integración final del Command Center y sus estados | E2E de los cuatro estados del Plan §5.1 | Sí | high | B–E (E9 bloqueada, no la necesita) | hecha | #25 |
| F2 | Accesibilidad y rendimiento de vistas clave (incluye el salto de diseño del Resumen al cargar en móvil, visto en la PR #25) | `a11y.spec.ts` ampliado; mediciones documentadas | Sí | high | F1 | hecha | #26 |
| F3 | Simulacro de respaldo y restauración | `restore:drill` correcto, con resultado documentado | Sí | high | F1 | bloqueada | — |
| F4 | Guía de uso y validación móvil | `docs/guia-uso.md`; capturas móvil y escritorio | Sí | medium | F2 | hecha | #27 |
| F5 | `docs/publicacion.md`: publicar, revertir, separar la base | Procedimiento completo revisado contra el repo | Sí | medium | F2 | hecha | #28 |
| F6 | Documentación final y versión candidata (DONE.md) | Criterios §12 de la orden con evidencia | Sí | high | F1, F2, F4, F5, F7 (F3 bloqueada) | hecha | #29 |
| F7 | Exportación CSV de los registros (PRD §7: «Export JSON and CSV») | Unitarias del CSV (escapes, zona, columnas); E2E: la descarga contiene los registros | Sí | medium | — | hecha | #28 |
| G1 | Orden 2 §1 · Cola de cambios duradera: cada cambio se anota de forma síncrona en un diario aparte (`localStorage`, una clave por operación) antes de pintarse, y al abrir se recupera lo que no llegó a IndexedDB | Unitarias del motor (diario antes de notificar, recuperación sin duplicar, limpieza tras guardar); E2E con CPU ralentizada: escribir sin red y cerrar al instante, sin esperar a la copia → al reabrir el cambio está y con red llega una sola fila al servidor | Sí | xhigh | — | en curso | #35 |
| E9a | Orden 2 §2 · Planificador: migración con registro de entregas (`push_deliveries`, única por persona, regla y día), `pg_cron` cada 5 min y `pg_net` hacia la ruta de envío, con la URL y el secreto en Vault (sin configurar no llama a nada) | Integración: el trabajo existe; sin configuración no encola nada; configurado encola una llamada con el secreto; RLS de las entregas | Sí | xhigh | E8 | en curso | #35 |
| E9b | Orden 2 §2 · Ruta de envío programado: con la clave de servicio, reevalúa el Motivation Engine con los datos de cada persona (silencio, tope, separación), reserva la entrega antes de enviar y la marca aceptada, rechazada o revocada | Unitarias del plan de envío; integración: un hábito hecho no recibe aviso, un reintento no duplica, el tope y el silencio se respetan | Sí | xhigh | E9a | en curso | #35 |
| E9c | Orden 2 §2 · Claves VAPID generadas y configuración preparada para Dani | Claves en un archivo local ignorado por git; `docs/publicacion.md` y DONE.md dicen qué variable va dónde | Sí | medium | E9b | en curso | #35 |
| G2 | Orden 2 §3 · Separar la base de producción: script que aplica todas las migraciones a una base vacía y verifica RLS, y procedimiento paso a paso | Integración del verificador contra la base local de la CI; ensayo en seco del script contra staging; `docs/publicacion.md` §4 actualizado | Sí | high | — | en curso | #35 |
| G3 | Orden 2 §4 · Cierre: DONE.md, PROGRESS.md y matriz con el resultado | Los tres documentos coinciden con las PR fusionadas; `docs/ORDENES.md` marca [hecha] las Órdenes 2 y 4 | Sí | medium | G1, E9, G2 | pendiente | — |
| G4 | Orden 4 · Lo que necesita a Dani, preparado y explicado paso a paso en DONE.md: variables de Vercel (claves VAPID, clave de servicio, secreto del envío), los dos secretos de Vault y la base de producción nueva con `db:fresh` | Cada paso dice el servicio, la pantalla, el nombre exacto y cómo comprobar que funcionó; coincide con `docs/publicacion.md` y `.env.example`, y ningún valor secreto aparece en el repo | Sí | medium | G1, E9, G2 | pendiente | — |
| S1 | Orden 3 §1 · Barrido de secretos en todo el historial: gitleaks 8.30.1 sobre el espejo de GitHub (ramas y `refs/pull/*`), el repo local (incluye `respaldo/*` y ramas sin subir) y la copia del worktree de Windows; búsqueda de los valores reales de `.env*.local` en todos los objetos de git; datos personales en fixtures, capturas e informes | `npm run audit:secrets` sale con 0 y cada hallazgo de gitleaks está clasificado en el informe | Sí | xhigh | — | hecha | #37 |
| S2 | Orden 3 §2 y §3 · Workflows (`pull_request_target`, secretos al alcance de PR de forks, artefactos subidos) y `.gitignore` (`.env*`, claves VAPID locales, copias de seguridad) | Ningún workflow con `pull_request_target`; `git check-ignore` cubre `.env.local`, `.env.push.local` y las copias `*.topbak` | Sí | high | — | hecha | #37 |
| S3 | Orden 3 §4 y §5 · Informe `docs/reports/auditoria-secretos.md` con veredicto, veredicto arriba del todo en PROGRESS.md y DONE.md solo con el veredicto y el siguiente paso para Dani | Los tres documentos dan el mismo veredicto | Sí | medium | S1, S2 | hecha | #37, #38 |

Estados: pendiente · en curso · hecha · bloqueada · en pausa · PR lista para fusionar

## Bloqueos

- **Orden 2 (G1, E9a–E9c, G2) · reanudada por la Orden 4 (2026-11-11).** El repo ya es público y Actions vuelve a tener minutos. La PR #35 se pone al día con la rama base y se relanza su CI; lo que ya estaba hecho sin CI no se repite: `npm run verify`, humo del preview, revisiones de G1 y E9, y ensayo en staging de la migración de E9 y de la auditoría de G2 (transacción deshecha). La migración de E9 se aplica a staging cuando la CI esté en verde.

- **F3 · Simulacro de respaldo y restauración (requiere el entorno de Dani).** `npm run restore:drill` arranca una Supabase aparte en Docker, carga la copia, compara recuentos y sumas por tabla y destruye la pila. `npm run backup` vuelca con `pg_dump` dentro del contenedor. Esta máquina no tiene Docker (`docker: command not found`) ni `pg_dump`. Las copias se cifran con `BACKUP_PASSPHRASE`, que guarda Dani, y la copia de la nube necesita `SUPABASE_DB_URL`, que no está en `.env.local`. Enfoques descartados: (1) ejecutarlo aquí, sin Docker; (2) la copia de la nube, que también usa Docker y una credencial fuera de `.env.local`; (3) GitHub Actions, que sí tiene Docker, pero exigiría tocar `.github/` o levantar una segunda Supabase en cada PR. Procedimiento para Dani en `docs/backup-strategy.md`: `npm run backup -- --source cloud` y después `npm run restore:drill -- <copia>`.

- **E9 · Envío programado de push:** desbloqueada por la Orden 2 (Dani autoriza las claves VAPID y `pg_cron`). Hecho en código y base (E9a–E9c); lo único pendiente es configuración de Dani: las variables de Vercel y los dos secretos de Vault (`docs/publicacion.md` §5). Las claves ya están generadas en `.env.push.local`.

**Limitación conocida:** la prueba de humo contra un preview da 10 de 22. Las 12 restantes pasan todos sus pasos y fallan solo en la aserción final de la consola, porque la CSP de la app bloquea la barra de comentarios que Vercel inyecta en los previews (`vercel.live/_next-live/feedback/feedback.js`). En la CI, sobre el build local, pasan las 22. Medido en las PR #3, #4 y #5.

**Resuelto en G1 (Orden 2 §1; antes, limitación medida en la PR #27):** un cambio hecho sin conexión aparecía en pantalla al instante y tardaba unos milisegundos en llegar a la copia del dispositivo (IndexedDB); si en ese intervalo se forzaba el cierre de la app, se perdía. Ahora cada cambio de la cola se anota antes de pintarse en un diario síncrono aparte (`localStorage`, una clave por operación, `src/features/sync/journal.ts`), y al abrir la app se recupera lo que no llegó a IndexedDB; el servidor aplica cada operación una sola vez. Es lo más duradero que ofrece un navegador: si el sistema mata el navegador entero antes de que este vuelque su almacenamiento a disco, ninguna web puede evitarlo. Si `localStorage` no está disponible o está lleno, la app sigue como antes (solo IndexedDB). Medido en Chromium real (`npm run bench:journal`, 30 intentos con CPU ×6, motor, IndexedDB y `localStorage` reales, sin red, pestaña cerrada nada más anotar la marca): sin el diario la marca se pierde en 30 de 30; con él sobrevive en 30 de 30, sin duplicados, y el diario queda vacío tras el siguiente guardado (`docs/reports/g1-journal.json`). La otra mitad de la E2E (una sola fila en el servidor) necesita la Supabase local de la CI y aún no se ha ejecutado.

**Resuelto en F2:** el «hoy» de la app usaba solo el reloj del dispositivo (destapado en la PR #15). Ahora, tras la primera respuesta del servidor, lo corrige con el desfase medido (`engine-today.test.ts`). Antes de esa respuesta sigue valiendo el reloj del dispositivo.

**Pendiente autorizable (Dani):** proveedor de IA generativa; servicio de envío programado de push si tuviera coste; publicación en `main` y producción; prueba real en iPhone; desactivar la barra de comentarios de Vercel en los previews (ajuste del proyecto en la nube), que dejaría en verde esa prueba de humo.

## Cambios de alcance

- 2026-11-11: Orden 4 (retomar la Orden 2) reanuda G1, E9a–E9c y G2 en la PR #35 y añade G4 (pasos para Dani en DONE.md).
- 2026-11-11: Orden 3 (auditoría de secretos antes de hacer público el repo) añade S1–S3 y pone en pausa la Orden 2 hasta que el repo sea público.
- 2026-11-11: Orden 2 (cierre previo a publicación) añade G1–G3 y E9a–E9c; E9 deja de estar bloqueada porque Dani autoriza claves VAPID y `pg_cron` en el proyecto `the-one-percent`.
- 2026-11-09: el plan se agrupa en PR por bloque para no agotar los minutos de CI (ver `DECISIONS.md`).
