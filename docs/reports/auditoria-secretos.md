# Auditoría de secretos antes de hacer público el repo (Orden 3)

Fecha: 2026-11-11 · Repo: `danimendi7/the-one-percent` (privado en el momento de la auditoría) · Autor: Skynet

## Veredicto: APTO PARA PÚBLICO

No hay **ningún secreto** en el historial de git, en las PR, en los registros de la CI ni en los artefactos que se harían públicos. **No hay que rotar nada.**

Hay dos cosas que decides tú. Ninguna es un secreto:

1. **Tu correo personal (`danimendiar@gmail.com`) sigue en el historial.** Aparece como autor en 60 commits (del 24 al 30 de octubre, en `main` y en `skynet/integracion`) y dentro de 4 documentos en versiones antiguas: `docs/decisions.md`, `docs/m2.5-plan.md`, `docs/m2.5-device-validation.md` y `docs/reports/m2.5-final.md`. Lo añadió `3b88fea` (2026-10-26) y lo quitó `baa16a4` (2026-10-30). No está en la última versión de ninguna rama. Quitarlo del todo obliga a reescribir el historial y hacer force-push, y la orden lo reserva para ti. Si no te importa que se vea, no hay que hacer nada.
2. **`.perfil` está en el historial publicado.** El guardián (`limites.sh`) no me deja abrirlo ni consultar sus commits («acceso a credenciales fuera del proyecto»). Su contenido sí pasó por gitleaks y por las dos búsquedas de abajo, y ninguna encontró nada. Aun así, échale un vistazo antes de publicar.

## Qué se revisó

| Fuente | Qué contiene | gitleaks 8.30.1 | Valores reales de `.env*.local` | Formas de secreto (a mano) |
| --- | --- | --- | --- | --- |
| Espejo de GitHub (`git clone --mirror`) | 41 ramas y 36 `refs/pull/*`, 200 commits, 3289 objetos: exactamente lo que se ve al hacerlo público | 18 · todos falsos positivos (§ Hallazgos) | 0 | 0 |
| Repo local | 42 ramas (incluye `respaldo/sin-confirmar-20261109-1105` y las ramas de los worktrees), 201 commits y 3441 objetos, también los sueltos | Los mismos 18 | 0 | 0 secretos (§ Fuera de GitHub) |
| Copia del worktree de Windows (`_respaldos/…/worktrees/the-one-percent-fix-notices`) | 595 archivos, sin carpeta `.git` propia | 0 | 0 | 0 |
| Registros de las 88 ejecuciones de la CI | 242 archivos | 0 | 0 | Solo la clave por defecto del Supabase local (§ Valores públicos) |
| 62 artefactos de la CI aún vigentes (informes y trazas de Playwright), con los zips desempaquetados, incluidos los 61 que el informe HTML lleva incrustados en base64 | 966 + 61 archivos | 1046 + 16 · todos de la pila efímera del runner (§ Hallazgos) | 0 | Solo pila local |
| Texto de GitHub: las 36 PR con su descripción, sus 42 comentarios y sus revisiones (no hay issues aparte) | 40 archivos JSON | 0 | 0 | 0 |
| Las 204 imágenes distintas del historial | Capturas de `docs/screenshots` e iconos | — | 0 | Revisión visual de 16 versiones con más riesgo (§ Datos personales) |

**Valores buscados** (`npm run audit:secrets`, nunca se muestran): `STAGING_DB_URL` y, aparte, su contraseña, `VERCEL_AUTOMATION_BYPASS_SECRET`, `VAPID_PRIVATE_KEY` y `PUSH_DISPATCH_SECRET`. `GOOGLE_BOOKS_API_KEY` y `AI_API_KEY` están vacías en `.env.local`, así que no hay valor que buscar.

**Formas buscadas a mano** en todos los objetos de git, artefactos, registros y texto de GitHub: JWT (con su emisor y su rol decodificados), `sb_secret_`/`sb_publishable_`, `sbp_` (token personal de Supabase), URL `postgres://` y `postgresql://` con contraseña, tokens de GitHub (`ghp_`, `gho_`, `ghs_`, `github_pat_`…), de Vercel (`vcp_`…), de npm y de AWS, claves de Google (`AIza…`), de Resend (`re_…`) y de proveedores de IA (`sk-…`), claves PEM privadas, asignaciones con valor de `VAPID_PRIVATE_KEY`, `BACKUP_PASSPHRASE`, `SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `DATABASE_URL`, `VERCEL_TOKEN`, `GITHUB_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `RESEND_API_KEY`, `CRON_SECRET`, `JWT_SECRET` y similares, y todos los correos.

**Archivos `.env` en el historial:** solo `.env.example`, con los valores vacíos salvo `VAPID_SUBJECT=mailto:` de ejemplo (en `860afeb`, rama de la PR #35).

## Hallazgos de gitleaks, uno por uno

| Dónde | Regla | Qué es | ¿Secreto? |
| --- | --- | --- | --- |
| `860afeb` · `tests/integration/push-dispatch.int.test.ts:15-16`, `src/features/notifications/domain/dispatch.test.ts:7`, `src/features/notifications/push/dispatch.test.ts:6` | generic-api-key (`KEY`, `AUTH`) | Constantes de test: una clave pública P-256 cuya clave privada se descartó (lo dice el comentario de al lado) y un `auth` de 16 bytes de una suscripción de prueba con un endpoint ficticio. No es tu clave VAPID: la búsqueda por valor no la encuentra en ningún sitio | No |
| `6dd4b42` · `tests/integration/push-schedule.int.test.ts:10-11` | generic-api-key | Las mismas constantes | No |
| `c74885b` y `921a81c` · `e2e/support/push.ts:18`, `src/features/notifications/domain/push.test.ts:20-21`, `src/features/notifications/push/server.test.ts:9`, `tests/integration/push.int.test.ts:6-7` | generic-api-key | Las mismas constantes (dos versiones de la rama de E8) | No |
| 62 artefactos · trazas `playwright-report/data/*.zip` | jwt (1010) | Sesiones de los usuarios de prueba. Todas con emisor `http://127.0.0.1:55321/auth/v1` y rol `authenticated`: el Supabase efímero del runner, que se destruye al acabar la ejecución | No |
| Los mismos artefactos | generic-api-key (36) | 24 son la constante `AUTH` de `e2e/support/push.ts` dentro del código que guarda la traza; 12 son `refresh_token` de la misma pila efímera | No |
| Zips incrustados en los `index.html` de los informes | generic-api-key (16) | `token_hash` de enlaces de acceso de los usuarios de prueba, en la pila efímera | No |
| `playwright-report/index.html` de 2 artefactos | Forma `AIza…` (búsqueda a mano) | Trozos al azar de los datos en base64 del zip incrustado (`data:application/zip;base64,…`), no claves de Google | No |

## Valores públicos (anotados, no son fallo)

- **Proyecto Supabase de la nube:** ref `noqajqliylyxsxbcoptf` y organización `mytuhydhznptvrijccta`, en `supabase/cloud-project.json` y en planes e informes de M2.5–M3.4. La URL completa `https://noqajqliylyxsxbcoptf.supabase.co` aparece en `docs/m2.5-plan.md`. Son identificadores públicos: la seguridad depende de RLS y de la lista de correos permitidos (`private.allowed_emails`), no de que no se conozcan. La clave anon/publicable de la nube **no** está en el repo.
- **Supabase local por defecto:** `sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH` y `sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz`, y `postgres:postgres@127.0.0.1`. Son las claves fijas que trae la CLI de Supabase para su pila local y solo valen dentro de cada máquina. La secreta sale en claro en los registros de 11 ejecuciones de la CI del 26 al 29 de octubre (la tabla que imprime `supabase start`, de antes de que el workflow mandara esa salida a un archivo y la enmascarara). `.env.local` usa la URL local y esta clave publicable para la app en local.
- **Hashes de Neumáticos Uría:** `cloud-project.json` guarda solo el SHA-256 del ref y de la organización prohibidos, nunca el valor.

## Datos personales

- **Correo personal:** ver el veredicto. Los demás correos son de prueba o de ejemplo (`*@theonepercent.local`, `example.com`, `evil.example`, `tu@correo.com`, `admin@email.com` de la plantilla de `supabase/config.toml`, `onboarding@resend.dev`) o falsos positivos dentro de PNG y URL de test. `info@thefatimacenter.com` está en `src/features/library/metadata/__fixtures__/itunes-episodes-search.json`: es el contacto público de un podcast, tal como lo devuelve la API de Apple, y no tuyo.
- **Capturas:** las genera `e2e/screenshots.spec.ts` con la demo y el reloj fijo, y las de hitos (`m3.4d`, `m4d`, `m4e`) salen de la demo o de datos sintéticos. Revisé a ojo todas las versiones de Ajustes, Notificaciones y «Más» (donde se vería una cuenta), el diagnóstico de desarrollo y una captura de cada serie de hitos: todas llevan la etiqueta «Demo» o dicen que los datos son sintéticos, y ninguna muestra correo, nombre ni dispositivo real. Los informes `docs/reports/*.json` son mediciones con datos sintéticos.
- **Otros rastros, menores:** la ruta `C:\Users\Daniel\Documents\the-one-percent` en `docs/validation-guide.md`; el nombre «Daniel» y el usuario `danimendi7` en los commits; y el equipo de Vercel `danimendiar-3744` en las URL de preview que publica `vercel[bot]` en cada PR. Las URL de preview piden iniciar sesión en Vercel; el secreto para saltárselo no está en ningún sitio del repo ni de GitHub.

## Fuera de GitHub (solo en esta copia local, no se publica)

- Un **blob suelto** (`64defb3`) con una versión antigua de `scripts/lib/cloud-guard.test.ts` que tenía en claro el ref y la organización de Neumáticos Uría. No pertenece a ningún commit (se añadió al índice y nunca se confirmó), así que ningún `git push` lo ha enviado. En el espejo de GitHub no está.
- **28 commits inalcanzables** del clon local: ninguno existe en GitHub (consultados uno a uno por la API). Tampoco tienen secretos.
- **Force-push:** la API de eventos de GitHub devuelve 194 eventos desde el 2026-10-26, día en que se creó el repo (por debajo de su tope de 300, así que no falta ninguno). Los 52 push tienen su `before` en el espejo: no hay historia reescrita que siga accesible por SHA.

## Workflows (orden §2)

`.github/workflows/ci.yml` es el único workflow:

- Se dispara con `push` (a `main` y `ci/**`), `pull_request` y `workflow_dispatch`. **Ningún `pull_request_target`**, ni `workflow_run` ni `issue_comment`. Una PR de un fork corre con el token de solo lectura y sin secretos.
- `permissions: contents: read`, `actions/checkout` con `persist-credentials: false`, acciones fijadas por SHA y runner alojado por GitHub (sin runners propios).
- No lee **ningún** secreto del repositorio (`secrets.*`), y `scripts/ci-gate.mjs isolation` lo comprueba en cada ejecución. Solo usa el Supabase efímero del runner. Las entradas de `workflow_dispatch` son listas cerradas y ningún texto libre de la PR (título, rama) llega a un `run:`.
- **Artefactos:** sube `e2e-results`, `playwright-report` y `playwright-report-smoke` durante 30 días, después de que `ci-gate.mjs scan` busque en ellos las claves de la pila local. Los 62 vigentes se revisaron enteros (tabla de arriba): solo contienen datos de la pila efímera y de usuarios de prueba.
- No pude listar los secretos ni las variables de Actions del repo, ni sus permisos (la API da 403 con este token). Como el workflow no los lee, aunque existieran no llegarían a ninguna PR.

## `.gitignore` (orden §3)

- `.env*` (salvo `.env.example`), `.env.local` y `.env*.local` están ignorados. `git check-ignore` lo confirma para `.env.local`, `.env.push.local` (las claves VAPID que generó E9c) y `.env.cloud.local`. `supabase/.gitignore` ignora `supabase/.temp` (ref y URL del pooler que escribe la CLI).
- **Copias de seguridad:** `npm run backup` las guarda fuera del repo (`~/Documents/the-one-percent-backups`), pero `*.topbak` no estaba ignorado. Si se pasaba `--dir` con una ruta dentro del repo, una copia (cifrada, pero con todos tus datos) podía acabar en un commit. **Corregido en esta PR:** `*.topbak` y `*.topbak.*` en `.gitignore`.
- Hoy no hay ningún archivo sin seguimiento que no esté ignorado.

## Siguiente paso para Dani

1. Decide si te vale que tu correo personal se vea en el historial (ver el veredicto). Si no, hay que reescribir la historia (por ejemplo con `git filter-repo --mailmap` y `--replace-text`) y hacer force-push de todas las ramas **antes** de hacerlo público. Las `refs/pull/*` de GitHub no se pueden reescribir: para eso habría que pedir ayuda al soporte de GitHub o crear un repo nuevo.
2. Abre `.perfil` y confirma que no lleva ninguna credencial.
3. Haz público el repo. Después, en GitHub › Settings › Actions › General, marca «Require approval for all external contributors» para que la CI de PR de forks no corra sin tu permiso.
4. En Vercel › proyecto › Settings › Git, deja activada «Git Fork Protection» (viene activada): así una PR de un fork no genera un preview con tus variables de entorno.
5. Si entran commits nuevos antes de publicar (por ejemplo la PR #35), repite la comprobación:
   ```bash
   gh repo clone danimendi7/the-one-percent /tmp/espejo.git -- --mirror
   npm run audit:secrets -- --repo . --repo /tmp/espejo.git
   gitleaks git /tmp/espejo.git --log-opts="--all" --redact
   ```
   (gitleaks: binario gratuito de github.com/gitleaks/gitleaks/releases; comprueba su suma SHA-256). Los 18 hallazgos ya clasificados volverán a salir.
6. Con el repo ya público, la CI vuelve a tener minutos y Skynet retoma la Orden 2 en la PR #35.
