# DONE · Órdenes 2 y 4: cierre previo a publicación

**Versión candidata:** rama `skynet/integracion`. El código está en `15c7c09` (PR #35) y la PR #40 añade este cierre, un ajuste de texto en Ajustes › Notificaciones (G5) y la documentación. **No se ha tocado ni `main` ni producción** (`https://the-one-percent-kappa.vercel.app`): publicar lo decides tú, siguiendo `docs/publicacion.md` §1–§3.

Preview de la rama base, protegido por Vercel: `https://the-one-percent-git-skynet-integracion-danimendiar-3744.vercel.app`.

## Qué está hecho y qué lo demuestra

| Qué | Prueba |
| --- | --- |
| **G1 · Ya no se pierde un cambio hecho sin conexión si cierras la app al instante** (Orden 2 §1, prioridad máxima). Cada cambio se anota en un diario síncrono aparte antes de mostrarse en pantalla, y al abrir la app se recupera lo que no llegó a la copia del dispositivo. | E2E «Orden 2 §1» (`e2e/account.spec.ts`): CPU 6 veces más lenta, sin red, la página se cierra en cuanto aparece la marca. Al reabrir, la marca sigue ahí, llega **una sola** fila al servidor y una sola operación. Pasa en móvil y escritorio en la CI. Además, `npm run bench:journal` en Chromium real: sin el diario se pierde 30 de 30 veces; con él se conserva 30 de 30. |
| **E9 · Push programado sin coste** (Orden 2 §2). `pg_cron` llama cada 5 minutos a `/api/push/dispatch`. La ruta vuelve a evaluar el Motivation Engine con tus datos (silencio, tope, separación) y reserva cada aviso antes de enviarlo, así que un reintento nunca lo duplica. En la pantalla de bloqueo, el aviso solo dice cuántos hábitos quedan. | Integración en la CI: `push-schedule.int.test.ts` (el trabajo corre cada 5 minutos; sin destino en Vault no llama a nada; con destino, encola una llamada con el secreto; un aviso se reserva una sola vez y se rechazan el reintento, el tope y la separación; nadie más puede leer las entregas) y `push-dispatch.int.test.ts` (un hábito pendiente recibe un aviso; uno ya hecho o en horas de silencio, ninguno; un reintento no lo reenvía). **Migración aplicada en staging:** el trabajo `the-one-percent-push-dispatch` está activo y, como Vault no tiene ningún secreto, no llama a nada. |
| **G2 · Base de producción aparte** (Orden 2 §3). `npm run db:fresh` aplica todas las migraciones a una base **vacía** y audita RLS. Se niega a tocar una base que ya tenga tablas. | `db-fresh.int.test.ts` en la CI (base vacía → instala y audita). Contra staging, `npm run db:fresh -- --verify` da 26 tablas, 66 políticas y 23 de 23 migraciones, sin escribir nada. |
| **G5 · Texto de Ajustes › Notificaciones**. Ya no dice «pendiente de autorización» cuando el push está activado. Ahora dice que los avisos llegan siempre a la bandeja y, cuando el envío programado está activado, también como notificación. | `e2e/push-account.spec.ts`, en la CI de la PR #40. |

**CI de la PR #35** (ejecución 43008966912, en verde a la primera tras relanzarla, sin tocar ninguna prueba): 1193 unitarias, 245 de integración, 6 del motor en Chromium real, **597 E2E con 0 fallidas y 0 inestables** (27 omisiones, las previstas) y 22 de humo.
**Humo contra los previews** de la #35 y de la rama base: 10 de 22. Las otras 12 fallan solo porque la CSP bloquea la barra de comentarios que Vercel inyecta en los previews (`vercel.live`). En producción esa barra no existe.

## Lo que tienes que hacer tú, paso a paso

Skynet no puede hacer nada de esto: es configuración en la nube o usa credenciales que no están en `.env.local`. Todo es gratis (Supabase Free, Vercel Hobby). Orden recomendado: **A** (si quieres separar la base), después **B** (publicar) y por último **C** (push). C necesita que la ruta del push esté ya en producción.

### A · Crear la base de producción aparte (recomendado antes de usar la app a diario)

Hoy los previews, las pruebas de Skynet y producción escriben en la misma base (`the-one-percent`).

1. **Supabase › New project**, en tu organización personal (nunca en la de Neumáticos Uría). Usa la región UE, la misma que el actual, y el plan Free. Guarda la contraseña de la base en tu gestor.
2. **Supabase › Connect › Session pooler** (puerto 5432): copia la cadena de conexión y pon tu contraseña.
3. En la carpeta del proyecto (en PowerShell: `$env:FRESH_DB_URL = '…'` y al final `Remove-Item Env:FRESH_DB_URL`):
   ```bash
   export FRESH_DB_URL='postgresql://postgres.<ref>:<contraseña>@aws-0-<región>.pooler.supabase.com:5432/postgres'
   npm run db:fresh                 # ensayo en seco: comprueba que está vacía y lista las 23 migraciones
   npm run db:fresh -- --apply      # instala todo y audita RLS
   unset FRESH_DB_URL
   ```
   **Comprobación:** termina con «✔ Todas las tablas tienen RLS…» y «23 de 23 migraciones en el historial».
4. **Acceso** (`supabase/README.md`, pasos 4 y 5):
   - En el SQL Editor del proyecto nuevo, autoriza tu correo: `insert into private.allowed_emails (email, note) values ('tu@correo', 'owner');`
   - En Authentication › URL Configuration, pon como Site URL `https://the-one-percent-kappa.vercel.app` y añádela también a Redirect URLs.
   - En Email Templates › Magic Link, pega el contenido de `supabase/templates/magic-link.html`.
   - En Providers › Email, deja activado «Confirm email».
5. **Vercel › the-one-percent › Settings › Environment Variables**, con ámbito **Production**:
   - `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, con los valores del proyecto nuevo (Supabase › Project Settings › API Keys).
   - Las de ámbito *Preview* se quedan como están: el proyecto actual pasa a ser solo staging.
6. Cambia `ref`, `organizationId` y `region` en `supabase/cloud-project.json` por los del proyecto nuevo, o pídeselo a Skynet en una orden.
7. **Comprobación:** tras el siguiente despliegue de producción, entra con tu correo. El indicador de la cabecera debe decir «Sincronizado».

### B · Publicar

Sigue `docs/publicacion.md` §1 y §2:
1. Valida la candidata subiéndola como `ci/candidata` (dos pasadas de la CI).
2. Abre la PR de `skynet/integracion` a `main` y fusiónala con *Create a merge commit*.
3. Espera a que el despliegue esté *Ready* y ejecuta `BASE_URL=https://the-one-percent-kappa.vercel.app npm run smoke`. Se esperan 22 de 22.

Para revertir, `docs/publicacion.md` §3: *Instant Rollback* en Vercel. No hace falta tocar la base.

### C · Activar el push programado

1. **Vercel › Settings › Environment Variables**, con ámbito **Production**. Los valores están en el archivo `.env.push.local` de la carpeta del proyecto en Ubuntu (está ignorado por git y no se ha subido nunca):

   | Variable | De dónde sale |
   | --- | --- |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | `.env.push.local` |
   | `VAPID_PRIVATE_KEY` | `.env.push.local` (márcala como *Sensitive*) |
   | `VAPID_SUBJECT` | `mailto:` seguido de tu correo |
   | `PUSH_DISPATCH_SECRET` | `.env.push.local` (*Sensitive*) |
   | `SUPABASE_SECRET_KEY` | En el proyecto que use producción: Supabase › Project Settings › API Keys › *Secret keys*. Empieza por `sb_secret_` (*Sensitive*) |

   Ninguna de las secretas lleva el prefijo `NEXT_PUBLIC_`. Después, vuelve a desplegar producción (Deployments › el último › *Redeploy*).
   **Comprobación:** en Ajustes › Notificaciones, pulsa «Activar en este dispositivo» y después «Enviar prueba». Te tiene que llegar la notificación.
2. **Supabase › SQL Editor**, en el proyecto que use producción (el nuevo si hiciste A; si no, el actual):
   ```sql
   select vault.create_secret('https://the-one-percent-kappa.vercel.app/api/push/dispatch', 'push_dispatch_url');
   select vault.create_secret('<el PUSH_DISPATCH_SECRET de .env.push.local>', 'push_dispatch_secret');
   ```
   El trabajo de `pg_cron` ya lo crearon las migraciones. En cuanto existan estos dos secretos, empieza a llamar cada 5 minutos.
3. **Activa el push en cada dispositivo:** Ajustes › Notificaciones › «Activar en este dispositivo».
4. **Comprobación, a los 5 minutos:**
   ```sql
   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 3;
   select status_code, content from net._http_response order by created desc limit 3;
   ```
   - Lo normal es un `200` con recuentos (`people`, `reserved`, `sent`…), sin datos personales.
   - Un `401` significa que el secreto de Vault y el de Vercel no coinciden.
   - Un `503` significa que falta alguna variable en Vercel.
5. **Para apagarlo:** `select cron.unschedule('the-one-percent-push-dispatch');`, o borra el secreto de la URL: `delete from vault.secrets where name = 'push_dispatch_url';`.

Si quieres probarlo antes en un preview, tienes el procedimiento en `docs/publicacion.md` §5, punto 5.

## Órdenes atendidas

- **Misión Maestra (2026-11-09):** [hecha]. Es la versión candidata de las fases A–F (PR #1–#30).
- **Orden 2 (2026-11-11 09:27), cierre previo a publicación:** [hecha]. G1, E9a–E9c y G2 en la PR #35; G3 y G5 en la #40.
- **Orden 3 (2026-11-11 11:21), auditoría de secretos:** [hecha]. Veredicto: APTO PARA PÚBLICO (PR #37 y #38).
- **Orden 4 (2026-11-11 11:59), retomar la Orden 2:** [hecha]:
  - La CI de la #35 se relanzó con la base al día y pasó en verde a la primera, sin cambiar ninguna prueba. La #35 se fusionó.
  - La migración de E9 está en staging.
  - Lo que necesita a Dani está arriba, paso a paso (G4).

## Pendiente autorizable o bloqueado

- **F3 · Simulacro de respaldo y restauración (bloqueada):** necesita Docker y tu `BACKUP_PASSPHRASE`. Hazlo con `npm run backup -- --source cloud` y después `npm run restore:drill -- <copia>` (`docs/backup-strategy.md`).
- **Activar el push programado y separar la base:** los pasos C y A de arriba.
- **Probar en un iPhone real:** `docs/guia-dispositivo.md`.
- **IA generativa:** requiere un proveedor de pago, así que está apagada.
- **Barra de comentarios de Vercel en los previews:** si la desactivas, el humo de los previews pasa a 22 de 22.
- **Publicación en `main`:** el paso B.

## Decisiones más importantes (detalle en `DECISIONS.md`)

- **Diario de la cola en `localStorage`.** Es síncrono, con una clave por operación, y se escribe antes de pintar el cambio. Se descartó guardar la cola en otra base de IndexedDB y esperar a que terminara antes de pintar: IndexedDB es asíncrona y se rompería la respuesta de menos de 100 ms que pide el PRD.
- **El planificador es `pg_cron` + `pg_net`, con la URL y el secreto en Vault.** Sin ellos no llama a nada. Se descartó el Cron de Vercel: el que se ejecuta cada pocos minutos es de pago.
- **Cada aviso se reserva en la base antes de enviarse.** El tope y la separación se vuelven a comprobar con un bloqueo por persona. Una entrega que falla a mitad no se reintenta: vale más un aviso perdido que uno repetido.
- **El push no muestra nombres de hábitos en la pantalla de bloqueo**, solo cuántos quedan.
- **`db:fresh` se niega a instalar sobre una base con tablas o historial**, para que no pueda pisar staging ni una base en uso.
- **La #35 se puso al día fusionando la planificación de la Orden 4.** Así su CI probó exactamente lo que entró en la rama base.
