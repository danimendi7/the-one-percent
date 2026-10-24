# Checklist de seguridad

Estado al cierre de M2 (solo local). ✅ hecho · ⏳ fase indicada.

## Repositorio y secretos
- ✅ `.env*` ignorado por git; solo se versiona `.env.example`, sin valores.
- ✅ La app solo usa la URL y la clave **publicable** de Supabase. Ninguna clave secreta ni de servicio en el código ni en el bundle.
- ✅ Los tests de integración leen las claves locales con `supabase status` en tiempo de ejecución y se niegan a ejecutarse contra hosts no locales.
- ✅ Sin proyectos cloud. La CLI de Supabase no tiene proyecto enlazado (`linked_project: null`). No se ha usado ni modificado la sesión previa de la CLI de otro proyecto.
- ✅ Stack local aislado (`project_id = the-one-percent`, puertos 553xx). Los contenedores de otros proyectos no se han tocado.

## Autenticación y acceso
- ✅ Enlace mágico con token hash más código de 6 dígitos. Sin contraseñas en la UI.
- ✅ Allowlist privada: un trigger en `auth.users` rechaza emails no autorizados. La UI no revela si un email lo está.
- ✅ `proxy.ts` valida la sesión con el servidor de Auth (`getUser`), no solo la cookie.
- ✅ La demo sin cuenta requiere una elección explícita y no accede a ningún dato del servidor.
- ⏳ Cloud: SMTP propio, límites de envío, Site URL y Redirect URLs exactas (ver `supabase/README.md`).

## Base de datos
- ✅ RLS activa en las 8 tablas de `public`, con políticas `to authenticated` por `auth.uid()`. El rol `anon` no tiene permisos.
- ✅ Esquema `private` sin exponer por la API; la allowlist es inaccesible para los usuarios.
- ✅ Funciones con `search_path = ''`; las RPC usan SECURITY INVOKER. Solo `user_today()` y los triggers de alta usan SECURITY DEFINER, con alcance mínimo.
- ✅ Las claves compuestas `(habit_id, user_id)` impiden vincular filas de otro usuario.
- ✅ `sync_operations` y `audit_logs` son de solo inserción para el usuario; los registros retroactivos se auditan.
- ✅ Tests automáticos de acceso cruzado: lectura, escritura, actualización, vinculación por FK, RPC y anónimo (criterio de aceptación 9).
- ✅ `supabase db lint`: sin errores.
- ⏳ M6: copias y restauración probadas en staging; Advisors de seguridad del proyecto cloud.

## Cliente
- ✅ Sin `dangerouslySetInnerHTML`; React escapa todo el texto.
- ✅ Estado de la demo validado con Zod. La caché de sincronización está en IndexedDB por usuario.
- ⚠️ Tras cerrar sesión, la copia local en IndexedDB (sin cifrar) permanece en el dispositivo para conservar los cambios no enviados. En dispositivos compartidos conviene una opción de «borrar copia local»: anotada para M3.
- ⏳ Cabeceras CSP y de seguridad con el despliegue (M6).

## Dependencias
- ✅ `npm audit`: 0 vulnerabilidades.
