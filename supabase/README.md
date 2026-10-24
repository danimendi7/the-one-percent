# Supabase de THE ONE PERCENT

## Stack local (M2)

Proyecto local `the-one-percent`. Usa **puertos dedicados (553xx)** para convivir con otros stacks locales sin tocarlos.

| Servicio | URL |
| --- | --- |
| API (REST, Auth, Realtime) | http://127.0.0.1:55321 |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:55322/postgres` |
| Studio | http://127.0.0.1:55323 |
| Mailpit (correos de acceso) | http://127.0.0.1:55324 |

```bash
npm run db:start     # arranca (la primera vez descarga imágenes Docker)
npm run db:reset     # recrea la base desde migrations/ + seed.sql (BORRA los datos locales)
npm run db:stop      # para el stack (conserva los datos)
npx supabase status  # URL y claves locales
```

Servicios desactivados por innecesarios en M2: Storage, Edge Functions y Analytics.

### Acceso local
- `seed.sql` autoriza `owner@theonepercent.local`. Para usar tu email local:
  `insert into private.allowed_emails (email) values ('tu@correo.com');` (desde Studio → SQL Editor).
- Los correos no salen del equipo: ábrelos en Mailpit. Cada correo trae un **enlace** y un **código de 6 dígitos**. El código sirve para entrar desde otro dispositivo de la red local o desde la PWA instalada.

### Migraciones
| Fichero | Contenido |
| --- | --- |
| `20261024100000_identity.sql` | Perfiles, dimensiones, allowlist privada, secuencia de cambios, `user_today()` |
| `20261024100100_habits.sql` | Hábitos, horarios versionados, registros, calendario de descanso, guardas de integridad y RLS |
| `20261024100200_sync.sql` | Registro de operaciones idempotentes, auditoría, `apply_ops` y `pull_changes` |
| `20261024100300_realtime.sql` | Publicación Realtime y permisos de funciones |

## Conectar más adelante tu cuenta personal de Supabase (requiere tu autorización)

> No hacer nada de esto sin autorización expresa. Comprueba siempre que el proyecto es el **nuevo y dedicado** a THE ONE PERCENT, nunca uno de Neumáticos Uría.

1. En https://supabase.com crea (o elige) una **organización personal** y un **proyecto nuevo** llamado `the-one-percent`. Región: UE (por ejemplo Frankfurt o París). Guarda la contraseña de la base de datos en tu gestor de contraseñas.
2. En el PC, inicia sesión en la CLI **con tu cuenta personal**. En este equipo hay una sesión previa de la CLI de otro proyecto (`~/.supabase`), así que conviene usar un token propio para no mezclarlas:
   ```bash
   npx supabase logout            # opcional: cierra la sesión previa de la CLI
   npx supabase login             # abre el navegador: entra con TU cuenta personal
   npx supabase projects list     # verifica que aparece the-one-percent y anota su Reference ID
   ```
3. Enlaza **solo este repositorio** con ese proyecto y revisa el resultado antes de aplicar nada:
   ```bash
   npx supabase link --project-ref <REFERENCE_ID>
   npx supabase db push --dry-run   # lista las 4 migraciones que se aplicarían
   npx supabase db push             # aplica las migraciones (no ejecuta seed.sql)
   ```
4. **Allowlist**: en el SQL Editor del proyecto cloud, autoriza tu email (el seed local no se sube):
   ```sql
   insert into private.allowed_emails (email, note) values ('tu@correo.com', 'owner');
   ```
5. **Auth** (Dashboard → Authentication):
   - URL Configuration → Site URL: la URL de producción (cuando exista) y Redirect URLs: esa URL + `http://localhost:3000`.
   - Email Templates → Magic Link: copia el contenido de `supabase/templates/magic-link.html` (enlace con `token_hash` + código).
   - Providers → Email: mantener activado, «Confirm email» activado. Sin otros proveedores.
   - SMTP: configura un proveedor propio antes de producción (el SMTP por defecto de Supabase tiene límites bajos).
6. **Variables** en `.env.local` (y más adelante en el hosting): `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` del proyecto cloud. La clave secreta / service role **no** la usa la app.
7. **Verificación** antes de usarlo a diario:
   - `npm run test:integration` está pensado para el stack local y se niega a ejecutarse contra un host remoto. Las pruebas de RLS contra cloud se harán con un proyecto de staging separado (M6).
   - Comprueba en Dashboard → Advisors (Security y Performance) que no hay avisos.
8. **Copias**: activa los backups del plan, programa la exportación periódica y prueba una restauración en un proyecto de staging (requisito de M6).
