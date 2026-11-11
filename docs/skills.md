# Skills que usa Skynet

Actualizado el 2026-11-11, al empezar la Orden 4 (retomar la Orden 2 con la CI de vuelta).

## En uso

| Skill | Para qué |
| --- | --- |
| superpowers:test-driven-development | Cola duradera (G1) y plan de envío push (E9b): la prueba que falla va antes del código |
| superpowers:systematic-debugging | Fallos de CI o de E2E antes de tocar nada |
| superpowers:verification-before-completion | No dar una tarea por hecha sin `npm run verify`, la CI y el preview |
| engineering:code-review y security-review | Repaso de la ruta de envío programado, que usa la clave de servicio |
| engineering:documentation | `docs/publicacion.md` y DONE.md |
| security-review | Orden 3: criterio para clasificar los hallazgos de gitleaks y revisar los workflows de cara a un repo público |
| engineering:code-review | Orden 3: repaso independiente del script `audit:secrets`, que lee los secretos de `.env*.local` |
| superpowers:systematic-debugging | Orden 4: si la primera CI de la PR #35 falla (la E2E de G1 y las integraciones de E9 y G2 nunca han corrido allí), causa antes que arreglo |
| engineering:deploy-checklist y engineering:documentation | Orden 4: pasos para Dani en DONE.md (variables de Vercel, Vault, base de producción), con la comprobación de cada paso |

## Echo en falta

| Qué | Fuente fiable | Qué aportaría | Riesgo |
| --- | --- | --- | --- |
| Un escáner de secretos instalado (gitleaks o trufflehog como herramienta de la cuenta) | Releases oficiales de gitleaks/gitleaks en GitHub (MIT, con sumas SHA-256) | Que la auditoría no dependa de descargar un binario en `/tmp` en cada sesión | Bajo: binario verificado, solo lectura del repo |
| Skills de agente de Supabase (`supabase/agent-skills`) | Repositorio oficial de Supabase en GitHub | Pautas al día de RLS, `pg_cron`, `pg_net` y Vault | Bajo: son instrucciones. La decisión de añadirlas es de Dani |
