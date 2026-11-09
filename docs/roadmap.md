# Roadmap

Fases de la Misión Maestra sobre el estado real (`docs/matriz-funcional.md`). Las tareas concretas y su estado están en `PROGRESS.md`. Las estimaciones son de trabajo efectivo de Skynet y no incluyen la espera de CI (16–40 min por PR).

| Fase | Contenido | Tareas | Depende de | Estimación |
| --- | --- | --- | --- | --- |
| **A · Estabilización** | Integrar M4g y D108, recuperar el e2e, cerrar M4g.5 | A1–A9 | — | 6–9 h |
| **B · Life Analytics** | Relaciones entre variables, comparativas, proyecciones, aprendizaje | B1–B5 | A1 | 4–6 h |
| **C · Objetivos y productividad** | Estados de objetivo, ajustes, interrupciones, revisión diaria, historial | C1–C6 | A1 | 6–9 h |
| **D · Conocimiento y aprendizaje** | Active Recall y Daily Discovery real | D1–D6 | A (M4g.5 cerrado) | 6–9 h |
| **E · Inteligencia personal** | Insights por reglas, experimentos, Motivation Engine, bandeja, push | E1–E8 | B, C, D | 8–12 h |
| **F · Consolidación final** | Integración, accesibilidad, rendimiento, respaldo, documentación, candidata | F1–F6 | Todas | 4–6 h |

## Dependencias relevantes
- **A1 va primero**: casi todo lo demás parte del código de M4g.
- **B y C pueden avanzar en paralelo**; E consume sus datos.
- **Migraciones (C1, C4, C5, D1, D4, E5):** deben ser aditivas, porque staging es la misma base que usa la app desplegada.

## Cambios respecto al orden del Plan Maestro
El orden de la orden (A–F) se mantiene sin cambios. El roadmap original de siete fases del Plan Maestro es estratégico y ya está superado por los milestones técnicos, como el propio documento indica.

## Fuera del alcance de esta versión candidata (pendiente autorizable)
- IA generativa con proveedor.
- Envío programado de push si exige un servicio de pago.
- Publicación en `main` y producción: decisión de Dani (`docs/publicacion.md`, tarea F5).
