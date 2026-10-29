# Decisiones y supuestos (M0/M1)

| # | Tema | Decisión | Motivo |
| --- | --- | --- | --- |
| D1 | Matriz semanal en móvil | Filas apiladas (nombre arriba, 7 celdas de ancho completo) en lugar de scroll horizontal con nombres fijos | A 375 px caben 7 celdas de ≈44 px sin scroll horizontal; mejor alcance táctil. El escritorio usa tabla. |
| D2 | Estado M1 | `localStorage` con esquema validado, etiquetado como "Local · demo" | El usuario pidió interacción real sin Supabase. El indicador nunca dice "sincronizado". |
| D3 | "Hoy" en el cumplimiento | Las oportunidades de hoy cuentan como pendientes en el denominador | La cifra es honesta durante el día; no se infla. |
| D4 | Objetivos semanales en curso | Fuera del denominador hasta que termine la semana (salvo que ya estén cumplidos) | Evita penalizar a mitad de semana (PRD §3.2: evaluación por periodo). |
| D5 | Días de descanso | Globales (`restDays`), reducen la meta semanal si dejan menos días disponibles | Cumple "descanso explícito, sin penalización". Por hábito en M2 (`excluded_dates_json`). |
| D6 | Valor `false` binario | Se guarda como ausencia de registro | Una sola representación canónica; mapeará a upsert/delete en M2. |
| D7 | Tipo de hábito no editable | El formulario bloquea cambiar el tipo tras crearlo | Cambiarlo invalidaría el historial. |
| D8 | Cambios de frecuencia | Nueva versión de horario desde hoy; las anteriores no se tocan | PRD §3.2 y criterio de aceptación 1. |
| D9 | Archivar | Inactivo desde hoy; el historial sigue en la analítica; restaurable | PRD §3.2 "Deletion". |
| D10 | Valoración de temas | Escala única 1–10 | Recomendación de la especificación para empezar. |
| D11 | Imágenes | Portadas tipográficas generadas; sin fotos de personajes públicos; textos motivacionales originales | Evita derechos de imagen y falsos respaldos. |
| D12 | Tema | Solo oscuro | La dirección "Dark Performance" es el producto; `color-scheme: dark`. |
| D13 | Next.js 16 | `cacheComponents` activo; datos de cliente vía `useSyncExternalStore` (snapshot nulo en servidor) | Sin errores de hidratación ni `Date` en el prerender. |
| D14 | Service worker | No incluido en M1 (solo manifest e iconos) | No simular offline ni push. Llega con la cola offline (M2) y el push (M5). |
| D15 | Supabase CLI | Dependencia local del proyecto; nunca `login` ni `link` | Separación total de otros proyectos; `supabase start` no necesita cuenta. |

## M2

| # | Tema | Decisión | Motivo |
| --- | --- | --- | --- |
| D16 | Puertos locales | Stack `the-one-percent` en 55320–55329 | En el equipo corre otro stack local en los puertos por defecto. Se evita cualquier interferencia. |
| D17 | Registro privado | `private.allowed_emails` y un trigger en `auth.users` que rechaza emails no autorizados | PRD §6: sin registro público. El login no revela si un email está autorizado. |
| D18 | Escrituras | RPC `apply_ops` con SECURITY INVOKER (RLS siempre activa) y guardas en triggers | Una única vía de escritura validada; RLS como segunda barrera. |
| D19 | Conflictos de registros | Gana la última escritura según la hora del dispositivo, con lápidas al desmarcar | Coherente con «set desired state». Un desfase de reloj entre dispositivos puede invertir el orden (riesgo bajo y aceptado). |
| D20 | Conflictos de edición | Versión optimista; se mantiene la versión del servidor y se avisa con «Aplicar el mío» | La especificación pide estrategia explícita y aviso. |
| D21 | Un registro por hábito y día | `unique (user_id, habit_id, local_date)`; el valor numérico es el total del día | Las sesiones múltiples (lectura, enfoque) tendrán su propia tabla con `source_activity_id` en M3/M4. |
| D22 | Columna `state` de habits | Se usa `archived_on` (fecha) en lugar de `state` | Permite saber desde cuándo deja de contar sin recalcular la historia. |
| D23 | Código de 6 dígitos | El correo de acceso incluye enlace y código | El Auth local rechaza URLs de retorno con IP privada, y en iOS los enlaces se abren en Safari en vez de en la PWA instalada. |
| D24 | Cookie de sesión | Nombre fijo `sb-top-auth-token` | Por defecto depende del host de la API, que difiere entre navegador (IP de la red local) y servidor. |
| D25 | Arranque en frío | `allowedDevOrigins` para redes privadas y un aviso de arranque si la app no hidrata en 12 s | Causa de los bloques vacíos vistos desde el móvil (ver informe M2). |

## M2.5

| # | Tema | Decisión | Motivo |
| --- | --- | --- | --- |
| D26 | Conflictos v2 | `base_seq` decide las ediciones secuenciales; el reloj híbrido corregido con el servidor solo desempata las simultáneas; horas futuras limitadas | Requisito de no depender del reloj local (sustituye a D19). |
| D27 | Cerrar sesión | Opción de borrar la copia local (IndexedDB y cola), con aviso si hay cambios pendientes; la nube no se toca | Dispositivos compartidos. |
| D28 | Cloud | Cuenta Supabase separada (`danimendiar@gmail.com`), plan Free, UE; token solo por variable de entorno; guarda `cloud.mjs` con refs prohibidas | Separación absoluta respecto a Uría. |
| D29 | Copias | Dump lógico cifrado (AES-256-GCM, scrypt), fuera del repo; simulacro en el stack local con huellas por tabla | Free no incluye copias. |
| D30 | Cabeceras | CSP sin orígenes de terceros, HSTS en Vercel, `frame-ancestors 'none'`, nosniff, `Permissions-Policy` restrictiva | Preparación para el despliegue público HTTPS. |
| D31 | Primer acceso y plantillas | El primer acceso de un email nuevo recibe la plantilla «Confirm signup», no la de enlace mágico: las dos usan el enlace con `token_hash` y el código `{{ .Token }}`. En local, `enable_confirmations = true` como en el cloud. `/auth/confirm` acepta también el `code` PKCE de las plantillas por defecto, y el proxy redirige al callback las credenciales que lleguen a `/` | El plan Free no permite cambiar plantillas con el correo integrado de Supabase, así que hace falta un SMTP propio. El primer intento real llegó con la plantilla por defecto, se redirigió a `localhost:3000` y no abrió sesión. |

## M3.2 · Deep Work

| # | Tema | Decisión | Motivo |
| --- | --- | --- | --- |
| D32 | Tiempo de una sesión | Tramos `[{start, end}]` con instantes del reloj híbrido; los minutos se calculan siempre a partir de ellos, en el cliente y en el servidor | No depender de contadores ni de que la app esté abierta; mismas cifras en todos los dispositivos. |
| D33 | Hábito alimentado por Enfoque | `habits.activity_source = 'focus'` desde `activity_source_from`; el día se materializa en `habit_entries` en la misma transacción. El registro manual se rechaza (`derived_entry`), también al escribir directamente en la tabla | Decisión 1 aprobada: Análisis, Objetivos y M5 leen `habit_entries` sin conocer Enfoque y nada se registra dos veces. |
| D34 | Día de una sesión | El día local, en la zona del perfil, en que empezó | Decisión 2 aprobada. |
| D35 | Sesión activa única | Índice único parcial por usuario. El segundo `focus.start` es un `conflict` con `session_active` y ese dispositivo se une a la sesión existente. Terminar o pausar una sesión ya cerrada da `superseded`, sin aviso | Decisión 5 aprobada. |
| D36 | Recuperación | «¿Sigue en curso?» si la sesión supera lo previsto en más de 30 min. Opciones: continuar, terminar a la hora prevista o descartar. Nunca se cierra sola | Decisión 5 aprobada. |
| D37 | Salvaguarda de despliegue | Con `features.focus = false`, el temporizador funciona solo en memoria y avisa de que no guarda | Permite desplegar el código y la migración en cualquier orden. |
| D38 | Copias persistidas antiguas | `upgradePersisted` añade `focusSessions: []` a las copias de M3.1. `e2e/upgrade.spec.ts` cubre las formas de M3.0 y de M3.1, cada una con una operación pendiente | Lección del incidente del 27/10. |
| D39 | Pruebas de regresión permanentes | `e2e/upgrade.spec.ts` (actualizar sobre copias de versiones anteriores, con operaciones pendientes) y `e2e/screen-error.spec.ts` (un error de pantalla no detiene la sincronización) se ejecutan en CI en cada push y no se borran, omiten ni debilitan. Cada fase que añada un campo persistido añade su forma anterior a `upgrade.spec.ts` | Los dos incidentes del 27/10 llegaron a producción por falta de estas pruebas. |

## M3.3 · Mind & Energy

| # | Tema | Decisión | Motivo |
| --- | --- | --- | --- |
| D40 | Escala y entrada | Energía, ánimo y estrés de 1 a 5 con cinco botones (`radiogroup` con flechas). Sueño con valores rápidos de 5–9 h y ±15 min. Tocar el valor elegido lo borra, con «Deshacer» dentro de la hoja | Decisión 1: un toque por indicador y accesible. El «Deshacer» va dentro del diálogo porque un toast fuera queda oculto a los lectores de pantalla |
| D41 | Día del check-in | La noche antes de las 04:00 cuenta para el día anterior y la hoja escribe siempre el día. El servidor admite hasta mañana (un día de margen) | Decisión 2; el margen cubre relojes alrededor de medianoche |
| D42 | Conflictos | `checkin.set` lleva solo los campos cambiados; cada campo gana por su sello de tiempo (reloj híbrido, limitado a «ahora + 1 min»). La reflexión usa `note_seq`: si otro dispositivo la cambió, `conflict` (`note_conflict`) y el aviso no se cierra solo, muestra tu texto y ofrece «Aplicar el mío» | Decisión 3: ningún indicador se pierde y ninguna reflexión se sobrescribe en silencio |
| D43 | Indicadores visibles | `profiles.settings_json.checkin` mediante `profile.checkin_fields` (estado deseado completo y orden canónico). Al menos un indicador por momento del día, validado también por trigger porque el perfil es editable por su dueño | Decisión 4; ocultar nunca borra historial |
| D44 | Métricas | Catálogo v4: cobertura, medias con n, cambio frente al periodo anterior (≥ 7 días en ambos), comparaciones con ≥ 5 días por grupo y la etiqueta «Descriptivo, no causal». Sin rachas ni puntuación de bienestar | Decisión 5 y PRD §3.6 |
| D45 | Sesión pausada | Se pregunta «Continuar / Terminar con X min / Descartar» si la pausa supera 30 min o cruza la medianoche (zona del perfil). Se pregunta una vez por pausa en cada pestaña y nunca se cierra sola | Decisión 6 |
| D46 | Validación Linux | `npm run e2e:linux`: contenedor desechable con la imagen oficial de Playwright de la versión exacta. Solo reenvía los puertos 55321, 55322 y 55324, copia solo los valores públicos, revisa los registros por si contienen secretos y borra siempre el contenedor y la red | Decisión 7; los procesos Node de este Windows caen con `0xC0000409` bajo carga |
| D47 | Reflexiones en conflicto | La reflexión que pierde un conflicto se guarda en la copia del usuario en IndexedDB (`pendingNotes`, registro `v1:<usuario>`, con día y fase) en el mismo momento en que llega la respuesta, antes del pull. Vuelve al reabrir (aviso y panel en Mente y energía) hasta que el usuario elige «Aplicar la mía» o «Mantener la otra»; las decididas quedan en `resolvedNotes` para que otra pestaña no las reviva. Los demás indicadores de esa escritura se reenvían solos con su hora original. Cerrar sesión borrando el dispositivo avisa antes de perderlas | Riesgo 1 del informe M3.3; solo cliente, sin cambios en la migración |
| D48 | Validación previa al despliegue en CI | Procedimiento estándar desde M3.3 para todas las fases. Se amplía el workflow `ci.yml`, sin crear otro:<br>• se lanza con push a ramas `ci/**` y con `workflow_dispatch`;<br>• suite E2E completa con 2 pasadas sobre Supabase local efímero en un runner estándar;<br>• control de aislamiento: sin secretos, sin nube, solo loopback;<br>• aceptación: 0 fallidas, 0 inestables, 0 interrumpidas y todas las specs ejecutadas;<br>• informes revisados por si contienen secretos y conservados 30 días.<br>`vercel.json` desactiva los despliegues de `ci/**`. Detalle en `docs/ci-validation.md`. `e2e:linux` (D46) queda como alternativa local | La suite completa en Docker local agota la RAM del PC aunque solo esté abierto Claude Code (tres intentos detenidos el 28–29/10). El runner es independiente, igual en cada ejecución y entra en los minutos incluidos |

## M3.4 · Life Review

| # | Tema | Decisión | Motivo |
| --- | --- | --- | --- |
| D49 | Identidad y periodos | Una revisión es usuario + tipo (`week` / `month`) + inicio de periodo, en fechas locales de la zona del perfil. La semana va de lunes a domingo y pertenece a su lunes; el mes es el natural. Disponible desde el último día del periodo y para cualquier periodo pasado | Decisiones 2 y 6: sin duplicados entre dispositivos, coherente con Analytics |
| D50 | Snapshot al cerrar | Las cifras se congelan al cerrar (`SNAPSHOT_VERSION` 1 y `METRICS_VERSION`) y no cambian nunca. Se calculan solo con las funciones de Analytics, Goals, Focus y Mind. Son deterministas: se ignoran los registros posteriores a la última semana del periodo; Goals se evalúa a fecha del final del periodo sin datos posteriores; cerrar tarde da las mismas cifras. Una revisión cerrada que se abre con cifras actuales distintas lo indica, solo con la misma versión | Decisión 1 y requisitos de M3.4a |
| D51 | Privacidad de Mente y energía | Las revisiones solo leen indicadores numéricos de check-ins sin reflexión (`withoutNotes`). Las notas nunca llegan a una métrica ni a la snapshot | Requisito de M3.4 y `MIND_RULES` |
| D52 | Contenido y cierre | 3 preguntas y una nota libre, todas opcionales; hasta 3 decisiones (empezar / mantener / cambiar / dejar) con un resultado esperado y un vínculo opcional; evaluación en la siguiente revisión del mismo tipo. Cerrar exige estar sincronizado (cola vacía y pull de menos de 60 s); sin conexión se aplaza; gana el primer cierre; una revisión cerrada es inmutable; borrar es excepcional, con confirmación expresa y nunca automático | Decisiones 3, 4 y 5 |
| D53 | CI sin claves en el log y acciones fijadas | `supabase start` escribe en un fichero que no se publica, se redacta si falla y las cuatro claves del stack local se enmascaran. `checkout` v7.0.1, `setup-node` v7.1.0, `cache` v6.1.0 y `upload-artifact` v7.0.2, fijadas por SHA de commit (Node 24) | Pendientes de CI de M3.3 (riesgo 12) |

## Decisiones abiertas (para ti)

1. ~~Inicio de sesión~~: resuelto en M2, enlace mágico más código.
2. Hosting y dominio, y cuentas nuevas y dedicadas de GitHub, Vercel y Supabase (M2/M6).
3. Proveedor de push y planificador en servidor (M5).
4. Retención de datos y frecuencia de exportación/copias (M6).
5. Proveedor de IA, límites y presupuesto (M6).
