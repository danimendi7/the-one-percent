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

## Decisiones abiertas (para ti)

1. ~~Inicio de sesión~~: resuelto en M2, enlace mágico más código.
2. Hosting y dominio, y cuentas nuevas y dedicadas de GitHub, Vercel y Supabase (M2/M6).
3. Proveedor de push y planificador en servidor (M5).
4. Retención de datos y frecuencia de exportación/copias (M6).
5. Proveedor de IA, límites y presupuesto (M6).
