# Arquitectura (M0/M1)

## Stack

| Capa | Elección | Notas |
| --- | --- | --- |
| Framework | Next.js 16.4 (App Router, Turbopack, `cacheComponents`) + React 19.3 + TypeScript estricto | Todas las rutas son estáticas en M1 |
| Estilos | Tailwind CSS v4 + tokens CSS en `src/app/globals.css` | Tema oscuro único (Dark Performance) |
| Componentes | shadcn/ui (base Radix) adaptado: tamaños táctiles, textos en español, sin `next-themes` | |
| Iconos | Lucide | Exigido por la especificación |
| Gráficos | Recharts 3 | Solo series únicas, con vista de tabla alternativa |
| Validación | Zod 4 | Formularios y estado persistido |
| Tests | Vitest (dominio), Playwright + axe-core (E2E y accesibilidad) | |
| Datos (M2+) | Supabase (Auth, Postgres con RLS, Storage) en local con Docker | Sin proyecto cloud todavía |

Pendientes de su fase: TanStack Query e IndexedDB (cola offline) en M2. No se instalan hasta que se usen.

## Capas

```
UI (features/*/components, app/*)
   │ lee                      │ escribe
   ▼                          ▼
store (M1: habit-store, localStorage)  ──► domain/ops (reductores puros, idempotentes)
   │
   ▼
domain (dates, schedule, metrics): funciones puras, sin React ni E/S
```

- **Dominio puro** (`features/habits/domain`): fechas de calendario (`LocalDate`) con aritmética en medianoches UTC (sin DST), horarios versionados, contrato de cálculo de cumplimiento, rachas, agregaciones. Es el código que el backend replicará en M2/M3.
- **Store de demo** (`features/habits/store/habit-store.ts`): `useSyncExternalStore`, persistencia en `localStorage` validada con Zod, sincronización entre pestañas del mismo navegador (evento `storage`), recálculo de "hoy" al volver a la pestaña. Devuelve `null` en SSR y la UI pinta skeletons, así no hay errores de hidratación.
- **Escrituras** "set desired state" (`setEntry(value)`, nunca toggle), rechazos explícitos (futuro, día no programado, descanso, valor inválido) y deshacer.

## Mapa de pantallas

| Ruta | Escritorio (sidebar) | Móvil | Estado M1 |
| --- | --- | --- | --- |
| `/` | Resumen | Pestaña Inicio | Interactivo (checklist real, top 3 en memoria) |
| `/habits` | Hábitos | Pestaña Hábitos (Hoy / Semana) | **Interactivo completo** |
| `/analytics` | Analítica | Pestaña Análisis | Calculado de los registros locales |
| `/goals` | Objetivos | Más | Resultado demo, esfuerzo calculado |
| `/focus` | Enfoque | Pestaña Enfoque | Temporizador funcional, no guarda sesiones |
| `/knowledge/library` | Biblioteca | Más | Fixtures, búsqueda y filtros funcionales |
| `/knowledge/discover` | Descubrir | Más | Tema curado, valoración 1–10 en memoria |
| `/knowledge/brain` | Cerebro | Más | Cola de repaso demo |
| `/mind` | Mente y energía | Más | Formulario demo, no guarda |
| `/reviews` | Revisiones | Más | Agregados reales de la semana anterior |
| `/intelligence` | Inteligencia | Más | Informativa |
| `/settings` | Ajustes | Más | Exportar JSON y restablecer demo |
| `/settings/notifications` | (Ajustes) | Más | Configuración simulada; nunca pide permiso |
| `/more` | n/a | Pestaña Más | Índice de secciones |
| `/knowledge` | n/a | n/a | Redirige a Biblioteca |

Layout: escritorio ≥1024 px sidebar de 240 px; tablet 768–1023 px rail de 72 px con tooltips; móvil <768 px cinco pestañas inferiores con área segura y cabecera con acceso persistente a la checklist de hoy.

## Sistema visual

- Tokens de la especificación en `:root`, mapeados a la semántica de shadcn (`--primary` = señal lima). Ningún componente usa hexadecimales sueltos.
- Colores de dimensión (categóricos, orden fijo) validados con el comprobador de paleta: banda de luminosidad, croma, separación CVD ΔE ≥ 12,6, visión normal ΔE ≥ 16,2 y contraste ≥ 3:1 sobre `#161D26`.
- Radios: controles 12 px, paneles 16 px, chips en píldora.
- Movimiento: 150–300 ms solo en `transform`/`opacity`/progreso; `prefers-reduced-motion` lo anula.
- Cifras con números tabulares.

## Decisiones y supuestos

Ver [`decisions.md`](decisions.md).
