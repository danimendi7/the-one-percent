# Decisiones

Registro de lo que Claude decidió por su cuenta. Una entrada por decisión, la más reciente arriba. Las decisiones de producto anteriores (D1–D108) están en `docs/decisions.md`.

| Fecha | Decisión | Alternativa descartada | Motivo |
| --- | --- | --- | --- |
| 2026-11-09 | La ficha muestra también la atribución guardada del proveedor, no solo la derivada de ediciones separadas | Mostrar solo el caso de D101 | Si no, una edición separada diría la fuente y el libro original no, siendo este el que la tiene registrada |
| 2026-11-09 | Pasar al formulario manual desde un asistente no borra su borrador | Borrarlo al pasar a manual | D102 no lo incluye entre los borrados y el formulario manual no tiene borrador propio: si se recarga ahí, lo escrito sigue recuperable. Como mucho queda una oferta sobrante hasta 24 h |
| 2026-11-09 | La PR #3 agrupa A3, A4 y A5 | Una PR para A3 y otra para A4 y A5 | La CI de A3 había que repetirla por la corrección de accesibilidad; así se gasta una sola pasada sobre el código ya combinado |
| 2026-11-09 | Un test recorre los `.tsx` y exige `role` en todo esqueleto con `aria-busy` y `aria-label` | Esperar en la prueba de accesibilidad a que acabe la carga | Esa espera habría ocultado un defecto real (`aria-prohibited-attr`) que hacía inestable la CI; el test lo comprueba siempre, no solo cuando axe llega durante la carga |
| 2026-11-09 | Un guardado rechazado cuando el usuario ya salió se avisa con un aviso que no caduca y ofrece «Reintentar» | Impedir cerrar el asistente durante la espera | M4g.5 dejaba abierta esta decisión. El aviso no bloquea a nadie y cubre también el formulario manual; no decide nada por sí mismo, así que no contradice D108 |
| 2026-11-09 | Toda migración debe ser aditiva y compatible con el código desplegado en `main` | Migraciones que cambien o eliminen columnas | Por decisión de Dani, staging es la misma base que usa la app desplegada: un cambio incompatible rompería esa app |
| 2026-11-09 | M4g.5 incluye sus dos definiciones (`m4g-plan` §8 y §23) | Atender solo el endurecimiento de §23 | La orden pide cerrar los pendientes de M4g.5 sin distinguir; es la opción que no deja requisitos fuera |
| 2026-11-09 | Agrupar tareas relacionadas en una misma PR | Una PR por tarea | Cada PR ejecuta la CI completa (16–40 min) en un repositorio privado con minutos limitados |
| 2026-11-09 | `npm run verify` = `check` + `build`; integración y E2E se validan en la CI de la PR | Exigir E2E en local | Esta máquina no tiene Docker para la Supabase local, que esos tests requieren por diseño (se niegan a usar hosts remotos) |
| 2026-11-09 | Integrar `fix/library-notice-autodismiss` como base de M4g | Integrar `m4g/h1` o `m4g/reconcile` | Contiene a las demás; el único commit de `main` local fuera de ella tiene el mismo árbol que `77f0b61` |
| 2026-11-09 | `docs/plan-maestro.md` se genera desde el HTML de mammoth para conservar las tablas | Salida markdown directa de mammoth | Esa salida aplana las tablas en párrafos sueltos y se pierde su estructura |
