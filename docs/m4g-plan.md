# Plan M4g · Biblioteca inteligente: alta asistida de libros y podcasts

**Estado (31/10/2026): solo investigación, auditoría, diseño y documentación.** No se ha implementado nada, no hay migraciones, no se ha tocado producción ni ningún remoto. Este documento sustituye la §9 y la ficha «M4g» de `docs/m4-knowledge-os-plan.md` allí donde la investigación las corrige (sobre todo Google Books sin clave, el límite de 200 episodios de Apple y las redirecciones de las portadas).

Índice:
1. Resumen y recomendación
2. Auditoría de M4 (lo que ya existe)
3. Inventario de datos: actuales, nuevos y correspondencias
4. Comparativa de proveedores (con pruebas reales)
5. Arquitectura
6. Propuesta UX
7. Pruebas
8. Roadmap por subfases
9. Riesgos, costes y decisiones pendientes
10. Mantenimiento pendiente (fuera de M4g)
11. Primer prompt de implementación (preparado, no ejecutado)
12. M4g.1: servicio seguro de metadatos (hecho en local)
13. M4g.1: validación remota en `ci/m4g`
14. M4g.2: revisión previa del proxy de portadas (sin implementar)
15. M4g.2: portadas reales con respaldo tipográfico (hecho en local)
16. M4g.2: validación remota en `ci/m4g`
17. M4g.3: plan de implementación del alta asistida de libros (sin implementar)
18. M4g.3: alta asistida de libros (hecho en local)
19. M4g.3: auditoría de integridad y validación remota en `ci/m4g`
20. M4g.4: alta asistida de podcasts y episodios (hecho en local)
21. Plan de endurecimiento posterior a M4g.4 (sin implementar)
22. M4g.4: auditoría y validación remota (fallida: pérdida de altas sin conexión, defecto de M4)
23. M4g.5: propuesta de endurecimiento (sin implementar)

---

## 1. Resumen y recomendación

- **No hace falta ninguna migración para la versión mínima.** M4 ya guarda portada externa, referencia externa (`openlibrary`, `googlebooks`, `itunes`…), atribución, ISBN-13/10, páginas, editorial, año, idioma, duración, fecha, n.º de episodio y enlace. Hay índices únicos por id externo en libros, episodios y programas.
- **Libros: Open Library como proveedor único de la primera versión.** Sin clave, sin coste y con buena cobertura en español en las pruebas, incluido el ISBN de la edición española.
- **Google Books sin clave no es viable.** Las 5 consultas de prueba, en dos momentos distintos de la sesión, devolvieron **429** («Queries per day» de un proyecto anónimo compartido), y la documentación oficial exige clave o OAuth. Con clave es gratis, pero es una credencial nueva y obliga a mostrar la marca «Powered by Google» y a enlazar cada resultado → **opcional y posterior**, solo si Open Library se queda corto.
- **Podcasts: Apple (iTunes Search y Lookup) como proveedor único de la primera versión.** Rápido (0,35–0,8 s), sin clave, buenas portadas de 600 px y descripciones de programa y episodio.
- **Apple no da todos los episodios:** Lookup devuelve como máximo **los 200 más recientes** (comprobado con `limit=300` y `limit=1000`). Para episodios antiguos, la búsqueda de episodios de Apple los encuentra por texto (p. ej. el n.º 89 de *La Ruina*, de 2022). **El catálogo completo solo está en el RSS oficial**, que se deja como subfase opcional por su coste en seguridad (SSRF con hosts abiertos) y una dependencia nueva (parser XML).
- **Portadas por un proxy del mismo origen** (`/api/covers`), con la portada tipográfica actual como respaldo. Así la CSP no cambia y los proveedores no ven tu IP ni lo que lees desde el navegador.
- **La entrada manual se mantiene siempre**, en el mismo panel, y es lo único disponible sin conexión.
- **Las altas usan las operaciones actuales** (`library.item.create`, `library.show.create`): la sincronización, la cola sin conexión, las notas, los estados y las valoraciones no cambian.

**Primera versión mínima (M4g.1–M4g.4, unas 11–14 h de ejecución):** buscar y añadir libros (Open Library) y programas y episodios (Apple), con revisión previa, portadas, aviso de duplicados y entrada manual. Sin migraciones, sin credenciales, sin dependencias nuevas y sin cambiar la CSP.

---

## 2. Auditoría de M4 (lo que ya existe)

### 2.1 Dominio (`src/features/knowledge/domain`)
| Pieza | Estado real | Relevancia para M4g |
|---|---|---|
| `types.ts` | `ContentItem` (libro o episodio) con `cover: CoverRef \| null`, `external: ExternalRef \| null`, `sourceUrl`, `language`, `creators`. `BookDetails` con ISBN-13/10, páginas, editorial y año. `EpisodeDetails` con `showId`, `platform`, `durationSeconds`, `publishedOn`, `episodeNumber`. `PodcastShow` con `publisher`, `cover`, `external` | **Todo lo que piden las fichas ya existe** (§3) |
| `ExternalProvider` | `openlibrary`, `googlebooks`, `itunes`, `spotify`, `youtube` (el comentario ya dice «M4g») | Basta para Open Library, Google Books y Apple. **No** hay `rss` |
| `CoverRef` | `{ source: "external", url }` o `{ source: "upload", path }`. El comentario ya prevé el proxy del mismo origen | Se usa tal cual |
| `validation.ts` (Zod) | Líneas limpias (sin saltos ni controles), bloques recortados, `safeUrl` (http/https, sin credenciales, ≤ 2.048), ISBN con dígito de control, años −3000…3000, duración ≤ 24 h | **Lo importado tiene que pasar exactamente estas reglas.** El normalizador limpia antes de llegar aquí |
| `ops.ts` | `createItem` / `createShow` limpian la entrada y rechazan con `duplicate` si ya hay otro elemento con el mismo proveedor e id externo (mismo `kind`) | Ya hay deduplicación local por id externo |
| `search.ts` | Índice local: título ×8, ISBN ×8, creadores ×5, temas ×5, subtítulo y editorial ×4, programa ×3, **descripción ×1** | Una descripción importada larga entra en la búsqueda de Cerebro (§5.12) |

### 2.2 Base de datos (`supabase/migrations/20261101090000_library.sql`)
- `library_items` y `podcast_shows` tienen `cover_source` (`external` \| `upload`), `cover_ref`, `source_url`, `external_provider`, `external_id` (1–200) y `external_attribution` (≤ 200), con `CHECK` de coherencia (proveedor e id van juntos; una portada externa es una URL válida).
- **Únicos parciales:** `library_items (user_id, kind, external_provider, external_id)` y `podcast_shows (user_id, external_provider, external_id)`, sin lápida. Si se viola, `apply_ops` responde `rejected` con el código `duplicate_external`.
- ISBN validado en la base (`lib_isbn13_ok`, `lib_isbn10_ok`) y **no único**, a propósito.
- RLS en las cuatro tablas: `select`, `insert` y `update` propios; sin `delete` ni `truncate`; `anon` sin acceso; escritura solo por `apply_ops`. **M4g no toca nada de esto.**
- `field_stamps` por campo: actualizar portada o metadatos es un `library.item.update` normal, con la resolución por campo de siempre.

### 2.3 Sincronización e IndexedDB
- La copia local de la Biblioteca va por filas (`library-store.ts`), con la cola durable del motor y `op_id` idempotente. Altas y ediciones de M4g = las mismas operaciones de hoy → **ninguna garantía cambia**.
- Un rechazo (`rejected`) de una operación de Biblioteca crea un aviso y conserva el texto (`libraryAnswered` en `engine.ts`). **No hay mensaje propio para `duplicate_external`**: hoy se mostraría el genérico «El servidor no aceptó este cambio. Tu texto se conserva.» (§5.4).
- Los metadatos importados **no** se guardan aparte: entran en el elemento como si los hubieras escrito, así que funcionan sin conexión y no dependen del proveedor para abrir nada.

### 2.4 Rutas, componentes y PWA
- Rutas: `/knowledge/library` (portada), `/books`, `/podcasts`, `/item?id=`, `/show?id=`, `/knowledge/brain`. Rutas estáticas con parámetros en la búsqueda (necesario para el arranque sin red).
- Alta y edición: `ContentFormSheet` (`components/content-form.tsx`), una hoja inferior en el móvil y lateral en el escritorio, con aviso «¿Descartar lo escrito?». Su comentario ya dice «external search arrives in M4g».
- `CoverArt` (`library-ui.tsx`): portada tipográfica generada (2:3 libro, 1:1 programa y episodio). Hoy **nunca** muestra una imagen.
- **CSP**: `img-src 'self' data: blob:` y `connect-src 'self'` + Supabase. Cualquier imagen o llamada a terceros desde el navegador está bloqueada → hace falta el proxy o cambiar la CSP (no recomendado).
- **Service worker** (`public/sw.js`): no intercepta `/api/` ni `/auth/`; guarda solo la carcasa versionada. Las portadas por `/api/covers` **no** estarían disponibles sin red salvo por la caché HTTP del navegador (§5.11).
- **`src/proxy.ts`**: deja pasar a quien tenga sesión **o la cookie de demo**. Cualquiera puede ponerse esa cookie → **las rutas `/api/metadata/*` y `/api/covers` deben exigir un usuario real** (`getUser()`), o serían un proxy abierto hacia Apple y Open Library a nuestro nombre.
- No existe ninguna ruta `/api/*` todavía; las únicas rutas de servidor son `/auth/confirm` y `/auth/signout`.
- Next 16 con `cacheComponents: true`: los *route handlers* `GET` que leen cookies se ejecutan siempre en la petición; `use cache` solo en funciones auxiliares, nunca en el cuerpo del handler (`node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`).

### 2.5 UX actual
- Alta manual de libro: basta el título; el resto de campos están en el mismo formulario largo.
- Alta de episodio: título, programa existente o nuevo, plataforma, duración, fecha…, todo a mano.
- Botones: «Añadir libro» y «Añadir episodio» en la portada de Biblioteca, en Libros y en Podcasts, y «Añadir episodio» en la ficha de un programa.
- Zonas táctiles ≥ 44 px, tokens de color, hoja inferior con altura máxima de 92 dvh en el móvil.

---

## 3. Inventario de datos: actuales, nuevos y correspondencias

### 3.1 Libro
| Campo de la app | Columna | Open Library | Google Books (si se activa) | ¿Falta? |
|---|---|---|---|---|
| Título | `title` | `title` (edición; si no, obra) | `volumeInfo.title` | — |
| Subtítulo | `subtitle` | `subtitle` | `volumeInfo.subtitle` | — |
| Autores | `creators` | `author_name[]` | `authors[]` | — |
| Descripción | `description` | `/works/{id}.json` → `description` (**cadena u objeto `{type, value}`**; a menudo ausente) | `description` (con HTML) | — |
| Idioma | `language` | `languages[].key` (`/languages/spa` → `es`) | `language` | — |
| ISBN-13 / ISBN-10 | `isbn13`, `isbn10` | `isbn_13[]`, `isbn_10[]` de la edición | `industryIdentifiers[]` | — |
| Páginas | `page_count` | `number_of_pages` de la edición o `number_of_pages_median` | `pageCount` | — |
| Editorial | `publisher` | `publishers[0]` | `publisher` | — |
| Año | `published_year` | `publish_date` es **texto libre** («January 23, 2024», «2020-03-23») → año por expresión regular; si no, `first_publish_year` | `publishedDate` | — |
| Portada | `cover_source`, `cover_ref` | `covers[]` de la edición (**puede traer `-1`**), si no `cover_i` de la obra | `imageLinks.thumbnail` (http) | — |
| Referencia externa | `external_provider/id/attribution` | `openlibrary` + **clave de la obra** (`OL…W`) | `googlebooks` + id del volumen | — |
| Enlace | `source_url` | `https://openlibrary.org/works/OL…W` | `infoLink` (obligatorio enlazarlo) | — |
| Temas | `topics` | `subjects[]` (ruidosos: 11–59 por obra) | `categories[]` | **No se importan** automáticamente (§5.12) |
| Estado, valoración, fechas, progreso, favorito | — | — | — | Siempre tuyos, nunca importados |

### 3.2 Programa
| Campo | Columna | Apple | ¿Falta? |
|---|---|---|---|
| Nombre | `title` | `collectionName` | — |
| Autor o productora | `publisher` | `artistName` | — |
| Descripción | `description` | **No viene en Search/Lookup**; está en el RSS (`<description>`). En la versión mínima queda vacía o la escribes tú | Sin cambio de esquema |
| Portada | `cover_*` | `artworkUrl600` (`isN-ssl.mzstatic.com`) | — |
| Referencia externa | `external_*` | `itunes` + `collectionId` | — |
| Enlace | `source_url` | `collectionViewUrl` (página de Apple Podcasts) | — |
| Temas | `topics` | `genres[]` | Solo como sugerencia |
| URL del feed RSS | — | `feedUrl` | **No se guarda**: se vuelve a pedir por `collectionId` cuando hace falta. Evita columna nueva |
| Idioma | — | No viene | No hace falta |

### 3.3 Episodio
| Campo | Columna | Apple (Lookup / búsqueda de episodios) | ¿Falta? |
|---|---|---|---|
| Título | `title` | `trackName` | — |
| Programa | `show_id` | `collectionId` → programa local (se crea si no existe) | — |
| Descripción | `description` | `description` (texto; unos 500–2.900 caracteres en las pruebas) | — |
| Duración | `duration_seconds` | `trackTimeMillis` / 1000 | — |
| Fecha | `published_on` | `releaseDate` (ISO, UTC) → fecha local | — |
| N.º de episodio | `episode_number` | **No viene**. Solo en RSS (`itunes:episode`, presente en 0–68 % de los episodios según el feed) | Se deja manual |
| Plataforma | `platform` | `apple` | — |
| Referencia externa | `external_*` | `itunes` + `trackId` | — |
| Enlace | `source_url` | `trackViewUrl` | — |
| Invitados | `creators` | No viene (va en el título) | Manual |
| GUID del RSS | — | `episodeGuid` | **No se guarda** en la versión mínima |

### 3.4 Conclusión sobre el esquema
- **Versión mínima: sin migraciones.**
- Posibles migraciones futuras, **solo si se aprueban sus subfases**:
  - `rss` como proveedor externo, si se importan episodios que Apple no tiene (M4g.8);
  - Storage para portadas subidas desde el dispositivo (sigue aplazado, P11);
  - índices de los avisos INFO (mantenimiento, §10, separado de M4g).
- **Obra frente a edición:** `external_id` guarda la **obra** de Open Library y la edición elegida queda identificada por su ISBN-13/10 (§5.3). No hace falta una segunda columna.

---

## 4. Comparativa de proveedores

### 4.1 Pruebas exploratorias (31/10/2026)
Consultas públicas de solo lectura desde este equipo, sin claves y sin datos de usuario. Los scripts están en el directorio temporal de la sesión (`scratchpad/m4g/`); no se han guardado respuestas en el repositorio.

**Libros, Open Library (`/search.json` con `fields=…,editions` y `lang=es`):**
| Consulta | Resultado | Latencia |
|---|---|---|
| «Cien años de soledad» | Obra correcta (García Márquez, 1967, 208 ediciones), edición española con ISBN `9788420471837` y portada. También 4 obras ruidosas (estudios, duplicados sin portada) | 3,8 s |
| «El infinito en un junco» | Correcta (Vallejo, 2020), edición en español con portada; ruido: adaptación gráfica y dos obras sin relación | 2,0 s |
| «Los asquerosos Santiago Lorenzo» | Correcta, **dos obras duplicadas** de la misma novela (2018) | 1,0 s |
| «Outlive Attia» | Correcta (Attia y Gifford, 2023), pero la «mejor edición» es **rumana**; ruido: resúmenes y cuadernos de trabajo | 1,3 s |
| «Atomic Habits» | Correcta; con `lang=es` propone «Hábitos Atómicos» (Paidós, 2024); ruido: diarios y resúmenes | 1,4 s |
| «Sapiens Harari» | Correcta, edición española `9788499926223` | 1,0 s |
| ISBN `9780735211292` | Obra y edición exactas | 0,7 s |
| ISBN `9788417860790` (Siruela) | Obra y edición exactas (452 págs., Siruela, 2020-03-23, portada) | 0,65 s |
| Ficha de obra (`/works/…json`) | Descripción en 3 de 5 obras; **la de *Atomic Habits* está en inglés** aunque elijas la edición española | 0,2–0,7 s |

**Libros, Google Books sin clave:** **429 en todas las consultas** (5), en dos tandas separadas: `Quota exceeded for quota metric 'Queries' and limit 'Queries per day'` de un proyecto compartido. No se pudo medir calidad sin clave.

**Podcasts, Apple (`country=ES`):**
| Consulta | Resultado | Latencia |
|---|---|---|
| «La Ruina» | Correcto (356 episodios), primer resultado | 0,5 s |
| «Nadie Sabe Nada» | Correcto (SER Podcast, 520), primer resultado | 0,8 s |
| «Entiende Tu Mente» | Correcto, pero **aparece dos veces** (dos `collectionId`, mismo autor y mismo host de feed) | 0,5 s |
| «The Knowledge Project» | Correcto, primer resultado; **su `feedUrl` devuelve 404** | 0,45 s |
| «Huberman Lab» | Único resultado, correcto | 0,4 s |
| «Lex Fridman» | Correcto, más **un duplicado** en Acast y dos programas de resúmenes | 0,36 s |
| Lookup de episodios (`entity=podcastEpisode`) | **Máximo 200, los más recientes**, aunque se pida 300 o 1.000. *La Ruina*: 200 de 356 (el más antiguo, de 2023). Respuesta de **460–840 KB** | 0,75–1,9 s |
| Búsqueda de episodios «La Ruina Ignatius» | Encuentra el n.º 89 (2022), fuera de los 200, **mezclado con otros programas** | 0,5 s |

**RSS oficial (vía `feedUrl` de Apple):**
| Programa | Episodios en el feed | Tamaño | Notas |
|---|---|---|---|
| La Ruina (anchor.fm) | 335 (desde 2019) | 0,7 MB | `itunes:duration` en todos, n.º en 2 |
| Nadie Sabe Nada (Prisa) | 520 (desde 2013) | 1,7 MB | Sin `itunes:episode` |
| Entiende Tu Mente (Acast) | 458 | 2,2 MB | |
| Huberman Lab (Megaphone) | 454 | **4,3 MB** | |
| Lex Fridman (propio) | 503 | 2,0 MB | |
| The Knowledge Project | — | — | **404** |

**Portadas:**
- `covers.openlibrary.org/b/id/…` responde con **dos redirecciones** (`archive.org` → `iaNNNNNN.us.archive.org`), JPEG de 16–46 KB, `max-age=10800`, ~1 s.
- Un id inexistente devuelve **200 con un GIF de 43 bytes** (no un 404). Con `?default=false` sí da 404, pero solo por ISBN, y las consultas por ISBN están limitadas a **100 cada 5 min por IP**.
- `isN-ssl.mzstatic.com` (Apple): directo, JPEG, 6 KB (100 px) y 100 KB (600 px), 0,1–0,2 s, `max-age` de ~6 meses.

### 4.2 Condiciones oficiales
| | Open Library | Google Books | Apple (iTunes Search) | RSS oficial | Podcast Index |
|---|---|---|---|---|---|
| Clave | No | **Sí** (clave u OAuth para datos públicos) | No | No | Sí (clave + secreto, firma SHA-1) |
| Límite | 1 petición/s sin identificar; **3/s con User-Agent y email**; portadas por ISBN: 100/5 min por IP | Cuota por proyecto (≈1.000/día por defecto según foros; configurable en la consola) | **≈20 peticiones/min** («subject to change») | El del host de cada feed | No verificado |
| Coste | 0 | 0 (dentro de cuota) | 0 | 0 | 0 |
| Uso y caché | «Cache responses whenever possible»; nada de descargas masivas | Retirar contenido si Google lo pide; no cobrar a usuarios | «set up caching logic»; recursos promocionales solo para promocionar la tienda | Contenido del autor | — |
| Atribución | Enlace a Open Library «apreciado» | **Obligatoria**: logotipo «powered by Google» junto a resultados y enlace prominente a Google Books en **cada** resultado; no reordenar resultados | Atribución en previews de música; enlace a Apple Podcasts razonable | — | — |
| Cobertura ES/EN | Buena en ambos; ruido de resúmenes y duplicados | Buena (no verificable sin clave) | Muy buena | Completa (catálogo entero) | Amplia |
| Episodios | — | — | 200 recientes + búsqueda por texto | **Todos** | Todos los indexados |

Fuentes: [Open Library API](https://openlibrary.org/developers/api), [Open Library Covers API](https://openlibrary.org/dev/docs/api/covers), [Apple Search API](https://performance-partners.apple.com/search-api), [Google Books: uso](https://developers.google.com/books/docs/v1/using), [Google Books: marca](https://developers.google.com/books/branding), [Google Books: términos](https://developers.google.com/books/terms), [cuota de Google Books (foro)](https://discuss.google.dev/t/where-to-start-google-books-api/162388), [Podcast Index (espejo de la documentación)](https://github.com/jamescridland/docs-api). La documentación oficial de Podcast Index devolvió 403 desde aquí; sus datos son de terceros y **no** se usan para decidir.

### 4.3 Conclusiones
- **Libros: Open Library.** Exacto por ISBN; bueno por título en español e inglés; necesita **ordenar y filtrar el ruido** (resúmenes, cuadernos, duplicados sin portada) y elegir edición por idioma. Lento en algunas búsquedas (hasta 3,8 s) → caché y estados de carga.
- **Google Books: solo con clave y solo si hace falta.** Sin clave no funciona hoy. Con clave añade una credencial, obligaciones de marca que encajan mal en la interfaz y la prohibición de reordenar resultados (que choca con mezclarlo con Open Library). Se deja como subfase opcional (M4g.7).
- **Otras fuentes de libros** (ISBNdb, de pago; datos.bne.es, SPARQL complejo y sin portadas): no aportan una mejora demostrable para una app personal.
- **Podcasts: Apple** para buscar programas y episodios. Hay que **agrupar los programas duplicados** (mismo autor y feed) y **filtrar por `collectionId`** en la búsqueda de episodios.
- **RSS: solo como ampliación** (M4g.8), para ver el catálogo entero y números de episodio. Exige descargar URLs de hosts arbitrarios (SSRF con lista abierta), feeds de hasta 4,3 MB y un parser XML (dependencia nueva). Los feeds pueden estar rotos (404).
- **Podcast Index, Spotify Web API y YouTube Data API:** credenciales nuevas sin ganancia clara frente a Apple + RSS. Siguen aplazados (P10).

---

## 5. Arquitectura

### 5.1 Vista general
```
Navegador (cliente)                         Servidor Next (Vercel, Node)                 Proveedores
───────────────────                         ────────────────────────────                 ───────────
AddContentSheet ──fetch same-origin──► /api/metadata/books/search ─┐
  · debounce 350 ms                    /api/metadata/books/detail  ├─ safeFetch ──► openlibrary.org
  · AbortController                    /api/metadata/podcasts/search│   (lista cerrada,     itunes.apple.com
  · offline → manual                   /api/metadata/podcasts/episodes┘ sin redirecciones
CoverArt <img src="/api/covers?…"> ──► /api/covers ──── safeFetch ──► covers.openlibrary.org → archive.org → iaN.us.archive.org
  · onError → portada tipográfica         (bytes mágicos, ≤ 2 MB)      isN-ssl.mzstatic.com
Confirmar → libraryActions.createItem/createShow → cola durable → apply_ops (sin cambios)
```
- **Todo lo externo pasa por el servidor.** El navegador solo habla con la app y con Supabase, como hoy: la CSP no cambia.
- **El servidor no guarda nada**: ni consultas, ni resultados en base de datos, ni registros con lo que buscas.
- **Lo guardado es tuyo**: tras confirmar, los datos son campos normales del elemento; abrir un libro o sus notas nunca llama a un proveedor.

### 5.2 Adaptadores y normalización
Nuevo módulo puro `src/features/library/metadata/` (sin React ni `fetch` directo):
- `types.ts`: resultados normalizados, independientes del proveedor:
  - `BookCandidate { provider, workId, editionId, title, subtitle, creators, year, language, isbn13, isbn10, pageCount, publisher, cover: { provider, id } | null, sourceUrl, attribution }`;
  - `ShowCandidate { provider: "itunes", id, title, publisher, cover, sourceUrl, episodeCount, lastReleaseOn, genres }`;
  - `EpisodeCandidate { provider: "itunes", id, showId, title, description, durationSeconds, publishedOn, sourceUrl }`.
- `openlibrary.ts` y `itunes.ts`: funciones **puras** `parseX(json: unknown): Candidate[]`, que validan con Zod y descartan lo malformado elemento a elemento (un resultado roto no tumba la lista).
- `normalize.ts`: limpieza común, **para que todo pase `validation.ts` sin cambios**:
  - quitar HTML y entidades, controles y espacios dobles; recortar a los `LIMITS` del dominio;
  - descripciones a texto plano, cortadas en un final de frase a **2.000 caracteres** (§5.12);
  - ISBN validado con `isValidIsbn13/10`; los que no pasan se descartan;
  - año entero de `publish_date` libre; fechas de Apple (UTC) a fecha local;
  - creadores deduplicados con `normalize`, máximo 20;
  - idioma `spa` → `es`.
- `rank.ts`: orden propio de los libros (sí está permitido con Open Library):
  - coincidencia exacta de ISBN primero;
  - penalizar «summary», «resumen», «workbook», «journal», «guía de», «study guide» cuando la consulta no los contiene;
  - preferir obras con portada, autor y más ediciones;
  - agrupar obras con título y primer autor normalizados iguales (los duplicados de Open Library).
- `rank.ts` para programas: agrupar resultados de Apple con el mismo autor normalizado y el mismo host+ruta de `feedUrl`; se queda el de más episodios o el más reciente.
- **Servidor** (`src/app/api/metadata/**/route.ts`): fino; autentica, limita, llama a `safeFetch`, pasa la respuesta por el adaptador puro y responde JSON pequeño y ya normalizado. Los 840 KB de Apple se quedan en el servidor; al cliente llegan ~20–40 KB.

### 5.3 Identificadores: obra, edición, programa y episodio
| Entidad | Identificador estable | Se guarda en | Uso |
|---|---|---|---|
| Obra (libro abstracto) | Open Library `OL…W` | `external_id` (proveedor `openlibrary`) | **Deduplicación fuerte**: una obra, una ficha con sus notas |
| Edición | ISBN-13 (o ISBN-10); Open Library `OL…M` solo durante la selección | `isbn13`/`isbn10` | Datos de la edición (páginas, editorial, portada); aviso suave si coincide |
| Volumen de Google Books | id de volumen (≈ edición) | `external_id` (`googlebooks`), solo si se activa M4g.7 | |
| Programa | Apple `collectionId` | `podcast_shows.external_id` (`itunes`) | Deduplicación fuerte |
| Episodio | Apple `trackId` | `library_items.external_id` (`itunes`, `kind = episode`) | Deduplicación fuerte |
| Feed RSS / GUID | `feedUrl` + `guid` | No se guardan (versión mínima) | Solo M4g.8 |

**Por qué la obra y no la edición:** para aprender, lo normal es una ficha por libro, con todas sus ideas. Si quieres dos ediciones como fichas distintas (p. ej., original y traducción), «Añadir igualmente» la guarda **sin** referencia externa y con su ISBN: no viola el índice único y sigue sin depender del proveedor.

### 5.4 Duplicados y correspondencias incorrectas
**Antes de guardar** (en el cliente, sobre la copia local, también sin conexión):
1. Mismo proveedor e id externo → **duplicado seguro**: «Ya está en tu Biblioteca» con «Abrir» (no se ofrece crear otro; el índice único lo rechazaría).
2. Mismo ISBN-13/10 → **probable**: «Abrir el existente» o «Añadir igualmente».
3. Título normalizado igual y algún autor en común (libros), o título normalizado igual y mismo programa (episodios) → **posible**: mismo aviso, más suave.
4. Programas: mismo `collectionId` o mismo título y autor normalizados → se reutiliza el programa existente sin preguntar (un programa no tiene estado ni notas propias que perder); si el existente es manual, se ofrece «Vincular con Apple Podcasts» (§5.9).
- La lógica va en una función pura `findDuplicates(state, candidate)` con tests.

**Carrera sin conexión** (el mismo libro añadido sin red en dos dispositivos):
- El segundo `library.item.create` llega con `duplicate_external` → `rejected`. Sus notas, creadas sobre un elemento que el servidor no acepta, también se rechazan, y **el motor ya conserva sus textos como avisos** (D68/D75).
- M4g añade a `LibraryConflicts` un mensaje propio para `duplicate_external` («Ya tenías este libro en otro dispositivo») y una prueba de integración que demuestra que ningún texto se pierde.
- «Mover mis ideas al existente» queda como mejora posterior si la prueba manual lo pide: cambia el flujo de avisos y no debe mezclarse con la versión mínima.

**Correspondencias incorrectas:**
- Nunca se añade nada sin la **ficha de confirmación**, donde se ve la portada, el autor, el año, la editorial, el idioma y el ISBN.
- Una búsqueda por ISBN que devuelve una obra con otro ISBN principal muestra la edición encontrada, no la de la obra.
- La descripción se marca con su idioma si no coincide con el de la edición (Open Library mezcla obra y edición).

### 5.5 Portadas e imágenes rotas
- **Se guarda la URL canónica del proveedor**, nunca la del proxy:
  - Open Library: `https://covers.openlibrary.org/b/id/{coverId}-L.jpg`, con `coverId > 0` (se descartan `-1` y ausentes); de la **edición** si la tiene, si no de la obra. **Nunca por ISBN** (límite de 100/5 min y GIF de relleno).
  - Apple: `artworkUrl600`.
  - Google Books (si M4g.7): `thumbnail` pasado a `https`, sin `&edge=curl`.
- **Se muestra por `/api/covers?u=<URL canónica>`**: `CoverArt` pinta primero la portada tipográfica y encima la imagen; si la imagen falla (`onError`), es demasiado pequeña (< 1 KB, como el GIF de 43 bytes) o tarda, se queda la tipográfica. Sin saltos de diseño (mismo `aspect-ratio`, `object-cover`).
- `loading="lazy"`, `decoding="async"` y tamaños fijos en las cuadrículas.
- Tamaños: Open Library `-M` (≈16 KB) en cuadrículas y `-L` (≈46 KB) en la ficha; Apple 600 px (≈100 KB), suficiente para ambas.
- Sin `next/image`: su optimizador tiene cupo en Vercel Hobby y añadiría otro origen de imágenes que configurar.

### 5.6 Rapidez, debounce y cancelación
- **Detección de ISBN** al escribir (10 o 13 dígitos con guiones o espacios, dígito de control válido) → búsqueda exacta inmediata, sin esperar.
- Texto: **mínimo 2 caracteres, debounce de 350 ms**; cada nueva búsqueda **aborta** la anterior (`AbortController`) y una respuesta tardía se ignora por id de petición.
- **Esqueleto** a los 150 ms; resultados de 10 libros u 8 programas.
- **Caché en el cliente** (memoria de la sesión): misma consulta normalizada → respuesta instantánea al volver atrás.
- Detalles bajo demanda: la descripción de la obra (Open Library) y los episodios (Apple) se piden **al abrir** el resultado, no en la lista.
- Episodios: la lista de 200 se filtra **en el cliente** al escribir; si no aparece, «Buscar episodios anteriores» usa la búsqueda de episodios de Apple filtrada por `collectionId`.

### 5.7 Límites, reintentos y caché
- **Por usuario** (en la instancia): 30 búsquedas/min y 120 portadas/min; responde 429 con `Retry-After`. Sobra para una persona y frena un bucle accidental.
- **Por proveedor** (en la instancia): Open Library ≤ 3/s y Apple ≤ 20/min, con cola corta; si se supera, 503 «Proveedor ocupado» y el formulario manual sigue abierto.
- **Cortacircuitos**: tras un 429/403/5xx o 3 tiempos agotados seguidos, el proveedor queda «en pausa» 5 minutos y se responde al momento con `provider_unavailable`.
- **Reintentos**: como máximo **1**, solo ante errores de red o 5xx, con 300–600 ms de espera aleatoria. Nunca ante 4xx ni 429.
- **Tiempo máximo**: Open Library 6 s (medido hasta 3,8 s), Apple 4 s, portadas 5 s.
- **Caché del servidor**: solo datos públicos de catálogo, **por consulta normalizada y nunca por usuario**:
  - búsquedas 1 h, fichas y episodios 6 h; los fallos no se cachean;
  - opción A: `use cache` + `cacheLife` en funciones auxiliares (Next 16; ojo con `cacheComponents`), opción B: LRU en memoria de 200 entradas. **Se decide en M4g.1 tras leer la guía de caché de Next 16** (§9.3).
- **Respuestas al cliente**: `Cache-Control: private, no-store` en metadatos (son tus búsquedas) y `private, max-age=2592000, immutable` en portadas (la URL canónica no cambia de imagen).
- Cumple las condiciones: Open Library pide cachear; Apple recomienda cachear búsquedas y lookups; no hay descargas masivas.

### 5.8 Respuestas externas malformadas
- Tamaño máximo leído en streaming: **1 MB** para Open Library, **2 MB** para Lookup de Apple (las 200 entradas pesan hasta 840 KB) y **2 MB** para imágenes. Se corta la lectura al pasarlo.
- `Content-Type` esperado (JSON o `image/jpeg|png|webp`); JSON con `try/catch`.
- Zod `safeParse` por elemento; los campos desconocidos se ignoran y los inválidos se ponen a `null`, nunca se inventan.
- Las imágenes se validan por **bytes mágicos** (JPEG `ffd8ff`, PNG `89504e47`, WebP `RIFF…WEBP`), además del tipo declarado; los GIF se rechazan.
- Todo el texto se trata como **texto plano**: React lo escapa, nunca se usa `dangerouslySetInnerHTML`, y el HTML de las descripciones se quita en el servidor.
- Tests de contrato con respuestas grabadas, incluidas respuestas truncadas, tipos cambiados, `description` como objeto, `covers: [-1]`, `publish_date` raro y entidades HTML.

### 5.9 URLs externas y SSRF
`safeFetch` (servidor) es la única puerta de salida:
- **Lista cerrada de hosts**, comparación exacta tras `new URL()`:
  - `openlibrary.org`, `covers.openlibrary.org`, `archive.org` y `/^ia\d{6}\.us\.archive\.org$/`;
  - `itunes.apple.com` y `/^is[1-5]-ssl\.mzstatic\.com$/`;
  - `books.google.com` y `www.googleapis.com`, solo si se activa M4g.7.
- Solo `https:`, puerto 443, sin credenciales, sin IP literales.
- **Redirecciones manuales** (`redirect: "manual"`), máximo **3** saltos, y **cada salto se vuelve a validar** contra la lista (las portadas de Open Library dan 2).
- `/api/covers` **no** acepta una URL cualquiera: el parámetro `u` debe ser una URL canónica de proveedor (patrones exactos de §5.5), y además pasar la lista.
- Sin cookies ni cabeceras del usuario hacia fuera. `User-Agent` propio (§9.3, D-UA).
- **RSS (solo M4g.8)**: aquí la lista cerrada no sirve (cada programa tiene su host), así que haría falta resolver DNS y rechazar IPs privadas, *link-local*, de bucle y de metadatos de la nube en **cada salto**, conectar a la IP comprobada (contra *DNS rebinding*), limitar a 5 MB y a 8 s, y quitar DTD/entidades XML. Es la razón principal para dejarlo fuera de la versión mínima.

### 5.10 Claves y costes
- **Versión mínima: ninguna clave.** Nada que proteger ni que pagar.
- Si se activa Google Books (M4g.7): clave **solo en el servidor** (`GOOGLE_BOOKS_API_KEY` en Vercel, nunca `NEXT_PUBLIC_*`), restringida a la Books API, con **cuota diaria limitada en la consola de Google** (p. ej. 500/día) para que el coste sea 0 por construcción. Crear la clave y la variable lo haces tú.
- Rutas solo para usuarios autenticados de verdad (no la cookie de demo), límites por usuario y por proveedor, sin registrar las consultas.
- Vercel: unas decenas de invocaciones al día; dentro de lo incluido.

### 5.11 Entrada manual y uso sin conexión
- El panel de alta tiene siempre **«Añadir a mano»**, que abre el formulario actual con lo que hayas escrito como título.
- **Sin conexión** (`navigator.onLine === false` o fallo de red): no se busca; se muestra «Sin conexión: puedes añadirlo a mano y completar los datos más tarde» y el formulario manual. La alta se guarda en el dispositivo y se sincroniza como hoy.
- **Proveedor caído**: el mismo mensaje con «Reintentar» y el formulario manual con lo escrito.
- **Portadas sin conexión**: la caché HTTP del navegador suele bastar para las ya vistas; si no, la tipográfica. Una caché propia de portadas en el service worker (máx. 300 entradas, borrada al cerrar sesión, porque revela qué lees) se propone como subfase aparte (M4g.6), porque cambia el SW.
- **Demo**: la búsqueda externa no está disponible («Disponible con tu cuenta»); la demo sigue siendo manual. No se simula nada.

### 5.12 Persistencia sin alterar notas, enlaces, estados ni sincronización
- Alta = `libraryActions.createItem(kind, input)` con los campos confirmados en la ficha; los estados, la valoración, el favorito y las fechas los eliges tú en la misma ficha (por defecto, como hoy: «Pendiente»).
- Episodio de un programa nuevo = `createShow` y luego `createItem` con `showId`, igual que el flujo manual actual.
- **Temas**: no se importan los de Open Library ni los géneros de Apple (son ruidosos y contaminarían tus filtros de Cerebro). Se muestran como sugerencias que puedes tocar para añadir.
- **Descripción**: se recorta a 2.000 caracteres para no inundar la búsqueda de Cerebro (pesa ×1, pero un texto largo multiplica coincidencias). Desmarcable en la ficha («Guardar la descripción»).
- Atribución en `external_attribution`: «Datos: Open Library» o «Datos: Apple Podcasts». Se muestra en la ficha del elemento, junto al enlace de origen.

### 5.13 Actualizar metadatos sin pisar tus cambios
- **Nunca automático**: no hay refresco en segundo plano ni al abrir una ficha.
- En la ficha (y en programas): «Buscar datos» si no tiene referencia externa, o «Actualizar datos» si la tiene.
- Se muestra un **comparador por campo**: valor actual frente a valor del proveedor.
  - Campo vacío en la app → **preseleccionado** para rellenar.
  - Campo con otro valor → **no seleccionado**; lo marcas tú si lo quieres.
  - Campos que nunca se tocan: título si lo cambiaste (siempre se pregunta), estado, valoración, favorito, fechas, progreso, temas y notas.
- Aplicar = **un único `library.item.update`** con solo los campos marcados: la sincronización por campo de siempre decide si otro dispositivo cambió lo mismo a la vez (conflicto visible, sin pérdidas).
- Así no hace falta guardar el «origen de cada campo» ni migrar nada.

### 5.14 Accesibilidad y diseño adaptable
- Buscador con `role="search"`, `aria-label`; resultados en `role="listbox"` con `aria-activedescendant`, flechas, Intro y Esc en el escritorio; en el móvil, filas de **≥ 56 px**.
- Recuento anunciado con `aria-live="polite"` («8 resultados», «Sin resultados»), sin anunciar cada pulsación.
- Las portadas son decorativas en las listas (`alt=""`, el título está en el texto) y descriptivas en la ficha (`alt="Portada de …"`).
- `inputmode="search"`, `enterkeyhint="search"`, `autocapitalize="off"`; con un ISBN, el teclado numérico no se fuerza (puede llevar X).
- Hoja inferior a 92 dvh con el campo arriba y el teclado del iPhone respetado (`visualViewport`); en el escritorio, panel lateral de 28 rem.
- `prefers-reduced-motion`: sin animaciones de entrada.
- Contraste con los tokens actuales; foco visible; nada de solo color para los avisos de duplicado.

---

## 6. Propuesta UX (Dark Performance)

Principios: el campo de búsqueda es lo primero que se ve; las portadas protagonistas; una pantalla por decisión; manual siempre a un toque; sin bloquear nunca.

### 6.1 Buscador de libros (móvil, hoja inferior)
```
┌───────────────────────────────────────┐
│ ─── Añadir libro                    ✕ │
│ ┌───────────────────────────────────┐ │
│ │ 🔍 Título, autor o ISBN            │ │  autofoco
│ └───────────────────────────────────┘ │
│ Datos: Open Library                   │  text-tertiary, 12 px
│                                       │
│ ▣  Cien años de soledad               │  portada 2:3 de 48×72
│    Gabriel García Márquez · 1967      │
│    Edición en español · 432 págs.     │
│ ▣  Hábitos atómicos                   │
│    James Clear · 2024 · Paidós        │
│ ▣  …                                  │
│                                       │
│ ¿No está? ✎ Añadir a mano             │  siempre visible al final
└───────────────────────────────────────┘
```
- Escritorio: panel lateral con la misma lista; la ficha de confirmación se abre en el mismo panel (no un modal encima).
- Resultados con insignia «En tu Biblioteca» si ya está (no se puede volver a añadir; el toque abre la ficha existente).

### 6.2 Ficha de confirmación (libro)
```
┌───────────────────────────────────────┐
│ ‹ Resultados                          │
│        ▣▣▣▣▣                          │  portada grande 2:3
│        ▣▣▣▣▣                          │
│ Título      [Cien años de soledad   ] │  todos los campos editables
│ Autores     [Gabriel García Márquez ] │
│ Año [1967]  Págs. [432]  ISBN [978…]  │
│ Editorial   [Cátedra               ]  │
│ Idioma      [es]                      │
│ Descripción (inglés) ☑ Guardar        │  se avisa si no coincide el idioma
│ ⓘ Otra edición ▾                      │  selector de ediciones en tu idioma
│ ─────────────────────────────────────  │
│ Estado  (Pendiente)(Leyendo)(Terminado) │
│ Valoración  ○○○○○○○○○○                │
│ Temas sugeridos: +Novela +Realismo    │
│ Datos: Open Library ↗                 │
│ [        Añadir a la Biblioteca      ] │  botón primario, 48 px
└───────────────────────────────────────┘
```
- Si hay posible duplicado, aparece encima del botón: «Ya tienes “Cien años de soledad” (otra edición). [Abrir] [Añadir igualmente]».
- Al añadir: se abre la ficha del libro con «Añadir idea» enfocado, como hoy tras el alta manual.

### 6.3 Buscador de podcasts y selector de episodios
```
Añadir podcast                         Programa (Apple)                       Episodio
┌───────────────────────┐   toque     ┌────────────────────────┐   toque     ┌──────────────────────┐
│ 🔍 Programa o creador │ ──────────► │ ▣ La Ruina             │ ──────────► │ ▣ 89. La Ruina (con  │
│ ▣ La Ruina            │             │   La Ruina · 356 ep.   │             │   Ignatius Farray)   │
│   La Ruina · 356 ep.  │             │ 🔍 Buscar episodio      │             │ 11/07/2022 · 58 min  │
│   Comedia · 21/10/26  │             │ 331. … · 28/10 · 77 min │             │ Descripción…  ☑      │
│ ▣ …                   │             │ 330. … · 21/10 · 75 min │             │ Estado · Valoración  │
│ ✎ Añadir a mano       │             │ …(200 recientes)        │             │ [Añadir episodio]    │
└───────────────────────┘             │ Buscar episodios        │             └──────────────────────┘
                                      │   anteriores            │
                                      │ ✎ Episodio a mano       │
                                      └────────────────────────┘
```
- La pantalla del programa muestra «Ya sigues este programa» si existe; añadir un episodio reutiliza el programa local.
- La lista de episodios marca los que ya están («En tu Biblioteca»).
- Fechas en formato local, duración en minutos (o h y min).
- En el escritorio, programa y episodios en dos columnas dentro del panel ancho.
- «Añadir podcast» guarda **solo el programa** (para seguirlo); «Añadir episodio» guarda programa (si falta) y episodio.

### 6.4 Estados
| Estado | Qué se ve |
|---|---|
| Inicial | Campo vacío con ejemplos («Sapiens», «978…», «Huberman») y «Añadir a mano» |
| Cargando | Esqueleto de 3 filas a los 150 ms; el texto escrito no se bloquea |
| Sin resultados | «No encontramos “…”» + sugerencias (menos palabras, el ISBN) + «Añadir a mano» con el título ya puesto |
| Proveedor caído o lento | «Open Library no responde ahora. Puedes añadirlo a mano y completar los datos más tarde.» + Reintentar |
| Límite alcanzado | «Demasiadas búsquedas seguidas; espera unos segundos.» |
| Sin conexión | Icono de nube tachada: «Sin conexión. Añádelo a mano; se sincronizará al volver la red.» El campo de búsqueda queda deshabilitado |
| Demo | «La búsqueda está disponible con tu cuenta» + formulario manual |
| Portada que falla | Portada tipográfica, sin aviso |

### 6.5 Entrada manual alternativa
- El formulario actual (`ContentForm`), sin cambios de comportamiento, abierto desde «Añadir a mano», con el texto buscado como título.
- Programa y episodio manuales: igual que hoy.

### 6.6 Edición posterior de metadatos
- En la ficha: menú «Editar» (formulario actual) y, aparte, «Buscar datos» / «Actualizar datos» (§5.13) con el comparador por campo:
```
Actualizar datos · Open Library
☐ Título        Mi título            → Cien años de soledad
☑ Páginas       —                    → 432
☑ Portada       (tipográfica)        → ▣
☐ Descripción   (tu texto, 120 car.) → (778 car.)
[Aplicar 2 cambios]
```

---

## 7. Pruebas
**Unitarias (Vitest, sin red):**
- adaptadores con respuestas grabadas reales (recortadas): Open Library búsqueda, obra, edición, ISBN; Apple búsqueda de programas, Lookup con 200 episodios, búsqueda de episodios;
- casos malformados (§5.8);
- `normalize` (HTML, entidades, límites, años, ISBN, idiomas), `rank` (ruido, duplicados), `findDuplicates`, comparador de actualización;
- `safeFetch`: hosts permitidos y no permitidos, redirección a un host no permitido, más de 3 saltos, `http:`, IP literal, credenciales, tamaño, tiempo, bytes mágicos, GIF de 43 bytes.
- **Ningún test llama a Internet.**

**Integración (route handlers):**
- sin sesión o con la cookie de demo → 401;
- límite por usuario → 429; proveedor que da 429 → cortacircuitos → `provider_unavailable`;
- `/api/covers` con URL no canónica → 400.
- El proveedor se sustituye por un servidor local de fixtures. La URL base de pruebas solo se acepta **fuera de Vercel y si es `http://127.0.0.1:<puerto>`** (los E2E corren contra `next start`, es decir, en producción).

**Integración de sincronización:**
- alta con referencia externa → fila con `external_*` y `cover_*` correctos;
- duplicado `duplicate_external` desde dos dispositivos sin red → aviso propio y **ningún texto perdido**.

**E2E (Playwright, en cuenta local, con fixtures):**
- buscar y añadir un libro por título y por ISBN, editar un campo en la confirmación, añadir y ver la ficha con portada y atribución;
- duplicado → «Abrir»;
- proveedor caído → manual con lo escrito;
- sin conexión → manual, se sincroniza al volver;
- programa + episodio de los 200, y episodio antiguo por «Buscar episodios anteriores»;
- portada rota → tipográfica;
- «Actualizar datos» que solo rellena vacíos;
- teclado y lector de pantalla (axe) en móvil y escritorio.

**Regresión:** las suites actuales completas (unitarias, integración, `test:browser`, E2E, smoke). La CSP se comprueba sin cambios.

**Manual (tú):** alta real por título e ISBN en español e inglés; un programa en español y otro en inglés; episodio antiguo; iPhone con teclado y hoja inferior; sin conexión.

---

## 8. Roadmap por subfases

Estimaciones en **minutos de ejecución** (trabajo del agente, sin esperas de CI ni tu revisión). Cada subfase termina con `npm run check` y `npm run e2e` en verde, un commit local y un informe; ninguna hace push.

### M4g.1 · Servidor de metadatos (sin interfaz) — 150–200 min
- **Objetivo**: rutas de búsqueda y detalle seguras y normalizadas.
- **Archivos**: `src/features/library/metadata/{types,normalize,rank,openlibrary,itunes,duplicates}.ts` (+ tests y fixtures), `src/lib/server/safe-fetch.ts`, `src/lib/server/rate-limit.ts`, `src/app/api/metadata/books/{search,detail}/route.ts`, `src/app/api/metadata/podcasts/{search,episodes}/route.ts`.
- **Base de datos**: ninguna.
- **Pruebas**: unitarias e integración de §7.
- **Riesgos**: cambios de API (tests de contrato), cuotas compartidas por IP de Vercel (cortacircuitos), caché de Next 16 (leer la guía).
- **Dependencias**: decisiones D-UA y D-CACHE (§9.3).
- **Aceptación**: 401 sin sesión real; respuestas ≤ 40 KB; ningún host fuera de la lista; todos los casos malformados cubiertos; cero llamadas a Internet en los tests.

### M4g.2 · Portadas reales — 90–120 min
- **Objetivo**: proxy `/api/covers` y `CoverArt` con imagen y respaldo.
- **Archivos**: `src/app/api/covers/route.ts`, `library-ui.tsx` (`CoverArt` acepta `cover`), vistas que lo usan.
- **Base de datos**: ninguna.
- **Pruebas**: unitarias del proxy; E2E de portada válida, rota y sin conexión; comprobación de la CSP sin cambios.
- **Riesgos**: diseño (saltos al cargar), memoria de la función con imágenes grandes (corte a 2 MB).
- **Aceptación**: elementos con `cover.source = "external"` muestran su imagen; cualquier fallo → tipográfica sin salto; ninguna imagen de terceros cargada directamente por el navegador.

### M4g.3 · Añadir libro asistido — 180–240 min
- **Objetivo**: §6.1, §6.2 y estados §6.4 para libros.
- **Archivos**: `components/add-book-sheet.tsx` (nuevo), `library-views.tsx` (botones), `content-form.tsx` (entrada manual con título prellenado), `library-sync.tsx` (mensaje `duplicate_external`).
- **Base de datos**: ninguna.
- **Pruebas**: E2E de libros de §7; integración de la carrera de duplicados.
- **Riesgos**: teclado del iPhone en la hoja inferior; elección de edición confusa.
- **Aceptación**: los 8 pasos de LIBROS del encargo; manual intacto; sin conexión funciona; duplicados avisados.

### M4g.4 · Añadir podcast y episodio asistido — 200–260 min
- **Objetivo**: §6.3 con programas, 200 episodios recientes, búsqueda de anteriores y deduplicación.
- **Archivos**: `components/add-podcast-sheet.tsx` (nuevo), `library-views.tsx`, `item-detail.tsx` («Añadir episodio» en la ficha del programa abre el selector de ese programa).
- **Base de datos**: ninguna.
- **Pruebas**: E2E de podcasts de §7.
- **Riesgos**: el usuario espera ver todos los episodios (el texto lo explica: «Mostrando los 200 más recientes»); programas duplicados en Apple (agrupados).
- **Aceptación**: los 9 pasos de PODCASTS del encargo, con la salvedad documentada de los episodios antiguos (búsqueda); sin programas ni episodios duplicados.

**→ Versión mínima = M4g.1–M4g.4 (620–820 min). Validación y despliegue según D48 (M4g.9).**

### M4g.5 · Buscar y actualizar datos de lo ya guardado — 120–150 min
- **Objetivo**: §5.13 / §6.6 para libros, episodios y programas manuales o importados.
- **Archivos**: `components/metadata-update.tsx` (nuevo), `item-detail.tsx`, dominio `metadata/diff.ts`.
- **Base de datos**: ninguna.
- **Pruebas**: unitarias del comparador; E2E «solo rellena vacíos» y conflicto entre dispositivos.
- **Aceptación**: nada cambia sin marcarlo; un solo `update` por aplicación.

### M4g.6 · Portadas sin conexión (opcional) — 90–120 min
- **Objetivo**: caché de portadas en el service worker, acotada y borrada al cerrar sesión.
- **Archivos**: `public/sw.js`, `src/app/auth/signout/route.ts` o el cliente de cierre de sesión, tests de `test:browser`.
- **Riesgos**: el SW es delicado (M4f); hay que repetir la comprobación de arranque sin red.
- **Aceptación**: portadas vistas disponibles sin red; tras cerrar sesión no queda ninguna.

### M4g.7 · Google Books como respaldo (opcional; requiere tu clave) — 90–120 min
- Solo si la prueba real muestra huecos en Open Library. Clave en el servidor con cuota limitada; marca y enlaces de Google en sus resultados; resultados de Google en un bloque aparte (no se reordenan ni se mezclan).

### M4g.8 · Catálogo completo por RSS (opcional) — 240–300 min
- Feed por `collectionId` → `feedUrl`; `safeFetch` con validación DNS/IP por salto; parser XML (dependencia nueva a justificar, p. ej. `fast-xml-parser`, sin dependencias propias); límite de 5 MB.
- **Posible migración**: añadir `rss` a los proveedores (`CHECK` de `external_provider`) si se quieren deduplicar episodios que Apple no tiene. Alternativa sin migración: episodios del RSS sin referencia externa y deduplicados por programa + título + fecha.

### M4g.9 · Validación y despliegue — 60 min + CI
- Rama `ci/m4g` y procedimiento D48 completo, con tu autorización. Sin migración no hace falta copia previa obligatoria, pero se recomienda la de siempre.
- Prueba manual en ordenador e iPhone.

---

## 9. Riesgos, costes y decisiones pendientes

### 9.1 Riesgos
| # | Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|---|
| G1 | IP de salida de Vercel compartida: Apple (≈20/min) u Open Library limitan por IP y otros clientes gastan el cupo | Media | Búsqueda no disponible a ratos | Cortacircuitos, caché, mensajes claros y manual siempre |
| G2 | Cambios o caídas de las APIs públicas | Media | Búsqueda rota | Adaptadores aislados con tests de contrato; nunca bloquea el alta |
| G3 | Ruido en Open Library (resúmenes, duplicados, edición equivocada) | Alta | Elegir el libro equivocado | `rank.ts`, ficha de confirmación, selector de edición |
| G4 | Expectativa de «todos los episodios» | Alta | Frustración | Texto explícito, búsqueda de anteriores; RSS como opción |
| G5 | SSRF | Baja (lista cerrada) | Alto | `safeFetch`, saltos revalidados, sin RSS en la versión mínima |
| G6 | Proxy abierto vía cookie de demo | Media si no se cuida | Abuso en nuestro nombre | `getUser()` obligatorio en las rutas |
| G7 | Privacidad: los proveedores ven las consultas (no tu IP ni tu identidad) | Cierta | Bajo | Sin registros de consultas; nada del usuario sale salvo el texto buscado |
| G8 | Descripciones largas o en otro idioma ensucian Cerebro | Media | Búsqueda peor | Recorte a 2.000, aviso de idioma, desmarcable |
| G9 | Carrera de duplicados sin conexión | Baja | Avisos confusos (sin pérdida) | Mensaje propio y prueba de integración |
| G10 | Atribución insuficiente | Baja | Incumplir condiciones | «Datos: …» en búsqueda y ficha; enlace al origen |
| G11 | Hoja inferior y teclado del iPhone | Media | Incomodidad | Prueba manual específica; `visualViewport` |

### 9.2 Costes
- Proveedores de la versión mínima: **0 €**, sin claves.
- Vercel: invocaciones y transferencia muy por debajo de lo incluido.
- Google Books (opcional): 0 € con la cuota limitada en la consola.
- Sin nuevas dependencias en la versión mínima.

### 9.3 Decisiones pendientes (tuyas)
| Id | Decisión | Recomendación |
|---|---|---|
| G-P1 | Proveedores de la versión mínima | **Open Library + Apple, sin claves** |
| G-P2 | Google Books | **Aplazado (M4g.7)**; solo con tu clave y si Open Library se queda corto |
| G-P3 | Episodios antiguos | **Búsqueda de Apple en la versión mínima; RSS (M4g.8) solo si la echas en falta** |
| G-P4 | Identidad del libro | **Obra de Open Library en `external_id`; ediciones distintas como «Añadir igualmente» sin referencia** |
| G-P5 | Temas importados | **Solo como sugerencias** |
| G-P6 | Descripción importada | **Recortada a 2.000 caracteres, desmarcable** |
| D-UA | Contacto en el `User-Agent` de Open Library (3/s con email frente a 1/s sin él) | **«TheOnePercent/1.0 (+URL del repositorio)», sin tu correo**; 1/s basta para una persona. Si prefieres el límite mayor, un correo que elijas tú |
| D-CACHE | Caché del servidor | **Decidir en M4g.1** entre `use cache` y LRU en memoria, tras leer la guía de Next 16 |
| G-P7 | Portadas sin conexión (M4g.6) | **Después de la versión mínima** |
| G-P8 | Orden | **M4g.1 → .2 → .3 → .4 → validación; .5 justo después** |

---

## 10. Mantenimiento pendiente (fuera de M4g, sin ejecutar)
Registrado para no mezclarlo con M4g. Cada punto necesita tu autorización expresa.
1. **Rama `ci/m4`**: sigue en `f66b3b9` (igual que `main`). Borrarla en remoto es seguro tras tu visto bueno; no se ha tocado.
2. **Artefacto antiguo 12963160670** (contiene tu correo): evaluar borrarlo desde GitHub. Requiere tu autorización específica; no se ha tocado.
3. **Commits documentales locales sin publicar**: `9dfcb49`, `de7ec4f` y el commit de este plan. Publicarlos en `main` (avance directo, sin reescribir historia) cuando lo autorices; no cambian código.
4. **Avisos INFO de rendimiento en las tablas M4**: 4 claves foráneas sin índice propio (`knowledge_notes` ×3, `library_items` ×1) e índices sin usar en tablas casi vacías. Con el volumen de una persona no afectan; revisar con datos reales y, si procede, una migración aditiva de índices **separada de M4g**, con su copia y su ensayo.

---

## 11. Primer prompt de implementación (preparado, **no ejecutado**)

> THE ONE PERCENT — M4g.1: servidor de metadatos (sin interfaz)
>
> **Autorización**: implementar M4g.1 en local según `docs/m4g-plan.md` §5 y §8 (M4g.1), con las decisiones aprobadas: G-P1 (Open Library + Apple, sin claves), G-P4 (obra en `external_id`), D-UA (User-Agent sin correo) y D-CACHE (decidir en la subfase y documentarlo).
>
> **Alcance**:
> 1. Leer antes `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` y la guía de caché de Next 16 (AGENTS.md); `cacheComponents` está activo.
> 2. `src/features/library/metadata/`: tipos normalizados, adaptadores puros de Open Library (búsqueda, obra, edición, ISBN) y Apple (programas, Lookup de episodios, búsqueda de episodios), `normalize`, `rank` y `findDuplicates`, todo con Zod y tests con respuestas grabadas reales recortadas (sin datos personales) en `__fixtures__`.
> 3. `safeFetch` de servidor: lista cerrada de hosts de §5.9, solo https/443, redirecciones manuales revalidadas (máx. 3), tiempo y tamaño máximos, tipo de contenido y bytes mágicos para imágenes. Tests de cada regla.
> 4. Límite por usuario y por proveedor, cortacircuitos y 1 reintento acotado (§5.7).
> 5. Rutas `GET /api/metadata/books/search?q=`, `/books/detail?work=&edition=`, `/podcasts/search?q=`, `/podcasts/episodes?show=&q=`: `getUser()` obligatorio (la cookie de demo no basta → 401), respuesta normalizada ≤ 40 KB, `Cache-Control: private, no-store`, errores tipados (`provider_unavailable`, `rate_limited`, `bad_request`). Sin registrar consultas.
> 6. Origen de pruebas solo fuera de Vercel y en `http://127.0.0.1:<puerto>`; tests de integración de las rutas con un servidor local de fixtures.
>
> **Fuera de alcance**: interfaz, portadas (`/api/covers`), migraciones, claves, dependencias nuevas, cambios en la CSP o en el service worker, Google Books, RSS.
>
> **Restricciones**: las de siempre (separación de Neumáticos Uría, nada en la nube, sin push ni GitHub Actions, sin secretos en registros, no borrar nada, no reescribir historia). Ningún test llama a Internet. Si una regla de seguridad no se puede cumplir, detente y pregunta.
>
> **Entrega**: `npm run check` y `npm run e2e` en verde (E2E en Linux solo si la memoria lo permite; si no, dilo), commit local, sección «M4g.1» en `docs/m4g-plan.md` con resultados, decisiones tomadas (D-CACHE) y riesgos, y el plan concreto de M4g.2. Detente ahí.

---

## 12. M4g.1 · Servicio seguro de metadatos (31/10/2026, hecho en local)

Autorizado solo M4g.1: sin interfaz, sin despliegue y sin migraciones. Las decisiones aplicadas son D90–D93 de `docs/decisions.md`.

### 12.1 Endpoints y contratos
- Todos son `GET` y solo para usuarios verificados.
- Responden JSON con `Cache-Control: private, no-store` y `Vary: Cookie`.
- La respuesta es `{ ok: true, data }` o `{ ok: false, error: { code, retryAfter? } }`.

| Ruta | Parámetros (validados) | `data` | Proveedor |
|---|---|---|---|
| `/api/metadata/books/search` | `q`: 2–100 caracteres; un ISBN válido, con o sin guiones, se busca como ISBN exacto.<br>`by`: `any` (por defecto), `title`, `author` o `isbn`.<br>`lang`: `es` (por defecto) o `en`; es el idioma de la edición preferida | `BookResult[]`, hasta 10 | Open Library `search.json`. Si el ISBN no está en el índice: `/isbn/` → edición → obra → autores |
| `/api/metadata/books/detail` | `work` (`OL…W`) y, opcionalmente, `edition` (`OL…M`, que debe ser de esa obra) | Un `BookResult` con descripción y temas sugeridos. `creators` es `null`: los nombres vienen de la búsqueda | `/works/…json` y `/books/…json` |
| `/api/metadata/books/editions` | `work`, `lang` | `BookResult[]`: hasta 20 ediciones, primero las del idioma | `/works/…/editions.json` |
| `/api/metadata/podcasts/search` | `q` | `ShowResult[]`: hasta 10, sin los duplicados de Apple | iTunes Search (`entity=podcast`, tienda ES) |
| `/api/metadata/podcasts/episodes` | `show` (`collectionId`) y, opcionalmente, `q` | `EpisodeList`.<br>Sin `q`: los 200 más recientes (`scope: "recent"`, con `total` y `complete`).<br>Con `q` (`scope: "search"`): las coincidencias entre los recientes, más la búsqueda de episodios de Apple filtrada por programa | iTunes Lookup y Search (`entity=podcastEpisode`) |

**Errores:**
| Código | HTTP | Cuándo |
|---|---|---|
| `unauthorized` | 401 | Sin sesión verificada |
| `unavailable` | 503 | Auth no configurado o caído |
| `bad_request` | 400 | Parámetros no válidos |
| `rate_limited` | 429 | Cuota del usuario agotada |
| `provider_busy` | 503 | Cuota propia del proveedor, o un 429/403 del proveedor |
| `provider_unavailable` | 502 | 5xx, tiempo agotado, respuesta malformada o cortacircuitos abierto |
| `not_found` | 404 | Obra o programa inexistente |

`Retry-After` acompaña los errores en los que esperar ayuda. Los textos en español para la interfaz están en `METADATA_ERROR_TEXT`.

### 12.2 Datos normalizados (`src/features/library/metadata/types.ts`)
- **`BookResult`**:
  - obra (`workId`) y edición (`editionId`) por separado;
  - título de la edición, con `workTitle` si el de la obra es distinto, y subtítulo;
  - creadores e idioma (ISO 639-1);
  - año de la edición y de la obra, editorial y páginas;
  - ISBN-13/10 y portada canónica;
  - descripción (≤ 2.000 caracteres) y temas sugeridos (≤ 10);
  - número de ediciones, enlace y atribución.
- **`ShowResult`**: id de Apple, nombre, autor, portada de 600 px, enlace, número de episodios, último lanzamiento y géneros sugeridos.
- **`EpisodeResult`**: id, programa (id y nombre), título, descripción (≤ 2.000), duración en segundos, instante de publicación, portada, enlace y atribución.

**Reglas:**
- **Nada se infiere.** Lo que no viene es `null` (o `[]`).
  - Las páginas del índice de búsqueda son la mediana de todas las ediciones, así que no se usan.
  - La única derivación es el ISBN-13 a partir de un ISBN-10 válido, que es una conversión exacta.
- **Dos ediciones o dos obras nunca se fusionan.** Solo se agrupan las entradas duplicadas de Apple: mismo feed, o mismo nombre y autor.
- **Texto plano siempre:**
  - se quitan las etiquetas, y las de `script` y `style` con su contenido;
  - las entidades se decodifican después, así que una etiqueta codificada queda como texto visible;
  - todo cumple ya las reglas de `validation.ts`;
  - el cliente vuelve a validar cada respuesta con Zod.
- **Paso a M4** (`to-input.ts`): `toBookInput`, `toShowInput` y `toEpisodeInput` producen la entrada de `createItem` o `createShow`, el mismo camino que el alta manual.
  - Estado, valoración, temas y si se guarda la descripción los elige el usuario.
  - `separateEdition` guarda otra edición sin referencia externa (D90).
  - La fecha del episodio se calcula en la zona horaria del perfil.

### 12.3 Duplicados (`duplicates.ts`)
Se buscan en la copia local, así que también funciona sin conexión.

| Nivel | Libros | Episodios | Programas | Efecto |
|---|---|---|---|---|
| `exact` | Misma obra de Open Library | Mismo `trackId` | Mismo `collectionId` | Impide reutilizar **la misma referencia** (`canUseExternalRef`). Otra edición se puede guardar igualmente |
| `strong` | Mismo ISBN, también ISBN-10 frente a ISBN-13 | — | — | Solo aviso |
| `possible` | Mismo título sin subtítulo y algún autor en común (o sin autores) | Mismo título en el mismo programa | Mismo nombre y autor compatible | Solo aviso |

`existingShow` reutiliza el programa local que ya es ese programa de Apple. Ninguna función modifica datos.

### 12.4 Seguridad
- **Autenticación** (`server/auth.ts`):
  - cada llamada se verifica con `getUser()` contra el servidor de Auth; la cookie nunca se da por buena sin más;
  - la cookie de demo no cuenta;
  - las cookies solo se leen: el refresco de la sesión sigue en `src/proxy.ts`.
- **Proxy:**
  - una llamada a `/api/*` sin sesión recibe 401 en JSON;
  - con la cookie de demo llega a la ruta, que responde 401;
  - las páginas siguen redirigiendo a `/login`.
- **Orden de comprobación:** usuario → cuota del usuario → parámetros → servicio. Nada sale del servidor antes de las tres primeras.
- **Sin proxy genérico:** las URL externas se construyen a partir de identificadores validados con expresiones regulares (`OL…W`, `OL…M`, `OL…A`, ISBN-13 y `collectionId`). La consulta solo entra como valor de un parámetro.
- **`safeFetch`**, en cada salto:
  - lista cerrada de hosts exactos: `openlibrary.org` e `itunes.apple.com`;
  - solo https, puerto 443, sin credenciales ni IP literales;
  - **todas** las direcciones DNS deben ser públicas. Se rechazan las de bucle, privadas, *link-local*, CGNAT, multidifusión, documentación, IPv4 mapeada, NAT64 y 6to4;
  - como máximo 3 redirecciones manuales;
  - un tiempo máximo para la petición entera: 6 s para Open Library y 4 s para Apple;
  - tamaño máximo leído por streaming: 1 MB para Open Library y 2 MB para Apple;
  - tipo de contenido esperado y JSON válido;
  - `credentials: "omit"`, sin cookies ni cabeceras del usuario;
  - `User-Agent` técnico, sin correo.
- **Riesgo residual documentado:** *DNS rebinding* entre nuestra resolución y la de `fetch`. Es teórico con dos hosts públicos de proveedores. Evitarlo fijando la IP exigiría un agente de red propio, que hoy no se justifica.
- **Build:** las cinco rutas salen como dinámicas (`ƒ`), así que no se ejecuta nada al compilar.
- **Registros:** no se registran consultas, sesiones ni identificadores.

### 12.5 Cuotas, caché y resiliencia (lo aplicado)
- **Cuotas y cortacircuitos:** D92. **Caché:** D93. Todo vive en memoria y por instancia: no persiste en Vercel y se da por perdido en cualquier momento.
- **El servidor no guarda ninguna búsqueda de texto.** El cliente (`search-controller.ts`) recuerda hasta 30 respuestas de la sesión, solo en memoria.
- **Respaldos autorizados:**
  - un ISBN que no está en el índice se busca por el registro de la edición;
  - si falla la búsqueda de episodios antiguos, se devuelven las coincidencias entre los recientes;
  - Apple y Open Library tienen cortacircuitos separados: los fallos de uno no afectan al otro.
- **Capa de cliente reutilizable para M4g.3 y M4g.4:**
  - `createSearchController`:
    - debounce de 350 ms; un ISBN se busca al momento;
    - cancela la petición anterior e ignora las respuestas tardías;
    - caché de la sesión;
    - estados `idle`, `waiting`, `loading`, `done`, `error` y `offline`; sin conexión no hace peticiones;
    - `retry`.
  - `metadataClient`: peticiones al mismo origen con validación Zod. Una página HTML o una respuesta deforme nunca llegan como datos.

### 12.6 Medidas reales (`npm run explore:metadata`, 31/10/2026)
- **Búsqueda de libros** normalizada: **≈2 KB**.
- **200 episodios de *La Ruina*** normalizados: **≈214 KB**, frente a ~460 KB del proveedor. Vercel la sirve comprimida.
  - Es **más que los 40 KB estimados** en §5.2, por las descripciones (≤ 2.000 caracteres cada una).
  - Si en M4g.4 resulta lenta en el móvil, la alternativa es una lista sin descripciones y el detalle al elegir el episodio. No se cambiará sin medirlo antes en el iPhone.
- **Proveedores reales**, por el mismo camino que en producción: **3/3**.
  - Libros en español e inglés por título, autor e ISBN; ficha y ediciones.
  - Programas en español e inglés, 200 episodios recientes y un episodio antiguo (el n.º 89) encontrado por búsqueda.

### 12.7 Pruebas
- **121 unitarias nuevas** en 7 ficheros, con respuestas reales grabadas y recortadas (`__fixtures__`). **Ninguna llama a Internet.**
  - Limpieza de texto.
  - Adaptadores de Open Library y Apple: español, inglés, ISBN, datos incompletos y respuestas malformadas.
  - Consultas y ordenación.
  - Duplicados y ediciones.
  - Compatibilidad con M4: `createItem` y `createShow`, `validation.ts` y la ida y vuelta por el formato de sincronización.
  - `safeFetch`:
    - 24 direcciones bloqueadas y 5 públicas;
    - redirecciones peligrosas y bucles;
    - tamaño por cabecera y por streaming;
    - tiempo, tipo y JSON.
  - Límites.
  - Servicio:
    - 429 y 404;
    - 5xx con un solo reintento;
    - cortacircuitos y tiempo agotado;
    - respuestas malformadas;
    - cuota de Apple, respaldos y caché.
  - Rutas:
    - anónimo, demo y token no verificado;
    - 400 sin llamadas externas;
    - cuota por usuario y aislamiento entre usuarios;
    - traducción de errores.
  - Controlador de búsqueda y cliente.
- **Mutaciones:** desactivar la comprobación de direcciones hace fallar 1 prueba y desactivar la del destino, 7. Después se restauró el código.
- **3 de integración nuevas**, con sesiones reales de dos usuarios sintéticos en el stack local:
  - una sesión verdadera identifica a su usuario;
  - sin cookie, con la cookie de demo o con un token con la firma alterada: anónimo y 401, sin llamadas externas;
  - la cuota de un usuario no afecta al otro;
  - fuera solo salen parámetros.
- **HTTP sobre el build de producción** (`next start`):
  - anónimo: 401 en JSON;
  - demo: 401;
  - demo con sesión falsa: 401;
  - POST: 405;
  - una página sin sesión sigue respondiendo 307 a `/login`.
- **3 exploratorias reales**, fuera de `npm test` y de la CI (`vitest.explore.config.mts`): 3/3.

### 12.8 Resultados (31/10/2026)
| Suite | Resultado |
|---|---|
| `npm run check` (tipos, lint y unitarias) | **636/636** (515 anteriores y 121 nuevas), sin errores de tipos ni de lint |
| `npm run test:integration` (stack local) | **148/148** (145 anteriores y 3 nuevas) |
| `npm run build` | Correcto; las 5 rutas nuevas son dinámicas (`ƒ`) |
| HTTP sobre el build de producción | 5/5 comprobaciones (§12.7) |
| `npm run explore:metadata` (proveedores reales, fuera de la CI) | 3/3 |
| `npm run e2e` (Windows, 2 workers) | **NO VÁLIDA, sin conclusión.** Se listaron y lanzaron las 342: 163 superadas, 25 omitidas y 154 fallidas. Las 154 fallidas son exactamente las 154 caídas de proceso (`Target crashed`, o un worker terminado con código `0xC0000142`, fallo de Windows al iniciar un proceso por falta de recursos); **ninguna es un fallo de aserción** ni toca `/api/`. Claude Code paró la ejecución por falta de memoria del sistema (≈2,2 GB libres) y no se ha relanzado. **La regresión E2E de M4g.1 está pendiente**: en la CI remota (`ci/m4g`, con autorización) o en local cuando haya memoria suficiente. **Validada después en Linux (§13): 630 superadas, 54 omitidas, 0 fallidas** |

### 12.9 Impacto en la arquitectura
- **Nuevo:**
  - `src/features/library/metadata/`: dominio puro y cliente;
  - `src/features/library/metadata/server/`: servicio;
  - `src/app/api/metadata/**`: 5 rutas finas.
- **Cambiado:**
  - `src/proxy.ts`: 401 en JSON para `/api/*` sin sesión;
  - el script `explore:metadata` y `vitest.explore.config.mts`.
- **Sin cambios:** sincronización, IndexedDB, motor, service worker (sigue sin tocar `/api/`), CSP, migraciones, dependencias e interfaz.

### 12.10 Requisitos para M4g.2 y M4g.3
- **M4g.2 (portadas):**
  - `/api/covers` solo acepta URLs que pasen `isCanonicalCoverUrl`: `covers.openlibrary.org/b/id/{n}-{S|M|L}.jpg` y la imagen de Apple en `isN-ssl.mzstatic.com`.
  - La lista de `safeFetch` se amplía **solo para esa ruta**: `covers.openlibrary.org`, `archive.org`, `/^ia\d+\.us\.archive\.org$/` (las dos redirecciones medidas) e `is1`–`is5-ssl.mzstatic.com`.
  - Como los hosts de `archive.org` cambian, `checkDestination` tendrá que aceptar expresiones regulares ancladas, con sus pruebas. Hoy solo admite nombres exactos.
  - Validar los bytes mágicos (JPEG, PNG o WebP) y rechazar el GIF de 43 bytes y cualquier imagen de menos de 1 KB. Límites: 2 MB y 5 s.
  - La misma autenticación (`callerOf`) y una cuota propia por usuario.
  - `CoverArt` con la imagen y la portada tipográfica de respaldo, sin saltos en la maquetación.
- **M4g.3 (añadir libro):**
  - `createSearchController` y `metadataClient` para buscar; `findBookMatches` antes de guardar; `toBookInput` con lo que elija el usuario.
  - **Duplicados:** los avisos `strong` y `possible` no impiden guardar. El `exact` ofrece «Abrir» o «Añadir como otra edición».
  - Un mensaje propio para `duplicate_external` en `LibraryConflicts` (§5.4).
  - **E2E:** el navegador no puede interceptar las llamadas del servidor, así que hace falta un origen de prueba para los proveedores.
    - Propuesta: una variable que solo se respete fuera de Vercel y en `http://127.0.0.1:<puerto>`, con un servidor local de fixtures en Playwright.
    - Obliga a admitir ese host en `safeFetch` solo en pruebas, así que se revisará como cambio de seguridad.

## 13. M4g.1 · Validación remota en `ci/m4g` (31/10/2026)

### 13.1 Auditoría previa
- **Árbol limpio.** HEAD `b5ad26b` desciende de `origin/main` = `ci/m4` = `f66b3b9`, y `ci/m4g` no existía.
- **Commits que publica la rama** (5, todos de este repositorio y con la identidad `noreply`, D88):
  - tres documentales anteriores: `9dfcb49`, `de7ec4f` y `8a3dd95`;
  - los dos de M4g.1: `67bccd8` y `b5ad26b`.
  - Los documentales suben como antecesores del HEAD, **solo en `ci/m4g`**, no en `main`.
- **Diff contra `origin/main`:**
  - sin migraciones ni cambios en `package-lock.json`, `.github` o `supabase/`;
  - en `package.json`, solo el script `explore:metadata`.
- **Sin secretos ni datos personales.** Los únicos correos son URLs de prueba con credenciales, que deben rechazarse, y un contacto público de un podcast de terceros dentro de una fixture.
- **Las cinco rutas exponen solo `GET`.** La comprobación del usuario va antes que la cuota, los parámetros y cualquier llamada externa. Probado con sesiones reales; la cookie de demo y un token alterado dan 401.
- **Datos de las pruebas:** solo usuarios sintéticos `@theonepercent.local` en el stack local.
- **SSRF:** la ventana DNS entre validar y conectar está documentada (§12.4) y tiene una solución propuesta para M4g.2 (§14.2).
- **Cuotas y caché:**
  - se documentan como de cada instancia, no globales (D92, D93);
  - las respuestas son `private, no-store`;
  - la caché del servidor solo guarda registros públicos por id; nunca sesiones ni búsquedas.
- **Workflow:** `ci/**` lanza la CI con 2 pasadas y `E2E_SKIPS_PER_PASS = 27`, y `vercel.json` desactiva los despliegues de `ci/**`. Las pruebas exploratorias (`*.explore.ts`) no entran en la CI.
- **Pruebas omitidas: 27 frente a 25.**
  - Las 27 omisiones por pasada son `test.skip(...)` que se evalúan **dentro** de cada prueba.
  - En la ejecución local invalidada, las dos únicas pruebas que se omiten en escritorio (`habits.spec.ts:54` y `navigation.spec.ts:30`, «mobile only») cayeron antes de llegar a su `test.skip`, y contaron como fallidas: 27 − 2 = 25.
- **Presupuesto de Actions:**
  - el repositorio es privado y la ejecución anterior en `ci/**` duró unos 30 minutos;
  - la herramienta de solo lectura no permite consultar la facturación de la cuenta, así que el saldo de minutos no se pudo verificar.

### 13.2 Ejecución
- **Push normal:** `b5ad26b → ci/m4g`, rama nueva y sin forzar. `main` y `ci/m4` no se tocaron.
- **Run** [41229248953](https://github.com/danimendi7/the-one-percent/actions/runs/41229248953) sobre `b5ad26b12053784b942abbbf34d467c8989db5c6`, por un `push`: **éxito**, de 18:24 a 19:02 UTC (38 min). Runner de 2 CPU y 7,7 GB, 2 pasadas, 2 workers.

Recuentos leídos de los artefactos y comprobados por las puertas de `ci-gate.mjs`:

| Suite | Resultado |
|---|---|
| Tipos y lint | Correctos |
| Unitarias | **636/636** en 54 ficheros. Incluye las 121 de `library/metadata` (7 ficheros); 0 omitidas |
| Aislamiento | Supabase efímero en `127.0.0.1:55321` dentro del runner, sin credenciales de la nube ni secretos del repositorio en los workflows |
| Integración | **148/148** en 9 ficheros. `metadata-auth.int.test.ts`: 3/3 |
| `test:browser` | **6/6** |
| E2E (2 pasadas) | **630 superadas y 54 omitidas** (27 × 2). 342 listadas por pasada y 684 resultados (342 × 2): 0 fallidas, 0 inestables, 0 interrumpidas, 0 errores globales, 0 reintentos, las 20 specs presentes |
| Smoke | **22/22** |
| Revisión de secretos de la CI | 9 ficheros, 0 eliminados |

### 13.3 Escenarios críticos
1. **API sin sesión → 401, y las páginas siguen igual.** Pruebas de rutas y HTTP sobre el build (§12.7); la E2E de navegación y de cuenta pasa completa.
2. **La demo no consulta proveedores:** pruebas de rutas y de integración (cookie de demo → 401 sin llamadas externas).
3. **Respuestas malformadas:** se rechazan o se normalizan (pruebas de adaptadores y del servicio).
4. **Límites de tamaño y tiempo:** pruebas de `safeFetch`, tanto por cabecera como por streaming, y del tiempo máximo.
5. **URLs y redirecciones peligrosas:** se rechazan sin hacer la petición (24 direcciones bloqueadas y 6 redirecciones).
6. **Nada guardado se modifica:** los metadatos solo crean entradas nuevas por las operaciones de M4. La prueba `matching.test.ts` comprueba que el libro ya existente queda idéntico (`toBe`).
7. **Sin conexión de M4:** `offline.spec.ts` superada en móvil y escritorio, en las dos pasadas.
8. **M2 y M3:** todas sus specs E2E y de integración superadas.
9. **Supabase Cloud:**
   - la CI no tiene credenciales de la nube (puerta de aislamiento);
   - la verificación de solo lectura de la nube tras la ejecución da **27/27**: 11 migraciones y funciones idénticas al fichero.
10. **Auth y `newAccount`:** ningún error de autenticación.
    - Hubo 4 avisos informativos `[newAccount] slow`, todos en la etapa `status`: la primera llamada a `npx supabase status` de cada proceso worker, que luego queda en caché, tardó 3,1–3,9 s en un runner de 2 CPU (el umbral es 3 s).
    - Auth y la base tardaron menos de 0,5 s, y las pruebas afectadas pasaron.
    - En las ejecuciones 41212978680 y 41217079580 hubo 0 avisos. M4g.1 no toca ese código; queda como observación.

### 13.4 Estado final
- **Vercel:** ningún estado ni despliegue para `b5ad26b`; no se creó Preview. Producción sigue sirviendo `f66b3b931aac`.
- **Ramas remotas:** `main` = `ci/m4` = `f66b3b9` y `ci/m4g` = `b5ad26b`.
- **Supabase Cloud:** sin cambios (13.3, punto 9).
- **Sin repeticiones de la CI, sin pushes adicionales y sin borrar nada.**

## 14. M4g.2 · Revisión previa del proxy de portadas (31/10/2026, **sin implementar**)

Esta sección solo documenta. No se amplía ninguna lista de destinos y no existe `/api/covers`.

### 14.1 Hosts y redirecciones (medido el 31/10/2026, §4.1)
| Proveedor | URL canónica guardada | Cadena real | Hosts que habría que permitir |
|---|---|---|---|
| Open Library | `https://covers.openlibrary.org/b/id/{n}-{S\|M\|L}.jpg` | `covers.openlibrary.org` → 302 `archive.org` → 302 `iaNNNNNN.us.archive.org` (JPEG, `max-age=10800`) | `covers.openlibrary.org`, `archive.org` y el patrón anclado `^ia\d{6}\.us\.archive\.org$` |
| Apple | `https://isN-ssl.mzstatic.com/image/thumb/…/600x600bb.jpg` | Directo, sin redirecciones (JPEG, `max-age` de unos 6 meses) | `is1`–`is5-ssl.mzstatic.com` (5 nombres exactos) |

**Comportamientos de los proveedores que hay que tener en cuenta:**
- Una portada inexistente de Open Library pedida por id devuelve **200 con un GIF de 43 bytes**.
- `?default=false` solo da 404 en las consultas por ISBN, que están limitadas a 100 cada 5 minutos por IP. Por eso solo se guardan portadas por id.

**Propuesta:**
- Una lista **propia de la ruta de portadas**, separada de la de metadatos, para que esta no se amplíe.
- `checkDestination` acepta además expresiones regulares ancladas, con pruebas de casos límite: `ia1.us.archive.org.evil.example`, `xia123456.us.archive.org` y puntos finales.
- Como máximo 3 redirecciones, cada una validada (hoy se usan 2).
- El parámetro de entrada solo puede ser una URL que pase `isCanonicalCoverUrl` (que ya existe y tiene pruebas). Ninguna otra URL se acepta, ni siquiera de esos hosts.

### 14.2 Direcciones privadas y cambios de DNS
- **Hoy (M4g.1):** resolvemos el nombre, validamos todas sus direcciones y después `fetch` vuelve a resolver. Queda una ventana teórica de *DNS rebinding* entre las dos resoluciones (§12.4).
- **Propuesta para M4g.2, también aplicable a los metadatos y sin dependencias nuevas:** pedir con `node:https` en lugar de `fetch` y pasarle una función `lookup` propia. Esa función resuelve el nombre, rechaza cualquier dirección bloqueada (`isBlockedAddress`) y devuelve **la dirección validada, que es exactamente a la que se conecta el socket**.
  - El certificado TLS se sigue comprobando contra el nombre (SNI), así que no se pierde la verificación del servidor.
  - Elimina la ventana entre validar y conectar.
- **Alternativa descartada:** `undici` con un `Agent` y `connect.lookup`. Exige instalar `undici` como dependencia, porque Node no lo expone para importarlo.
- **Pruebas:**
  - un `lookup` que devuelve primero una dirección pública y después una privada: la conexión usa la validada o se rechaza;
  - IPv6 mapeada;
  - redirección a un host permitido que resuelve a una dirección privada.

### 14.3 Imágenes, autenticación y sesiones
- **Las imágenes no necesitan autenticación ante los proveedores:** las portadas de Open Library y de Apple son públicas. El proxy las pide sin cookies, sin `Authorization` y sin `Referer` del usuario. No hay peticiones autenticadas adicionales hacia terceros.
- **El navegador envía las cookies de sesión** con `<img src="/api/covers?…">`, porque es del mismo origen. La ruta verifica al usuario igual que los metadatos, así que la cookie de demo y las sesiones falsas reciben 401. `<img>` no puede añadir cabeceras, y no hace falta.
- **Coste de verificar cada imagen.** Una cuadrícula de 60 portadas implicaría unas 120 llamadas al servidor de Auth: `getUser()` en `src/proxy.ts` y otra vez en la ruta.
  - La nube firma con **ES256**, lo que se comprobó en la JWKS pública del proyecto.
  - Así, `auth.getClaims()` verifica la firma **en local**, con la JWKS en caché en cada instancia.
  - **Propuesta:** en `/api/covers`, `getClaims()` en lugar de `getUser()`.
  - **Contrapartida:** una sesión cerrada en otro dispositivo sigue siendo válida para portadas hasta que caduca el token (≈1 h). Es aceptable porque una portada es un dato público; los metadatos mantienen `getUser()`.
  - El doble trabajo en `src/proxy.ts` para `/api/covers` (refrescar la sesión) se mide antes de tocarlo.
- **Sesión caducada o sin conexión:** la imagen falla (401 o error de red) y `CoverArt` muestra la portada tipográfica. Nunca se ve una imagen rota ni se pide iniciar sesión por una portada.

### 14.4 Caché y condiciones de los proveedores
- **Respuesta del proxy:** `Cache-Control: private, max-age=2592000, immutable`. La URL canónica de una portada no cambia de imagen.
  - `private`: la CDN de Vercel no la guarda (la ruta exige sesión). Cada dispositivo la pide una vez y después la sirve su caché HTTP.
  - Sin caché en el servidor: las imágenes pesan de 16 a 100 KB. Una caché en memoria por instancia aporta poco y consume RAM de la función.
- **Open Library:**
  - pide cachear;
  - la Covers API es para mostrar portadas, no para descargas masivas;
  - por id no hay límite publicado (por ISBN sí, y no se usa);
  - se aprecia un enlace a Open Library, que ya figura en la ficha (`sourceUrl` y atribución).
- **Apple:**
  - las portadas son material promocional para enlazar con su tienda;
  - se muestran junto al enlace a Apple Podcasts (`sourceUrl`) y la atribución «Datos: Apple Podcasts»;
  - no se modifican ni se usan para otra cosa.
- **Límites propuestos:** 120 portadas por minuto por usuario; 2 MB y 5 s por imagen; tipos JPEG, PNG o WebP según sus bytes mágicos; rechazo de GIF y de imágenes de menos de 1 KB; cortacircuitos por proveedor como en D92.

### 14.5 Respaldo tipográfico y sin conexión
- `CoverArt` pinta siempre primero la portada tipográfica actual y pone la imagen encima, con la misma proporción y `object-cover`. Ante un error, un tamaño mínimo no superado o un tiempo agotado, la imagen se retira sin que se mueva nada.
  - `loading="lazy"` y `decoding="async"`.
  - `alt=""` en las listas (el título ya es texto) y «Portada de …» en la ficha.
- **Sin conexión:**
  - el service worker sigue sin tocar `/api/`;
  - una portada ya vista puede salir de la caché HTTP del navegador;
  - en iPhone (PWA instalada) no está garantizado, y entonces se ve la tipográfica;
  - una caché propia de portadas en el SW, borrada al cerrar sesión, sigue siendo M4g.6, aparte.
- **Demo:** no tiene portadas externas, así que no cambia.

### 14.6 Riesgos de M4g.2
| Riesgo | Mitigación |
|---|---|
| `archive.org` cambia sus nombres de servidor | Patrón anclado con pruebas; si falla, la tipográfica |
| Un proveedor añade protección contra enlaces externos | La imagen falla y se ve la tipográfica; no hay nada que autenticar |
| Coste de Auth por imagen | `getClaims()` local (ES256) y caché HTTP de 30 días |
| Memoria de la función con imágenes grandes | Corte a 2 MB en streaming |
| Saltos de diseño | Misma caja y proporción, la imagen se superpone |
| *DNS rebinding* | `node:https` con `lookup` validado (§14.2) |

**Estimación:** 120–150 minutos, sin migraciones ni dependencias nuevas.
- Incluye el cambio de transporte a `node:https`, también para los metadatos, con sus pruebas.
- Requiere tu autorización.

## 15. M4g.2 · Portadas reales con respaldo tipográfico (31/10/2026, hecho en local)

Autorizado solo en local, después de cerrar la validación de M4g.1. Para empezar se volvieron a comprobar:
- el run 41229248953 (éxito, intento 1, `b5ad26b`) y los recuentos de sus artefactos;
- que no hay Preview en Vercel y que `main` = `f66b3b9`;
- la nube en solo lectura (27/27).

Decisiones: D94–D95 en `docs/decisions.md`.

### 15.1 Endpoint
`GET /api/covers?ol={id}&s={sm|md|lg}` o `GET /api/covers?apple={1–5}:{ruta}&s={sm|md|lg}`

- **Solo identificadores** (`covers.ts`), nunca una URL:
  - Open Library por su **id de portada** (nunca por ISBN);
  - Apple por el número de host `isN-ssl` y la ruta de la imagen, con la forma exacta de Apple (`Podcasts…/v4/xx/xx/xx/<uuid>/<fichero>.jpg|jpeg|png`).
  - Se rechazan los parámetros desconocidos, repetidos o de más, y cualquier `url` o `src`.
- **Reconstrucción**: la URL externa se rehace en el servidor a partir del identificador (`coverUpstreamUrl`).

  | Tamaño | Open Library | Apple |
  |---|---|---|
  | `sm` (fila de lista) | `-M` | 100 px |
  | `md` (cuadrícula) | `-M` | 300 px |
  | `lg` (ficha) | `-L` | 600 px |

- **Lo que se guarda en la Biblioteca** sigue siendo la URL canónica (`cover.url`). Solo se convierte en imagen si pasa `coverKeyOf`; `isCanonicalCoverUrl` y `appleArtwork` usan ahora esa misma validación estricta.
- **Respuesta correcta**: los bytes de la imagen, con el tipo **comprobado por sus primeros bytes** y `Cache-Control: private, max-age=2592000, immutable`, `Content-Disposition: inline` y `Cross-Origin-Resource-Policy: same-origin`.
- **Respuestas de error** (`no-store`, sin cuerpo):

  | Código | Cuándo |
  |---|---|
  | 401 | Sin sesión verificada (también con la cookie de demo) |
  | 503 | Auth no disponible, o el proveedor está ocupado (con `Retry-After`) |
  | 400 | Parámetros no válidos |
  | 429 | Cuota por usuario agotada |
  | 404 | Sin portada |
  | 502 | Fallo del proveedor |

### 15.2 Hosts y redirecciones (medidas reales del 31/10/2026)
- **Primer salto**: seis nombres exactos, `covers.openlibrary.org` e `is1`–`is5-ssl.mzstatic.com`.
- **Open Library**: algunas portadas (las recientes, o el id 1) las sirve el propio host. Las demás siguen **esta cadena exacta, y solo esta**:
  ```
  covers.openlibrary.org/b/id/{n}-{T}.jpg
  → archive.org/download/{t}_covers_{dddd}/{t}_covers_{dddd}_{dd}.zip/{n con 10 dígitos}-{T}.jpg
  → ia{dddddd}.us.archive.org/view_archive.php?archive=/{d}/items/{t}_covers_{dddd}/{t}_covers_{dddd}_{dd}.zip&file={n con 10 dígitos}-{T}.jpg
  ```
  - Cada salto tiene que venir del host anterior y nombrar **el mismo id y el mismo tamaño**.
  - El nodo de almacenamiento (`ia` + 6 dígitos + `.us.archive.org`) **solo** se acepta como destino de `archive.org`, con esa ruta y exactamente los parámetros `archive` y `file`.
  - **No hay ningún patrón de host abierto**: un `ia…` sin el salto previo de `archive.org`, o con otro fichero, se rechaza.
- **Apple**: sin redirecciones. Cualquier redirección se rechaza.
- **Límite**: como máximo 2 redirecciones.

### 15.3 Direcciones privadas y cambios de DNS
- **Antes de cada salto**: se resuelve el nombre y se rechaza si **alguna** dirección es privada, de bucle, *link-local*, CGNAT, de multidifusión, de documentación, IPv4 mapeada, NAT64 o 6to4 (`isBlockedAddress`).
- **Conexión fijada**: el transporte por defecto es ahora `node:https` con un `lookup` validador (`validatingLookup`). El socket se conecta **exactamente a las direcciones comprobadas en ese momento**, así que un nombre que cambie a una dirección privada después de la primera comprobación no se alcanza: se rechaza con `blocked`. Hay una prueba con un resolvedor que primero da una dirección pública y después una privada.
  - Sin reutilizar conexiones (`agent: false`).
  - El certificado TLS se sigue verificando contra el nombre.
  - Los cuerpos comprimidos se rechazan; no se piden.
- **También lo usa M4g.1**: los metadatos pasan por el mismo transporte, lo que cierra el riesgo residual de §12.4. El comportamiento con Open Library y Apple se volvió a comprobar con los proveedores reales.

### 15.4 Validación de la imagen
- Respuesta 200 exacta; 206 y similares se rechazan.
- Tipo declarado `image/jpeg`, `png` o `webp`. Un GIF declarado se lee para clasificarlo como «sin portada».
- **Los primeros bytes deben demostrar el mismo tipo declarado**: un PNG declarado como JPEG, un HTML o un GIF se rechazan.
- Al menos 1 KB (el GIF de relleno pesa 43 bytes) y como máximo 2 MB, leídos por streaming y cortados al pasar el límite.
- 5 s para la petición entera, redirecciones incluidas.
- En el navegador, además: menos de 16 × 16 píxeles cuenta como fallo y se queda la portada tipográfica.

### 15.5 Autorización y caché, separadas
- **Autorización**:
  - la ruta verifica al usuario con `getUser()` en el servidor de Auth (`callerOf`, el mismo de M4g.1);
  - la cookie de demo o una sesión falsa dan 401;
  - cuota de 120 portadas a la vez y 120 por minuto por usuario; por proveedor y por instancia, 120/min para Open Library y 240/min para Apple.
- **El proxy no toca `/api/covers`** (`src/proxy.ts`). Así una respuesta de imagen **nunca lleva un `Set-Cookie`** de refresco de sesión. Si la sesión ha caducado, la imagen da 401 y se ve la tipográfica; la sesión se refresca en la siguiente navegación.
- **Caché**:
  - solo una imagen comprobada es cacheable, y solo por el navegador (`private`): ninguna caché compartida puede guardarla, porque la ruta exige sesión;
  - en el servidor no se guarda nada;
  - las imágenes son públicas, y al proveedor no llega nada del usuario: sin cookies, sin `Authorization` y con `credentials: "omit"`;
  - la URL de la petición solo lleva el identificador del proveedor.
- **Condiciones de los proveedores**:
  - Open Library pide cachear y desaconseja las descargas masivas; aquí se pide por id, solo lo que se ve y una vez por dispositivo;
  - las imágenes de Apple se muestran junto al enlace y la atribución que la ficha ya tiene, sin modificarlas.
- **Service worker**: sin cambios; sigue sin tocar `/api/`. **Las portadas no se guardan en el SW**; eso queda pendiente (M4g.6) de autorización y revisión.

### 15.6 `CoverArt`
- **La portada tipográfica se pinta siempre.** La imagen se superpone en la misma caja (`absolute inset-0`, `object-cover`) y aparece cuando ha cargado bien (`opacity`, sin animación con `prefers-reduced-motion`).
  - Si falla, está cargando, no hay conexión, no hay sesión o es la demo, se queda la tipográfica, **sin icono de imagen rota y sin que se mueva nada**.
  - Mantiene la proporción: 2:3 en libros y 1:1 en programas y episodios.
- **Carga**: `loading="lazy"` y `decoding="async"`. El estado se guarda por dirección, así que cambiar de portada empieza de cero.
- **Accesibilidad**:
  - decorativa en listas y cuadrículas (`aria-hidden`; el título ya está como texto);
  - en la ficha, `role="img"` con «Portada de …», sea cual sea la portada visible.
- **Atributo de prueba**: `data-cover` = `image` o `typographic`.
- **Uso**: cuadrícula y lista de libros y episodios, cuadrícula de programas, y fichas de contenido y de programa.
  - **Solo se muestran portadas externas válidas**: las subidas por el usuario (`source: "upload"`, sin Storage todavía) o las URLs no reconocidas mantienen la tipográfica.
  - **Nada se escribe**: M4g.2 no crea, cambia ni sustituye la portada de ningún elemento.

### 15.7 Medidas reales (`npm run explore:metadata`)
- **Tamaños**:
  - Open Library: 19–20 KB (`-M`);
  - Apple: 6 KB (100 px), 31 KB (300 px) y 101 KB (600 px).
- **`archive.org` va lento**. El 31/10/2026, el salto de `archive.org` tardó **3,4–8,2 s con `curl`**, y la cadena completa **6–12 s con `fetch`**. El transporte no es la causa: los tiempos son iguales con cualquier cliente.
  - Con el límite de 5 s, una portada antigua (las que pasan por `archive.org`) puede quedarse con la tipográfica mientras dure esa lentitud. El fallo no se guarda en caché, así que se reintenta en la siguiente visita.
  - Un tiempo agotado **no** pausa a Open Library. Si lo hiciera, ocultaría también las portadas que `covers.openlibrary.org` sirve al instante.
  - **Decidido (D96)**: se mantienen los 5 s, también para `archive.org`.

### 15.8 Pruebas
- **Unitarias nuevas**:
  - `covers.test.ts` (28): claves, peticiones válidas y no válidas, reconstrucción, y la cadena exacta con 13 desvíos rechazados.
  - `server/covers.test.ts` (44):
    - tipos comprobados por bytes, GIF de relleno, HTML, PNG declarado como JPEG, vacío, demasiado pequeño, SVG, comprimido, más de 2 MB, 206 y 404, tiempo;
    - `lookup` validador con 6 respuestas DNS peligrosas;
    - **DNS rebinding**: primero una dirección pública, después una privada;
    - transporte (https, 443, sin reutilizar conexiones, solo `User-Agent` y `Accept`);
    - servicio: Open Library directo y por cadena, Apple, redirecciones maliciosas (otro host, localhost, IP privada, `http`, otra portada, nodo directo), redirección de Apple, nodo con DNS privado, sin portada sin penalizar al proveedor, 429, 5xx, tiempo agotado y aislamiento entre proveedores;
    - ruta: anónimo, demo y Auth caído sin llamadas externas; con sesión, tipo comprobado, caché privada y sin `Set-Cookie`; nada del usuario hacia fuera; 400, errores `no-store` y cuota por usuario.
  - Ajuste en `clean.test.ts`: las URLs de Apple que no tienen la forma exacta ya no son portadas.
- **Mutaciones**: quitar el filtro de direcciones del `lookup` validador hace fallar 6 pruebas; quitar la comprobación del id y del tamaño en la cadena, 3. Después se restauró el código.
- **Integración nueva**: 1, con sesiones reales del stack local. Sin cookie, con la cookie de demo o con un token falso: 401 `no-store` sin llamadas externas. Con sesión verdadera: imagen, caché privada, sin `Set-Cookie`, y una sola petición a la URL reconstruida.
- **E2E nueva**: `e2e/covers.spec.ts` (4 pruebas × móvil y escritorio). Responde a `/api/covers` desde la propia página con una imagen dibujada en el navegador, sin llamar a ningún proveedor.
  - Portada real sobre la tipográfica: misma caja que un libro sin portada, 2:3, `object-cover`, petición solo con el id, tamaño `lg` en la ficha y «Portada de …».
  - Apple en una fila de episodio (`sm`) y en una cuadrícula de programas (`md`, 1:1).
  - Ante 404, 401, sin conexión y bytes que no son imagen: se queda la tipográfica, sin imagen rota.
  - La demo contra la ruta real: 401 `no-store` sin `Set-Cookie`, y la tipográfica.
- **Resultados**: §15.9.

### 15.9 Resultados (31/10/2026)
| Suite | Resultado |
|---|---|
| `npm run check` (tipos, lint y unitarias) | **708/708**: 636 anteriores y 72 nuevas |
| `npm run test:integration` (stack local) | **149/149**: 148 anteriores y 1 nueva |
| E2E dirigida (1 worker, Windows): `covers`, `library`, `library-account`, `offline` (con service worker), `a11y`, `knowledge` y `navigation` | **148 listadas: 144 superadas, 4 omitidas previstas** (3 de `library-account` en móvil y 1 de `navigation` en escritorio), **0 fallidas**. `covers.spec.ts`: 8/8 |
| HTTP sobre el build de producción | `/api/covers` anónimo, con demo y con demo y sesión falsa: 401 `no-store` sin `Set-Cookie`. Una URL como parámetro: 401, porque la autenticación va antes que el análisis de parámetros. POST: 405. Metadatos sin sesión: 401 en JSON como antes. Página sin sesión: 307 a `/login`, como antes |
| `npm run explore:metadata` (proveedores reales, fuera de la CI) | **5/5**: metadatos con el transporte fijado, portadas de Open Library por la cadena y directa, y Apple en 3 tamaños |
| **E2E completa** (342 × 2) | **No ejecutada en local**: en Windows se quedó sin memoria en M4g.1 y no se ha insistido. Pendiente de la CI remota, con autorización |

Avisos: 2 `[newAccount] slow` en la E2E dirigida, ambos en la etapa `status` (la primera llamada a `npx supabase status` de cada worker, 3,7–4,2 s). Es el mismo patrón observado en la CI; Auth y la base tardaron ≈0,1 s.

### 15.10 Limitaciones pendientes
1. **`archive.org` lento** y el límite de 5 s (§15.7, G2-1).
2. **Portadas sin conexión**: solo lo que conserve la caché HTTP del navegador. En el iPhone no está garantizado. La caché en el service worker es M4g.6.
3. **Coste de Auth**: `getUser()` en cada portada pedida por primera vez en un dispositivo, y después caché de 30 días. Si se nota en las cuadrículas, la opción es `getClaims()` con verificación local (la nube firma con ES256, §14.3). A cambio, una sesión cerrada en otro dispositivo seguiría valiendo ≈1 h para portadas.
4. **Una portada que falla se vuelve a pedir** en cada visita: los errores son `no-store` para no fijar una indisponibilidad pasajera.
5. **Ningún elemento de la Biblioteca tiene todavía una portada externa**: aparecerán con M4g.3 y M4g.4. Hasta entonces, en producción todo seguirá viéndose como hoy.

### 15.11 Propuesta de M4g.3: alta asistida de libros (sin implementar)
1. **Objetivo**: «Añadir libro» abre un buscador (título, autor o ISBN) con resultados con portada, una ficha de confirmación editable y el guardado con las operaciones de M4. La entrada manual queda siempre a un toque.
2. **Componentes**:
   - `components/add-book-sheet.tsx` (hoja inferior en el móvil y panel lateral en el escritorio);
   - usa `createSearchController`, `metadataClient`, `findBookMatches`, `toBookInput` y `CoverArt`;
   - selector de edición (`books/editions`);
   - detalle (`books/detail`) al abrir un resultado;
   - avisos de duplicado `strong` y `possible` que no bloquean; en el `exact`, «Abrir» o «Añadir como otra edición».
3. **Cambios en lo existente**:
   - los botones «Añadir libro» abren el buscador;
   - `ContentForm` recibe el título prellenado para la entrada manual;
   - mensaje propio para `duplicate_external` en `LibraryConflicts`.
4. **Base de datos**: ninguna.
5. **E2E**:
   - el navegador no puede interceptar las llamadas del servidor, así que se propone un origen de pruebas para los proveedores, aceptado **solo** fuera de Vercel y en `http://127.0.0.1:<puerto>`, con un servidor local de fixtures;
   - toca `safeFetch`, así que se revisaría como cambio de seguridad;
   - alternativa: interceptar `/api/metadata/*` desde la página, como en `covers.spec.ts`, sin cambiar el servidor. **Recomendada**, porque no abre ningún camino nuevo en el servidor.
6. **Pruebas**:
   - buscar por título y por ISBN, editar en la ficha y guardar;
   - duplicado → «Abrir»;
   - proveedor caído → entrada manual con lo escrito;
   - sin conexión → entrada manual, y sincroniza al volver;
   - teclado y lector de pantalla (axe) en móvil y escritorio.
7. **Riesgos**: el teclado del iPhone en la hoja inferior, una edición equivocada y la lentitud de Open Library (hasta 3,8 s).
8. **Estimación**: 180–240 minutos, sin migraciones ni dependencias.

## 16. M4g.2 · Validación remota en `ci/m4g` (31/10/2026)

### 16.1 Verificación previa
- **Rama y commits:**
  - HEAD `5c4309a`, árbol limpio;
  - `ci/m4g` = `b5ad26b` y `main` = `f66b3b9`;
  - avance directo con 3 commits: `5b1149f` (documentación), `345e503` y `5c4309a`.
- **Diff contra `b5ad26b`:**
  - sin cambios en `supabase/`, `package.json`, el lockfile, `.github`, `vercel.json`, `next.config.ts` ni `public/`;
  - sin secretos ni correos.
- **Contrato:**
  - 350 pruebas listadas por pasada (342 + 8 de `covers.spec.ts`) y 21 specs;
  - `covers.spec.ts` no añade omisiones, así que `E2E_SKIPS_PER_PASS` sigue en 27;
  - esperado: 646 superadas y 54 omitidas.
- **`/api/covers` y autenticación:** revisadas (§15.1 y §15.5). La comprobación de usuario va antes que la de parámetros.
- **Caché del navegador entre usuarios:**
  - la respuesta es `private`: no la guarda ninguna caché compartida;
  - en un mismo navegador puede reutilizarse para otra sesión, pero el contenido es una **imagen pública** del proveedor, idéntica para cualquiera; no hay contenido privado que pueda pasar de un usuario a otro;
  - no se usa `Vary: Cookie` porque el token cambia al refrescarse (≈1 h) e invalidaría la caché sin aportar privacidad.
- **Conexión fijada, comprobada con servidores reales** (`npm run explore:metadata`, prueba nueva):
  - el socket se conectó a `207.241.234.146`, que es la dirección que validó nuestro `lookup`;
  - `servername` = `covers.openlibrary.org` (SNI) y el certificado se autorizó;
  - forzando la IP de otro servidor (Apple) se obtiene `ERR_TLS_CERT_ALTNAME_INVALID`: el certificado se valida contra el host original, no contra la IP.
- **Redirecciones:** solo se sigue la cadena exacta de Open Library. Cada salto revalida las direcciones y fija la conexión. Las pruebas rechazan otro host, localhost, IP privada, `http`, otra portada, el nodo directo y un nodo con DNS privado.
- **Vercel:** `vercel.json` sigue con `ci/**` desactivado.

### 16.2 Ejecución
- **Push normal:** `b5ad26b..5c4309a → ci/m4g`. `main` y `ci/m4` no se tocaron.
- **Run** [41241302825](https://github.com/danimendi7/the-one-percent/actions/runs/41241302825) sobre `5c4309a03a894f4a7fa3b43382ed1d046a6a624c` (push): **éxito**, de 20:57 a 21:29 UTC (32 min).

| Suite | Resultado (artefactos y puertas) |
|---|---|
| Tipos y lint | Correctos |
| Unitarias | **708/708** en 56 ficheros; las de portadas, 72/72 (2 ficheros) |
| Aislamiento | Supabase efímero en `127.0.0.1:55321`, sin credenciales de la nube ni secretos |
| Integración | **149/149** en 9 ficheros; `metadata-auth`, 4/4 (sesiones reales, portadas incluidas) |
| `test:browser` | **6/6** |
| E2E (2 pasadas) | **646 superadas, 54 omitidas**, 0 fallidas, 0 inestables, 0 interrumpidas, 0 errores globales, 0 reintentos. 350 × 2 = 700 ejecutadas, 21 specs |
| Smoke | **22/22** |
| Revisión de secretos de la CI | 9 ficheros, 0 eliminados |

- **Pruebas nuevas en Linux:**
  - `covers.spec.ts` **16/16**: portada real, Apple, respaldo ante 404, 401, sin red o bytes que no son imagen, y la demo contra la ruta real;
  - `offline.spec.ts` **24/24**: service worker, arranque y navegación sin red, privacidad de la caché.
- **Omitidas:** las 54 son **exactamente las mismas** que en el run 41229248953 (lista comparada prueba a prueba).
- **Sin llamadas reales a los proveedores:**
  - las pruebas unitarias y de integración inyectan el transporte;
  - la E2E responde a `/api/covers` desde la página;
  - la única llamada real a la ruta (demo) se rechaza con 401 antes de salir;
  - los logs no mencionan `openlibrary.org`, `archive.org`, `mzstatic.com` ni `itunes.apple.com`.
- **`newAccount`:** 3 avisos «slow» (la etapa `status` tardó ≈2,9 s, y `createUser` 0,2–0,5 s), el mismo patrón informativo de siempre. Ningún error de autenticación.

### 16.3 Estado final
- **Ramas:** `ci/m4g` = `5c4309a`; `main` = `ci/m4` = `f66b3b9`.
- **Vercel:** ningún estado ni despliegue para `5c4309a`, así que no hubo Preview. Producción sirve `f66b3b931aac`.
- **Supabase Cloud:** 27/27 en solo lectura, con 11 migraciones y las funciones idénticas al fichero.
- **Sin repeticiones, sin borrados y sin reescribir historia.**

## 17. M4g.3 · Plan de implementación del alta asistida de libros (31/10/2026, **sin implementar**)

Construye sobre lo validado en M4g.1 y M4g.2, con D96–D98 vigentes. No necesita migraciones, dependencias nuevas ni cambios en el servidor.

### 17.1 Flujo
1. **«Añadir libro»** (portada de Biblioteca, Libros y estado vacío) abre `AddBookSheet`: hoja inferior en el móvil (92 dvh) o panel lateral de 28 rem en el escritorio, con el foco en el buscador.
2. **Búsqueda**:
   - un solo campo para título, autor o ISBN;
   - un ISBN válido, con o sin guiones, se detecta solo y se busca al momento;
   - el texto espera 350 ms y cancela la búsqueda anterior (`createSearchController`);
   - un selector discreto «Todo · Título · Autor» se traduce en `by`;
   - idioma preferido de la edición: `es`, cambiable a `en`.
3. **Resultados** (≤ 10):
   - `CoverArt` `sm`, que pide a `/api/covers` y muestra la tipográfica al momento (D97), título, autores, año (de la edición o de la obra), editorial e idioma;
   - insignia «En tu Biblioteca» si hay una coincidencia `exact`;
   - filas de ≥ 56 px;
   - al final, siempre, «¿No está? Añadir a mano».
4. **Ficha de confirmación** (en el mismo panel, con «‹ Resultados»):
   - al abrirla se pide `books/detail` (descripción y temas sugeridos de la obra, y páginas de la edición);
   - mientras llega, los datos del resultado ya son editables y nada se bloquea;
   - **selector de edición** (`books/editions`, primero el idioma preferido): cambiar de edición actualiza ISBN, editorial, páginas, año, idioma y portada, sin tocar lo que ya hayas editado a mano en la ficha;
   - campos editables: título, subtítulo, autores, año, páginas, editorial, ISBN-13/10 e idioma;
   - descripción con «Guardar la descripción» (D7) y aviso si su idioma no coincide con el de la edición;
   - temas sugeridos como chips para añadir (D6); ninguno viene marcado;
   - **tus datos de M4**: estado (por defecto «Pendiente»), valoración 1–10 y favorito, con los mismos componentes de la ficha (`StatusPill` y `RatingInput`);
   - «Datos: Open Library ↗» con el enlace de origen;
   - botón «Añadir a la Biblioteca» de 48 px.
5. **Guardar**:
   - `libraryActions.createItem("book", toBookInput(resultado, elecciones))`, el mismo camino que el alta manual: va a la cola durable y funciona igual sin conexión;
   - después se abre la ficha del libro con «Añadir idea» a mano, como hoy;
   - **las notas y los enlaces no se tocan nunca**: el alta solo crea un elemento nuevo.

### 17.2 Duplicados (`findBookMatches` antes de mostrar y antes de guardar)
| Nivel | Qué ve el usuario | Acción |
|---|---|---|
| `exact` (misma obra) | «Ya está en tu Biblioteca: *Título*» | «Abrir» (principal) o «Añadir como otra edición»: se guarda sin referencia externa, con su ISBN (`separateEdition`) |
| `strong` (mismo ISBN) | «Ya tienes esta edición» | «Abrir» o «Añadir igualmente» |
| `possible` (título y autor) | «Puede que ya lo tengas: *Título*» | Aviso; se puede guardar |

- Se compara con la copia local, así que también funciona sin conexión.
- **Carrera entre dispositivos sin conexión**: el servidor rechaza el segundo con `duplicate_external`.
  - Nuevo texto en `LibraryConflicts`: «Ya habías añadido este libro en otro dispositivo. Tus notas de aquí se conservan.» Los textos ya se conservan (D68/D75).
  - Una prueba de integración comprueba que no se pierde ninguna nota.

### 17.3 Entrada manual y uso sin conexión
- **«Añadir a mano»** siempre visible: abre `ContentFormSheet` con el texto buscado como título (prop nueva `initialTitle`, sin más cambios en el formulario).
- **Sin conexión** (`offline` del controlador): el campo de búsqueda queda deshabilitado y se muestra «Sin conexión. Añádelo a mano; se sincronizará al volver la red.» con el formulario manual. El alta va a la cola como hoy.
- **Proveedor caído, ocupado o sin respuesta**: el texto de `METADATA_ERROR_TEXT`, «Reintentar» y «Añadir a mano» con lo escrito. Nunca se bloquea el alta (D8).
- **Demo**: «La búsqueda está disponible con tu cuenta» y alta manual. El cliente no llama a la API en modo demo: lo sabe por `mode` y se ahorra el 401.

### 17.4 Datos y sesión
- **El navegador solo habla con `/api/metadata/*` y `/api/covers`, del mismo origen**: la CSP no cambia.
  - Las respuestas se vuelven a validar con Zod (`metadataClient`).
  - Lo que no pasa no se muestra.
- **Lo que guarda la sesión de búsqueda**: las búsquedas se recuerdan solo en memoria y en esta sesión (`createSearchController`, ≤ 30). Al cerrar el panel se descartan. Nada va a IndexedDB ni a `localStorage`.
- **Lo que se guarda en la Biblioteca**: solo lo confirmado (campos del elemento, portada canónica, `external` y atribución).
  - No se guardan respuestas del proveedor, consultas ni temas sin marcar.
  - Ningún dato del usuario sale hacia los proveedores; está garantizado en el servidor (M4g.1 y M4g.2).
- **Sesión**:
  - una respuesta 401 de la API (sesión caducada) muestra «Tu sesión ha caducado; vuelve a entrar para buscar» y deja la entrada manual;
  - no hay redirecciones automáticas en mitad de un alta;
  - lo escrito se conserva (el aviso «¿Descartar lo escrito?» actual cubre también el panel nuevo).

### 17.5 Accesibilidad y adaptación
- `role="search"` con etiqueta, `inputmode="search"`, `enterkeyhint="search"` y `autocapitalize="off"`.
- **Resultados**: `role="listbox"` con `aria-activedescendant`, flechas, Intro y Esc en el escritorio; en el móvil, botones de lista de ≥ 56 px.
- **Avisos por `aria-live="polite"`**: «8 resultados», «Sin resultados» y los errores, una vez por búsqueda y no por tecla.
- **Foco**:
  - va a la ficha al abrirla y vuelve al resultado al pulsar «‹ Resultados»;
  - queda atrapado en la hoja, que ya lo hace (Radix);
  - es visible.
- **Teclado del iPhone**: la hoja usa `visualViewport` para que el campo y el botón principal no queden debajo del teclado.
- **Interfaz**: tokens de color existentes, zonas táctiles de ≥ 44 px y `prefers-reduced-motion` respetado.
- **Comprobación**: axe sin incidencias serias ni críticas en móvil (375 px) y escritorio (1280 px), en búsqueda, resultados y ficha; sin desbordamiento horizontal.

### 17.6 Archivos
| Archivo | Cambio |
|---|---|
| `src/features/library/components/add-book-sheet.tsx` | **Nuevo**: panel, buscador, resultados, ficha y estados |
| `src/features/library/metadata/book-draft.ts` | **Nuevo**, puro y con pruebas: estado de la ficha (valores del resultado + ediciones aplicadas + campos tocados por el usuario), que no pisa lo editado al cambiar de edición. Lo convierte en `BookResult` para `toBookInput` |
| `src/features/library/library-views.tsx` | Los botones «Añadir libro» abren `AddBookSheet`. «Añadir episodio» y «Programa» siguen igual hasta M4g.4 |
| `src/features/library/components/content-form.tsx` | Prop `initialTitle` para la entrada manual |
| `src/features/library/components/library-sync.tsx` | Texto de `duplicate_external` |
| `e2e/add-book.spec.ts` | **Nuevo** |
| `src/features/library/metadata/*.test.ts` y `tests/integration/library-sync.int.test.ts` | `book-draft`, y la carrera de duplicados sin pérdida de notas |

### 17.7 Pruebas
- **Unitarias**:
  - `book-draft`: aplicar una edición sin pisar lo editado, campos vacíos y ediciones sin ISBN;
  - elecciones del usuario → `toBookInput` → `createItem` válido;
  - textos de los estados.
- **Integración**: dos dispositivos crean sin conexión la misma obra → `duplicate_external` → el aviso nuevo y las notas del segundo dispositivo conservadas.
- **E2E** (`add-book.spec.ts`, móvil y escritorio):
  - **Cómo se simulan los proveedores**: con `page.route` sobre `/api/metadata/*` y `/api/covers`, con respuestas grabadas, igual que `covers.spec.ts`. Se recomienda esta opción porque **no abre ningún camino nuevo en el servidor**. Los navegadores no pueden interceptar las llamadas del servidor; la alternativa sería un origen de pruebas en `safeFetch`, que se descarta.
  - **Casos**:
    - buscar por título → resultado con portada → ficha → cambiar de edición → editar páginas → añadir → la ficha del libro, con su portada, estado y valoración;
    - ISBN con guiones → búsqueda inmediata → resultado exacto;
    - un duplicado `exact` → «Abrir» lleva al existente; «Añadir como otra edición» crea un segundo libro sin referencia;
    - proveedor caído (503) → mensaje + «Añadir a mano» con el título prellenado → se guarda;
    - sin conexión (`context.setOffline`) → alta manual → sincroniza al volver (modo cuenta, stack local);
    - demo → solo manual, sin peticiones a `/api/metadata`;
    - teclado (flechas, Intro, Esc) en escritorio;
    - axe en los tres estados;
    - el libro creado mantiene «Añadir idea», y sus notas y sincronización funcionan como siempre.
  - **Recuento**: las pruebas nuevas no deben añadir omisiones, para que `E2E_SKIPS_PER_PASS` siga siendo 27. Si alguna tiene que omitirse, se cambiará ese número a propósito y se dirá en el informe.
- **Regresión**: `check` e integración completas; E2E dirigida en local (portadas, biblioteca, cuenta, sin conexión y accesibilidad). La E2E completa, en la CI remota con autorización.

### 17.8 Riesgos
| Riesgo | Mitigación |
|---|---|
| Elegir mal la edición | Ficha de confirmación con portada, editorial, año, idioma e ISBN, y selector de edición |
| Lentitud de Open Library (hasta 3,8 s) | Esqueleto a los 150 ms, caché de la sesión, nada bloquea y entrada manual a mano |
| Teclado del iPhone | `visualViewport` y prueba manual en el iPhone |
| Cambio de edición que pisa lo editado | `book-draft` con los campos tocados y sus pruebas |
| Duplicados entre dispositivos | Aviso nuevo y prueba de integración sin pérdida |
| Crecimiento del recuento E2E | Sin omisiones nuevas; el gate lo comprueba |

### 17.9 Criterios de aceptación
- Los 8 pasos de LIBROS del encargo de M4g, en móvil y escritorio.
- Con el proveedor caído, sin conexión o en la demo, el alta manual funciona igual que hoy.
- Ningún libro se duplica por la misma obra sin pedirlo.
- Notas, estados, valoraciones y sincronización sin cambios.
- CSP, service worker, migraciones y dependencias sin cambios.
- Axe sin incidencias serias.

### 17.10 Estimación
**180–240 minutos**, más la validación (E2E dirigida en local y la CI remota con tu autorización).

## 18. M4g.3 · Alta asistida de libros (31/10/2026, hecho en local)

Autorizado solo en local. Sin migraciones, dependencias, cambios en el servidor, en el service worker ni en la CSP. Decisión: D99 en `docs/decisions.md`.

### 18.1 Flujo terminado
1. **«Añadir libro» con cuenta** (portada de Biblioteca, Libros y estado vacío) abre `AddBookSheet`:
   - hoja inferior en el móvil y panel lateral en el escritorio;
   - en el móvil, la hoja se coloca por encima del teclado del iPhone (`visualViewport`).
   - En la **demo** abre el formulario manual de siempre: allí no hay búsqueda y no se pide nada a ningún proveedor.
2. **Búsqueda**:
   - un campo para título, autor o ISBN, con el filtro «Todo · Título · Autor»;
   - espera 350 ms y cancela la búsqueda anterior; un ISBN válido sale al momento;
   - un ISBN con el dígito de control mal se avisa y no se busca;
   - solo se muestran respuestas a lo que está escrito en ese momento.
3. **Resultados**:
   - cada uno con `CoverArt` (tipográfica al instante y la imagen encima si llega, D97), título, autor, año, editorial, idioma, «Obra: …» si el título de la edición es otro, y el número de ediciones;
   - insignias «En tu Biblioteca» y «Ya tienes esta edición»;
   - con teclado: flechas, Intro y `aria-activedescendant`.
4. **Ficha «Revisa y añade»**:
   - pide una vez la descripción de la obra y los detalles de la edición, y la lista de ediciones; nada bloquea mientras llegan;
   - «Cambiar edición (n)» actualiza los campos de la edición **que no hayas tocado** (`book-draft.ts`);
   - todo es editable: título, autores, subtítulo, editorial, año, páginas, idioma, ISBN y descripción (con «Guardar la descripción»); portada con «Usar esta portada»; temas sugeridos que hay que elegir (D6); estado, valoración de 1 a 10 y favorito;
   - atribución y enlace a Open Library.
5. **Guardar**:
   - `libraryActions.createItem("book", toBookInput(…))`, la misma operación que el alta manual (cola, copia del dispositivo, sincronización, conflictos);
   - un doble clic guarda una sola vez;
   - un error se muestra sin perder lo escrito;
   - después se abre la ficha del libro con su estado de sincronización.
6. **«Introducir manualmente»** en todos los pasos: abre el formulario de siempre con el título (o el ISBN) escrito. Si se cierra, se pregunta antes de descartar lo escrito.

### 18.2 Componentes y archivos
| Archivo | Qué |
|---|---|
| `components/add-book-sheet.tsx` (nuevo) | Asistente: búsqueda, resultados, ficha, ediciones, duplicados y estados |
| `metadata/book-draft.ts` (nuevo) | Ficha pura: campos tocados, aplicar edición o detalle sin pisarlos, el par ISBN-13/10 de la edición, validación y paso a `BookResult` |
| `library-views.tsx` | `useContentForm(state, source)`: un libro nuevo abre el asistente con cuenta y el manual en la demo |
| `components/content-form.tsx` | `FormTarget.draft` para el texto que viene del asistente; `DiscardPrompt` exportado |
| `components/library-sync.tsx` | Avisos de `duplicate_external` y «Guardar en «…»» |
| `sync/engine.ts`, `store/types.ts`, `store/account-library.ts` | Opción `existing` de `resolveLibraryText` (aditiva) |
| `e2e/add-book.spec.ts` (nuevo) | 8 pruebas (y capturas `@screens`, fuera de la E2E) |
| `e2e/{library-account,knowledge-live,offline,screen-error}.spec.ts` | Un paso más («Introducir manualmente») en sus altas manuales con cuenta |
| `tests/integration/library-sync.int.test.ts` | Prueba M: la misma obra creada sin conexión en dos dispositivos |

### 18.3 Contratos utilizados
- `metadataClient`: `books/search`, `books/detail` y `books/editions` de M4g.1, validados de nuevo con Zod.
- `createSearchController`: debounce, cancelación y estados `offline` y `error`.
- `/api/covers` de M4g.2, mediante `CoverArt`.
- `findBookMatches` y `toBookInput`.
- `libraryActions.createItem` y `resolveText`.
- **Ningún contrato del servidor ha cambiado.**

### 18.4 Duplicados
| Caso | Tratamiento |
|---|---|
| **A. Mismo proveedor e id externo** (misma obra) | Insignia «En tu Biblioteca». En la ficha, «Ya está en tu Biblioteca: «…»» con «Abrir el existente» y «Añadir como otra edición»; **el botón de guardar queda desactivado** mientras no se elija otra edición. `ops.ts` y el índice único lo rechazarían igualmente |
| **B. ISBN coincidente** | «Ya tienes esta edición (mismo ISBN)» y «Abrir el existente». Se puede guardar («Añadir igualmente») |
| **C. Misma obra, otra edición** | «Añadir como otra edición» la guarda **sin referencia externa** y con su ISBN. El servidor lo acepta: el índice único solo afecta a filas con id externo. No se ofrece nada que el servidor vaya a rechazar |
| **D. Coincidencia probable** (título y autor; p. ej., la obra duplicada de Open Library) | «Puede que ya lo tengas: «…»» y «Abrir el existente». Se puede guardar |
| **E. Dos dispositivos sin conexión** | El servidor acepta el primero y rechaza el segundo (`duplicate_external`). **No se borra ni se fusiona nada.** El aviso del libro explica que ya estaba y ofrece «Abrir el existente» y «Entendido». Cada nota escrita en la copia rechazada se conserva **entera** (D68/D75), con «Guardar en «Título existente»» (nueva opción `existing`), «Guardar como idea suelta» o «Descartar mi texto». La prueba de integración M lo reproduce contra PostgreSQL local, con la nota, su página y su paso a la idea suelta |

### 18.5 Demo, sin conexión y sesión
- **Demo**: el formulario manual de siempre, sin peticiones a `/api/metadata` (comprobado en la E2E).
- **Sin conexión**:
  - el asistente lo dice, no hace peticiones y conserva lo escrito;
  - «Introducir manualmente» lo lleva al formulario;
  - el alta va a la cola como siempre.
  - Abrir páginas nuevas sin red sigue dependiendo del service worker, que no cambia (D86).
- **Proveedor caído, límite o sesión caducada**: mensajes distintos, «Reintentar» (excepto con la sesión caducada), el texto se conserva y «Introducir manualmente» pasa a botón principal.
  - Si la sesión caduca **después** de elegir un resultado, la ficha lo dice y **permite guardar** con los datos que ya tiene: el alta es local y se sincroniza cuando vuelve la sesión.
- **Datos y sesión**:
  - las búsquedas solo se recuerdan en memoria, durante la sesión;
  - en la Biblioteca solo se guarda lo confirmado;
  - al proveedor no sale nada del usuario (M4g.1 y M4g.2).

### 18.6 Accesibilidad y adaptación
- **Buscador**: `role="search"`, campo `combobox` con `listbox` y `option`, flechas e Intro, estado en `aria-live`.
- **Foco**:
  - en el buscador al abrir;
  - en «Revisa y añade» al pasar a la ficha;
  - «Resultados» vuelve con la búsqueda y sus resultados intactos.
- **Esc** pide confirmación antes de descartar lo escrito.
- **Etiquetas**: todas con `Label`; errores por campo con `aria-invalid` y `aria-describedby`.
- **Interfaz**: zonas táctiles de al menos 44 px, tokens de color y animaciones con `motion-reduce`.
- **Comprobado en la E2E**: axe sin incidencias serias ni críticas en búsqueda, resultados y ficha, a 375 px y a 1440 px, sin desplazamiento horizontal.
- **VoiceOver**: sin probar en un iPhone real (§18.9).

### 18.7 Revisión visual (Chromium, capturas en `docs/screenshots/{mobile,desktop}-m4g3-*.png`)
- **Estados capturados**: buscador vacío, resultados, ficha, selector de ediciones, error del proveedor y entrada manual, en móvil (375) y escritorio (1440). Cuenta sintética y datos simulados, sin datos personales.
- **Corregido tras la revisión**: el ISBN de cada edición salía cortado en el selector, y es lo que las distingue. Ahora la línea ocupa las líneas que necesite.
- **Comprobado**: la transparencia que se veía en la primera captura de la entrada manual era la animación de apertura del panel; terminada, es opaco.

### 18.8 Pruebas y resultados (31/10/2026)
| Suite | Resultado |
|---|---|
| `npm run check` (tipos, lint y unitarias) | **717/717**: 708 anteriores y 9 nuevas de `book-draft` |
| `npm run test:integration` | **150/150**: 149 anteriores y la nueva M (misma obra en dos dispositivos sin conexión) |
| `npm run test:browser` (motor con IndexedDB real) | **6/6** |
| `e2e/add-book.spec.ts` | **16/16** (8 pruebas × móvil y escritorio), 0 omitidas |
| E2E dirigida (1 worker, Windows): `add-book`, `library`, `library-account`, `knowledge-live`, `offline` (con service worker), `screen-error`, `a11y`, `covers`, `navigation` y `knowledge` | **178: 170 superadas y 8 omitidas previstas** (3 de `library-account` y 4 de `knowledge-live` en móvil, y 1 de `navigation` en escritorio), **0 fallidas** |
| `npm run smoke` (local, sobre el build de producción) | **22/22** |
| Build | Correcto (lo hacen la E2E y el smoke) |
| **E2E completa** (366 × 2) | **No ejecutada en local** por la memoria de Windows. Pendiente de la CI |

**Las 8 pruebas de `add-book.spec.ts`:**
1. Por título → obra → otra edición: los campos tocados se conservan, el resto sigue a la edición; doble clic → **una** fila con todos los campos: editorial, páginas, ISBN-13 y ISBN-10, año, idioma, estado, valoración, favorito, descripción, tema elegido, portada y referencia con atribución. Sin cargas fallidas salvo las portadas que la prueba responde con 404.
2. Por autor (`by=author`); ISBN con guiones (búsqueda inmediata); ISBN inválido (aviso, sin petición); sin resultados.
3. Duplicados: A (bloqueado, «Añadir como otra edición» → fila sin referencia), D (probable, «Abrir el existente»).
4. Límite (429, con `Retry-After`), proveedor caído (502) y sesión caducada (401): mensajes, el texto se conserva y la entrada manual sale con el título.
5. Detalles que fallan tras elegir (401): se guarda igualmente.
6. Sin conexión: aviso, ninguna petición, la entrada manual conserva el texto y se sincroniza al volver la red.
7. Teclado (flechas, Intro), foco, axe en tres estados, sin desplazamiento horizontal y «Resultados» conserva la búsqueda; Esc pide confirmación en escritorio.
8. Demo: formulario manual y ninguna petición a `/api/metadata`.

**Defecto real encontrado por la E2E y corregido**: al cambiar de edición se perdía el ISBN-10 de la nueva edición, porque la ficha muestra un único campo ISBN. Ahora el borrador conserva el par de la edición, con una prueba unitaria.

### 18.9 Riesgos y pendientes
1. **VoiceOver y el teclado del iPhone** sin probar en un dispositivo real; la posición sobre el teclado (`visualViewport`) solo se puede verificar allí.
2. **Abrir la ficha de un libro creado sin conexión** depende de que el service worker tenga la ruta preparada (D86), como cualquier alta manual.
3. **E2E completa (366 × 2) no ejecutada en local**, por la memoria de Windows: se ejecutaron las suites afectadas una a una. Queda para la CI.
4. **Cobertura de Open Library**: algunos libros llegan sin portada, editorial o año; quedan vacíos (nunca inventados) y se pueden escribir.
5. **«Guardar en «…»»** solo aparece si el libro existente ya está en la copia del dispositivo, lo que ocurre tras sincronizar. Antes, quedan «Guardar como idea suelta» y conservar el aviso.

### 18.10 Validación en `ci/m4g` (cuando se autorice)
- Push normal del HEAD de M4g.3 a `ci/m4g`.
- **Recuentos esperados**:
  - unitarias **717**;
  - integración **150** (la nueva, M);
  - `test:browser` **6**;
  - E2E con **366 pruebas listadas por pasada** (350 + 16 de `add-book.spec.ts`), es decir, **732 − 54 = 678 superadas y 54 omitidas**; las omisiones por pasada siguen siendo 27 y deben ser las mismas;
  - smoke **22**.
- **Comprobaciones**:
  - ninguna llamada real a proveedores (los metadatos y las portadas se responden desde la página en la E2E);
  - sin Preview;
  - `main` sin cambios.

### 18.11 Propuesta de M4g.4: podcasts y episodios (sin implementar)
1. **Entrada**: «Añadir podcast» o «Añadir episodio» con cuenta abre `AddPodcastSheet`; en la demo sigue el formulario manual.
2. **Programa**:
   - búsqueda en `podcasts/search` (sin duplicados de Apple), con resultados con portada 1:1, autor, número de episodios y último lanzamiento;
   - se reutiliza un programa existente (`existingShow`); un programa manual con el mismo nombre se avisa como posible coincidencia.
3. **Episodios**:
   - `podcasts/episodes`: los 200 más recientes, con un filtro local mientras se escribe y «Buscar episodios anteriores» (búsqueda de Apple filtrada por programa);
   - el texto deja claro «Mostrando los 200 más recientes».
4. **Ficha**: título, programa, fecha (en la zona del perfil), duración, descripción (≤ 2.000, opcional), portada, estado, valoración y favorito, con `toEpisodeInput` y `toShowInput`.
5. **Duplicados**: episodio con el mismo `trackId` (exacto: «Abrir el existente»); mismo título en el mismo programa (probable); programa por `collectionId`.
6. **Guardado**: crea el programa (si falta) y después el episodio, con las operaciones de M4 y sin nada paralelo.
7. **Pruebas**: el mismo esquema que `add-book.spec.ts` (respuestas desde la página), más la lista de 200 episodios, la búsqueda de anteriores, la reutilización del programa y su accesibilidad.
8. **Tamaño**: los ≈214 KB de la lista de 200 episodios (§12.6) se miden en el iPhone. Si pesa, la lista va sin descripciones y el detalle se pide al elegir.
9. **Estimación**: 200–260 minutos, sin migraciones.

## 19. M4g.3 · Auditoría de integridad y validación remota en `ci/m4g` (01/11/2026)

### 19.1 Verificación previa
- **Commits:**
  - HEAD `313ad83`, árbol limpio, avance directo desde `ci/m4g` (`5c4309a`);
  - contiene `8e60cc4`, `ab0d62c` y `313ad83`;
  - `origin/main` = `f66b3b9`.
- **Contenido del cambio:**
  - sin cambios en `supabase/`, `package.json`, el lockfile, `.github`, `public/` (service worker), `vercel.json` ni `next.config.ts`;
  - sin secretos ni correos;
  - ningún fichero temporal entre los 31 del diff.
- **Las 12 capturas, revisadas una a una:**
  - cuenta sintética, resultados simulados y títulos de catálogo público; ningún correo ni nombre;
  - el fondo de la app sale desenfocado por el panel;
  - en `mobile-m4g3-search-empty.png` el panel quedó a mitad de su animación de apertura: es solo estético.
- **Contrato:**
  - 366 pruebas listadas por pasada (`--grep-invert @screens`), 22 specs;
  - `add-book.spec.ts` no tiene omisiones, así que `E2E_SKIPS_PER_PASS` sigue en 27;
  - las capturas `@screens` quedan fuera de la E2E.
- **Vercel:** `ci/**` sigue con los despliegues desactivados.

### 19.2 Auditoría especial de integridad
**A. Duplicados**
- **Otra edición:** se guarda con `external = null` (`toBookInput(…, { separateEdition: true })`). Nunca reutiliza la referencia de la obra: lo comprueban la E2E (fila con `external_id` nulo) y `ops.ts`, que rechazaría la misma referencia.
- **Datos guardados en ese caso:** ISBN, editorial y el resto de la edición, más el enlace a la ficha de la edición en Open Library (`source_url`).
- **Limitación de coherencia (sin pérdida de datos):** la base exige un proveedor para guardar `external_attribution`, así que una edición separada **no conserva la atribución** como campo; solo el enlace de origen la delata.
  - Alternativa para decidir más adelante: guardar como referencia la clave de la **edición** (`OL…M`) en lugar de la de la obra, solo en este caso. Mantendría la atribución, pero mezcla significados en `external_id` (D90). No se ha cambiado.
- **Título y autor:** coincidencia `possible`, que solo avisa. La E2E comprueba que el botón de guardar sigue activo.

**B. Recuperación de notas**
- **Durabilidad:**
  - los avisos del libro rechazado (`duplicate_external`) y de sus notas (`item_deleted`) son textos de Biblioteca (`isLibraryText`);
  - se guardan en la copia del dispositivo (`pendingNotes`) en cuanto llega la respuesta, antes de seguir (`await persist()`);
  - **nueva comprobación en la prueba M** (`7794172`): se cierra y se reabre el dispositivo antes de decidir, y el aviso y las dos notas siguen enteras.
- **Nada se elimina automáticamente:** un aviso solo desaparece por una decisión del usuario.
- **Ni duplicado ni pérdida:**
  - «Guardar en…» y «Guardar como idea suelta» quitan el aviso y encolan la nota en el mismo paso síncrono, así que la copia guardada nunca tiene una cosa sin la otra;
  - un segundo toque devuelve `false` (comprobado en la prueba M);
  - en el servidor queda **una** fila con el texto y la página.
- **Libro de destino aún no sincronizado en el dispositivo:**
  - el motor solo acepta `existing` sobre un libro confirmado por el servidor; si no, devuelve `false` y el aviso sigue (comprobado: con el id del libro rechazado se niega);
  - el botón solo aparece cuando el libro existente está en la copia. En el caso real (lo creó otro dispositivo) llega con la descarga, así que ya está confirmado.

**C. Borradores**
| Situación | Qué pasa |
|---|---|
| La sesión caduca al buscar | Aviso; el texto se conserva; «Introducir manualmente» lo lleva al formulario (E2E) |
| La sesión caduca tras elegir un resultado | Aviso en la ficha; **se puede guardar** con lo que hay, porque el alta es local y se sincroniza al volver la sesión (E2E) |
| Falla el guardado (rechazo local) | Mensaje en la ficha; nada se borra; se puede corregir y repetir |
| Proveedor caído o límite | Mensaje; texto conservado; «Reintentar» y entrada manual (E2E) |
| Cerrar el asistente o el formulario con algo escrito (Esc, X o deslizar) | Pregunta «¿Descartar lo escrito?» (E2E en escritorio) |
| **No cubierto: recargar, navegar fuera o que el sistema cierre la app** con el asistente abierto | **Se pierde lo escrito sin guardar**, igual que en el formulario manual de M4: los borradores no se guardan en el dispositivo. Lo guardado nunca se pierde. Una mejora posible: borrador en `sessionStorage`, que hoy no se ha hecho |

### 19.3 Ejecución
- **Push normal:** `313ad83` más el commit de auditoría `7794172` (prueba M con reapertura y doble toque); `5c4309a..7794172 → ci/m4g`. `main` y `ci/m4` no se tocaron.
- **Run** [41287915453](https://github.com/danimendi7/the-one-percent/actions/runs/41287915453) sobre `7794172b2cda96800f0c7b76c4898ccbe9fa7aeb` (push): **éxito**, de 09:13 a 09:47 UTC (34 min).

| Suite | Resultado (artefactos y puertas) |
|---|---|
| Tipos y lint | Correctos |
| Unitarias | **717/717**; las de `book-draft`, 9/9 |
| Aislamiento | Supabase efímero en `127.0.0.1:55321`, sin credenciales de la nube ni secretos |
| Integración | **150/150**; la prueba M (dos dispositivos, reapertura, doble toque) superada |
| `test:browser` | **6/6** |
| E2E (2 pasadas) | **678 superadas y 54 omitidas**: 366 × 2 = 732 ejecutadas, 339 superadas y 27 omitidas por pasada. 0 fallidas, 0 inestables, 0 interrumpidas, 0 errores globales y 0 reintentos. Las 22 specs presentes; `add-book.spec.ts`, 32/32 |
| Smoke | **22/22** |
| Revisión de secretos de la CI | 9 ficheros, 0 eliminados |

- **Omitidas:** las 54 son **las mismas, por título**, que en el run 41241302825. Comparadas por número de línea parecían distintas porque se añadieron líneas en 4 specs.
- **Sin llamadas reales a proveedores:**
  - la E2E responde a `/api/metadata` y `/api/covers` desde la página, y cualquier petición imprevista falla;
  - los logs no mencionan `openlibrary.org`, `archive.org`, `mzstatic.com` ni `itunes.apple.com`.
- **`newAccount`:** 3 avisos «slow», todos en la etapa `status` (2,8–3,1 s), el patrón informativo de siempre. Ningún error de autenticación.
- **Logs y artefactos:** sin secretos, correos ni la referencia del proyecto de la nube.
- **Estado final:**
  - ningún estado ni despliegue de Vercel para `7794172`, así que no hubo Preview; producción sirve `f66b3b931aac`;
  - `origin/main` = `ci/m4` = `f66b3b9`;
  - Supabase Cloud: 27/27 en solo lectura.
- **Funcionalidades** (E2E en Linux, 2 pasadas):
  - búsqueda por título, autor e ISBN (válido e inválido);
  - portadas con respaldo tipográfico (`covers.spec.ts`, 32/32);
  - obra y edición; campos manuales conservados; ISBN-10 e ISBN-13;
  - doble clic; conservación ante errores;
  - duplicados por referencia y probables; resolución entre dispositivos y notas (integración M);
  - demo sin proveedores; entrada manual sin conexión; sesión caducada;
  - Biblioteca, Cerebro y M2/M3 sin regresiones; axe en móvil y escritorio.

### 19.4 Condiciones de entrada para M4g.4 (sin implementar)
1. **M4g.3 validada en `ci/m4g`** (este run) y aceptada por el propietario.
2. **Decisión sobre la atribución de las ediciones separadas** (§19.2-A): mantenerla como está, o usar la clave de la edición.
3. **Medida en el iPhone** de la lista de 200 episodios (≈214 KB) antes de decidir si se piden las descripciones por separado.
4. **Las mismas reglas que M4g.3:**
   - respuestas de los proveedores desde la página en la E2E y ningún origen de pruebas en el servidor;
   - sin omisiones nuevas (o el cambio de `E2E_SKIPS_PER_PASS` a propósito y documentado);
   - demo manual;
   - alta con las operaciones de M4.
5. **Contratos de M4g.1 que se usarán sin cambios:** `podcasts/search`, `podcasts/episodes` (`scope`, `total` y `complete`), `toShowInput`, `toEpisodeInput`, `findShowMatches`, `findEpisodeMatches` y `existingShow`.
6. **Pendientes que no bloquean:** VoiceOver y el teclado en el iPhone real; la E2E completa en local sigue fuera del alcance de la memoria de Windows.

## 20. M4g.4 · Alta asistida de podcasts y episodios (01/11/2026, hecho en local)

Autorizado solo en local (D103), con M4g.3 cerrada (D100). No hay migraciones, dependencias nuevas ni cambios en el servidor, el service worker o la CSP. Decisión de diseño: D104.

### 20.1 Flujo terminado
1. **Entrada con cuenta.** «Episodio» y «Programa de podcast» (menú «Añadir» de Podcasts) abren `AddPodcastSheet`; también «Añadir episodio» en la ficha de un programa que vino de Apple, que abre directamente en sus episodios. En la **demo** y en los **programas escritos a mano** sigue el formulario manual, sin pedir nada a Apple.
2. **Programas** (`podcasts/search`):
   - por nombre o creador;
   - espera 350 ms y cancela la búsqueda anterior;
   - solo muestra las respuestas a lo que está escrito;
   - con teclado: flechas e Intro.
   - Cada resultado muestra portada 1:1 (tipográfica al instante, D97), nombre, creador, número de episodios, último lanzamiento (en la zona del perfil) y géneros.
   - Apple no da descripción del programa en la búsqueda: los géneros hacen de descripción breve, y no se inventa nada.
   - Los duplicados de Apple ya llegan agrupados desde el servidor (M4g.1).
   - Insignias «En tu Biblioteca» (mismo `collectionId`) y «¿Ya lo tienes?» (posible, por nombre y creador).
3. **Episodios** (`podcasts/episodes`):
   - el texto dice **«Los 200 más recientes de N. Si no está, búscalo abajo.»**: nunca se presenta como el catálogo completo;
   - se dibujan 30 a la vez, con «Mostrar 30 más (n restantes)»; las filas no llevan imagen (la portada del programa está arriba);
   - el filtro local por título y descripción usa un valor diferido y filas memorizadas, así que escribir no bloquea;
   - con dos o más letras aparece **«Buscar episodios anteriores en Apple»** (búsqueda de Apple filtrada por programa);
   - cada fila: título, día (zona del perfil), duración y descripción breve, o «Sin fecha ni duración»;
   - insignia «En tu Biblioteca» para el mismo `trackId`;
   - **«Seguir el programa»** guarda solo el programa (o lo abre si ya está).
4. **Ficha «Revisa y añade»** (`episode-draft.ts`):
   - **programa**: el existente, o «(nuevo)», otro de la Biblioteca o «Sin programa»; si hay un programa escrito a mano con el mismo nombre, se avisa con «Usar «…»»;
   - título, invitados, fecha (el **día del instante en la zona del perfil**: el instante no se cambia ni se guarda), duración, nº de episodio, descripción (con «Guardar la descripción»), imagen («Usar esta imagen»; la del episodio o, si no tiene, la del programa) y enlace oficial;
   - estado, valoración de 1 a 10 y favorito;
   - lo que Apple no da queda vacío; lo que tocas no se vuelve a escribir.
5. **Guardar**:
   - si el programa falta, `createShow`; después `createItem("episode")`. Son las operaciones de M4, en este orden en la misma cola: sin cola paralela y sin episodios huérfanos;
   - un doble clic guarda una sola vez;
   - si el episodio falla después de crear el programa, el programa queda seleccionado y el siguiente intento lo reutiliza, sin duplicarlo;
   - después se abre la ficha del episodio con su estado de sincronización.
6. **Entrada manual**:
   - «Episodio a mano» y «Programa a mano» en la búsqueda;
   - «Añadir episodio manualmente» en los episodios, con lo escrito en el filtro y el programa si ya está;
   - «Manual» en la ficha.

### 20.2 Reutilización respecto a M4g.3
- **`assistant-ui.tsx` (nuevo)**: `AssistantSheet` (hoja inferior o lateral, aviso de descarte y posición sobre el teclado del iPhone) y `searchErrorText`. `AddBookSheet` pasa a usarlos, sin cambiar su comportamiento: su E2E sigue verde.
- **Sin cambios, de M4g.1 y M4g.2**: `createSearchController`, `metadataClient`, `CoverArt`, `existingShow`, `findShowMatches`, `findEpisodeMatches`, `filterEpisodes` y `toShowInput`.
- **Nuevos**: `episode-draft.ts` (puro y con pruebas), `showResultOf` (un programa de la Biblioteca como resultado de Apple, para abrir sus episodios) y el patrón de prueba de `add-book.spec.ts`.

### 20.3 Duplicados y conflictos
| Caso | Comportamiento |
|---|---|
| Mismo programa (`collectionId`) | Se reutiliza siempre; «En tu Biblioteca»; nunca se crea otro (E2E: 1 programa tras dos episodios) |
| Programa probable (nombre y creador; p. ej., uno escrito a mano) | Solo aviso, con «Usar «…»» en la ficha |
| Mismo episodio (`trackId`) | «Este episodio ya está en tu Biblioteca» con «Abrir el existente»; guardar desactivado. **No se ofrece «otra copia»**: sería el mismo episodio |
| Mismo título en otro programa | No es un duplicado (unitaria y E2E) |
| Mismo episodio en dos dispositivos sin conexión | El segundo se rechaza (`duplicate_external`); sus notas se conservan y se pueden guardar en el existente con su minuto (integración N1) |
| **El mismo programa en dos dispositivos sin conexión**, con un episodio en cada uno | El segundo programa se rechaza (`duplicate_external`) y **su episodio también** (`show_not_found`, trigger del servidor). Antes de M4g.4 ese episodio solo quedaba como un aviso genérico. Ahora el aviso explica qué pasó y ofrece **«Añadir a «programa existente»»**: el episodio se vuelve a escribir entero y **con el mismo id** (nueva opción `show` del motor, aditiva). También **«Guardar sin programa»** (nunca se pierde) y «Descartar el episodio». Sus notas esperan («Su episodio está pendiente de decidir») y después ofrecen «Guardar en «episodio»» (integración N2 y N3) |
| Rechazos en general | Nada se borra ni se fusiona solo. Los avisos se guardan en la copia del dispositivo y **sobreviven a cerrar y reabrir** (N2 lo comprueba). Un doble toque nunca escribe dos veces |

### 20.4 Sin conexión, demo y errores
- **Demo**: formularios manuales; ninguna petición a `/api/metadata` (E2E).
- **Asistente sin conexión**: lo dice, no hace peticiones y la entrada manual conserva el texto (E2E).
- **Programa y episodio por la cola sin conexión** (E2E con service worker): se eligen con red, se guardan sin ella, la ficha se abre con la carcasa del SW y queda «no sincronizado». Al volver la red llegan **una vez y en orden**: 1 `library.show.create` y 1 `library.item.create` en el registro del servidor.
- **Límite de Apple (429), Apple caído (502) y sesión caducada al pedir los episodios**: mensajes distintos, «Reintentar» (salvo con la sesión caducada) y la entrada manual con el texto escrito (E2E).
- **Episodio antiguo fuera de los 200**: «Ninguno de estos 200 coincide» → «Buscar episodios anteriores en Apple» → se guarda (E2E).
- **Episodio sin fecha, duración, descripción ni enlace**: campos vacíos y guardado con nulos (E2E).

### 20.5 Rendimiento observado (emulación, **no medido en iPhone**)
Chromium con el viewport de cada proyecto y la CPU 4 veces más lenta (CDP `Emulation.setCPUThrottlingRate`), 200 episodios simulados.

| Medida | Antes de la optimización | Después |
|---|---|---|
| Clic en el programa → primera fila (incluye la respuesta simulada y Playwright) | 350 ms (móvil) / 309 ms (escritorio) | 442 ms (móvil) / 332 ms (escritorio) |
| «Mostrar más» (30 filas más) | 250 / 278 ms | 185 / 288 ms |
| Teclas al filtrar (Event Timing, de la entrada al siguiente pintado; entradas ≥ 16 ms) | máximo **120** / 184 ms | máximo **48** / 136 ms, y en una segunda ejecución **56** / 152 ms |

- **Optimización aplicada**: el conjunto de episodios «En tu Biblioteca» se calcula una vez y cada fila está memorizada, así que una tecla ya no vuelve a dibujar las 30–60 filas.
- **Variación**: las cifras cambian de una ejecución a otra. Todas las teclas quedan por debajo de los 200 ms que se consideran buena respuesta (INP).
- **iPhone real**: diagnóstico preparado en **`/dev/podcasts`**, solo con `next dev` (404 en producción), con 200 episodios generados allí, sin peticiones ni datos de la cuenta. Mide el primer dibujo, el filtrado tecla a tecla y, donde Safari lo permita, las teclas escritas a mano. Hay que abrirlo desde el iPhone en la red local (§21.3). **Pendiente**: lo ejecuta el propietario.

### 20.6 Revisión visual (capturas `docs/screenshots/{mobile,desktop}-m4g4-*.png`)
- **Estados**: programas, episodios, búsqueda de anteriores, ficha, error de Apple y entrada manual, en móvil (375) y escritorio (1440). Cuenta sintética y datos simulados.
- **Corregido tras la revisión**: «último: 28 oct 2026» en la lista de programas usaba el día en UTC, cuando el mismo instante en la lista de episodios es el 29 en Madrid. Ahora los dos usan la zona del perfil, con una comprobación en la E2E.

### 20.7 Pruebas y resultados (01/11/2026)
| Suite | Resultado |
|---|---|
| `npm run check` (tipos, lint y unitarias) | **723/723**: 717 anteriores y 6 nuevas de `episode-draft`, más una comprobación nueva en `matching.test.ts` |
| `npm run test:integration` | **153/153**: 150 anteriores y N1, N2 y N3 |
| `npm run test:browser` | **6/6** |
| `e2e/add-podcast.spec.ts` | **16/16** (8 pruebas × móvil y escritorio), 0 omitidas |
| E2E dirigida (1 worker, Windows): `add-podcast`, `add-book`, `library`, `library-account`, `knowledge-live`, `offline`, `screen-error`, `a11y`, `covers`, `navigation` y `knowledge` | **194: 186 superadas y 8 omitidas previstas, 0 fallidas**. Sin avisos de `newAccount` |
| `npm run smoke` (local) | **22/22** |
| Build | Correcto; `/dev/podcasts` y `/dev/knowledge` responden **404** en producción |
| **E2E completa** (382 × 2) | **No ejecutada en local** (memoria de Windows). Pendiente de la CI |

**Las 8 pruebas de `add-podcast.spec.ts`:**
1. Programa → 200 recientes con su texto → 30 + 30 filas → filtro → día local (23:30 UTC del 28 = 29 en Madrid) → duración editada conservada → doble clic → **1 programa y 1 episodio** con todos los campos.
2. Programa reutilizado (sigue habiendo 1); mismo episodio bloqueado; mismo título en otro programa, sin aviso.
3. Episodio anterior a los 200 por la búsqueda de Apple; episodio sin datos guardado con nulos.
4. 429, 502 y sesión caducada al pedir los episodios: mensajes, y la entrada manual con el texto.
5. Asistente sin conexión: ninguna petición y entrada manual con el texto.
6. Teclado, foco, axe en los tres pasos y sin desplazamiento horizontal.
7. Con service worker: programa y episodio guardados sin conexión, llegan una vez y en orden.
8. Demo: formulario manual y ninguna petición a `/api/metadata`.

### 20.8 Riesgos
1. **Rendimiento en el iPhone**: medido solo en emulación. Falta `/dev/podcasts` en el dispositivo.
2. **VoiceOver y el teclado del iPhone** sin probar en un dispositivo real.
3. **Apple**: la búsqueda de programas no trae descripción (se muestran los géneros), y la de episodios anteriores depende de que Apple los indexe.
4. **Borradores**: como en libros, una recarga con el asistente abierto pierde lo no guardado (D102, en el endurecimiento).
5. **E2E completa** no ejecutada en local (memoria de Windows). Queda para la CI.

### 20.9 Validación de M4g.4 en `ci/m4g` (cuando se autorice)
- **Recuentos esperados**:
  - unitarias **723**, integración **153** (N1–N3), `test:browser` **6**, smoke **22**;
  - E2E con **382 pruebas por pasada** (366 + 16 de `add-podcast.spec.ts`), **23 specs**, **0 omisiones nuevas**: **710 superadas y 54 omitidas** en dos pasadas (355 + 27 por pasada).
- **Comprobaciones**:
  - `add-podcast.spec.ts` incluye una prueba con service worker («offline through the queue»), que la CI ejecuta como las de `offline.spec.ts`;
  - las capturas y medidas `@screens` quedan fuera;
  - sin llamadas reales a Apple, sin Preview y `main` sin cambios.

## 21. Plan de endurecimiento posterior a M4g.4 (sin implementar; requiere autorización)

1. **Borradores temporales (D102)**:
   - `sessionStorage` por asistente y usuario (`top:draft:book:<user>`, `top:draft:episode:<user>`) con lo escrito, la ficha y el resultado elegido;
   - se restaura al reabrir el asistente en la misma pestaña tras una recarga («Recuperar lo que escribías»);
   - se borra al guardar, al descartar y al cerrar sesión; caduca a las 24 h; nunca va al servidor ni al SW;
   - pruebas de recarga a mitad, de cierre de sesión y de otra cuenta en la misma pestaña.
2. **Atribución de ediciones separadas (D101)**:
   - sin mezclar identificadores ni migrar: mostrar «Datos: Open Library» en la ficha cuando `source_url` es de `openlibrary.org` y no hay referencia externa, derivado al mostrarse y sin guardar nada;
   - documentar la limitación;
   - una columna propia de atribución, si algún día hiciera falta, sería una migración aditiva aparte.
3. **Rendimiento móvil**:
   - ejecutar `/dev/podcasts` (y `/dev/knowledge`) en el iPhone y apuntar las cifras reales;
   - si la lista de 200 pesa (≈214 KB), una lista sin descripciones con el detalle al elegir (cambio de contrato de M4g.1, con sus pruebas).
4. **VoiceOver**: una guía de prueba manual de los dos asistentes (anuncios de estado, orden del foco, elegir con doble toque, avisos de duplicado, teclado sin tapar los campos), que ejecuta el propietario y queda registrada sin datos personales.
5. **Validación integral de M4g antes de producción**:
   - CI completa en `ci/m4g`;
   - copia de seguridad verificada (aunque no haya migración);
   - prueba manual en móvil y ordenador con su guía;
   - procedimiento D48 de publicación en `main` con tu autorización;
   - comprobaciones en producción (portadas, metadatos, demo sin proveedores, `/dev/*` con 404).

## 22. M4g.4 · Auditoría y validación remota en `ci/m4g` (01/11/2026)

### 22.1 Auditoría previa
- **Commits:**
  - HEAD `8b18e5b`, árbol limpio, avance directo desde `ci/m4g` (`7794172`); `main` = `f66b3b9`;
  - 3 commits del proyecto con la identidad `noreply`: `445c5c6` (documentación de M4g.3), `54b0c8a` y `8b18e5b`.
- **Contenido del cambio:**
  - sin cambios en `supabase/`, `package.json`, el lockfile, `.github`, `public/` (service worker), `vercel.json` ni `next.config.ts`;
  - sin secretos ni correos;
  - sin ficheros temporales (`episode-diagnostics.tsx` es la página de diagnóstico de desarrollo, no un temporal).
- **Las 12 capturas `*-m4g4-*.png`, revisadas una a una:** programas públicos, episodios sintéticos y cuenta sintética; ningún correo ni nombre.
- **Contrato:**
  - **382 pruebas por pasada en 23 specs** (`--grep-invert @screens`);
  - `add-podcast.spec.ts` no tiene omisiones, así que siguen 27 por pasada;
  - `ci/**` sigue sin despliegues en Vercel.
- **Runner:** Supabase efímero con la puerta de aislamiento de siempre. El saldo de minutos no se puede leer con la herramienta de solo lectura; los últimos runs duraron unos 34 minutos.

### 22.2 Auditoría de integridad
**A. Programas y episodios**
- **Reutilización del programa:** la ficha preselecciona el existente por `collectionId` (`existingShow`) y solo crea uno si falta. Un reintento tras un fallo reutiliza el que acaba de crear. La E2E lo confirma: sigue habiendo 1 programa tras dos episodios.
- **Orden sin conexión:** la cola añade las altas al final (`enqueueLibrary`) y solo funde ediciones de un mismo elemento en su sitio, así que el alta del programa va siempre antes que la del episodio, también entre lotes.
  - La E2E con service worker lo confirma: 1 `library.show.create` y 1 `library.item.create`, y el episodio en su programa.
  - Si el programa se borrara sin conexión antes de enviarse, el episodio llegaría con `show_not_found` y tendría la recuperación nueva.
- **Sin huérfanos y sin duplicados por doble clic:** un guardián de doble envío y la comprobación en la E2E.

**B. Conflictos entre dispositivos**
- **N2:** el episodio del segundo dispositivo se conserva y se puede añadir al programa existente, o guardar sin programa (N3).
- **N1:** las notas del mismo episodio se conservan con su minuto.
- **Durabilidad:** los avisos se guardan en la copia del dispositivo y sobreviven a cerrar y reabrir (N2, M).
- **Doble toque:** devuelve `false` (N2 para `show`, M para `existing`).
- **Nada se descarta solo:** las notas solo desaparecen por una decisión del usuario.
- **Limitación previa a M4g.4, no crítica:** un **vínculo** de Cerebro creado sin conexión sobre un contenido rechazado queda como aviso propio. No se borra en silencio, pero tampoco se recrea solo: hay que volver a conectarlo a mano.

**C. Fechas y rendimiento**
- **Fechas:** la zona del perfil se aplica en programas, episodios y ficha. El día «último» de la lista de programas se corrigió en M4g.4 y está comprobado en la E2E.
- **Histórico de Apple:** «Los 200 más recientes de N. Si no está, búscalo abajo.», más la búsqueda de anteriores.
- **Lista:** las filas no llevan imagen; se dibujan 30 a la vez con filas memorizadas; tecla más lenta de 48–56 ms en emulación móvil con CPU ×4.
- **`/dev/podcasts`:** 404 en el build de producción (comprobado).

**D. Seguridad y compatibilidad**
- Demo sin peticiones a `/api/metadata` (E2E).
- Endpoints de M4g.1 sin cambios (verificación real de la sesión).
- Ninguna llamada real a Apple en la CI: todo se responde desde la página y lo imprevisto falla.

### 22.3 Ejecución
- **Push normal:** `7794172..8b18e5b → ci/m4g`. `main` y `ci/m4` no se tocaron.
- **Run** [41296762714](https://github.com/danimendi7/the-one-percent/actions/runs/41296762714) sobre `8b18e5b13469b19d956d9859a4035092415d2810`: **FALLO**, de 10:16 a 10:52 UTC.

| Suite | Resultado |
|---|---|
| Tipos y lint | Correctos |
| Unitarias | **723/723** |
| Integración | **153/153** (N1–N3 incluidas) |
| `test:browser` | **6/6** |
| E2E (2 pasadas, 382 × 2 = 764) | **707 superadas, 54 omitidas previstas, 2 fallidas y 1 inestable**. Todo lo que no pasó es **una sola prueba**: `add-podcast.spec.ts:305` («offline through the queue», con service worker), en los dos proyectos |
| Smoke | No se ejecutó (el job se detiene tras la puerta E2E) |

- **Evidencia:** el contexto de error del artefacto muestra, tras guardar sin conexión, la ficha con **«No está en este dispositivo»** y el estado «Sin conexión».
- **Sin reintentos ni pushes adicionales.**
- **Estado tras el fallo:**
  - sin Preview de Vercel;
  - `main` = `f66b3b9` y producción en `f66b3b931aac`;
  - la nube, 27/27 con 11 migraciones;
  - aislamiento correcto;
  - logs sin secretos, datos personales ni llamadas a Apple;
  - 4 avisos `newAccount` del patrón de siempre.

### 22.4 Diagnóstico: pérdida de un alta hecha sin conexión (defecto que ya existe en M4)
- **Causa (verificada):**
  1. Un alta guarda la cola en IndexedDB **de forma asíncrona** (`engine.submit` → `void this.persist()`).
  2. Justo después, el formulario o el asistente navegan a la ficha (`router.push`).
  3. **Sin conexión**, Next no puede pedir la ruta y hace una **recarga completa** (la sirve la carcasa del SW).
  4. Si la recarga llega antes de que la transacción de IndexedDB se confirme, el alta **no queda en el dispositivo**: la ficha dice «No está» y **nunca llega al servidor**.
- **Reproducido en local** (experimento temporal, no confirmado, con la CPU ×6):
  - con el asistente de podcasts: 3/3 intentos con 0 programas y 0 episodios en el servidor 25 s después de recuperar la red;
  - **con el alta manual de libros de M4**: 2/2 intentos con 0 libros en el servidor.
  - Sin ralentizar la CPU, la escritura suele ganar la carrera, y por eso la prueba pasó en Windows.
- **Alcance:**
  - afecta a **producción** (`f66b3b9`): cualquier alta de libro, episodio o programa hecha **sin conexión** desde un dispositivo lento puede perderse al abrirse sola la ficha;
  - con conexión no ocurre, porque la navegación es en el cliente, sin recarga;
  - las notas y capturas no navegan al guardarse.
  - Es el mismo tipo de riesgo para cualquier escritura seguida de una navegación automática sin conexión.
- **Por qué no se detectó antes:** ninguna prueba creaba contenido **sin conexión** y navegaba después. `offline.spec.ts` crea con red y captura notas sin red en una página ya cargada. La prueba nueva de M4g.4 es la primera en ejercitarlo, y la CI de Linux, más lenta, lo destapó.
- **Evidencia conservada** (fuera del repositorio): el artefacto y los logs del run, los registros del experimento y el fichero de la prueba temporal.

### 22.5 Corrección propuesta (no implementada; requiere autorización)
1. **Motor**: `submit` guarda la promesa de la última escritura. Nuevo `whenSaved(): Promise<boolean>`, que espera a que la cola con esa operación esté en IndexedDB y dice si se guardó (`persisted`).
2. **Acciones de Biblioteca**: `libraryActions.saved()`; en la demo resuelve al momento (`localStorage` es síncrono).
3. **Interfaz**: el formulario manual, `AddBookSheet`, `AddPodcastSheet` («Añadir» y «Seguir el programa») y cualquier otra navegación que siga a una escritura:
   - esperan a `saved()` antes de navegar, con un estado breve «Guardando en este dispositivo…» y un límite de unos 3 s;
   - si la copia no se pudo guardar, **no navegan**: muestran el error y conservan el formulario.
4. **Pruebas**:
   - la prueba de M4g.4 se mantiene, más una variante del **alta manual de libros**, las dos con la CPU ×6 para que el caso sea determinista;
   - prueba de motor de `whenSaved`;
   - `test:browser` con IndexedDB real.
5. **Producción**: como el defecto está en `f66b3b9`, conviene decidir si la corrección va en M4g.5 (y se publica con M4g) o como **corrección urgente** sobre `main` antes, con su propia validación y autorización.

**Estimación:** 60–90 minutos y una CI.


## 23. M4g.5 · Propuesta de endurecimiento (sin implementar; requiere autorización)

| # | Trabajo | Detalle | Minutos |
|---|---|---|---|
| 0 | **Corrección de la pérdida de altas sin conexión** (§22.5) — **prioritaria** | Persistencia confirmada antes de navegar, en el formulario manual y en los dos asistentes; pruebas deterministas con la CPU ×6. Decidir si va con M4g o como corrección urgente sobre `main` | 60–90 |
| 1 | **Borradores temporales** (D102) | `sessionStorage` con clave `top:draft:{book\|podcast}:{userId}`: lo escrito, la ficha (campos y campos tocados), el resultado elegido, la edición o el programa y la marca de tiempo. Se restaura al reabrir el asistente en la misma pestaña («Recuperar lo que escribías» / «Empezar de cero»). Se borra al guardar bien, al descartar explícitamente, al cerrar sesión y al cambiar de usuario; caduca a las 24 h; nunca va al servidor, a IndexedDB ni al service worker. Lectura y escritura con `try/catch` (navegación privada). Pruebas: unitarias del almacén, E2E de recarga a mitad en libros y podcasts, guardado que limpia, otra cuenta en la misma pestaña que no ve el borrador y caducidad | 100–130 |
| 2 | **Atribución de ediciones separadas** (D101) | Sin cambiar `external_id`: en la ficha, «Datos: Open Library» cuando `source_url` es de `openlibrary.org` y no hay referencia externa (derivado al mostrar, nada guardado). Prueba unitaria y E2E | 25–35 |
| 3 | **Búsqueda en el iPhone** | Revisión del asistente con capturas en un viewport de iPhone y el teclado simulado; ajustes de espacio de la cabecera de episodios (ocupa mucho en 375 px); la prueba real la hace el propietario con la guía (fila 5) | 40–60 |
| 4 | **Medición real con `/dev/podcasts`** | Procedimiento: `next dev` en la red local (como §21.3 de M4), abrir `/dev/podcasts` en el iPhone, «Medir el primer dibujo», «Medir el filtrado» y escribir a mano; apuntar las cifras en el plan sin datos personales. Si el filtrado supera 100 ms en el iPhone, propuesta de lista sin descripciones (contrato de M4g.1) | 20–30 (más el tiempo del propietario) |
| 5 | **Guía de VoiceOver y teclado del iPhone** | Pasos para los dos asistentes: anuncios de estado (`aria-live`), orden del foco, elegir con doble toque, avisos de duplicado, entrada manual y teclado sin tapar el campo ni el botón principal. Registro del resultado por paso | 30–40 |
| 6 | **Privacidad e integridad de la sincronización** | Repaso final: nada personal hacia los proveedores, caché del navegador (portadas `private`, metadatos `no-store`), avisos durables, `getUser()` en las rutas, `/dev/*` con 404 y búsqueda de secretos en el repositorio; más una prueba de integración que ate los casos M y N con vínculos de Cerebro (la limitación de §22.2-B queda documentada o, si se aprueba, con una recuperación) | 45–60 |
| 7 | **Plan de publicación conjunta de M4g** (sujeto a otra autorización) | Validación CI en `ci/m4g`; copia de seguridad verificada (sin migración, por prudencia); prueba manual guiada en móvil y ordenador; procedimiento D48 (`main` por avance directo, Vercel, CI de `main`, smoke en producción); comprobación en producción de portadas, metadatos, demo sin proveedores y `/dev/*` con 404; plan de vuelta atrás (revert, sin tocar la base) | 30–40 de preparación (más CI y publicación cuando se autorice) |

**Estimación total de M4g.5:** unos **350–485 minutos** de trabajo (incluida la corrección 0), más unos 35 minutos de CI remota si se autoriza. No incluye el tiempo del propietario en el iPhone ni la publicación.

## 24. Integración local de M4-H1 en M4g (01/11/2026)

La corrección 0 de §23 ya está en producción como hotfix M4-H1 (`docs/hotfix-m4-h1.md`, D105). Aquí se integra en M4g y se extiende a los asistentes (D106). Todo es local: sin push, sin CI remota, sin cambios en la nube ni en Vercel.

### 24.1 Rama y commits
- **Rama local `m4g/h1`**, en el worktree `the-one-percent-m4g-h1`, creada desde `ci/m4g` (`8b18e5b`).
- **Commits, en orden** (avance directo desde `8b18e5b`):
  1. `77f0b61`: la documentación local de M4g.4 (`2b9feb6` del `main` local, que sigue intacto).
  2. `341490c`: cherry-pick de `fb0d651` (corrección del hotfix).
  3. `c5996fc`: cherry-pick de `b8388f7` (corte estricto sin red); sin conflictos.
  4. La adaptación de los asistentes, las pruebas y esta documentación.
- **Conflictos al traer `fb0d651`:**
  - `docs/decisions.md`: las dos ramas añadían al final. Se conservan las dos secciones, M4g (D90–D104) y después M4-H1 (D105).
  - `store/types.ts`: se conserva el `resolveText(…, target?)` de M4g.3/M4g.4 y se añade `saved()`.
- **Fusiones automáticas revisadas:**
  - `engine.ts`: `whenSaved`, `writing` y el estado `saving`, junto a las opciones `existing` y `show` de M4g;
  - `content-form.tsx`: el borrador del asistente (`draft`) junto a la espera del hotfix;
  - `account-library.ts`: `resolveText` con `target` y `saved()`.
- **Comprobación:** `git range-diff` muestra el hotfix idéntico, y las únicas líneas eliminadas respecto a `77f0b61` son las que el propio hotfix sustituye.

### 24.2 Garantía aplicada a cada alta
| Flujo | Antes | Ahora |
|---|---|---|
| Alta manual (libro, episodio o programa, también desde «Introducir manualmente») | Hotfix (formulario) | Sin cambios: espera a `saved()` |
| Libro desde Open Library (confirmación) | Navegaba en el mismo tick | Espera a `saved()` |
| «Seguir el programa» (Apple) | Navegaba en el mismo tick | Espera a `saved()`; también al abrir uno que ya tenías |
| Episodio desde Apple, con programa nuevo | Navegaba en el mismo tick | Espera a `saved()`. Una sola escritura guarda los dos en el orden de la cola: programa antes que episodio |

**Común (`useDeviceSave`, `device-save.tsx`):**
- **Mientras guarda**, el botón dice «Guardando en este dispositivo…», desactivado y con `aria-busy`.
- **A los 3 s**, aparece un aviso que sigue esperando y nunca da por guardado lo que no lo está.
- **Si falla**:
  - no navega y conserva lo elegido;
  - «Reintentar» solo vuelve a escribir la copia y nunca crea otro libro, programa o episodio;
  - la guarda es síncrona, así que un doble toque tampoco duplica nada.
- **Mientras hay algo escrito, el asistente queda bloqueado** (`inert`): «Manual», «Volver», «Abrir el existente» y la lista. Así no hay una segunda alta por la entrada manual ni navegación antes de tiempo.
- **Lo recién escrito no se muestra como duplicado de sí mismo.** Antes, el detector de M4g.3/M4g.4 lo habría marcado como «ya está» y desactivado «Reintentar».
- **Persistencia local frente a sincronización:** «guardado» significa la copia de IndexedDB, nada más. El envío al servidor sigue siendo el de la cola, sin cambios.
- **Sin cambios** en el motor, el protocolo, el esquema, las migraciones, las dependencias, el service worker ni los endpoints.

**Fuera de alcance, sin cambios:** borrar y volver (`item-detail.tsx`) sigue sin esperar (riesgo 3 del hotfix, para M4g.5).

### 24.3 Pruebas
**`e2e/offline-save.spec.ts`:**
- **Las tres pruebas del hotfix** llegan al formulario manual a través de los asistentes, que es la entrada de M4g. Todas sus aserciones se mantienen.
- **Cuatro pruebas nuevas** con respuestas fijas de Open Library y Apple. Lo imprevisto falla; la búsqueda se hace con red y el guardado sin red.

| Prueba | Qué fija |
|---|---|
| Libro de Open Library, con la escritura retenida | «Guardando…», aviso a los 3 s, doble toque, «Manual» desactivado, sin duplicado de sí mismo, cola vacía hasta soltar. Después: la ficha; salir enseguida (otra carga completa sin red) y recargar; con red, 1 fila con `external_id` de la obra y 328 páginas, y 1 operación |
| «Seguir el programa», con la escritura retenida | Lo mismo con el programa: la cola tiene `library.show.create`; tras recargar sin red sigue y el servidor no tiene nada; con red, 1 programa y 1 operación |
| Episodio de Apple con programa nuevo, CPU ×6 y una nota | Cola `show.create` → `item.create` → `note.create`; recarga; con red, programa, episodio y nota enlazados, con sus referencias de Apple, y 1 operación de cada tipo |
| Almacenamiento lleno en la confirmación del episodio | Error, «Reintentar» activo, sin duplicado, sin navegar, cola vacía; un segundo fallo no cambia nada; al restaurar, la cola tiene exactamente un programa y un episodio; con red, 1 de cada |

**`add-podcast.spec.ts` («chosen online, saved without connection», la antigua línea 305, ahora la 308):**
- usa el mismo corte estricto (`e2e/support/offline.ts`, movido sin cambios desde `offline-save.spec.ts`);
- sus aserciones no cambian.

**Antes y después, en Windows:**

| Código | Resultado |
|---|---|
| Asistentes sin adaptar (`git stash` temporal) | Las 4 pruebas nuevas **fallan 8/8** y los 8 contextos de error muestran «No está en este dispositivo». Las del hotfix pasan, porque el formulario ya espera. La 308 pasó: depende de la carrera, por eso hacían falta las pruebas con barrera |
| Asistentes adaptados | **16/16** a la primera |

### 24.4 Validación local (Windows, un worker, Supabase local)
| Suite | Resultado |
|---|---|
| `npm run check` (tipos, lint y unitarias) | **726/726** (723 de M4g.4 y 3 del hotfix) |
| Integración | **153/153** |
| `test:browser` | **6/6** |
| E2E dirigidas (`add-book`, `add-podcast`, `covers`, `offline-save`, `offline`, `library-account`, `library`, `knowledge-live`, `knowledge`, `screen-error`, `navigation`, `upgrade`, `a11y`) | **218 superadas y 8 omitidas previstas, 0 fallidas, 0 inestables** |
| Build de producción | Correcta |
| Smoke local | **22/22** |
| E2E completa, una pasada (396 pruebas en 24 ficheros) | **Incompleta por memoria.** Las primeras 383 dieron 356 superadas, 27 omitidas (contrato D87) y 0 fallidas. Las 13 últimas (escritorio: `reviews.spec.ts:144`, 3 de `screen-error` y 9 de `upgrade`) cayeron cuando Claude Code detuvo la ejecución por falta de memoria del sistema («Target crashed», «worker process exited», código `0xC0000142`). `screen-error` y `upgrade` ya habían pasado en las dirigidas. **Sin resultado en este equipo: `reviews.spec.ts:144` [desktop]** |

**Recuento para la CI:**
- 396 pruebas por pasada en 24 specs (382 de M4g.4, 6 del hotfix y 8 nuevas), con 27 omitidas por pasada;
- dos pasadas: 792 enumeradas, **738 superadas y 54 omitidas**.

### 24.5 Riesgos pendientes
1. **Recarga o cierre manual** en los milisegundos del guardado (igual que en el hotfix).
2. **Borrar y volver** no espera (M4g.5).
3. **Notas escritas justo antes de pulsar un enlace sin red:** la ventana de autoguardado de 800 ms existe desde M4.
4. **Línea de estado** de ediciones fundidas en un alta aún no enviada: puede adelantarse unos milisegundos.
5. **Cerrar el asistente durante la espera** no navega; lo creado sigue en memoria y su escritura continúa. Si esa escritura fallara, lo indicaría la línea de estado de la Biblioteca, no el asistente.
6. **Pendiente:**
   - la E2E completa en Linux (CI) y `reviews.spec.ts:144` [desktop] en local;
   - un iPhone real.

### 24.6 Validación remota propuesta (requiere autorización)
1. Publicar `m4g/h1` en `ci/m4g` por avance directo desde `8b18e5b`, sin force push. `ci/**` no despliega.
2. **Exigir:**
   - unitarias 726/726, integración 153/153 y `test:browser` 6/6;
   - E2E en dos pasadas con 396 enumeradas por pasada, 738 superadas y 54 omitidas, sin fallos ni inestables;
   - smoke 22/22;
   - `offline-save` y `add-podcast` en los dos proyectos.
3. Si sale en verde, M4g.5 y la publicación conjunta de M4g siguen requiriendo autorización aparte.
