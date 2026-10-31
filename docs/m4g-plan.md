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
