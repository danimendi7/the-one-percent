# M4 Knowledge OS: informe de despliegue

**Desplegado en producción el 31/10/2026: commit `f66b3b9` en `main`, con «Vercel: success».**

Incluye M4a–M4f:
- la Biblioteca (libros, podcasts, fichas y notas);
- Cerebro, con búsqueda sin red, filtros y conexiones;
- la sincronización por filas de la Biblioteca;
- un service worker propio para arrancar sin red;
- la corrección del arranque del motor (D89).

## Registro
| Paso | Resultado |
|---|---|
| CI previa (`ci/m4`), run [41212978680](https://github.com/danimendi7/the-one-percent/actions/runs/41212978680) sobre `f66b3b9` | Unitarias 515/515, integración 145/145, `test:browser` 6/6, E2E con 2 pasadas: 630 superadas, 54 omitidas previstas, 0 fallidas, 0 inestables, 0 interrumpidas, 0 reintentos, 20/20 specs. Smoke 22/22 |
| Copia cifrada de la nube | `top-cloud-2026-10-31T15-47-17-491Z.topbak`: 18 tablas y 186 filas. `backup:verify` correcto: la frase la abre y el origen es `noqajqliylyxsxbcoptf` |
| Restauración aislada (`--schema-at 20261031090000`) | Las 18 tablas idénticas a la copia; registrada en el libro de copias; simulacro eliminado |
| Ensayo de la migración, en otro stack aislado con la misma copia | 16/16 comprobaciones (detalle abajo) |
| Revisión previa (`push-dry`) | Exactamente una migración: `20261101090000_library.sql` |
| Migración en la nube | Aplicada solo `20261101090000_library.sql`, tras pasar la protección de copia verificada. La nube tiene **11 migraciones** |
| Verificación posterior, en solo lectura | 27/27 comprobaciones (detalle abajo) |
| Avisos de Supabase | Seguridad: solo el aviso que ya existía (`auth_leaked_password_protection`). Rendimiento, nuevos y de nivel INFO: 4 claves foráneas sin índice propio (`knowledge_notes` ×3, `library_items` ×1) e índices sin usar en las tablas nuevas, que están vacías |
| Código | `git push origin f66b3b9:refs/heads/main`: `85fd1a0..f66b3b9`, avance directo |
| Vercel | «Deployment has completed»: success. Producción sirve `top-version` = `f66b3b931aac` y `/sw.js` con `no-cache` |
| CI de `main`, run [41217079580](https://github.com/danimendi7/the-one-percent/actions/runs/41217079580) | Unitarias 515/515, integración 145/145, `test:browser` 6/6, E2E (1 pasada) 315 superadas y 27 omitidas previstas, 0 fallidas, 0 inestables, 0 reintentos; 342 listadas y ejecutadas; 20/20 specs. Smoke 22/22. Artefacto sin secretos ni correos |
| Smoke contra producción | **22/22**. Solo lectura y solo demo, sin cuenta |
| Comprobación de la Biblioteca en producción (demo, navegador limpio, móvil y escritorio) | 20/20 (detalle abajo) |

**Ensayo de la migración, sobre la copia restaurada:**
- Los datos anteriores quedan intactos: filas y sumas de las 18 tablas.
- Solo cambian `apply_ops` y `pull_changes`; hay 22 funciones nuevas y ninguna eliminada.
- Las 4 tablas nuevas:
  - tienen RLS y 3 políticas cada una;
  - `anon` no tiene acceso y `authenticated` no puede borrar ni vaciar;
  - empiezan vacías;
  - tienen índices y *trigger*;
  - están en realtime.
- `pull_library` solo se puede ejecutar como `authenticated`.
- Un cliente M3.4:
  - recibe de `pull_changes` lo mismo que antes, tanto con la copia restaurada (solo lectura) como con una cuenta sintética; la única novedad es la clave `library.head`, que ese cliente ignora;
  - recibe de `apply_ops` una respuesta con la misma forma;
  - si reenvía, obtiene `duplicate` sin duplicar nada.

**Verificación posterior en la nube:**
- 11 migraciones.
- Las 16 tablas anteriores conservan sus filas.
- Las 4 tablas nuevas tienen RLS y 3 políticas, sin `anon` ni borrado, y 0 filas.
- Realtime tiene 13 tablas.
- Permisos de los RPC correctos.
- `apply_ops`, `pull_changes` y `pull_library` son iguales al fichero de la migración.

**Biblioteca en producción**, en móvil y en escritorio:
- se abren Biblioteca, Libros → ficha, Podcasts y Cerebro;
- el service worker está activo con `?v=f66b3b931aac` y prepara una carcasa de 19 páginas;
- la caché no guarda datos, sesión, RSC ni Supabase;
- funcionan el arranque y la navegación sin red;
- no hay errores de consola.

**No se ha tocado:** tu cuenta (ninguna prueba automática la usa), los contenedores de Neumáticos Uría, `ci/m4` (sigue en `f66b3b9`, pendiente de que autorices borrarla), artefactos antiguos ni historial.

## Riesgos pendientes
1. **Las pruebas manuales en tus dispositivos** (abajo) y el diagnóstico del iPhone (plan §21.3) no se han hecho. Solo los puedes hacer tú.
2. **Primera visita sin red:** un dispositivo cuyo service worker aún no está activo, y que pierde la red antes de terminar las precargas, no puede abrir páginas que nunca recibió. En ese caso la app muestra «Sin conexión».
3. **Avisos de rendimiento de nivel INFO** en las tablas nuevas. No afectan con el volumen de una persona; se revisarán si crecen los datos.
4. **El aviso de seguridad `auth_leaked_password_protection`**, ya existente. La app no usa contraseñas (solo enlace mágico).
5. **`newAccount`:** el retraso aislado del contenedor local no ha vuelto a aparecer en la CI, y su causa sigue sin demostrar. La instrumentación sigue activa.
6. **Pendientes de tu decisión:**
   - borrar `ci/m4`;
   - borrar el artefacto antiguo 12963160670, que contiene tu correo;
   - publicar los commits de documentación locales.

## Vuelta atrás, si hiciera falta
- **Código:** `git revert` del despliegue en `main`, como commit nuevo y con tu autorización. La migración es aditiva, así que el código anterior (`85fd1a0`) funciona con ella. **No se toca la base.**
- **Base de datos:** no hay restauración automática. La copia `top-cloud-2026-10-31T15-47-17-491Z.topbak` está verificada, y cualquier restauración necesitaría un plan escrito y tu decisión.

## Prueba manual (tu cuenta, móvil y ordenador)
Antes de empezar, abre la app **con conexión** en los dos dispositivos y recárgala una vez: así se activa la versión nueva y se prepara el arranque sin red. Usa títulos de prueba que puedas borrar después.

1. **Alta de un libro** (ordenador): Biblioteca → Libros → «Añadir libro», solo con el título «Prueba M4». Se abre su ficha y, a los pocos segundos, el estado dice «Sincronizado».
2. **Alta de un episodio** (móvil): Biblioteca → Podcasts → nuevo episodio con un programa nuevo. Aparece en Podcasts y el programa tiene su página.
3. **Ideas principales** (ordenador): en la ficha de «Prueba M4», captura dos ideas y marca una como destacada. Se guardan solas mientras escribes; no hay botón de guardar.
4. **Sincronización** (móvil): sin recargar, «Prueba M4» y sus dos ideas aparecen en unos segundos.
5. **Edición desde el segundo dispositivo** (móvil): edita una de las ideas. En el ordenador cambia sola. Si editas la misma idea a la vez en los dos, la app te ofrece elegir o «Guardar las dos», sin perder ninguna.
6. **Búsqueda en Cerebro** (cualquiera): busca una palabra de tus ideas. Aparecen resaltadas, con el libro de origen.
7. **Filtros y conexiones** (ordenador):
   - en Cerebro, filtra por tipo o por destacadas y recarga: el filtro se mantiene, porque está en la dirección;
   - conecta una idea con el episodio del paso 2 y mueve otra idea a otro libro;
   - en el móvil, las dos cosas se reflejan.
8. **Guardado sin red** (móvil): activa el modo avión, abre la ficha de «Prueba M4» y captura una idea. La app dice que está guardada en el dispositivo y que se enviará al recuperar la conexión.
9. **Reconexión** (móvil): quita el modo avión. El estado pasa a «Sincronizado» y la idea aparece en el ordenador una sola vez.
10. **Arranque sin red de la app instalada** (móvil):
    - cierra la app por completo, activa el modo avión y ábrela desde el icono;
    - debe arrancar y mostrar tu Biblioteca y Cerebro desde el dispositivo, y la búsqueda debe funcionar;
    - al volver la conexión, todo sigue igual.

Si algo no coincide, anota el paso, el dispositivo y lo que viste, sin datos personales en capturas. Lo investigo antes de tocar nada.
