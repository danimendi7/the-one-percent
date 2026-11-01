# Hotfix M4-H1 · Altas sin conexión que se perdían (01/11/2026)

Corrección independiente de M4g, hecha sobre el commit de producción `f66b3b9` en la rama `hotfix/m4-offline-save` (D105). Solo en local: sin push, sin CI remota, sin cambios en Supabase Cloud ni en Vercel.

## 1. Defecto
La CI de M4g.4 (run 41296762714) lo encontró, y existe en producción desde M4:
1. Creas sin conexión un libro, un episodio o un programa con el formulario.
2. La app abre su ficha justo después (`router.push`).
3. Sin red, Next no puede pedir la página y hace una **recarga completa**; el service worker sirve la aplicación instalada.
4. La copia del dispositivo se escribía en segundo plano (`void this.persist()` en `engine.submit`). Si la recarga llegaba antes de que terminase la transacción de IndexedDB, la escritura moría con la página.
5. Resultado: la ficha decía «No está en este dispositivo» y el alta no llegaba nunca a Supabase.

**Causa raíz exacta.** La interfaz daba el alta por guardada en cuanto la acción devolvía `ok` (estado optimista en memoria). La durabilidad, en cambio, solo llega cuando `idb-keyval` resuelve `set()`, con la transacción `complete`. Entre ambos momentos no había ninguna espera, y `onDone` navegaba en el mismo tick.

**Alcance.**
- **Afectados:** el formulario manual de libros, el de episodios y el de programas, cuando abren la ficha de algo nuevo.
- **No afectados:**
  - las ediciones y las notas, porque no navegan;
  - la línea de estado, que sí decía «Guardado en este dispositivo» unos milisegundos antes de tiempo (corregido también).

## 2. Contrato nuevo
> Una escritura solo se considera **guardada en este dispositivo** cuando la transacción de IndexedDB que guarda la cola (la información necesaria para sincronizarla) ha terminado bien.

- **`SyncEngine.whenSaved(): Promise<boolean>`** espera a la última escritura de la copia del dispositivo y a cualquiera que empiece mientras tanto.
  - Devuelve `true` cuando esa escritura completó.
  - Devuelve `false` si el almacenamiento la rechazó; en ese caso, cada nueva llamada vuelve a intentar la escritura una vez.
  - Cada escritura guarda la cola **entera** bajo el mismo Web Lock, así que «guardado» cubre todo lo encolado hasta ese momento, en su orden: un programa siempre antes que su episodio.
- **`LibraryActions.saved()`:**
  - en una cuenta, es `engine.whenSaved()`;
  - en la demo, devuelve el resultado real de su escritura síncrona en `localStorage`.
- **`librarySyncStateOf` devuelve `saving`** («Guardando en este dispositivo…») mientras una escritura de ese elemento todavía no está en la copia. Nunca dice «guardado» antes de tiempo.

## 3. Comportamiento del formulario
- **Al pulsar «Añadir»:**
  - el alta se aplica en memoria y se encola una sola vez, igual que antes;
  - el botón pasa a «Guardando en este dispositivo…», desactivado y con `aria-busy`;
  - los campos quedan bloqueados con lo escrito visible.
- **A los 3 s sin terminar**, aparece el aviso «Está tardando más de lo normal. Seguimos esperando a que quede guardado: no cierres ni recargues la app.» El formulario **sigue esperando**: nunca declara guardado algo que no lo está.
- **Si se guarda bien**, el formulario se cierra y se abre la ficha. Desde ese momento, navegar, recargar o cerrar la app ya no puede perder el alta.
- **Si el almacenamiento rechaza la escritura** (por ejemplo, por cuota llena):
  - no navega;
  - mantiene los datos;
  - muestra «No se ha podido guardar en este dispositivo (puede que falte espacio). Lo escrito sigue aquí: no cierres ni recargues la app y pulsa «Reintentar».»;
  - **«Reintentar» solo vuelve a escribir la copia**, nunca crea un segundo elemento;
  - no dice nada sobre el servidor: si hay red, la cola puede enviarlo igualmente.
- **Doble toque:** el segundo toque no hace nada, porque ya hay una escritura en curso.
- **Formulario cerrado durante la espera** (aviso de descartar): no se navega. El elemento ya creado sigue en memoria y su escritura continúa.

No hay motor nuevo ni cola nueva. Tampoco cambian la semántica de sincronización ni el protocolo con el servidor: no se borra ninguna operación pendiente, no hay migraciones ni dependencias nuevas, y el service worker no se toca.

## 4. Pruebas
### Regresión E2E `e2e/offline-save.spec.ts`
Se ejecuta con cuenta y service worker, en móvil y escritorio.

| Prueba | Qué fija |
|---|---|
| Libro con barrera | **Barrera determinista**: la prueba retiene el Web Lock `the-one-percent:sync:<usuario>`, bajo el que el motor escribe la copia.<br>Mientras está retenido:<br>• botón «Guardando…» y desactivado;<br>• aviso de lentitud a los 3 s;<br>• sigue en la lista, con el título conservado;<br>• cola guardada vacía.<br>Al soltarlo:<br>• se abre la ficha;<br>• la cola de IndexedDB tiene exactamente `library.item.create`;<br>• tras recargar sin red sigue ahí, y el servidor no tiene nada.<br>Con red: «Sincronizado», 1 fila y 1 operación. El doble toque crea uno solo |
| Programa → episodio → nota con CPU ×6 | La carrera real, sin barrera:<br>• cada ficha se abre con su contenido guardado;<br>• la cola guardada queda `show.create`, `item.create`, `note.create`, en ese orden;<br>• recarga sin red;<br>• con red, el episodio queda en su programa y la nota en el episodio, con 1 operación de cada tipo |
| Almacenamiento lleno | `IDBObjectStore.put` lanza `QuotaExceededError`:<br>• aparece el error, no se navega, se conservan los datos y la cola sigue vacía;<br>• un segundo «Reintentar» que también falla no cambia nada.<br>Con el almacenamiento restaurado:<br>• se abre la ficha y la cola tiene una sola alta;<br>• recarga, y con red 1 fila y 1 operación |

**Sin conexión, por partida doble.** `context.setOffline` sola dejaba escapar, durante la recarga completa, la primera petición del documento nuevo a Supabase, y Playwright ni siquiera la registraba.
- Se vio en 3 de 6 repeticiones: el servidor tenía la operación (hora del servidor 12:45:50.482) sin ninguna `apply_ops` visible.
- La prueba aborta además todo lo que va al puerto de Supabase local. Con eso, 10 de 10 en el diagnóstico y 30 de 30 en la repetición final.
- Un dispositivo realmente sin red no tiene ese hueco. No es un defecto de la app.

**Unitarias** (`library-engine.test.ts`, «M4-H1»):
- `whenSaved` espera a la escritura en curso y el elemento dice `saving` hasta que termina;
- un rechazo devuelve `false` y el estado `error`, y el reintento guarda el alta una sola vez;
- un programa y su episodio quedan guardados en orden y llegan una vez.

### Antes y después
| Código | `offline-save.spec.ts` |
|---|---|
| `f66b3b9` (producción, sin corregir), primera versión de la prueba | **6/6 fallidas**; los dos escenarios de carrera acaban en «No está en este dispositivo» |
| `f66b3b9`, versión final de la prueba (worktree temporal) | **6/6 fallidas**; los 6 contextos de error muestran «No está en este dispositivo» |
| Hotfix | 6/6 en la primera ejecución.<br>×3 con solo `setOffline`: 12/18; los 6 fallos son la fuga descrita arriba, con el alta en el servidor antes de tiempo, nunca perdida.<br>Con el corte doble, ×5: **30/30** |

### Validación local del hotfix (Windows, un worker, Supabase local)
| Suite | Resultado |
|---|---|
| `npm run check` (tipos, lint y unitarias) | 518/518 |
| Integración (`test:integration`) | 145/145 |
| `test:browser` | 6/6 |
| E2E dirigidas (biblioteca, conocimiento, offline con SW, a11y, navegación, actualización) | 158 superadas y 8 omitidas previstas |
| **E2E completa** (`--grep-invert @screens`, una pasada, `--workers=1`) | **321 superadas, 27 omitidas (contrato D87), 0 fallidas** |
| Build de producción | Correcto |
| Smoke local | 22/22 |

La E2E completa, una pasada, cabe en Windows con un solo worker (13,7 min). La CI de Linux hace las dos pasadas del contrato.

## 5. Riesgos residuales
1. **Recarga manual durante la espera.** Si el usuario recarga o cierra la app en los milisegundos que tarda la escritura, la escritura puede perderse. El aviso lo pide, pero no hay `beforeunload`.
2. **Ediciones fundidas en un alta aún no enviada.** Conservan el `op_id`: durante unos milisegundos, la línea puede decir «guardado» con el texto anterior en la copia. Las altas, que eran el defecto, siempre llevan un `op_id` nuevo.
3. **Borrar y volver** (fichas de libro, episodio y programa) navega sin esperar. Sin red, un borrado podría no quedar guardado y el elemento reaparecería. No se pierde nada, pero se pierde la intención del usuario. Propuesta: aplicar `saved()` también ahí en M4g.5.
4. **Durabilidad de IndexedDB.** Chromium usa durabilidad «relaxed»: protege frente a recargas y cierres de la app, pero no frente a un corte de energía del sistema justo después de la escritura.
5. **Validación pendiente:**
   - la CI de Linux (dos pasadas) está sin ejecutar;
   - no se ha probado en un iPhone real.

## 6. Validación remota propuesta (requiere autorización)
1. Publicar `hotfix/m4-offline-save` como rama **`ci/m4-h1`**, por avance directo y sin force push. `ci/**` no despliega en Vercel.
2. GitHub Actions con el contrato D48/D87:
   - unitarias e integración;
   - `test:browser` 6/6;
   - E2E en dos pasadas con recuento exacto: 27 omitidas por pasada y las 6 nuevas incluidas;
   - smoke.
3. Si la CI está en verde:
   - copia de seguridad verificada (`npm run backup` y `backup:verify`; no hay migración);
   - `main` por avance directo a ese commit;
   - Vercel despliega;
   - CI de `main`;
   - smoke en producción (`BASE_URL`);
   - comprobar `top-version`.
4. **Vuelta atrás:** `git revert` del commit en `main`. No hay datos ni esquema que deshacer.

## 7. Traslado a M4g
M4g toca otros sitios que también navegan tras un alta: el asistente de libros, el de podcasts y «Seguir el programa».
1. Cuando `main` tenga el hotfix, hacer `cherry-pick` del commit sobre `ci/m4g`, en una rama de trabajo propia.
   - Conflictos previstos: `docs/decisions.md` (las dos ramas añaden al final) y posiblemente `content-form.tsx`, si M4g lo cambió.
   - Ninguno en el motor.
2. Adaptación controlada: `AddBookSheet`, `AddPodcastSheet` y «Seguir el programa» esperan `libraryActions.saved()` antes de navegar, con los mismos estados (guardando, lento, fallo y reintento sin segunda alta).
3. Ampliar `offline-save.spec.ts` con el asistente de podcasts. La prueba de M4g.4 `add-podcast.spec.ts:305` pasa a ser su regresión natural.
4. Nueva CI de `ci/m4g` antes de cualquier publicación conjunta.
