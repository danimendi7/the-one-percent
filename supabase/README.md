# Supabase (solo local)

Configuración generada con `supabase init` para el proyecto `the-one-percent`. Todavía no hay migraciones: llegan en M2 siguiendo el orden de `docs/data-model.md`.

- Arrancar en local (Docker): `npm run db:start`. Imprime la URL y las claves **locales** para `.env.local`.
- Parar: `npm run db:stop`. Recrear desde las migraciones: `npm run db:reset`.
- **No** ejecutar `supabase login` ni `supabase link` sin autorización expresa y sin verificar que el proyecto cloud es el dedicado a THE ONE PERCENT.
