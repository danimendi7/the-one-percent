# THE ONE PERCENT

Sistema operativo personal de rendimiento (PWA privada, móvil primero): hábitos, analítica, objetivos, enfoque, conocimiento y reflexión.

> **Estado: M1 (prototipo visual).** Funciona sin conexión y sin cuentas. Todos los datos son **de demostración** y se guardan solo en el navegador (`localStorage`). No hay backend, sincronización, push ni IA todavía.

La especificación funcional y técnica está en [`docs/spec/`](docs/spec/README_START_HERE.md).

## Requisitos

- Node.js 24 y npm 11
- Docker (solo a partir de M2, para Supabase local)

## Puesta en marcha

```bash
npm install
npx playwright install chromium   # solo para los tests E2E
npm run dev                       # http://localhost:3000
```

Para probar en el móvil dentro de la misma red: `npm run dev -- -H 0.0.0.0` y abre `http://<IP-del-PC>:3000`.
(La instalación como PWA y las notificaciones requieren HTTPS; llegan con el despliegue).

## Scripts

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo |
| `npm run build` / `npm start` | Build de producción y servidor |
| `npm run typecheck` | `next typegen` + `tsc --noEmit` |
| `npm run lint` | ESLint (config de Next) |
| `npm run test` | Tests unitarios del dominio (Vitest) |
| `npm run test:coverage` | Igual, con cobertura de `features/*/domain` |
| `npm run e2e` | Playwright contra build de producción (móvil 375 px y escritorio 1440 px), incluye axe |
| `npm run screenshots` | Regenera `docs/screenshots/` |
| `npm run check` | typecheck + lint + test |
| `npm run icons` | Regenera los iconos PWA desde la marca |
| `npm run db:start` / `db:stop` / `db:reset` | Supabase **local** en Docker (M2) |

## Estructura

```
docs/                 especificación, arquitectura, decisiones, seguridad, informes
e2e/                  tests Playwright
scripts/              utilidades locales (iconos)
src/app/              rutas (App Router); (app)/ comparte el layout con navegación
src/components/ui/    primitivas shadcn/ui adaptadas a los tokens
src/components/shell/ AppShell, SideNav (sidebar/rail), BottomTabs, cabecera móvil, SyncStatus
src/features/<módulo>/
  domain/             lógica pura y testeada (fechas, horarios versionados, métricas)
  store/              estado (M1: demo local)
  components/         UI del módulo
  fixtures.ts         datos de ejemplo etiquetados como demo
supabase/             configuración local y migraciones (vacías hasta M2)
```

Más detalle en [`docs/architecture.md`](docs/architecture.md). Para revisar el prototipo: [`docs/validation-guide.md`](docs/validation-guide.md).

## Seguridad

- Sin secretos en el repositorio. `.env*` está ignorado excepto `.env.example`.
- Este proyecto es independiente de cualquier otro: no reutiliza cuentas, proyectos ni credenciales de Supabase, Vercel o GitHub.
- Checklist: [`docs/security-checklist.md`](docs/security-checklist.md).
