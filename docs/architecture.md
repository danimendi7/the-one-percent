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

## M2: datos reales y sincronización

```
UI ──► habitActions / useHabits()  (fachada, src/features/habits/store/habit-store.ts)
          │
          ├─ demoBackend ── localStorage (modo demo)
          │
          └─ accountBackend
               └─ SyncEngine (src/features/sync/engine.ts)
                    ├─ ServerCache + cola de operaciones ──► IndexedDB (por usuario)
                    ├─ vista optimista = rebase(cache, cola) con los mismos reductores puros
                    ├─ push: apply_ops(device_id, ops[])  ──► Postgres (RLS, guardas, ledger)
                    └─ pull: pull_changes(cursor - solape) ◄── Realtime invalida · foco · online · cada 30 s
```

**Operaciones** (`src/features/sync/domain/types.ts`): `entry.set` (estado deseado, nunca toggle), `habit.create` (id generado en el cliente), `habit.update` (con `base_version`), `habit.archive`, `habit.restore`, `rest_day.set` y `profile.update`. Cada una lleva un `op_id` único.

**Garantías**
- *Idempotencia*: `sync_operations (user_id, client_op_id)` es único; repetir un `op_id` devuelve el resultado guardado sin volver a aplicarlo. Si se pierde la respuesta, el cliente reintenta sin duplicar.
- *Cola duradera*: las operaciones se guardan en IndexedDB antes de enviarse y sobreviven a cierres y reinicios. Los estados deseados del mismo día se compactan.
- *Sin parpadeos*: una operación confirmada sale de la cola solo después del pull que la refleja.
- *Conflictos*:
  - Registros y días de descanso: gana la última escritura según la hora del dispositivo. Desmarcar deja una «lápida» con hora, para que una marca más antigua que llegue tarde no la resucite.
  - Edición de hábitos: control optimista por `version`. Si dos dispositivos editan a la vez, el segundo recibe `conflict`, se mantiene la versión más reciente y se avisa con la opción «Aplicar el mío».
- *Cursor*: `server_seq` global (`public.change_seq`). Los pulls incrementales releen un solape de 500 posiciones para cubrir transacciones que confirman tarde; la fusión ignora filas más antiguas que la copia local. Al arrancar la app se hace siempre un pull completo.
- *Hoy* se calcula con `profiles.timezone`, igual en el cliente y en el servidor (`public.user_today()`).

**Integridad en la base de datos** (independiente del cliente):
- Solo se registra en días programados según la versión de horario vigente, nunca en días futuros ni de descanso, y con el tipo de valor correcto.
- Las versiones de horario solo se añaden o sustituyen desde hoy: el histórico es inmutable.
- `habit_type` y `start_date` son inmutables.
- Las claves compuestas `(habit_id, user_id)` impiden vincular datos de otro usuario.
- Los registros retroactivos quedan en `audit_logs`.

**Auth**: enlace mágico con *token hash* (`/auth/confirm`), válido desde cualquier dispositivo, más un código de 6 dígitos en el mismo correo (red local y PWA de iOS). `src/proxy.ts` refresca la sesión y envía a `/login` a quien no tiene sesión ni ha elegido explícitamente la demo. Las cuentas solo se crean para emails de `private.allowed_emails`.
