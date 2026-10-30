# Validación previa al despliegue en GitHub Actions (D48)

Procedimiento estándar para validar cada fase (M3.3, M3.4, M4 y siguientes) antes de desplegarla. Sustituye a `npm run e2e:linux` como paso obligatorio: la suite completa necesita más RAM de la que queda libre en el PC con Docker/WSL y dos stacks de Supabase. `e2e:linux` sigue disponible como alternativa local (D46).

## Qué se ejecuta
Un solo workflow, `.github/workflows/ci.yml`, en un runner estándar `ubuntu-24.04` que se destruye al terminar:

1. `npm ci`, typecheck, lint y tests unitarios.
2. **Supabase local efímero** dentro del runner (`npx supabase start`, mismos puertos y migraciones que en local). Se crea vacío y desaparece con el runner.
3. **Control de aislamiento** (`node scripts/ci-gate.mjs isolation`). Detiene el job si:
   - hay credenciales de la nube en el entorno (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_URL`, `SUPABASE_DB_PASSWORD`, `BACKUP_PASSPHRASE`, `VERCEL_TOKEN`, `BASE_URL`);
   - alguna variable apunta a Supabase o Vercel;
   - hay un proyecto enlazado;
   - `.env.local` tiene algo más que la URL y la clave pública del stack local;
   - `supabase status` no es loopback;
   - algún workflow lee `secrets.*`.
4. Tests de integración (rechazan cualquier host que no sea loopback).
4b. **`npm run test:browser`** (M4f): pruebas del motor en Chromium real con IndexedDB real contra el stack local. El criterio exige **exactamente 6 superadas** (`ci-gate.mjs report e2e-results/browser.json --expect 6`).
5. **Suite E2E completa** (`--grep-invert @screens`, móvil y escritorio, build de producción). Incluye todas las specs, entre ellas check-ins, conflictos de reflexiones, offline, sincronización entre dispositivos, `upgrade.spec.ts` (copias de IndexedDB de versiones anteriores) y `screen-error.spec.ts` (D39).
6. **Criterio de aceptación** (`ci-gate.mjs report --all-specs`):
   - 0 fallidas;
   - **0 inestables**: Playwright reintenta una vez en CI para detectarlas, pero un test que pasa al reintentar suspende igualmente;
   - 0 interrumpidas;
   - 0 errores globales;
   - cada `e2e/*.spec.ts` con al menos una prueba superada, para detectar una spec que deje de ejecutarse;
   - **recuento exacto (M4f)**: antes de la suite se guarda el listado (`playwright test --list`); cada prueba listada debe ejecutarse en cada pasada, y las omitidas deben ser exactamente `E2E_SKIPS_PER_PASS` (27) por pasada: los casos de dos navegadores que solo corren en escritorio. Una prueba que desaparece o que empieza a omitirse suspende. Cambiar esas omisiones obliga a cambiar el número a propósito en `ci.yml`.
7. Smoke contra la build local, con el mismo criterio. `BASE_URL` está prohibida: nunca sale a producción.
8. **Revisión de secretos** de los informes: borra cualquier fichero que contenga una clave del stack local. Después sube los informes como artefacto `e2e-<run>-<intento>`, conservado 30 días:
   - `e2e-results/e2e.json`, `e2e-list.json`, `browser.json` y `smoke.json`;
   - `playwright-report/` y `playwright-report-smoke/`, con trazas de los fallos.

El resumen con los números aparece en la página del job (*Summary*).

## Cuándo se ejecuta y cuántas pasadas

| Disparador | Para qué | Pasadas E2E |
| --- | --- | --- |
| push a `main` | Comprobación tras cada despliegue (Vercel publica en paralelo) | 1 |
| pull request | Revisión | 1 |
| push a una rama `ci/**` | **Validación previa al despliegue de una fase** | 2 (`--repeat-each 2`) |
| `workflow_dispatch` (botón *Run workflow*) | La misma validación a demanda, en cualquier rama | 2 por defecto (1–3) |

Dos pasadas en el mismo job equivalen al criterio «dos ejecuciones completas consecutivas sin fallos» de M3.2d/M3.3d, con una sola preparación del entorno.

`workflow_dispatch` solo aparece en GitHub cuando el workflow ya está en `main`. Hasta que M3.3 se despliegue, la validación se lanza con la rama `ci/<fase>`.

## Vercel: las ramas `ci/**` no despliegan
`vercel.json` incluye `"git": { "deploymentEnabled": { "ci/**": false } }`:
- Vercel documenta este campo con patrones minimatch (*Git Configuration › git.deploymentEnabled*). Para una rama que no coincide con ningún patrón, el valor por defecto es `true`.
- Comprobado con minimatch: `ci/**` coincide con `ci/m3.3` y `ci/m3.4/x`, y no con `main`, `ci` ni `feature/ci/x`.
- Vercel lee `vercel.json` del commit que se sube, así que la rama de validación debe contener ya este cambio (desde D48, todas lo contienen).
- `main` sigue desplegando producción como siempre.
- Comprobación tras el primer push: la lista *Deployments* de Vercel no debe mostrar ningún despliegue de `ci/…`. Si apareciera uno, se borra la rama remota y se revisa la configuración antes de seguir.

## Costes y límites
- Solo runners estándar, que entran en los minutos incluidos del plan. Linux cuenta 1×. Con Free son 2.000 minutos al mes en repos privados y con Pro 3.000.
- No se usan runners grandes (de pago) ni almacenamiento extra. Los artefactos ocupan pocos MB, con un límite de 500 MB en Free.
- Duración estimada:
  - validación previa (2 pasadas): unos 45–60 min;
  - push a `main`: unos 30 min.
  - El límite del job es de 90 min.
- **Antes de la primera ejecución**, comprobar en GitHub → *Settings → Billing and plans*:
  - el plan y los minutos de Actions que quedan este mes;
  - que el presupuesto o límite de gasto de Actions es **0 $**. Así, si se agotan los minutos, los jobs se bloquean en lugar de cobrarse.
- `concurrency` cancela la ejecución anterior de la misma rama al subir otra.

## Procedimiento para cada fase
1. En local:
   - terminar la fase;
   - `npm run check`;
   - commits locales.
2. Autorización del propietario para **subir solo la rama de validación**:
   ```
   git push origin <commit>:refs/heads/ci/<fase>
   ```
   Por ejemplo `ci/m3.4`. No toca `main`, Vercel ni la nube.
3. GitHub → *Actions* → *CI* → la ejecución de `ci/<fase>`. Esperar el resultado.
4. Si está en verde:
   - anotar en el informe de la fase el run, el commit y los números del *Summary*;
   - pasar al plan de despliegue de la fase.
5. Si está en rojo:
   - descargar el artefacto y diagnosticar;
   - no relanzar sin autorización (*Re-run* también consume minutos).
6. Tras desplegar (push a `main` del mismo commit), borrar la rama remota:
   ```
   git push origin --delete ci/<fase>
   ```
7. Desde que este workflow esté en `main`, la alternativa es *Actions → CI → Run workflow*, elegir la rama y las pasadas.

## Seguridad del workflow
- `permissions: contents: read`; `checkout` con `persist-credentials: false`, para que el token no quede en `.git/config`.
- Ningún `secrets.*`. Las entradas de `workflow_dispatch` son listas cerradas (`choice`) y llegan al shell como variables de entorno, nunca interpoladas en el script.
- Acciones oficiales de GitHub fijadas por **SHA de commit**, con la versión en un comentario (D53): `checkout` v7.0.1, `setup-node` v7.1.0, `cache` v6.1.0 y `upload-artifact` v7.0.2, todas con Node 24. Para actualizarlas, se revisan sus notas de versión y se resuelve el commit de la etiqueta con `git ls-remote`.
- La salida de `supabase start`, que lista las claves por defecto del stack local, va a un fichero que no se publica. Si falla, se muestra una cola redactada, y `SECRET_KEY`, `SERVICE_ROLE_KEY`, `JWT_SECRET` y `ANON_KEY` se enmascaran con `::add-mask::` para el resto del job. Tras cada validación se descarga el log y se comprueba que no contiene la clave.
- El runner no tiene acceso a Supabase Cloud, Vercel ni a ningún recurso de Neumáticos Uría: no hay credenciales que lo permitan, y el control de aislamiento lo comprueba en cada ejecución.
