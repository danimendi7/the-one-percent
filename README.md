# THE ONE PERCENT

Sistema operativo personal de rendimiento (PWA privada, móvil primero): hábitos, analítica, objetivos, enfoque, conocimiento y reflexión.

> **Estado: M2 (Real Data Foundation), solo en local.** Cuenta privada con enlace mágico, hábitos persistidos en Postgres con RLS, sincronización entre dispositivos con cola offline. Biblioteca, Descubrir, Enfoque, etc. siguen con datos de ejemplo etiquetados (M3+). No hay proyecto cloud ni despliegue.

Especificación: [`docs/spec/`](docs/spec/README_START_HERE.md) · Arquitectura: [`docs/architecture.md`](docs/architecture.md) · Informe M2: [`docs/reports/m2.md`](docs/reports/m2.md)

## Modos de datos

| Modo | Cuándo | Dónde viven los datos |
| --- | --- | --- |
| **Cuenta** | Has entrado con tu email | Postgres (Supabase) + copia local en IndexedDB para uso offline |
| **Demo** | «Explorar la demo sin cuenta» en `/login`, o sin Supabase configurado | Solo en este navegador (`localStorage`), etiquetado «Demo» |

Los datos de la demo **nunca** se importan solos. Desde Ajustes puedes elegir qué hábitos pasar a tu cuenta; los registros generados por la demo se descartan siempre.

## Requisitos

- Node.js 24 y npm 11
- Docker Desktop (para Supabase local)

## Puesta en marcha

```bash
npm install
npm run db:start                  # Supabase local en puertos 553xx (primera vez: descarga imágenes)
npx supabase status               # copia API_URL y PUBLISHABLE_KEY a .env.local (ver .env.example)
npm run dev                       # http://localhost:3000
```

Para entrar: en `/login` usa `owner@theonepercent.local` (autorizado en `supabase/seed.sql`) y abre el correo en **Mailpit** (http://127.0.0.1:55324). Pulsa el enlace o escribe el código de 6 dígitos.

**Desde el móvil (misma wifi):** `npm run build && npm start -- -H 0.0.0.0` y abre `http://<IP-del-PC>:3000`. Entra con el **código** del correo (el enlace apunta a `localhost`). Permite el acceso del firewall de Windows en redes privadas si lo pide.

## Scripts

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo (accesible desde la red local) |
| `npm run build` / `npm start` | Build de producción y servidor |
| `npm run typecheck` · `npm run lint` | `next typegen` + `tsc` · ESLint |
| `npm run test` | Tests unitarios (dominio, sincronización, importación) |
| `npm run test:integration` | Tests contra el Postgres **local**: RLS, idempotencia, validaciones, conflictos |
| `npm run e2e` | Playwright contra build de producción (móvil 375 px y escritorio 1440 px), incluye axe, demo y cuenta |
| `npm run screenshots` | Regenera `docs/screenshots/` |
| `npm run check` | typecheck + lint + test |
| `npm run db:start` / `db:stop` / `db:reset` | Supabase local (`db:reset` borra los datos locales) |

## Estructura

```
docs/                    especificación, arquitectura, decisiones, seguridad, informes
e2e/                     Playwright (demo + cuenta)
tests/integration/       Vitest contra Supabase local
supabase/                config, migraciones, seed local y plantilla de correo
src/proxy.ts             sesión y acceso privado (Next 16 "proxy")
src/app/                 rutas; (app)/ comparte la navegación; login/ y auth/ fuera
src/features/habits/     dominio puro + store (fachada demo/cuenta) + UI
src/features/sync/       motor de sincronización, transporte Supabase, IndexedDB, importación
src/lib/supabase/        clientes de navegador y servidor
```

## Seguridad

- Solo se usan la URL y la clave **publicable** de Supabase; ninguna clave secreta en la app ni en el repo.
- RLS en todas las tablas privadas; escrituras validadas en la base de datos; allowlist de emails (sin registro público).
- Proyecto independiente: no reutiliza cuentas, proyectos ni credenciales de otros proyectos. Checklist: [`docs/security-checklist.md`](docs/security-checklist.md).
- Conexión futura a Supabase cloud: [`supabase/README.md`](supabase/README.md).
