# Órdenes de Dani

Skynet atiende primero las órdenes [pendiente]. Marcas: [pendiente] · [planificada] · [hecha] · [bloqueada]

## 2026-11-09 11:33 [hecha]

Atendida el 2026-11-10: versión candidata en `skynet/integracion` (ver `DONE.md`). Lo que necesita tu autorización o tu entorno queda como pendiente autorizable: E9 (envío programado de push), F3 (simulacro de restauración), IA generativa, prueba en iPhone real y publicación en `main`.

> # MISIÓN MAESTRA: FINALIZACIÓN INTEGRAL DE THE ONE PERCENT
> 
> ## 1. Misión
> Actúa como arquitecto principal, director técnico, desarrollador full-stack, especialista en experiencia de usuario y responsable de calidad de THE ONE PERCENT.
> 
> Lleva THE ONE PERCENT desde su estado actual hasta completar la visión definida en su Plan Maestro, reutilizando el código y la infraestructura existentes. No quiero una propuesta teórica, una auditoría aislada ni un prototipo: organiza, desarrolla, integra y verifica las funcionalidades pendientes hasta entregar una aplicación completa, estable y preparada para producción.
> 
> ## 2. Dónde trabajas (modo protegido de Skynet)
> - Trabajas en la copia de Ubuntu del repositorio (la carpeta actual). El original de Windows no se toca nunca.
> - Rama base: `skynet/integracion`. Todas tus ramas y PR van contra ella. Nunca contra `main` ni ramas de producción.
> - Los cambios que estaban sin confirmar al incorporar el proyecto están en una rama local `respaldo/sin-confirmar-*` (si existe). Los de los worktrees de Windows están copiados en `~/proyectos/_respaldos/the-one-percent-*/worktrees/`. El estado inicial de ramas y commits está en `logs/estado-inicial.txt`.
> - Supabase: trabaja con la base de `STAGING_DB_URL` (.env.local). **Decisión de Dani (2026-11-09):** de momento es el proyecto Supabase `the-one-percent` actual, el mismo que usa la app desplegada, y todos sus datos son de prueba: puedes aplicar migraciones y crear o modificar datos en él. Que staging y producción coincidan es una decisión consciente y no un bloqueo; anótalo como riesgo en la documentación y en `docs/publicacion.md` explica cómo separar una base de producción limpia antes de publicar.
> - No uses ninguna otra credencial de Supabase ni crees proyectos nuevos.
> 
> ## 3. Fuente principal: Plan Maestro
> Localiza en el repositorio el documento Word `THE_ONE_PERCENT_Plan_Maestro_DESCARGA.docx` (o el .docx cuyo título sea "THE ONE PERCENT — Plan Maestro del Producto"). Conviértelo a `docs/plan-maestro.md` (por ejemplo con `npx --yes mammoth <archivo.docx> --output-format=markdown`) y léelo entero: tablas, funcionalidades, arquitectura, fases, módulos, requisitos y evolución histórica.
> - Es la referencia funcional principal. Actualiza `docs/SPEC.md` para que apunte a él.
> - Si difiere de la documentación técnica existente, identifica si se debe a decisiones posteriores, a funcionalidades ya implementadas o a requisitos pendientes. No sustituyas requisitos por interpretaciones propias sin documentarlo en DECISIONS.md.
> - No presupongas que todas sus funcionalidades están implementadas.
> 
> ## 4. Auditoría inicial obligatoria (antes de modificar código)
> ### 4.1 Estado del código
> Estructura y arquitectura, dependencias y versiones, componentes y páginas, rutas y navegación, modelos de datos y relaciones, migraciones y políticas RLS, autenticación y sesiones, persistencia local y sincronización, pruebas (unitarias, integración, E2E), documentación técnica y configuración de desarrollo y despliegue.
> 
> ### 4.2 Reconstrucción del historial
> Analiza ramas, commits, etiquetas, la rama de respaldo y los worktrees copiados. Atención especial a: M3 y sus subfases, M4 Knowledge OS, M4g y M4g.5, M4-H1 (persistencia offline) y D108 (conservación de información en la biblioteca).
> - No asumas que `main` contiene todo el trabajo avanzado. Detecta ramas divergentes, commits no integrados y trabajo desarrollado pero no publicado.
> - Antes de integrar ramas divergentes, reconstruye su ascendencia y compara los cambios reales. Intégralas en `skynet/integracion` mediante PR, nunca en `main`.
> - Nada de resets destructivos, limpiezas masivas ni borrado de ramas.
> 
> ### 4.3 Inventario funcional
> Crea `docs/matriz-funcional.md` con la tabla: Módulo | Funcionalidad | Estado actual | Evidencia | Trabajo pendiente | Prioridad.
> Estados: implementada y validada · implementada parcialmente · implementada sin pruebas suficientes · planificada pero no desarrollada · no verificable con la información disponible. No declares nada terminado sin evidencia.
> 
> Escribe además `docs/auditoria-inicial.md` con un resumen breve de la situación y del primer bloque de trabajo (nadie leerá tu chat: el resumen va ahí).
> 
> ## 5. Alcance funcional
> Desarrolla o finaliza todos los módulos del Plan Maestro:
> 1. **Command Center**: resumen de hábitos diarios, indicadores de cumplimiento, objetivos activos, energía, sueño, ánimo y estrés, actividad de aprendizaje, estadísticas recientes, accesos rápidos y visualizaciones del progreso. Datos reales conectados con sus módulos de origen.
> 2. **Habit Engine**: creación y edición, frecuencias y calendarios, registro de cumplimiento, descansos planificados, historial y auditoría, rachas, consistencia de 30 días, indicadores diarios/semanales/mensuales, sincronización entre dispositivos, funcionamiento offline y recuperación. Preserva la lógica que diferencia descanso e incumplimiento.
> 3. **Life Analytics**: dashboard de métricas, tendencias, consistencia, comparativas semanales y mensuales, calendarios de actividad, análisis de objetivos y de concentración, evolución de energía y ánimo, relación entre hábitos y resultados, patrones. Estructura preparada para análisis descriptivos, diagnósticos y recomendaciones. Las correlaciones no se presentan como causalidad.
> 4. **Goals & Systems**: objetivos con fechas y métricas, hitos, relación con hábitos, seguimiento, indicadores de avance, revisiones y ajustes.
> 5. **Deep Work**: sesiones de concentración, temporizador, duración, asociación con tareas o proyectos, historial, estadísticas, interrupciones si están en el alcance, relación con energía y productividad. Interfaz sencilla y rápida.
> 6. **Knowledge OS**: biblioteca de libros (altas, edición, búsqueda asistida, metadatos y portadas, estados de lectura, progreso, notas e ideas, recuperación), biblioteca de podcasts (podcasts y episodios, altas asistidas, portadas y metadatos, estados, notas, duplicados), Cerebro (ideas, organización, relaciones, integración con libros y podcasts) y Aprendizaje (Active Recall, repasos, Daily Discovery / Tema de hoy). Cierra los pendientes de M4g y M4g.5 antes de dar Knowledge OS por terminado.
> 7. **Mind & Energy**: check-ins de sueño, energía, ánimo, estrés y observaciones; historial, tendencias y conexión con Life Analytics. Sin diagnósticos médicos.
> 8. **Life Review**: revisiones diarias, semanales y mensuales; resumen de hábitos, revisión de objetivos, dificultades, reflexión y ajustes. Diferencia datos registrados de conclusiones interpretativas.
> 9. **AI Intelligence**: análisis contextual, tendencias, recomendaciones de hábitos, productividad, resúmenes, sugerencias y aprendizaje. **Restricción económica absoluta**: ninguna API de pago por consumo, Extra Usage ni suscripción nueva. Implementa primero la arquitectura compatible y, cuando sea viable, una alternativa local o basada en reglas. Documenta la diferencia entre reglas e IA generativa. No simules respuestas de IA como análisis reales. Lo que necesite un proveedor de pago queda como "pendiente autorizable".
> 
> Transversales: Motivation Engine, notificaciones personalizadas, PWA móvil, sincronización multidispositivo, persistencia offline, seguridad y privacidad, respaldo y recuperación, rendimiento y accesibilidad.
> **Exclusión**: nada de bloqueadores de Instagram Reels o YouTube Shorts (descartado).
> 
> ## 6. Arquitectura
> Preserva la existente salvo razones técnicas demostrables (documentadas en DECISIONS.md). Stack de referencia: Next.js, React, TypeScript, Tailwind, shadcn/ui, Recharts, Supabase PostgreSQL, Supabase Auth, RLS, IndexedDB, Vercel, GitHub, PWA y Resend para el email. No reconstruyas desde cero. Reutiliza, modulariza y evita dependencias innecesarias.
> 
> ## 7. Fases (ajustables según dependencias reales; documenta cada cambio)
> - **A · Estabilización**: auditoría, recuperar desarrollos válidos, cerrar defectos de M4g y D108, proteger la información offline, consolidar.
> - **B · Life Analytics**: completar lo previsto en M3 y posteriores.
> - **C · Objetivos y productividad**: Goals & Systems, Deep Work y Life Review.
> - **D · Conocimiento y aprendizaje**: cerrar Knowledge OS y M4g.5.
> - **E · Inteligencia personal**: Motivation Engine, notificaciones e inteligencia con los datos disponibles, dentro de la restricción económica.
> - **F · Consolidación final**: integración, pruebas, rendimiento, accesibilidad, validación móvil, documentación y versión candidata.
> 
> Convierte las fases en tareas de PROGRESS.md (con su esfuerzo). Escribe `docs/roadmap.md` con las fases, dependencias y un rango de estimación por fase, y actualízalo según avances.
> 
> ## 8. Forma de trabajar
> Para cada misión: requisito → código reutilizable → criterios de aceptación → implementación → pruebas → verificación → regresiones → PR a `skynet/integracion` → documentación → siguiente. Sin pausas artificiales y sin pedir confirmación para lo rutinario y reversible. Si algo requiere una decisión mía, regístralo como bloqueo en PROGRESS.md y sigue con tareas independientes.
> 
> ## 9. Seguridad de los datos
> La aplicación contiene información personal. La pérdida silenciosa de datos es un defecto crítico que impide dar una versión por terminada. Nunca descartes trabajo previo del repositorio, nunca publiques en `main` ni en producción, y diseña las migraciones para conservar los datos existentes (aunque ahora sean de prueba, la app los tendrá reales).
> 
> ## 10. Calidad
> Comprueba TypeScript, ESLint, unitarias, integración, build de producción, E2E, autenticación y sesiones, persistencia offline, sincronización, conflictos y reintentos, navegación, móvil, accesibilidad básica y rendimiento de las vistas importantes. No alteres pruebas para ocultar errores. Diferencia en la documentación los tests ejecutados de los que no pudieron realizarse.
> 
> ## 11. Documentación (en docs/, sin redundancias)
> Auditoría inicial, matriz funcional, roadmap, decisiones (DECISIONS.md), funcionalidades implementadas, pruebas ejecutadas, defectos y riesgos, pendientes, guía de uso y `docs/publicacion.md` con el procedimiento de publicación y reversión (para que yo decida cuándo pasar a `main` y producción).
> 
> ## 12. Criterio de finalización
> Escribe DONE.md solo cuando:
> 1. Todos los requisitos obligatorios del Plan Maestro estén implementados o exista una decisión explícita que modifique su alcance.
> 2. Los módulos compartan correctamente los datos.
> 3. Las funcionalidades críticas estén verificadas.
> 4. La aplicación sea estable en móvil y ordenador.
> 5. Offline y sincronización no tengan defectos críticos conocidos de integridad.
> 6. No haya errores bloqueantes de autenticación ni pérdida de información.
> 7. La documentación describa fielmente el estado real.
> 8. Haya una versión candidata en `skynet/integracion` lista para que yo decida publicarla.
> Lo que requiera proveedores de pago, permisos adicionales o decisiones estratégicas se marca como pendiente autorizable, no como terminado.
> 
> ## 13. Primera acción
> Empieza por el Plan Maestro y la auditoría (sección 4). Después crea el roadmap y las tareas, y continúa desarrollando, verificando e integrando hasta completar el proyecto o encontrar un bloqueo real. No te detengas tras el análisis inicial.
> 
> **Objetivo final: THE ONE PERCENT completamente desarrollado, estable y preparado para su publicación.**


## 2026-11-11 09:27 [hecha]

Atendida el 2026-11-11: G1 (§1), E9a–E9c (§2) y G2 (§3) en la PR #35, con la CI completa en verde (0 fallidas, 0 inestables); G3 (§4) en la PR #40. La migración de E9 está aplicada en staging. Activar el push programado y crear la base de producción quedan para Dani, paso a paso en `DONE.md`.

> ORDEN 2: CIERRE PREVIO A PUBLICACIÓN
> 
> Sigue en modo protegido: todo contra skynet/integracion, nada en main ni en producción.
> 
> 1. PRIORIDAD MÁXIMA. Pérdida de datos sin conexión: implementa la mejora propuesta en PROGRESS.md (guardar la cola de cambios aparte, de forma duradera antes de pintar el cambio en pantalla o con escritura síncrona equivalente) para que forzar el cierre de la app justo después de escribir sin conexión no pierda nada. Añade una E2E que lo demuestre en runner lento (cierre forzado inmediato tras escribir offline → al reabrir, el cambio está y se sincroniza una sola vez). Sin test.skip ni más tiempo de espera.
> 
> 2. E9 · Envío programado de push, sin coste: AUTORIZO generar un par de claves VAPID y usar pg_cron en el proyecto Supabase the-one-percent como planificador (no el cron de pago de Vercel). Si necesitas guardar las claves o la clave de servicio en Vercel y no tienes acceso, déjalo preparado y apunta en DONE.md exactamente qué variable poner y dónde; yo lo hago. Respeta el Motivation Engine existente (silencio, tope, separación). Prueba de integración del planificador.
> 
> 3. Prepara la separación de la base de producción: en docs/publicacion.md deja el procedimiento paso a paso y un script que aplique todas las migraciones a una base vacía nueva y verifique RLS. NO crees el proyecto nuevo: eso lo hago yo.
> 
> 4. Actualiza DONE.md, PROGRESS.md y la matriz con el resultado, CI completa en verde en cada PR.
> 
> Sigue sin coste: ninguna API ni servicio de pago.

## 2026-11-11 11:21 [hecha]

Atendida el 2026-11-11: **APTO PARA PÚBLICO**, sin secretos que rotar (PR #37, `docs/reports/auditoria-secretos.md`). Tareas S1–S3 en `PROGRESS.md`; el siguiente paso para Dani, en `DONE.md`. La Orden 2 sigue en pausa con su PR #35 abierta hasta que el repo sea público.

> ORDEN 3: AUDITORÍA DE SECRETOS ANTES DE HACER PÚBLICO EL REPO
> 
> Contexto: la CI no arranca porque se han agotado los minutos de GitHub Actions del repo privado. Dani va a hacer público danimendi7/the-one-percent para tener Actions gratis. Esta orden va ANTES que la Orden 2, que queda en pausa hasta que el repo sea público (no reintentes su CI hasta entonces).
> 
> 1. Revisa TODO el historial de git (todas las ramas locales y remotas, incluidas respaldo/* y los commits de los worktrees copiados) en busca de secretos: usa gitleaks (npx o binario sin coste) y además busca a mano .env*, claves de Supabase (service_role, contraseñas de base de datos, URLs postgresql:// con contraseña), tokens de GitHub o Vercel, claves VAPID privadas, BACKUP_PASSPHRASE, emails o datos personales reales en fixtures, capturas o informes.
>    La clave anon/publishable de Supabase y la URL pública del proyecto no son secretos; anótalas pero no las cuentes como fallo.
> 2. Revisa .github/workflows: que ningún workflow use pull_request_target ni exponga secretos a PRs de forks, y que los informes subidos como artefactos no contengan secretos.
> 3. Revisa que .gitignore cubre .env*, las claves VAPID locales y las copias de seguridad.
> 4. Escribe el resultado en docs/reports/auditoria-secretos.md con un veredicto claro:
>    - "APTO PARA PÚBLICO" si no hay nada, o
>    - "NO APTO" con la lista exacta de cada hallazgo (commit, archivo, tipo) y qué secreto hay que rotar en qué servicio. NO reescribas el historial ni hagas force-push: eso lo decide Dani.
> 5. Pon el veredicto también arriba del todo en PROGRESS.md y termina la vuelta escribiendo DONE.md solo con ese veredicto y el siguiente paso para Dani.
> 
> No necesitas la CI para esta orden. Sin coste: nada de pago.

## 2026-11-11 11:59 [hecha]

Atendida el 2026-11-11: la CI de la PR #35 pasó en verde a la primera tras ponerla al día (ejecución 43008966912) y se fusionó en `skynet/integracion`; G3 y G4 en la PR #40. Lo que necesita a Dani (variables de Vercel, secretos de Vault, base de producción) está preparado y explicado paso a paso en `DONE.md`.

> ORDEN 4: RETOMAR LA ORDEN 2
> 
> El repo danimendi7/the-one-percent ya es público y GitHub Actions vuelve a tener minutos. La auditoría de secretos (Orden 3) está hecha y es APTO; Dani deja su correo en el historial tal cual.
> 
> Retoma la Orden 2 (cierre previo a publicación) donde la dejaste: relanza la CI de la PR #35 (G1 + E9 + G2), corrige lo que falle sin debilitar pruebas, fusiona en skynet/integracion con la CI en verde y completa G3 (DONE.md, PROGRESS.md y matriz). Marca la Orden 2 y esta como [hecha] al terminar.
> 
> Lo que no puedas hacer sin Dani (variables en Vercel, claves en Vault, crear la base de producción), déjalo preparado y explícalo paso a paso en DONE.md. Modo protegido y sin coste, como siempre.
