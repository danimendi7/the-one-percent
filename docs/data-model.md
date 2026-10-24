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

## Implementado en M2 (Postgres local)

| Tabla | Notas respecto a la especificación |
| --- | --- |
| `profiles` | Como en la spec. Se crea con un trigger al dar de alta el usuario; zona horaria validada con `pg_timezone_names`. |
| `dimensions` | Cuatro dimensiones fijas por usuario (`body`, `mind`, `learn`, `work`). |
| `habits` | `id` generado en el cliente (creación idempotente) y `version` para conflictos. `archived_on` en lugar de `state`. `start_date` y `habit_type` son inmutables. |
| `habit_schedule_versions` | `weekdays smallint[]` en lugar de `weekdays_json`; `valid_until` se deriva. Solo se añaden versiones; el histórico es inmutable (trigger). `excluded_dates_json` queda para más adelante. |
| `habit_entries` | Un registro por hábito y día; `client_updated_at` para resolver conflictos (gana la última escritura); `deleted_at` como lápida; `source_activity_*` reservados para M3/M4. |
| `routine_calendar` | Días de descanso (`rest_flag`) con resolución por última escritura. `routine_templates` queda para M3. |
| `sync_operations` | Registro de operaciones idempotentes: único `(user_id, client_op_id)`; guarda el resultado para las repeticiones. |
| `audit_logs` | Creación, edición, archivo y restauración de hábitos, y registros retroactivos. |
| `private.allowed_emails` | No figura en la spec: implementa «sin registro público». |

Fuera de M2 (fases siguientes): objetivos, enfoque y check-ins (M3), libros y conocimiento (M4), notificaciones (M5) y revisiones persistidas (M6).
