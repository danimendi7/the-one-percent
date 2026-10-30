# M4a · Prueba de volumen de Knowledge OS (30/10/2026)

**Medidas reales**, no estimaciones. Los datos completos están en `docs/reports/m4a-volume.json` y se reproducen con `npm run bench:knowledge`.

## Cómo se ha medido
- **Datos**: biblioteca **sintética** y determinista (`src/features/knowledge/domain/synthetic.ts`).
  - Composición: 300 libros, 40 programas, 260 episodios, 5.000 notas (y una segunda serie con 10.000) y unos 1.000 enlaces.
  - Longitud de las notas: el 60 % de 60–300 caracteres, el 30 % de 300–900, el 8 % de 900–2.000 y el 2 % de 2.000–6.000.
  - Texto: palabras comunes del español más un vocabulario de ~20.000 palabras inventadas con frecuencia de cola larga.
  - Sin títulos, personas ni citas reales. Nunca se mezcla con la demo ni con datos de cuenta.
- **Dónde**:
  - **Chromium real** (el navegador de Playwright, v156), con la **IndexedDB real**;
  - página servida desde memoria, sin red, sin cuenta y sin nube;
  - código del dominio empaquetado con `rolldown`.
- **Velocidad**:
  - **×1**: este PC (AMD Ryzen 5 7535HS, 16 GB);
  - **×4**: CPU ralentizada 4 veces con DevTools. Es una **aproximación** de un móvil de gama media, no un móvil real.
- **IndexedDB**: se escribe y se lee **el mismo registro que el motor de sincronización** (`v1:<usuario>`, con la biblioteca dentro de `cache.state`).
  - El «ciclo de guardado» reproduce `engine.persist()`: lee el registro (fusión entre pestañas, D58) y lo escribe entero.
  - 7 repeticiones; las búsquedas y las listas, 25.
- **Memoria**: heap de JavaScript tras forzar la recolección de basura, antes y después de crear el estado y el índice.

## Resultados
| Medida | 5.000 · ×1 | 5.000 · ×4 | 10.000 · ×1 | 10.000 · ×4 |
|---|---|---|---|---|
| Notas · contenidos · programas · enlaces | 5000 · 560 · 40 · 1000 | 5000 · 560 · 40 · 1000 | 10000 · 560 · 40 · 2000 | 10000 · 560 · 40 · 2000 |
| Media de caracteres por nota | 476 | 476 | 475 | 475 |
| Estado en JSON | 4.61 MB | 4.61 MB | 8.65 MB | 8.65 MB |
| Estado en JSON comprimido (gzip) | 1.10 MB | 1.10 MB | 2.07 MB | 2.07 MB |
| Memoria (heap) del estado | 4.6 MB | 4.5 MB | 8.3 MB | 8.3 MB |
| Memoria (heap) del índice | 13.4 MB | 13.4 MB | 22.2 MB | 22.2 MB |
| Palabras distintas en el índice | 12790 | 12790 | 13019 | 13019 |
| JSON.parse del estado | 8.9 ms | 38.5 ms | 15.9 ms | 66.7 ms |
| structuredClone del estado | 23.2 ms | 108 ms | 39.2 ms | 191 ms |
| IndexedDB: escribir el registro | 26.0 ms (p95 27.2) | 66.7 ms (p95 74.9) | 49.1 ms (p95 57.7) | 136 ms (p95 147) |
| IndexedDB: leer el registro | 15.7 ms (p95 20.8) | 55.9 ms (p95 77.9) | 27.5 ms (p95 33.2) | 133 ms (p95 145) |
| **IndexedDB: ciclo de guardado del motor** (leer + escribir) | **44.4 ms (p95 47.6)** | **122 ms (p95 149)** | **84.3 ms (p95 94.4)** | **266 ms (p95 369)** |
| IndexedDB: registro sin biblioteca (referencia) | 0.4 ms (p95 0.7) | 0.8 ms (p95 1.7) | 0.4 ms (p95 0.6) | 0.9 ms (p95 1.5) |
| Índice: construcción en frío | 144 ms | 932 ms | 272 ms | 1992 ms |
| Reductor: editar 1 nota | 3.5 ms | 21.9 ms | 4.7 ms | 35.5 ms |
| Índice: actualización incremental tras 1 edición | 5.8 ms | 27.2 ms | 7.5 ms | 47.5 ms |
| Índice: reconstrucción completa (comparación) | 130 ms | 972 ms | 253 ms | 1797 ms |

| Búsqueda (mediana y p95; n.º de notas encontradas con 5.000) | 5.000 · ×1 | 5.000 · ×4 | 10.000 · ×1 | 10.000 · ×4 |
|---|---|---|---|---|
| palabra frecuente (atención) (977) | 0.6 ms (p95 1.0) | 3.4 ms (p95 6.8) | 1.0 ms (p95 1.9) | 9.2 ms (p95 18.8) |
| otra palabra frecuente (hipótesis) (937) | 0.6 ms (p95 0.8) | 3.2 ms (p95 4.1) | 0.9 ms (p95 1.1) | 7.0 ms (p95 10.1) |
| palabra rara (palabra inventada) (1) | 0.0 ms (p95 0.0) | 0.0 ms (p95 0.1) | 0.0 ms (p95 0.0) | 0.0 ms (p95 0.2) |
| dos palabras (hábito sueño) (318) | 0.4 ms (p95 0.7) | 2.6 ms (p95 3.3) | 0.9 ms (p95 1.5) | 4.2 ms (p95 9.6) |
| prefijo corto (en) (2422) | 1.4 ms (p95 2.3) | 9.1 ms (p95 12.7) | 2.7 ms (p95 3.8) | 22.0 ms (p95 37.9) |
| solo filtros (ideas destacadas) (105) | 1.3 ms (p95 2.0) | 7.4 ms (p95 12.0) | 2.5 ms (p95 3.5) | 18.9 ms (p95 32.2) |
| texto + filtros (atención, libros, valoración ≥ 7) (73) | 0.3 ms (p95 0.5) | 2.9 ms (p95 6.7) | 0.5 ms (p95 0.8) | 3.3 ms (p95 4.8) |
| filtro de tema (sueño) (532) | 2.1 ms (p95 4.2) | 12.1 ms (p95 18.4) | 3.7 ms (p95 5.3) | 29.5 ms (p95 49.2) |
| todas las notas, recientes primero (5000) | 3.2 ms (p95 3.9) | 21.6 ms (p95 29.5) | 6.3 ms (p95 7.5) | 44.5 ms (p95 72.3) |
| Lista: libros por título (todos) | 0.4 ms (p95 0.5) | 3.2 ms (p95 5.0) | 0.4 ms (p95 0.5) | 3.3 ms (p95 6.8) |
| Lista: episodios con filtro de texto | 0.4 ms (p95 0.7) | 3.4 ms (p95 6.0) | 0.5 ms (p95 0.6) | 3.1 ms (p95 4.7) |
| Lista: recuentos por estantería | 0.1 ms (p95 0.1) | 0.4 ms (p95 0.9) | 0.1 ms (p95 0.2) | 0.4 ms (p95 0.8) |
| Lista: relacionados por temas | 0.8 ms (p95 1.0) | 5.4 ms (p95 6.7) | 1.0 ms (p95 1.3) | 7.0 ms (p95 10.6) |

## Qué se corrigió gracias a la medición
1. **Datos de prueba poco realistas.** La primera versión del generador solo producía 567 palabras distintas, así que el índice no se parecía al de notas reales. Se rehízo con un vocabulario de cola larga (12.790 palabras distintas con 5.000 notas). Las cifras de arriba son las de la versión corregida.
2. **Índice reconstruido entero tras cada edición**: 156 ms con la CPU ×4 en la primera medición. Ahora se actualiza **de forma incremental**: solo se reindexa lo que cambió, gracias a que los reductores conservan los objetos sin cambios.
   - Resultado: **27 ms** con 5.000 notas (×4).
   - Un test comprueba que el índice incremental es idéntico a uno construido desde cero después de crear, editar, borrar y renombrar programas.
3. **Normalización de acentos**: camino rápido con una tabla para el español. La descomposición Unicode solo se aplica si quedan otras letras no ASCII. Un test compara el resultado con la implementación de referencia en todas las letras latinas.
4. **Ordenación y filtros**, con la CPU ×4:
   - ordenar por título pasa de 57,6 a **3,2 ms**, con un `Intl.Collator` compartido;
   - filtrar por tema pasa de 68,6 a **12,1 ms**, con temas normalizados cacheados por objeto;
   - las fechas ISO se comparan como texto, sin `localeCompare`.

## Conclusiones
1. **El modelo unificado funciona con libros y episodios.** No ha aparecido ningún caso que pida separarlos.
2. **La búsqueda local cumple el objetivo** (< 100 ms). Con 5.000 notas y la CPU ×4, todas las consultas tardan menos de 30 ms en el p95; la típica (una o dos palabras), unos 3 ms. Con 10.000, todas menos de 75 ms.
3. **Los límites de 10.000 y 2.000 caracteres no causan problemas.** El volumen depende del número de notas, no del límite: la media medida es de 476 caracteres por nota. Se mantienen.
4. **Memoria**: con 5.000 notas, unos 18 MB (4,5 MB de estado y 13,4 MB de índice); con 10.000, unos 30 MB. Es asumible en un móvil, sobre todo si el índice solo se construye cuando se usa la búsqueda (propuesta 4 de abajo).

## Impacto en el motor actual (IndexedDB y sincronización): requiere decisión antes de M4c
No se ha modificado la arquitectura del motor. Estos son los datos para decidir:

| Hallazgo | Medida | Umbral del plan (§8.6) | Consecuencia |
|---|---|---|---|
| **El ciclo de guardado escribe el registro entero** | 44 ms (×1) y **122 ms, p95 149 (×4)** con 5.000 notas; 266 ms (×4) con 10.000. Sin biblioteca: menos de 1 ms | Escritura > 50 ms | **Superado** en ×4. Si la biblioteca viviera dentro del registro actual, **cada toque en un hábito** costaría unos 120 ms en un móvil medio, no solo las ediciones de la biblioteca |
| **Pull completo en cada arranque** | 1,10 MB comprimidos con 5.000 notas y **2,07 MB con 10.000**, más ~40 ms de `JSON.parse` (×4) | Pull > 1,5 MB comprimido | Por debajo con 5.000 y **superado con 10.000**. Además es tráfico móvil en cada apertura |
| **Reductor: una edición copia el mapa de notas** | 21,9 ms (×4) por operación con 5.000 notas | — | `rebase` repite las operaciones en cola en cada instantánea. Sin conexión, 10 ideas pendientes serían unos 220 ms por render |
| **Índice en frío** | 144 ms (×1) y **932 ms (×4)** con 5.000 notas | — | Bloquearía el hilo principal casi 1 s en un móvil si se construyera al abrir la app |

**Propuestas** (para aprobar en M4b y M4c; no son cambios hechos):
1. **Guardar el conocimiento en un almacén propio de IndexedDB, por entidad** (una entrada por nota, contenido, programa o enlace) y escribir solo lo que cambió, comparando por identidad de objeto, que es barato.
   - El registro actual `v1:<usuario>` sigue igual para hábitos, objetivos, enfoque, check-ins, revisiones y la cola. Así los guardados que no son de la biblioteca siguen en ~1 ms.
   - La cola de operaciones (incluidas las de la biblioteca), `pendingNotes` y la fusión entre pestañas (D58) **no cambian**.
   - Alternativa más simple: un único registro aparte para todo el conocimiento. Protege los guardados de hábitos, pero cada edición de la biblioteca seguiría costando ~120 ms (×4).
2. **Pull incremental del conocimiento al arrancar** desde el cursor guardado; el pull completo solo sin copia local o como refresco periódico.
   - Las lápidas (`deleted_at`) ya se conservan en el servidor; falta fijar cuántas posiciones se guardan.
   - Se diseña en M4b (`pull_changes`) y se aplica en M4c.
3. **Aplicar las operaciones en cola en bloque** al rehacer la vista optimista: una sola copia del mapa por rebase, no una por operación. Es una optimización interna del reductor, sin cambio de arquitectura.
4. **Índice perezoso**: construirlo al abrir la búsqueda o Cerebro, por partes en tiempo libre (`requestIdleCallback`) o en un Web Worker. Después, actualizarlo de forma incremental (27 ms ×4).

## Límites de esta medición
- La CPU ×4 es una aproximación; **falta medir en tu móvil real**. Se propone una página de diagnóstico en M4d, solo con datos sintéticos, para ejecutarla en el teléfono.
- IndexedDB en Chromium de escritorio; Safari en iOS puede diferir, también en la memoria permitida a una PWA.
- No se ha medido la red real del pull: solo el tamaño del cuerpo comprimido.
