# Roadmap

Fases de la Misión Maestra sobre el estado real (`docs/matriz-funcional.md`). Las tareas concretas y su estado están en `PROGRESS.md`. Las estimaciones son de trabajo efectivo de Skynet y no incluyen la espera de CI (16–40 min por PR).

| Fase | Contenido | Tareas | Depende de | Estimación | Estado (2026-11-11) |
| --- | --- | --- | --- | --- | --- |
| **A · Estabilización** | Integrar M4g y D108, recuperar el e2e, cerrar M4g.5 | A1–A9 | — | 6–9 h | hecha (PR #1–#7) |
| **B · Life Analytics** | Relaciones entre variables, comparativas, proyecciones, aprendizaje | B1–B5 | A1 | 4–6 h | hecha (PR #7) |
| **C · Objetivos y productividad** | Estados de objetivo, ajustes, interrupciones, revisión diaria, historial | C1–C6 | A1 | 6–9 h | hecha (PR #8–#13) |
| **D · Conocimiento y aprendizaje** | Active Recall y Daily Discovery real | D1–D6 | A (M4g.5 cerrado) | 6–9 h | hecha (PR #14–#17) |
| **E · Inteligencia personal** | Insights por reglas, experimentos, Motivation Engine, bandeja, push | E1–E9 | B, C, D | 8–12 h | hecha (PR #18–#24 y E9 en #35); activar el push programado es configuración de Dani |
| **F · Consolidación final** | Integración, accesibilidad, rendimiento, respaldo, documentación, candidata | F1–F6 | Todas | 4–6 h | hecha salvo F3, bloqueada; versión candidata (PR #25–#29) |
| **G · Cierre previo a publicación (Órdenes 2 y 4)** | Cola duradera, push programado sin coste, separación de la base de producción, cierre | G1–G4, E9a–E9c | F | 6–9 h | hecha (PR #35 y #40) |

## Dependencias relevantes
- **A1 va primero**: casi todo lo demás parte del código de M4g.
- **B y C pueden avanzar en paralelo**; E consume sus datos.
- **Migraciones (C1, C4, C5, D1, D4, E5):** deben ser aditivas, porque staging es la misma base que usa la app desplegada.

## Cambios respecto al orden del Plan Maestro
El orden de la orden (A–F) se mantiene sin cambios. El roadmap original de siete fases del Plan Maestro es estratégico y ya está superado por los milestones técnicos, como el propio documento indica.

## Fuera del alcance de esta versión candidata (pendiente autorizable)
- IA generativa con proveedor.
- Activar el envío programado de push (E9): el código, la migración (con `pg_cron`, sin coste) y las claves están hechos; faltan las variables de Vercel y los secretos de Vault, que pone Dani (`DONE.md`).
- Crear la base de producción aparte con `npm run db:fresh` (G2): lo hace Dani.
- Publicación en `main` y producción: decisión de Dani (`docs/publicacion.md`, tarea F5).
