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

## Decisiones abiertas (para ti)

1. Inicio de sesión: enlace mágico por email o passkeys (M2).
2. Hosting y dominio, y cuentas nuevas y dedicadas de GitHub, Vercel y Supabase (M2/M6).
3. Proveedor de push y planificador en servidor (M5).
4. Retención de datos y frecuencia de exportación/copias (M6).
5. Proveedor de IA, límites y presupuesto (M6).
