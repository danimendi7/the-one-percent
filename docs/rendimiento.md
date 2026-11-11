# Rendimiento y accesibilidad de las vistas clave (F2)

Medido el 2026-11-10 sobre la rama `feat/f2-a11y-rendimiento`. Datos completos en [`reports/f2-views.json`](reports/f2-views.json).

## Cómo se mide

`npm run measure:views` (`scripts/measure-views.mjs`) abre cada vista en Chromium real contra un build de producción (`npm run build && npx next start -p 3100`) en modo demo:

- **Perfil de móvil:** 375×812, táctil, CPU ×4 más lenta y red «4G decente» (9 Mbps de bajada, 1,5 de subida y 85 ms de latencia), emuladas con DevTools.
- **Frío:** caché vacía. **Con caché:** segunda visita en el mismo navegador.
- **Por vista:** primer contenido pintado (FCP), mayor contenido pintado (LCP), saltos de diseño (CLS) y tiempo hasta que la vista muestra sus datos («datos»).
- **Toque:** en el Resumen, desde que se pulsa un hábito hasta el fotograma que lo muestra hecho.
- Mediana de 5 pasadas (10 para el toque en la comprobación final del Resumen). Máquina: 12 núcleos y 10 GB, WSL2.

## Resultados (medianas, ms salvo el CLS)

| Vista | Datos (frío) | LCP (frío) | CLS (frío) | Datos (caché) | LCP (caché) | CLS (caché) |
| --- | --- | --- | --- | --- | --- | --- |
| Resumen `/` | 1695 | 1520 | 0,004 | 682 | 664 | 0 |
| Hábitos | 1744 | 1548 | 0 | 805 | 776 | 0 |
| Analytics | 2222 | 2184 | 0 | 1195 | 1172 | 0 |
| Biblioteca | 1730 | 1488 | 0 | 666 | 648 | 0 |
| Objetivos | 1755 | 1484 | 0 | 673 | 664 | 0 |

FCP: unos 350 ms en frío y unos 210 ms con caché en todas las vistas. Toque en el Resumen: **78 ms**.

**Frente a los objetivos del PRD (§7):**
- «Usable en menos de 3 s en un 4G decente con la caché caliente»: se cumple con margen (0,7–1,2 s). En frío también queda por debajo de 3 s (1,7–2,2 s).
- «Respuesta visual al toque en menos de 100 ms»: se cumple (78 ms con la CPU ×4).
- CLS por debajo de 0,1 («bueno» según Core Web Vitals) en todas las vistas.

## Qué se corrigió

- **Salto de diseño del Resumen** (CLS 0,64 → 0,004 en frío). Al cargar en un móvil se pintaban esqueletos y, debajo, los atajos, la columna lateral, las dimensiones y los objetivos. Al llegar los datos, la lista de hoy crecía y todo bajaba unos 440 px. Ese salto hizo que la CI pulsara en el vacío en la PR #25. Ahora, mientras no hay datos, solo se pinta el esqueleto del encabezado de hoy; el resto aparece con los datos y ya no se desplaza nada.
- **«Hoy» con el reloj del dispositivo** (limitación anotada desde la PR #15). Una vez que el motor conoce la hora del servidor, calcula el día con el reloj del dispositivo corregido por ese desfase. Un móvil con la hora varias horas mal ya no ve ni escribe el día anterior o el siguiente cerca de la medianoche. Antes de la primera respuesta del servidor se usa el reloj del dispositivo, como antes: `engine-today.test.ts`.

## Accesibilidad

`e2e/a11y.spec.ts` analiza con axe (WCAG 2.1 AA, se rechaza toda infracción grave o crítica) estas pantallas:
- `/login`, el Resumen, Hábitos, Analytics, Enfoque (en reposo, en curso, en pausa y al cerrar), las cinco vistas de la Biblioteca, Descubrir, Cerebro, Ajustes, Notificaciones, Más e Inteligencia.
- Desde F2, también la bandeja abierta.

Objetivos, Mente, Repaso y Revisiones tienen su análisis de axe en su propia especificación. La ausencia de desbordamiento horizontal a 375 px está en `navigation.spec.ts`.

**Zonas táctiles (nuevo en F2).** `a11y.spec.ts` recorre 16 pantallas y comprueba que cada control del contenido principal tenga un área pulsable de al menos 44 px en móvil (regla del proyecto) y 24 px con ratón (WCAG 2.5.8):
- El área se mide con `elementFromPoint` en los bordes de una franja de ese tamaño, así que cuenta un área invisible ampliada.
- Quedan exentos los enlaces dentro de una frase, como en WCAG.

Lo que encontró y se corrigió:
- **Interruptores:** área de 34 → 44 px de alto.
- **Selectores:** la variante de tamaño de shadcn imponía 32 px aunque la pantalla pidiera 44; ahora son 44 px en móvil y 32 en escritorio.
- **Botón «Tabla» de los gráficos:** 36 → 44 px en móvil.
- **Días de la tira semanal de Mente y de «Días sin avisos»:** 38–40 → 45 px de ancho a 375 px.
- **«Editar nota» de Cerebro** y **enlace al libro de una nota con título corto:** ahora tienen 44 px de alto y de ancho, respectivamente.

## Límites de esta medición

- Es una emulación en un ordenador, no un teléfono real. La prueba en iPhone sigue pendiente (`docs/guia-dispositivo.md`).
- El servidor es local: no incluye la distancia de red ni el arranque en frío de las funciones de Vercel. El tiempo hasta el primer byte no se informa, porque la emulación de DevTools no lo refleja.
- Modo demo: con cuenta, los datos llegan de IndexedDB y del servidor. Con la caché local llena, el tiempo debería ser parecido al de «con caché», pero no está medido.
