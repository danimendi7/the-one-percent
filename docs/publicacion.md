# Publicar, revertir y separar la base de producción

Procedimiento para que Dani decida cuándo pasar `skynet/integracion` a `main` y a producción. Skynet no publica: todo lo de este documento lo hace Dani, o Skynet con su autorización expresa para ese paso.

Estado comprobado el 2026-11-10:
- `skynet/integracion` va 27 commits por delante de `main` y `main` no tiene nada que ella no tenga, así que la fusión no tiene conflictos.
- **Producción:** `https://the-one-percent-kappa.vercel.app`. La despliega Vercel al hacer push a `main` (`vercel.json`: las ramas `ci/**` no despliegan).
- **Base de datos:** el proyecto Supabase `the-one-percent` (`supabase/cloud-project.json`) es a la vez staging y producción, por decisión de Dani del 2026-11-09. Las 11 migraciones nuevas de esta versión (de `20261109090000_goal_review` a `20261110120000_push_subscriptions`) **ya están aplicadas** en esa base. Todas son aditivas y compatibles con el código de `main`, que funciona sobre ellas desde que se aplicaron (9 y 10 de noviembre).
- **CI:** `.github/workflows/ci.yml` valida, pero no migra ni despliega, y no lee ningún secreto. En este repositorio no hay ninguna migración automática a producción: las migraciones de la nube se aplican a mano (abajo).

## 1. Antes de publicar

1. **CI de la rama base en verde.** Cada PR fusionada en `skynet/integracion` pasó la CI completa con 0 fallidas y 0 inestables (`PROGRESS.md`, columna PR).
2. **Validación previa al despliegue (D48, `docs/ci-validation.md`):** sube la rama como `ci/candidata` y espera dos pasadas completas en verde:
   ```bash
   git push origin origin/skynet/integracion:refs/heads/ci/candidata
   ```
   Vercel no despliega las ramas `ci/**`.
3. **Copia y simulacro** de la base, en tu PC con Docker Desktop:
   ```bash
   npm run backup -- --source cloud
   npm run restore:drill -- <copia.topbak>
   ```
   Necesitas `BACKUP_PASSPHRASE` y `SUPABASE_DB_URL` (en `.env.cloud.local`), según `docs/backup-strategy.md`. Es la tarea F3, bloqueada para Skynet porque su máquina no tiene Docker.
4. **Variables de Vercel (Production).** Obligatorias: `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; sin ellas el build de producción falla a propósito (`next.config.ts`). Opcionales:
   - `GOOGLE_BOOKS_API_KEY`: mejores datos de libros.
   - Para el push: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` (`mailto:tu@correo`), generadas con `npx web-push generate-vapid-keys`. Sin ellas, Ajustes › Notificaciones dice que el push no está configurado y los avisos siguen en la bandeja.
   - `AI_*`: déjalas vacías; el proveedor de IA está apagado y requiere autorización.
5. **Preview de la rama base:** la prueba de humo contra `the-one-percent-git-skynet-integracion-…vercel.app` da 10 de 22. Las 12 restantes fallan solo porque la CSP bloquea la barra de comentarios que Vercel inyecta en los previews, que en producción no existe.

## 2. Publicar

1. **PR de `skynet/integracion` a `main`**, fusionada con *Create a merge commit* para conservar cada tarea como un commit. Repasa la lista de cambios en `PROGRESS.md` y `DECISIONS.md`.
2. **Vercel despliega `main`.** Espera a que el despliegue de producción esté *Ready*. El push a `main` lanza además la CI (una pasada).
3. **Humo contra producción** (22 de 22 esperado: no hay barra de Vercel):
   ```bash
   BASE_URL=https://the-one-percent-kappa.vercel.app npm run smoke
   ```
4. **Comprobación a mano, en el móvil y en el ordenador:**
   - Entra con tu email.
   - Marca un hábito en un dispositivo y comprueba que aparece en el otro.
   - Comprueba que el indicador de la cabecera dice «Sincronizado».
   - Abre Ajustes › Notificaciones.
   - En el iPhone instalado, sigue `docs/guia-dispositivo.md`.
5. **Recarga una vez** las pestañas abiertas: el service worker se versiona por build (`/sw.js?v=<commit>`) y prepara la caché sin conexión de la versión nueva al primer arranque con red.

## 3. Revertir

Desde que staging y producción comparten base, toda migración es aditiva y compatible con el código anterior. Revertir el código **no exige tocar la base**.

1. **Inmediato:** en Vercel, Deployments → el despliegue de producción anterior → *Instant Rollback*. Vuelve en segundos, sin build.
2. **Después**, deja `main` igual que lo que está en producción, con un PR que revierta la fusión:
   ```bash
   git revert -m 1 <commit de la fusión>
   ```
   Si no, el siguiente push a `main` volvería a publicar la versión retirada.
3. **Datos:**
   - Lo escrito con la versión nueva queda en la base. La anterior simplemente no lo muestra (tarjetas de repaso, temas, experimentos, suscripciones push…), y al volver a publicar reaparece.
   - La copia local de cada dispositivo (IndexedDB) se lee campo a campo y conserva la cola de cambios pendientes. Al volver a una versión anterior no se pierde lo que aún no se ha enviado.
4. **Si hiciera falta recuperar datos:** la restauración en la nube no está automatizada a propósito (`docs/backup-strategy.md` › Recuperación). Se hace en un proyecto nuevo con la última copia que haya pasado el simulacro, con un plan escrito en el momento.

## 4. Separar una base de producción limpia

Recomendado antes de usar la app a diario: hoy los previews, las pruebas de Skynet y producción escriben en la misma base.

1. **Proyecto nuevo** en Supabase, en tu organización personal y en la región UE, con la contraseña en tu gestor. No reutilices ningún proyecto de Neumáticos Uría.
2. **Repositorio:** apunta `supabase/cloud-project.json` al proyecto nuevo (`ref`, `organizationId`, `region`). `scripts/cloud.mjs` se niega a actuar sobre otro.
3. **Esquema completo,** con el token del proyecto en tu terminal (`SUPABASE_ACCESS_TOKEN`) o en `.env.cloud.local`:
   ```bash
   npm run cloud -- check
   npm run cloud -- link            # necesita además SUPABASE_DB_PASSWORD
   npm run cloud -- push-dry
   npm run cloud -- push --confirm <ref>
   ```
   `push` exige una copia de menos de 24 h del proyecto destino con el simulacro superado. En un proyecto recién creado basta con copiar la base vacía y hacerle el simulacro.
4. **Acceso** (`supabase/README.md`, pasos 4 y 5):
   - Allowlist: `insert into private.allowed_emails (email, note) values ('tu@correo', 'owner');`
   - Site URL y Redirect URLs de producción.
   - Plantilla del enlace mágico (`supabase/templates/magic-link.html`).
   - Confirmación de email activada.
   - SMTP propio.
5. **Vercel:** las variables de Supabase con ámbito *Production* pasan al proyecto nuevo; las de *Preview* siguen en el actual, que queda como staging. Haz un despliegue nuevo de producción para que las use.
6. **Datos:**
   - Los del proyecto actual son de prueba (decisión del 2026-11-09), así que lo normal es empezar limpio.
   - Para traer algo concreto, exporta desde la app (Ajustes › «Exportar mis datos (JSON)»). Un traspaso completo sería una restauración de copia con un plan escrito.
7. **Después:**
   - `STAGING_DB_URL` (`.env.local` de Skynet) sigue apuntando al proyecto actual: Skynet migra staging, nunca producción.
   - Cada migración nueva llega a producción con `npm run cloud -- push --confirm <ref>`, tras su copia y su simulacro.
   - Desde entonces, las migraciones ya no necesitan ser compatibles con el código desplegado en `main` (D de 2026-11-09). Aun así, conviene mantenerlo: es lo que permite revertir el código sin tocar la base.

## Pendiente autorizable (no bloquea publicar)

- **Envío programado de push (E9):** claves VAPID en Vercel, un planificador de pocos minutos (de pago en Vercel) y una clave de servicio en el servidor.
- **IA generativa:** requiere un proveedor de pago.
- **Desactivar la barra de comentarios de Vercel en los previews:** dejaría el humo de los previews en 22 de 22.
- **Simulacro de restauración (F3)** y **prueba en un iPhone real.**
