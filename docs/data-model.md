# Modelo de datos

Fuente de verdad: [`spec/DATABASE_ARCHITECTURE.md`](spec/DATABASE_ARCHITECTURE.md). Este documento relaciona el modelo local de M1 con el esquema Postgres de M2.

## M1 (local, demo)

`HabitsState` (`src/features/habits/domain/types.ts`), validado con Zod al leerlo de `localStorage`:

| Campo M1 | Tabla M2 |
| --- | --- |
| `habits[]` (`id`, `name`, `icon`, `dimensionId`, `type`, `unit`, `target`, `direction`, `startDate`, `archivedOn`) | `habits` |
| `habits[].schedule[]` (`validFrom`, `rule`) | `habit_schedule_versions` (`valid_until_date` se deriva de la versión siguiente) |
| `entries{habitId:date}` (`value`, `opId`, `updatedAt`) | `habit_entries` (unique `(user_id, client_op_id)` y unique por hábito y día para los binarios) |
| `restDays[]` | `routine_calendar.rest_flag` |
| `dimensions[]` | `dimensions` |
| `timezone` | `profiles.timezone` |

Biblioteca, temas, tarjetas y objetivos usan fixtures estáticos en M1.

## Contratos de cálculo implementados (y testeados)

- Binario: cumplido si `value = true` en un día programado.
- Numérico: cumplido si `≥` o `≤` el objetivo según `direction`. La ausencia de valor nunca es éxito, tampoco en los límites "como máximo".
- Semanal (N veces por semana): una oportunidad por semana ISO; meta = `min(N, días disponibles sin descanso)`.
- `% cumplimiento = cumplidas / aplicables`; si no hay ninguna aplicable devuelve `null` (N/D), nunca 0 ni 100.
- Los horarios versionados conservan los denominadores históricos.
- Fechas: `LocalDate` en la zona del usuario; aritmética sobre medianoches UTC; conversión de instantes con `Intl` (DST verificado en Europe/Madrid el 29 de marzo y el 25 de octubre de 2026).

## Plan de migraciones (M2 →)

Orden de la especificación: 1) identidad y dimensiones; 2) hábitos, horarios y registros; 3) objetivos, enfoque y check-ins; 4) libros, lectura y notas; 5) descubrimiento y repaso; 6) push y reglas; 7) auditoría y sincronización; 8) índices y vistas analíticas. Cada tabla privada con RLS por `auth.uid()` y tests automáticos de acceso cruzado.
