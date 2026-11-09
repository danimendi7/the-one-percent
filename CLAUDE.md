@AGENTS.md

# THE ONE PERCENT: reglas del proyecto

- Proyecto totalmente independiente de Neumáticos Uría: no acceder, reutilizar ni modificar sus archivos, bases de datos, credenciales, repositorios o configuraciones.
- No crear recursos externos (repos remotos, proyectos Supabase/Vercel, despliegues) ni usar cuentas cloud sin autorización expresa del propietario. Nunca `supabase login`/`link` sin verificar cuenta y proyecto.
- Especificación en `docs/spec/`. Decisiones en `docs/decisions.md`. Seguir las fases de `docs/spec/IMPLEMENTATION_PLAN.md`.
- La lógica de negocio va en `src/features/*/domain` como funciones puras con tests (Vitest).
- UI en español, oscura, móvil primero, con zonas táctiles de al menos 44 px. Colores solo mediante tokens de `src/app/globals.css`. Etiquetar cualquier fixture como demo. No simular backend, sincronización, push ni IA.
- Antes de dar algo por terminado: `npm run check` y `npm run e2e`.
- Antes de desplegar una fase: validación en GitHub Actions subiendo una rama `ci/<fase>` (solo con autorización), según `docs/ci-validation.md` (D48).

## Skynet (modo protegido)
- Este proyecto contiene datos personales reales. Skynet trabaja en modo protegido: rama base `skynet/integracion`, nunca `main`, nunca producción.
- Pruebas y migraciones solo contra el Supabase de staging (`STAGING_DB_URL` en .env.local).
- La pérdida silenciosa de datos es un defecto crítico.
- Si alguna regla de este archivo contradice el prompt de Skynet, prevalece la más estricta.
