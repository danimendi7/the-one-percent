# Decisiones

Registro de lo que Claude decidió por su cuenta. Una entrada por decisión, la más reciente arriba. Las decisiones de producto anteriores (D1–D108) están en `docs/decisions.md`.

| Fecha | Decisión | Alternativa descartada | Motivo |
| --- | --- | --- | --- |
| 2026-11-09 | Toda migración debe ser aditiva y compatible con el código desplegado en `main` | Migraciones que cambien o eliminen columnas | Por decisión de Dani, staging es la misma base que usa la app desplegada: un cambio incompatible rompería esa app |
| 2026-11-09 | M4g.5 incluye sus dos definiciones (`m4g-plan` §8 y §23) | Atender solo el endurecimiento de §23 | La orden pide cerrar los pendientes de M4g.5 sin distinguir; es la opción que no deja requisitos fuera |
| 2026-11-09 | Agrupar tareas relacionadas en una misma PR | Una PR por tarea | Cada PR ejecuta la CI completa (16–40 min) en un repositorio privado con minutos limitados |
| 2026-11-09 | `npm run verify` = `check` + `build`; integración y E2E se validan en la CI de la PR | Exigir E2E en local | Esta máquina no tiene Docker para la Supabase local, que esos tests requieren por diseño (se niegan a usar hosts remotos) |
| 2026-11-09 | Integrar `fix/library-notice-autodismiss` como base de M4g | Integrar `m4g/h1` o `m4g/reconcile` | Contiene a las demás; el único commit de `main` local fuera de ella tiene el mismo árbol que `77f0b61` |
| 2026-11-09 | `docs/plan-maestro.md` se genera desde el HTML de mammoth para conservar las tablas | Salida markdown directa de mammoth | Esa salida aplana las tablas en párrafos sueltos y se pierde su estructura |
