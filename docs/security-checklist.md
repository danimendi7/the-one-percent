# Checklist de seguridad

Estado al cierre de M1. ✅ hecho · ⏳ fase indicada · n/a no aplica todavía.

## Repositorio y secretos
- ✅ `.env*` ignorado por git; solo se versiona `.env.example`, sin valores.
- ✅ Ningún secreto, token ni clave en el código. M1 no necesita variables de entorno.
- ✅ Sin conexiones a Supabase, Vercel ni GitHub. La CLI de Supabase no tiene sesión ni proyecto enlazado (`supabase/.temp` está ignorado).
- ✅ Separación de otros proyectos: no se ha leído ni reutilizado ninguna configuración global ni credencial existente.
- ⏳ M2: cuentas y proyectos nuevos y dedicados; claves de servicio solo en el servidor, nunca con prefijo `NEXT_PUBLIC_`.

## Aplicación
- ✅ `robots: noindex` (app privada).
- ✅ Sin `dangerouslySetInnerHTML` ni HTML de usuario renderizado; React escapa todo el texto.
- ✅ El estado persistido se valida con Zod; los datos corruptos se descartan.
- ✅ El permiso de notificaciones nunca se solicita en M1; solo se lee su estado.
- ✅ Ninguna llamada a APIs externas en tiempo de ejecución (las fuentes se sirven desde el propio dominio vía `next/font`).
- ⏳ M2: Supabase Auth con cookies seguras, RLS en cada tabla privada, tests de acceso cruzado, protección CSRF en server actions, cabeceras CSP y de seguridad.
- ⏳ M4: APIs de libros e IA solo desde el servidor, con límites, caché y validación de respuestas.
- ⏳ M5: suscripciones push cifradas en reposo; nada sensible en la pantalla de bloqueo.
- ⏳ M6: auditoría de mutaciones, exportación/restauración probada, plan de rollback.

## Dependencias
- ✅ `npm audit`: 0 vulnerabilidades al instalar.
- ⏳ Dependabot/Renovate cuando exista el repositorio remoto.
