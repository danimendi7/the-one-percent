# Plan M4 · Knowledge OS: Biblioteca (Libros y Podcasts) y conocimiento personal

**Estado (30/10/2026)**:
- **Arquitectura aprobada**, con 18 decisiones registradas como **D59–D69** en `docs/decisions.md`. La valoración pasa a ser **de 1 a 10**, no de 1 a 5 como se propuso.
- **M4a hecha en local** (§16).
- **M4b no empieza sin tu autorización.**
- Las propuestas aún abiertas siguen marcadas como **P** (§15 y §16.6).

---

## 0. Resumen
- **Objetivo**: convertir lo que lees y escuchas en conocimiento propio, organizado y recuperable.
  - Biblioteca con dos secciones, **Libros** y **Podcasts**, sobre **una sola capa de conocimiento**: ideas, citas, aprendizajes, aplicaciones prácticas y notas.
  - Esa capa se consulta y se busca desde una vista global, sin conexión y en todos los dispositivos.
- **Arquitectura recomendada** (P3):
  - una tabla `library_items` para libros y episodios, con sus columnas específicas protegidas por `CHECK`;
  - `podcast_shows` para los programas;
  - una capa común `knowledge_notes` y `knowledge_links`;
  - todo por el motor de sincronización actual (`apply_ops`, `pull_changes`, cola de IndexedDB, D47/D55/D58).
  - No se construye un segundo sistema.
- **Sin IA, sin servicios de pago y sin credenciales nuevas.** Los metadatos externos usan fuentes gratuitas sin clave, a través del servidor, y la entrada manual siempre funciona (P10).
- **Plan**: 10 subfases (M4a–M4j) con **dos despliegues**: el primero tras la Biblioteca manual con el conocimiento y la búsqueda, el segundo tras los metadatos, las sesiones y el repaso. Estimación total: **13,5–18,5 días de trabajo** (§13).
- **Primer paso recomendado**: M4a, el dominio puro y la demo, sin migraciones ni cambios en la nube. Incluye la medición de rendimiento del almacenamiento local con 5.000 notas (riesgo R2 del cierre de M3).

---

## 1. Requisitos ya aprobados (fuentes)
Fuentes: `docs/spec/PRODUCT_REQUIREMENTS.md` §4 y §9, `DATABASE_ARCHITECTURE.md` («Knowledge / Library»), `DESIGN_SYSTEM.md`, `IMPLEMENTATION_PLAN.md` (M4), `docs/decisions.md` y `CLAUDE.md`.

| # | Requisito aprobado | Fuente | Tratamiento en M4 |
|---|---|---|---|
| A1 | Vistas de cuadrícula de portadas o lista; estanterías Quiero leer, Leyendo, Terminados, En pausa y Favoritos; filtros, orden y búsqueda por título, autor, ISBN, etiquetas y valoración | PRD §4.1 | Se mantiene. Los estados se unifican con los de podcasts (P4) |
| A2 | Alta de libro buscando en Google Books u Open Library **desde el servidor**, revisando los datos importados; **entrada manual cuando la API falla**; portada subida o por URL autorizada | PRD §4.1 | Se mantiene (P10, P11) |
| A3 | Ficha: portada, metadatos, estado, fechas, progreso en páginas o %, valoración, género y etiquetas, sesiones de lectura, notas (idea, cita, curiosidad, reflexión, pregunta, aplicación) con página opcional, fuente guardada y enlaces entre notas; sin ingerir el texto completo de libros | PRD §4.1 | Se mantiene. Se añade «aprendizaje» y se fusiona «curiosidad» (P5) |
| A4 | Favorito independiente del estado; varias ediciones solo como registros explícitos; deduplicar por id externo y usuario; las notas se conservan al editar metadatos; páginas desconocidas admitidas; progreso manual | PRD §4.1 | Se mantiene (§5) |
| A5 | Una sesión de lectura suma minutos o páginas y cumple los hábitos vinculados **una sola vez**, deduplicada por id de actividad; nunca completa hábitos no vinculados | PRD §4.1 y criterio §9.3 | Se mantiene con el patrón D33 de Enfoque (M4h) |
| A6 | Portada de respaldo; un fallo de la API nunca bloquea; atribución al proveedor; proxy y caché cuando las condiciones lo permitan | PRD §4.1 | Se mantiene (§9) |
| A7 | Descubrir: temas diarios, valoración 1–10, fuentes verificadas, **modo curado sin clave** y adaptador de IA opcional | PRD §4.2 | **Discrepancia** con «sin IA en M4» (P1) |
| A8 | Cerebro: tarjetas de repaso manuales o sugeridas por IA, Again/Hard/Good/Easy, calendario espaciado y **búsqueda personal** en notas, temas y tarjetas | PRD §4.3 | La búsqueda entra en M4 (M4e). El repaso básico manual, en M4i (P2). Las tarjetas de IA, aplazadas |
| A9 | Salida de M4: el libro persiste; una sesión de lectura completa el hábito vinculado una vez; ninguna cita inventada se muestra como verificada | `IMPLEMENTATION_PLAN.md` | Se mantiene |
| A10 | Criterio de lanzamiento 4: alta de libro por API o manual; metadatos y notas persisten, se editan y se recuperan tras una sesión nueva | PRD §9 | Se mantiene |
| A11 | Tablas `books`, `book_authors`, `reading_sessions`, `book_notes`, `knowledge_tags` y `knowledge_links`; RLS; APIs externas por el servidor; bucket privado para imágenes subidas | `DATABASE_ARCHITECTURE.md` | Se **generalizan** a libros y podcasts (P3, P7, P20) |
| A12 | Biblioteca usada recientemente accesible sin conexión «cuando sea viable» | PRD §6 | Datos sin conexión: sí. Arranque sin conexión: requiere service worker (P17) |
| A13 | Componentes `BookCoverCard`, `BookDetailsDrawer`, `BookNoteEditor`, `ReadingSessionInput` y `EmptyState`; portadas sin deformar | `DESIGN_SYSTEM.md` | Se generalizan a «contenido» |
| A14 | UI en español y oscura, móvil primero, zonas táctiles ≥ 44 px, solo tokens, demo etiquetada, sin simular backend, sync ni IA | `CLAUDE.md` | Se mantiene |

**Novedades de este encargo**, nuevas frente al PRD y propuestas como ampliación:
- Podcasts, con la relación entre programa y episodio.
- La ficha de conocimiento equivalente entre formatos.
- La vista global de conocimiento.
- Las aplicaciones prácticas con seguimiento.

## 2. Discrepancias y propuesta
| # | Discrepancia | Propuesta (no aprobada) |
|---|---|---|
| X1 | El PRD solo contempla libros; el encargo añade podcasts con programa y episodio | Ampliación aditiva: misma capa de conocimiento y misma ficha (P3) |
| X2 | Estados del PRD: Quiero leer, Leyendo, Terminado, En pausa. Encargo: pendiente, leyendo, terminado y abandonado | Unificar en 5 estados internos con etiquetas por tipo, incluidos **En pausa** (PRD) y **Abandonado** (encargo) (P4) |
| X3 | Tipos de nota del PRD (idea, cita, curiosidad, reflexión, pregunta, aplicación) frente a las secciones del encargo (ideas principales, notas, citas, aprendizajes, aplicaciones) | 6 tipos: idea, aprendizaje, cita, aplicación, nota (reflexión) y pregunta. «Curiosidad» se fusiona con «idea» (P5) |
| X4 | Descubrir con adaptador de IA está en el M4 aprobado; el encargo excluye la IA de M4 | Llevar Descubrir completo a M6, junto con la IA (P1) |
| X5 | Repaso espaciado básico en la salida de M4 aprobada; el encargo no lo menciona | Mantenerlo en M4 como subfase final y opcional (M4i), solo con tarjetas manuales (P2) |
| X6 | La spec separa `books` y `book_notes` | Tabla común de contenidos y de notas (P3). Mismos principios (RLS, propietario, deduplicación) |
| X7 | La spec define `knowledge_tags` como tabla | Lista `topics text[]` normalizada, sin tabla de etiquetas en M4 (P7) |
| X8 | `reading_sessions` solo para libros | `library_sessions` para lectura y escucha (P20) |
| X9 | La spec no fija la escala de valoración de libros (D10 fija 1–10 para temas) | **Aprobado: 1–10** para contenidos, opcional (D61), la misma escala que Descubrir (D10) |
| X10 | `data-model.md` sitúa las revisiones persistidas en M6 | Ya están hechas en M3.4. Sin efecto en M4 |

## 3. Lo que ya existe y se reutiliza
### 3.1 Prototipo M1 (`/knowledge/*`, solo demo)
| Pieza | Fichero | Reutilización |
|---|---|---|
| Vista de Biblioteca: estanterías, búsqueda, orden y cuadrícula o lista | `src/features/library/components/library-view.tsx` | Base visual de la sección Libros. Los datos pasan del fixture al modelo nuevo |
| Portada tipográfica 2:3 | `components/book-cover.tsx` | Se generaliza a `CoverArt` (libro 2:3, programa y episodio 1:1). Sigue siendo el respaldo sin imagen |
| Hoja de detalle | `components/book-details-sheet.tsx` | Sustituida por fichas con ruta propia (se pueden enlazar y abrir sin conexión) |
| Búsqueda y filtros | `domain/search.ts` (`normalize`, `filterBooks`, `readingProgress`) | `normalize` se reutiliza tal cual. El filtro se generaliza en el índice de búsqueda (§7) |
| Fixtures | `src/features/library/fixtures.ts` (`BookNote`, `NOTE_LABEL`, `STATUS_LABEL`) | Se migran a la demo nueva, etiquetada |
| Descubrir y Cerebro (demo) | `src/features/discover/*`, `src/features/brain/*` | Descubrir queda como está hasta M6 (P1). Cerebro pasa a ser la vista global (P16) |

### 3.2 Arquitectura y componentes
| Pieza | Dónde | Uso en M4 |
|---|---|---|
| Motor de sincronización | `src/features/sync/engine.ts`, `domain/rebase.ts`, `merge.ts`, `persisted.ts`, `idb-storage.ts` | Operaciones `library.*`; cola durable; compactación por fila; `upgradePersisted` (D38/D39); Web Lock y `goneOps` (D58) |
| Escritura validada en el servidor | `apply_ops` → `private.apply_<dominio>_op` (D18, D54) | `private.apply_library_op`, con marca local de transacción (solo `apply_ops` escribe) |
| Pull incremental con lápidas | `pull_changes` y `change_seq` | Bloques nuevos `library_items`, `podcast_shows`, `knowledge_notes`, `knowledge_links` y `library_sessions` |
| Textos que nunca se pierden | D47/D55: `pendingNotes` y `resolvedNotes`, `ConflictPanel` | Conflictos de cuerpo de nota y de descripción |
| Campos con sello propio | D42 (`checkin.set` por campo) | Estado, valoración, favorito y fechas de un contenido |
| Hábito derivado de una actividad | D33 (`activity_source = 'focus'`) | `activity_source = 'library'` para sesiones de lectura o escucha (M4h) |
| Bandera según el pull | D37 (`features.focus`) y `reviewsEnabled()` | `libraryEnabled()`: el código y la migración se despliegan en cualquier orden |
| Guardado automático | `useAutosave` (`reviews/components/review-sections.tsx`): 800 ms, al salir del campo y en `pagehide` | Editor de notas y captura rápida |
| Indicador honesto | `SaveIndicator` y `saveLine` (D57) | «Sincronizado» solo cuando el servidor tiene la escritura |
| UI común | `PageHeader`, `EmptyState`, `Segmented`, `ChoiceGroup`, `Sheet`, `Dialog`, `Tabs`, `SourceBadge`, drilldowns de Análisis, filtros en la URL | Todas las pantallas nuevas |
| Métricas honestas | Catálogo de Análisis (n, N/D, «Pocos datos») | Estadísticas de Biblioteca (M4h) |
| Copias, simulacro, CI y despliegue | `npm run backup`, `restore:drill`, `cloud`, `ci-gate.mjs`, D48 | Igual que en M3.4 |

### 3.3 Qué se aprovecha de los módulos de M3
- **Objetivos**: el patrón de métricas de esfuerzo frente a resultado, y los enlaces muchos a muchos con propietario verificado. El vínculo de un objetivo con contenidos queda aplazado (P15).
- **Life Analytics**: catálogo, drilldown al registro de origen y estados de muestra pequeña.
- **Mente y energía**: campos con sello propio (D42), D47 y un formulario de 3 toques sin botón «Guardar».
- **Life Review**: autoguardado por sección, conflictos por sección, panel de conflictos, documentos de solo lectura y registro de decisiones. Las «aplicaciones prácticas» funcionan como las decisiones: un estado y una evaluación.
- **Enfoque**: sesiones con tiempo real y hábito derivado sin doble conteo.

## 4. Especificación funcional: Biblioteca
### 4.1 Conceptos
- **Contenido** (`library_item`): un libro o un episodio. Es lo que tiene estado, valoración, fechas y notas.
- **Programa** (`podcast_show`): agrupa episodios y guarda una vez los datos comunes (nombre, presentador, portada, descripción y enlace). No tiene estado de consumo propio. Su ficha muestra sus episodios y el conocimiento agregado.
- **Nota de conocimiento** (`knowledge_note`): una unidad de conocimiento con tipo, texto, localizador opcional (página o minuto) y temas. Pertenece a un contenido o es una nota suelta (P5).
- **Enlace** (`knowledge_link`): relaciona dos contenidos, dos notas, o una nota y un contenido.
- **Sesión** (`library_session`): un rato de lectura o escucha con minutos y páginas opcionales (M4h).

### 4.2 Ficha común (Libros y Podcasts)
| Bloque | Libro | Episodio |
|---|---|---|
| Información general | Título, subtítulo, autores, portada, temas, descripción o sinopsis, año, editorial, ISBN, páginas e idioma | Título, programa, invitados, imagen, plataforma (Spotify, Apple Podcasts, YouTube, iVoox u otra), enlace original, duración, fecha de publicación y n.º de episodio |
| Estado y valoración | Estado (P4), favorito, valoración 1–10 (D61), fecha de inicio y de fin, y progreso (página actual o %) | Estado, favorito, valoración, fecha de escucha o visualización (inicio y fin) y minuto en que te quedaste (opcional) |
| Ideas principales | Notas de tipo **idea**; las destacadas (⭐) encabezan | Igual |
| Citas o momentos | Tipo **cita**, con página opcional | Tipo **cita**, con marca de tiempo opcional (`mm:ss`) que abre el enlace en ese punto si la plataforma lo admite (YouTube `t=` y Spotify) |
| Aprendizajes | Tipo **aprendizaje** | Igual |
| Aplicaciones prácticas | Tipo **aplicación**, con estado (pendiente, en marcha, hecha o descartada) y vínculo opcional a un hábito u objetivo (P15) | Igual |
| Notas personales | Tipo **nota** (reflexión) y **pregunta** | Igual |
| Contenidos relacionados | Enlaces a otros libros, episodios o notas | Igual |
| Historia | Línea de tiempo: añadido, empezado, terminado, n.º de ideas por mes y cambios de estado | Igual |

Todo es opcional salvo el **título** (y el **tipo**). Un libro se puede dar de alta solo con el título, y un episodio con el título o con su enlace.

### 4.3 Libros
- **Estanterías**: Todos, Leyendo, Pendientes, Terminados, En pausa, Abandonados y Favoritos. El recuento va en la pestaña.
- **Vistas**: cuadrícula de portadas (predeterminada) y lista densa.
- **Orden**: recientes (última actividad), título, autor, valoración y fecha de fin.
- **Filtros**, guardados en la URL: tema, valoración mínima, año de fin, con notas o sin ellas.
- **Progreso**:
  - página actual sobre el total; si el total es desconocido, porcentaje manual;
  - se actualiza a mano o desde una sesión (M4h);
  - nunca se infiere «terminado» sin que lo marques. Al llegar al 100 % la app solo lo sugiere.
- **Estadísticas** (M4h, primera versión sencilla): terminados por año y por mes, páginas y minutos registrados, ideas guardadas y aplicaciones hechas sobre las propuestas. Con «N/D» y «Pocos datos» como en Análisis.
- **Ediciones**: una edición distinta es otro registro, explícito. Si coincide el ISBN o el id externo, la app avisa de un posible duplicado.

### 4.4 Podcasts
- **Programas**: cuadrícula de imágenes 1:1 con el n.º de episodios registrados y el último escuchado. La ficha del programa muestra sus episodios (por estado y fecha), los temas agregados y las ideas de todos sus episodios.
- **Episodios**: lista cronológica de recientes con filtro por programa, estado, tema y valoración. Pestañas: En curso, Pendientes, Completados, Abandonados y Favoritos.
- **Alta de episodio**:
  - pegar un enlace (Spotify, Apple Podcasts o YouTube): la app propone título, programa, imagen, duración y fecha, que revisas antes de guardar (M4g);
  - buscar por nombre (iTunes Search, M4g);
  - o entrada manual (siempre disponible).
- **Programa**: un episodio puede quedar **sin programa**, por ejemplo una charla suelta de YouTube (P9). Al dar de alta un episodio de un programa ya registrado se reutiliza, sin duplicar sus datos.
- **No hay reproducción** en la app: solo el enlace a la plataforma original (`rel="noopener noreferrer"`, en otra pestaña).

### 4.5 Captura rápida (requisito clave)
- Al abrir un libro o un episodio, una barra fija **«Añade una idea…»**:
  - en el móvil, sobre la barra de pestañas;
  - en el escritorio, al pie de la columna de notas.
- **Flujo**: tocar, escribir, «Guardar» o ⌘/Ctrl+Enter. **Un toque más el texto.**
  - El tipo por defecto es **Idea**; se cambia con chips (Idea · Aprendizaje · Cita · Aplicación · Nota) sin abrir ningún formulario.
  - El localizador (página o minuto) se ofrece relleno con el último progreso conocido y se puede quitar.
- **Guardado inmediato** en el dispositivo, también sin conexión. La línea de estado dice la verdad: «Guardado en este dispositivo», «Sincronizando…», «Sincronizado».
- **Tras guardar**, la barra queda abierta y vacía para la siguiente idea.
  - «Deshacer» dentro de la barra durante 5 s, accesible: no es un toast que desaparezca para los lectores de pantalla (lección de D40).
  - El borrador sin guardar sobrevive a cerrar la app (autoguardado del borrador).
- **Desde la portada de Biblioteca y desde Cerebro**: «Idea rápida» abre la misma barra con el contenido en curso más reciente preseleccionado y un selector para cambiarlo, o «Sin contenido» para una nota suelta.

## 5. Modelo de datos
### 5.1 Alternativas
| Opción | Descripción | A favor | En contra |
|---|---|---|---|
| A. Tablas separadas | `books`, `book_notes`, `podcast_episodes`, `episode_notes`… (spec ampliada) | Columnas tipadas sin nulos; fiel a la spec | Duplica notas, enlaces, búsqueda, operaciones de sync, conflictos y UI. La vista global une N tablas; cada formato futuro (artículos, cursos, vídeos) repite todo. Es justo lo que el encargo pide evitar |
| B. Herencia por tablas | `library_items` común más `book_details` y `episode_details` 1:1 | Integridad tipada; notas con una sola FK | Dos filas por contenido: versionado, lápidas y conflictos coordinados entre tablas; más complejidad en el motor y en el pull |
| **C. Tabla única con columnas específicas y `CHECK` (recomendada)** | `library_items` con las columnas comunes más las específicas de cada tipo, nulas cuando no aplican y obligadas por `CHECK (kind = …)`; `podcast_shows` aparte; capa común de notas y enlaces | **Una fila por contenido**: un solo versionado, una lápida, un bloque de pull y una operación. Las notas tienen **una FK real**. La vista global y la búsqueda leen una sola tabla. Un formato nuevo es un valor de `kind` y unas columnas más con su `CHECK` | Unas columnas nulas por fila. Los `CHECK` deben mantenerse al añadir tipos (cubierto por tests) |

**Recomendación: C** (P3). Es la más clara para el motor que ya funciona: una fila es una unidad de sincronización. Mantiene integridad real (FK compuestas, `CHECK` y triggers) y amplía sin rediseño.

### 5.2 Tablas propuestas (migración R1 `20261101090000_library.sql`)
Común a todas, como en M3:
- `id uuid` generado en el cliente (alta idempotente) y `user_id`;
- `server_seq` (`change_seq`), `created_at`, `updated_at`, `deleted_at` (lápida);
- `field_seqs jsonb`, mantenido por un trigger como en D54/D55;
- FK compuestas `(id, user_id)`;
- RLS: `select`, `insert` y `update` propios para `authenticated`; sin `delete` ni `truncate`; `anon` sin permisos;
- escritura solo por `apply_ops` (marca local de transacción, D54).

**`podcast_shows`**
- `title` (1–300), `publisher` (≤ 200), `description` (≤ 5.000) y `topics text[]` (≤ 10 × 40).
- `cover_source` (`none` | `external` | `upload`) y `cover_ref` (URL de un host permitido o ruta de Storage).
- `source_url` (http/https, ≤ 2.048), `external_provider` (`itunes` | `spotify` | `youtube` | `manual`) y `external_id`.
- Único `(user_id, external_provider, external_id)` donde `external_id` no es nulo y no hay lápida.

**`library_items`**
- **Comunes**:
  - `kind` (`book` | `episode`), `title` (1–300), `subtitle` (≤ 300), `creators text[]` (autores de un libro o invitados de un episodio; ≤ 20 × 200);
  - `description` (≤ 10.000), `topics text[]` (P7), `language` (≤ 10);
  - `status` (`planned` | `active` | `paused` | `done` | `abandoned`), `is_favorite bool` y `rating smallint` (1–10 o nulo, D61);
  - `started_on date` y `finished_on date` (con `finished_on ≥ started_on`), `progress_percent numeric(5,2)` (0–100 o nulo);
  - `cover_source`, `cover_ref` y `source_url`;
  - `external_provider` (`openlibrary` | `googlebooks` | `itunes` | `spotify` | `youtube` | `manual`), `external_id` y `metadata_attribution` (≤ 200).
- **Solo `book`**: `isbn13` (13 dígitos válidos), `isbn10`, `page_count` (> 0), `current_page` (≥ 0, ≤ `page_count` si lo hay), `publisher` y `published_year`.
- **Solo `episode`**: `show_id`, con FK compuesta `(show_id, user_id)` a `podcast_shows` (nula = sin programa, P9); `platform` (`spotify` | `apple` | `youtube` | `ivoox` | `web` | `other`); `duration_seconds` (> 0); `published_on`; `episode_number`; `position_seconds` (≥ 0).
- **`CHECK`**: con `kind = 'book'` las columnas de episodio son nulas, y viceversa.
- **Únicos**: `(user_id, kind, external_provider, external_id)` donde hay id externo y no hay lápida (deduplicación del PRD). El ISBN **no** es único (ediciones explícitas); la app avisa.

**`knowledge_notes`**
- `item_id`, con FK compuesta y nula = nota suelta (P5).
- `note_type` (`idea` | `learning` | `quote` | `application` | `note` | `question`).
- `body` (1–10.000; una cita como máximo 2.000, P19).
- `page` (≥ 0), `position_seconds` (≥ 0) y `locator_text` (≤ 120, p. ej. «Cap. 3»).
- `is_starred bool`.
- `application_status` (`open` | `doing` | `done` | `dropped`), solo si `note_type = 'application'`.
- `linked_habit_id` y `linked_goal_id`, nulos, con FK compuesta, solo en aplicaciones (P15).
- `topics text[]` y `client_created_at`.
- Índices: `(user_id, server_seq)`, `(user_id, item_id)` y GIN sobre `topics`.

**`knowledge_links`**
- `a_type`, `a_id`, `b_type` y `b_id`, con tipos `item`, `show` y `note` (ampliable a `goal`, `habit` y `review`).
- Forma canónica (a < b) y único por usuario y par.
- Trigger: los dos extremos existen, son del mismo usuario y no tienen lápida.
- Quitar un enlace deja lápida, con estado deseado (D6).

**`library_sessions`** (migración R2 `20261105090000_library_sessions.sql`, M4h)
- `item_id` (FK compuesta), `local_date` (zona del perfil, D34), `occurred_at`, `minutes` (1–1.440), `pages_from`, `pages_to` y `note` (≤ 500).
- Idempotente por `id`.
- Si `habits.activity_source = 'library'`, el día se materializa en `habit_entries` en la misma transacción (D33): suma de minutos o de páginas según la unidad del hábito. El registro manual de ese hábito se rechaza con `derived_entry`.

**Historia**: `audit_logs` registra creación, cambios de estado, fin, borrado y restauración (sin textos). La línea de tiempo de la ficha sale de ahí y de las fechas. **No** se versiona el texto de cada nota en M4: los conflictos conservan ambas versiones (§8).

### 5.3 Relaciones
```
auth.users 1─* podcast_shows 1─* library_items(kind=episode)   (show_id nulo = sin programa)
auth.users 1─* library_items(kind=book|episode) 1─* knowledge_notes   (item_id nulo = nota suelta)
library_items 1─* library_sessions ──(día, activity_source='library')──► habit_entries (derivado, D33)
knowledge_notes(application) ─? habits | goals            (vínculo opcional)
knowledge_links: item|show|note  *─*  item|show|note      (canónico, sin duplicados)
audit_logs ◄── cambios de estado y borrados (sin textos)
```

### 5.4 Límites y contenido de terceros (P19)
- **Longitudes**: título 300; nota 10.000; cita 2.000; descripción 10.000; temas ≤ 10 de 40 caracteres; creadores ≤ 20.
- **Sin importación masiva** del texto de libros o de transcripciones. Las citas son fragmentos que escribes tú (PRD §4.1).
- **URLs**: solo `http` y `https`, ≤ 2.048, sin credenciales en la URL; validadas en el cliente y en el servidor.

## 6. Arquitectura de notas, ideas y aprendizajes (común a todos los formatos)
- **Una nota es una fila.** La unidad de edición, sincronización y conflicto es pequeña: dos dispositivos que añaden ideas al mismo libro **nunca chocan**.
- **Dominio puro** `src/features/knowledge/domain`:
  - tipos, etiquetas y orden de secciones;
  - validación (las mismas reglas que los `CHECK`);
  - agrupación por sección para la ficha;
  - extracción de temas;
  - índice de búsqueda;
  - estadísticas («ideas por mes», «aplicaciones hechas / propuestas»).
- Se usa igual con libros, episodios y notas sueltas.
- **Componentes** `src/features/knowledge/components`: `QuickCapture`, `NoteCard`, `NoteEditor` (autoguardado), `NoteSection`, `LocatorInput` (página o `mm:ss`), `TopicInput`, `LinkPicker`, `ApplicationStatus` y `KnowledgeConflictPanel` (generaliza `ConflictPanel`).
- **La Biblioteca solo aporta lo específico**: `CoverArt`, la cabecera de la ficha según el tipo, los formularios de metadatos de libro, episodio y programa, y las estanterías.
- **Ampliación futura**: artículos, vídeos o cursos serían un `kind` nuevo con sus columnas y su cabecera; las notas, la búsqueda, los enlaces y la sincronización no cambian.

## 7. Búsqueda y recuperación del conocimiento
- **Dónde**: en el **cliente**, sobre la copia local (P12).
  - Funciona sin conexión.
  - Responde al instante (< 50 ms con 5.000 notas, a verificar en M4a).
  - No envía consultas a ningún servidor.
- **Índice**: tokens normalizados con `normalize` (sin acentos ni mayúsculas) de título, creadores, temas, programa, ISBN y cuerpo de las notas.
  - Coincidencia por prefijo y por varias palabras; resaltado del término.
  - Ponderación sencilla: título > temas > notas destacadas > notas.
  - Se recalcula de forma incremental al cambiar el estado.
  - Si la medición lo exige, se construye en un Web Worker.
- **Vista global «Cerebro → Ideas»** (P16): todas las notas de todos los formatos.
  - Filtros combinables en la URL: tipo de nota, formato (libros, podcasts, sueltas), tema, contenido, programa, valoración mínima del contenido, destacadas, aplicaciones por estado y periodo.
  - Orden: recientes, antiguas o relevancia.
  - Agrupación opcional por contenido o por tema.
  - «Recuperar notas antiguas»: filtro por periodo y orden «más antiguas» (en M4 no hay algoritmo de resurfacing; el repaso espaciado es M4i).
- **Aplicaciones prácticas**: una vista propia (filtro preconfigurado) con las aplicaciones abiertas y en marcha, su contenido de origen y el vínculo a un hábito u objetivo.
- **Contenidos relacionados** en cada ficha:
  - los enlaces manuales;
  - además, una sugerencia **determinista y explicada**, sin IA: «comparten 2 temas: hábitos, sueño».
- **Sin embeddings ni búsqueda semántica** (§12).
- **Búsqueda en el servidor** (`tsvector` en español): no se necesita para un único usuario. Queda como opción si el volumen supera lo medido.

## 8. Sin conexión, sincronización y conflictos
### 8.1 Operaciones (cola durable, estado deseado e idempotentes por `op_id`)
| Operación | Contenido | Resolución |
|---|---|---|
| `library.item.create` / `library.show.create` | Fila completa con `id` del cliente | Idempotente: repetirla devuelve el resultado guardado |
| `library.item.update` / `library.show.update` | Solo los campos cambiados, con `base` por campo (`field_seqs`) | **Campos simples** (estado, valoración, favorito, fechas, progreso, portada, temas): si nadie cambió ese campo, se aplica; si cambió a la vez, gana el sello más reciente del reloj híbrido (D26/D42). **Textos largos** (descripción): conflicto → D47/D55 |
| `library.item.delete` / `library.show.delete` | `base_seq` y `confirm` | Lápida en el contenido y en sus notas; «Deshacer» la restaura. Si otro dispositivo lo editó después de `base_seq` → conflicto y no se borra |
| `library.note.create` | Nota completa | Idempotente. Si el contenido tiene lápida, se rechaza y el texto queda en `pendingNotes` para reasignarlo o guardarlo como nota suelta |
| `library.note.update` | Campos cambiados con `base` por campo | **`body`**: conflicto → se conservan las dos versiones (D47), con «Aplicar la mía», «Mantener la otra» o **«Guardar las dos»** (crea una nota nueva). Los demás campos, por sello |
| `library.note.delete` | `base_seq` | Si la nota cambió en otro dispositivo → conflicto: nunca se borra en silencio un texto que no viste |
| `library.link.set` | Par y `linked: true/false` | Estado deseado con lápida |
| `library.session.*` (M4h) | Sesión completa | Como `focus.*`: idempotente; el día del hábito se recalcula en el servidor |

- **Compactación** en la cola: por fila y campo se queda el valor más reciente, con la base de la primera escritura sin enviar (D55).
- **Crear y editar sin conexión** la misma nota se compacta en un solo `create`.

### 8.2 Servidor
- `apply_ops` despacha `library.%` a `private.apply_library_op` (`security invoker`, `search_path` vacío, D54).
- `pull_changes` añade los cinco bloques. Los pulls incrementales llevan lápidas; un pull completo omite las filas borradas y el cliente lo trata como «ya no existe» (corrección §17.8 de M3.4).
- Realtime: las cuatro tablas de R1 (más sesiones en R2) en `supabase_realtime`, solo como señal de invalidación.
- Tests de integración entre usuarios: no se puede leer, enlazar ni derivar sobre datos de otro usuario (PRD §9.9).

### 8.3 Cliente
- **Estado**: `library: { items, shows, notes, links, sessions }` en la copia de cada usuario.
- **`upgradePersisted`**: añade `library` vacío a las copias de M3.4, sin tocar nada más. `e2e/upgrade.spec.ts` añade la forma M3.4 con una operación pendiente (D38/D39).
- **Bandera `libraryEnabled()`**: si el pull no trae `library_items` (migración aún no aplicada), la Biblioteca guarda en el dispositivo y lo dice: «tu cuenta aún no guarda la biblioteca». Así el código y la migración se despliegan en cualquier orden (D37).
- **Pestañas**: la fusión de cola con Web Lock y `goneOps` (D58) cubre las operaciones nuevas sin cambios; se añade un E2E de dos pestañas con notas.
- **Dos dispositivos editando a la vez**:
  - **notas distintas**: nunca hay conflicto;
  - **misma nota**: se conservan las dos versiones;
  - **mismo campo simple**: gana el sello más reciente, que es aceptado y visible en la historia;
  - **nota borrada en un dispositivo y editada en otro**: conflicto que se resuelve explícitamente.
- **Cerrar sesión borrando el dispositivo** avisa de las ideas sin enviar y de los conflictos pendientes (D27).

### 8.4 RLS y aislamiento
Como en M3:
- RLS en las cinco tablas; FK compuestas `(id, user_id)` en todas las referencias, incluidos los vínculos a hábitos u objetivos;
- triggers de propiedad en los enlaces genéricos;
- sin `delete` directo y `anon` sin permisos;
- funciones privadas no ejecutables por `anon`.

### 8.5 Enlaces y metadatos externos seguros
- Las URLs se muestran como texto plano; los enlaces con `target="_blank" rel="noopener noreferrer"`. Se rechazan `javascript:`, `data:` y credenciales en la URL.
- Los textos importados (descripciones) se guardan como texto plano: no se renderiza HTML externo; se quitan etiquetas y entidades en el servidor.
- El servidor **nunca** descarga una URL arbitraria del usuario: solo hosts de una lista cerrada (§9).

### 8.6 Volumen y rendimiento (riesgo R2 del cierre de M3)
- **Hoy**: la copia local es un único registro de IndexedDB que se reescribe en cada guardado, y cada arranque hace un pull completo.
- **Estimación**: con 500 contenidos y 5.000 notas de 300 caracteres, unos **2–3 MB**.
- **M4a mide** con datos sintéticos el tiempo de escritura en IndexedDB, el tamaño del pull completo y el tiempo del índice.
- **Umbrales de acción** (propuesta):
  - escritura > 50 ms o pull completo > 1,5 MB comprimido;
  - entonces, **dividir la copia en registros por dominio** (`v1:<usuario>` y `lib:<usuario>`, con la misma transacción y el mismo Web Lock);
  - y/o un pull completo por páginas.
  - Cualquiera de las dos se presentaría antes como cambio de alcance.
- No se toca la arquitectura del motor si la medición no lo justifica.

## 9. Metadatos y portadas externos
### 9.1 Qué entra en M4 (sin claves, sin coste y por el servidor)
| Uso | Fuente | Clave | Fiabilidad | Plan |
|---|---|---|---|---|
| Buscar libro por título, autor o ISBN | **Open Library** (`/search.json`, `/isbn/`) | No | Buena para ISBN; descripciones irregulares | M4g |
| Segunda fuente de libros | **Google Books** (`/books/v1/volumes`, sin clave y con cuota baja) | No | Buena en español; cuota sin clave limitada | M4g, como respaldo. Si responde 429, se usa solo Open Library |
| Portadas de libros | `covers.openlibrary.org` y miniaturas de Google Books | No | Buena | M4g, por proxy |
| Buscar programa o episodio | **iTunes Search / Lookup** (`itunes.apple.com/search`, `entity=podcast` / `podcastEpisode`) | No | Buena: imagen, programa, duración, fecha y enlace | M4g |
| Resolver un enlace pegado | **oEmbed** de Spotify (`open.spotify.com/oembed`) y YouTube (`youtube.com/oembed`); **iTunes Lookup** para Apple | No | Título, imagen y autor o canal. **Sin** duración en Spotify ni YouTube por oEmbed: se escribe a mano | M4g |

**Reglas**:
- **Rutas de Next.js en el servidor** (`/api/metadata/books`, `/api/metadata/podcasts`, `/api/metadata/resolve`):
  - solo con sesión iniciada;
  - lista cerrada de hosts, sin seguir redirecciones fuera de ella;
  - tiempo máximo de 4 s y respuesta ≤ 1 MB;
  - validación con Zod;
  - texto plano;
  - caché corta en memoria y `Cache-Control` privado;
  - límite por usuario (30 consultas por minuto, con contador en la propia instancia; suficiente con el registro cerrado).
- **CSP**: `connect-src` sigue en `'self'`, porque el navegador solo habla con la app.
- **Atribución**: «Datos: Open Library», «Google Books» o «Apple Podcasts» en la revisión previa y en la ficha (`metadata_attribution`).
- **Revisión previa obligatoria**: nada importado se guarda sin que lo veas y lo confirmes, y puedes editarlo todo.
- **Fallo o sin conexión**: el formulario manual queda abierto con lo que hayas escrito; nunca se bloquea el alta (A6).

### 9.2 Portadas (P11)
- **Externas**:
  - se guarda la URL original (host permitido) en `cover_ref`;
  - se sirven por un **proxy del mismo origen** (`/api/covers?src=…`) que solo acepta hosts permitidos, `image/jpeg|png|webp`, ≤ 2 MB, valida los bytes mágicos y responde con `Cache-Control: private, max-age=2592000`;
  - así la **CSP `img-src 'self'` no cambia** y terceros no ven tu IP ni qué lees;
  - el navegador cachea la imagen.
- **Respaldo**: siempre la portada tipográfica generada (ya existe), sin conexión o si la imagen falla. 2:3 para libros y 1:1 para programas y episodios; `object-cover`; sin deformar.
- **Subida desde el dispositivo**:
  - requiere activar Supabase Storage: bucket privado `covers/<user_id>/…`, RLS en `storage.objects` y servicio por el mismo proxy;
  - activa contenedores extra en el stack local (RAM);
  - **se propone aplazarla** a una subfase posterior, salvo que la quieras en M4g (P11).

### 9.3 Qué se aplaza
- **Podcast Index API**: clave gratuita, pero es una credencial nueva → con tu aprobación.
- **Spotify Web API** y **YouTube Data API**: requieren credenciales de app → aplazadas.
- **Duración automática** de Spotify y YouTube.
- **Importar desde Goodreads o Kindle** (CSV o «Mis notas»): útil; posible fase posterior, siempre con lo que tú aportes.
- **Lectura de feeds RSS** de programas: descargar URLs arbitrarias amplía la superficie SSRF → aplazado.

## 10. Experiencia y diseño Dark Performance
### 10.1 Principios
- **Portadas como protagonistas** sobre `surface`, con el texto en la jerarquía del sistema: títulos de 20–24 px y metadatos de 12–14 px en `text-secondary`.
- **El lima solo para la acción y el estado «en curso»**: progreso y botón de captura.
- **Ámbar** para «pendiente de decidir» (conflictos).
- **Capturar en un toque**; el resto de la ficha es lectura.
- **Navegación**:
  - **escritorio**: barra lateral → Conocimiento → Biblioteca, Cerebro (y Descubrir);
  - **móvil**: Más → Biblioteca o Cerebro;
  - **atajo**: la tarjeta de Resumen «Sigue leyendo o escuchando», con «Idea rápida».

### 10.2 Pantallas
**1. Portada de Biblioteca** (`/knowledge/library`)
```
┌ Biblioteca ───────────────── [+ Añadir] ┐
│ [ Libros 24 ]  [ Podcasts 31 ]   (Segmented)
│ EN CURSO ─────────────────────────────── │
│ ▣ Outlive        ▣ The Knowledge Project │  carrusel: portada, progreso, «Idea rápida»
│   p. 214/496       Ep. 187 · 38 min      │
│ IDEAS RECIENTES ──────────────── Ver todo│  3 notas con su origen
│ RESUMEN DEL AÑO: 9 libros · 22 episodios · 146 ideas · 12/19 aplicaciones hechas
└──────────────────────────────────────────┘
```
- **Estado vacío**: «Tu biblioteca empieza con un título», con [Añadir libro] y [Añadir episodio] y una frase sobre la captura rápida.

**2. Libros** (`/knowledge/library/books`): pestañas de estantería con recuento, buscador, orden, filtros (hoja en el móvil, barra en el escritorio) y cuadrícula de 3 columnas a 375 px y de 6–8 a 1440 px. Cada portada lleva insignias discretas: progreso, ⭐ y n.º de ideas.

**3. Podcasts** (`/knowledge/library/podcasts`): conmutador «Episodios | Programas».
- Los episodios, en lista con miniatura 1:1, programa, duración, estado y fecha.
- Los programas, en cuadrícula 1:1.
- Ficha del programa (`/knowledge/library/shows/[id]`): cabecera con la imagen, episodios por estado e «Ideas de este programa».

**4 y 5. Ficha de libro o de episodio** (`/knowledge/library/items/[id]`, una ruta para los dos tipos)
```
Móvil 375                                   Escritorio 1440
┌──────────────────────────┐               ┌───────────────┬──────────────────────────────┐
│ ▣ portada  Título        │               │ ▣ portada     │ Ideas principales (⭐ arriba) │
│            Autor · 2023  │               │ Título, autor │ Aprendizajes                  │
│ [Leyendo ▾] ★★★★☆  ♡    │               │ Estado ★ ♡    │ Citas · p. / mm:ss            │
│ ▓▓▓▓▓░░░ p.214/496       │               │ Progreso      │ Aplicaciones (estado)         │
│ [Ideas][Citas][Aprend.]  │  ← pestañas   │ Temas         │ Notas y preguntas             │
│ [Aplic.][Notas][Info]    │    de sección │ Relacionados  │                               │
│ …notas…                  │               │ Historia      │                               │
│ ┌ Añade una idea…  [➤] ┐ │  ← fija       │               │ ┌ Añade una idea… ────── [➤] ┐│
└──────────────────────────┘               └───────────────┴──────────────────────────────┘
```
- En el episodio, la cabecera muestra programa, invitados, plataforma y [Abrir en Spotify ↗], y la cita muestra `12:34` con un enlace al minuto.

**6. Editor de notas**:
- tocar una nota la edita en su sitio (autoguardado como D57);
- menú: tipo, ⭐, localizador, temas, enlazar, mover a otro contenido y borrar con «Deshacer»;
- conflicto: panel ámbar con las dos versiones.

**7. Vista global** (`/knowledge/brain`, P16): pestañas **Ideas** (y **Repaso** en M4i). Buscador arriba, chips de filtro y lista de `NoteCard` con su origen (miniatura y título). Agrupar por «Contenido» o por «Tema».

**8. Buscador y filtros**:
- un único campo con resultados por grupos («Contenidos», «Notas» y «Programas») y resaltado;
- filtros en una hoja (móvil) o una barra lateral (escritorio), todos en la URL (como Análisis), con «Quitar filtros».

**9. Historia y relaciones**:
- en la ficha, «Relacionados» (manuales y por temas, con el motivo);
- «Historia»: línea de tiempo vertical, compacta;
- en Cerebro, por tema: contenidos y notas de ese tema a lo largo del tiempo.

### 10.3 Estados, accesibilidad y rendimiento
- **Estados**:
  - carga con *skeletons* con la forma final;
  - vacío con un texto que propone el siguiente paso;
  - sin conexión: «Guardado en este dispositivo»;
  - error con reintento;
  - conflicto en ámbar.
  - Ninguno depende solo del color (DESIGN_SYSTEM).
- **Accesibilidad**:
  - zonas ≥ 44 px; foco visible; `radiogroup` en la valoración; pestañas con `role=tablist`;
  - imágenes con `alt` (título) o decorativas si el título ya está al lado;
  - axe sin violaciones graves en cada pantalla nueva (puerta de E2E);
  - `prefers-reduced-motion` respetado.
- **Rendimiento**:
  - imágenes con `loading="lazy"`, `decoding="async"` y tamaño fijo, sin saltos de diseño;
  - listas largas (> 300 notas) virtualizadas o paginadas por bloques de 50;
  - índice de búsqueda memoizado o en un Worker;
  - objetivo: abrir una ficha en < 100 ms desde la copia local y una captura con respuesta < 100 ms.

## 11. Integración con el resto de THE ONE PERCENT
| Integración | Valor | Propuesta |
|---|---|---|
| Hábito alimentado por sesiones de lectura o escucha (D33) | Requisito aprobado A5 | **M4h** |
| Tarjeta en Resumen: «Sigue leyendo o escuchando» con «Idea rápida» | Captura sin fricción | **M4d**, una tarjeta sencilla |
| Sección «Aprendizaje» en Análisis: minutos y páginas, terminados e ideas por mes | Métricas transparentes | **M4h** |
| Aplicación práctica vinculada a un hábito u objetivo | Cierra el ciclo del conocimiento a la acción | **M4e**: solo el vínculo y su visualización; no crea hábitos sola |
| Life Review con cifras de aprendizaje (`SNAPSHOT_VERSION` 2) | Revisiones más completas | **Aplazado** (P15): cambia la snapshot congelada; mejor en una fase propia |
| Objetivo «Leer 24 libros» con progreso derivado de terminados | Útil | **Aplazado** (P15): amplía el modelo de Objetivos |
| Exportación JSON y CSV de la Biblioteca | PRD §7 | M6 (exportación general), aunque los datos ya están en las copias cifradas |

## 12. M4 frente a la IA futura
**En M4, sin IA**:
- entrada manual y metadatos de fuentes bibliográficas públicas;
- notas;
- búsqueda por palabras;
- filtros;
- enlaces manuales;
- relacionados por temas compartidos (explicado);
- repaso con tarjetas escritas por ti.

**Fuera de M4, para M6 o posterior y con tu aprobación** (presupuesto, límites y proveedor, decisión abierta 5):
- resúmenes automáticos;
- transcripciones;
- extracción de ideas de audio o vídeo;
- recomendaciones por historial;
- chat con la biblioteca;
- búsqueda semántica con embeddings;
- conexiones automáticas;
- tarjetas de repaso sugeridas por IA;
- Descubrir con IA.

**Preparación sin coste**:
- el modelo ya separa contenido, notas y enlaces con `kind`, `note_type` y temas;
- los enlaces admiten un origen (`manual` hoy y `suggested` mañana, con aprobación);
- las notas privadas **nunca** se enviarán a un modelo por defecto (PRD §4.2).
- No se instala ninguna dependencia de IA.

## 13. Plan por subfases
Esfuerzo en **días de trabajo**: una sesión larga de desarrollo con pruebas, como las de M3.4a–e. Cada subfase termina con `npm run check`, las E2E dirigidas (1 worker por la RAM del PC), un commit local y un informe, y se detiene para tu autorización.

### M4a · Dominio y demo (sin base de datos)
1. **Objetivo**: el modelo y la lógica pura de Biblioteca y conocimiento, probados; la demo nueva; medir el rendimiento.
2. **Incluye**:
   - tipos y validación (Zod) de contenidos, programas, notas, enlaces y estados;
   - etiquetas por tipo;
   - reductores de operaciones (`library.*`) para la demo y el rebase;
   - índice de búsqueda y filtros;
   - estadísticas;
   - agrupación de la ficha;
   - fixtures demo etiquetados (libros y podcasts reales, notas ficticias);
   - **banco de medida** con 5.000 notas (IndexedDB, índice y tamaño serializado).
3. **Archivos**: `src/features/knowledge/domain/*` (nuevo), `src/features/library/domain/*` (ampliado), `src/features/library/fixtures.ts`, `src/features/habits/store/demo-*` y `src/features/sync/domain/types.ts` (tipos de operación).
4. **Dependencias**: aprobación de P3–P8, P12, P13, P19 y P20.
5. **Riesgos**: el modelo de estados y tipos debe quedar cerrado aquí, porque cambiarlo después obliga a migrar datos.
6. **Pruebas**: Vitest de validación, reductores, búsqueda (acentos, prefijos, varias palabras), estadísticas (N/D y muestras pequeñas) y medición.
7. **Aceptación**: `npm run check` limpio; demo con datos etiquetados; informe de la medición con la decisión sobre §8.6.
8. **Esfuerzo**: 1–1,5 días.

### M4b · Base de datos (solo stack local)
1. **Objetivo**: persistencia segura.
2. **Incluye**:
   - migración `20261101090000_library.sql`: `podcast_shows`, `library_items`, `knowledge_notes` y `knowledge_links`, con `CHECK`, FK compuestas, triggers (`field_seqs`, marca de transacción, propiedad de enlaces) y RLS;
   - `private.apply_library_op`;
   - ampliación aditiva de `apply_ops` y `pull_changes`;
   - realtime y auditoría.
3. **Archivos**: `supabase/migrations/…_library.sql` y `tests/integration/library.int.test.ts`.
4. **Dependencias**: M4a.
5. **Riesgos**: ampliar `apply_ops` y `pull_changes` debe ser estrictamente aditivo; se comprobará igual que en M3.4.
6. **Pruebas** de integración: idempotencia; conflictos por campo y por texto; borrado con base vieja; aislamiento entre usuarios (leer, enlazar y vincular hábitos u objetivos ajenos); límites y `CHECK`; lápidas en pulls incrementales y completos; la puerta 6/6 → 7/7 ficheros.
7. **Aceptación**: integración completa en verde; migración aditiva demostrada; ninguna función `security definer`.
8. **Esfuerzo**: 1,5–2 días.

### M4c · Sincronización en el cliente
1. **Objetivo**: guardar sin conexión y sincronizar entre dispositivos sin perder texto.
2. **Incluye**:
   - transporte y conversión (`library-wire.ts`);
   - rebase y fusión;
   - compactación por fila y campo;
   - `pendingNotes` generalizado a notas y descripciones;
   - `upgradePersisted` con la forma M3.4;
   - `libraryEnabled()`;
   - aviso al cerrar sesión;
   - dos pestañas;
   - fachada `useLibrary()`.
3. **Archivos**: `src/features/sync/*` (engine, domain, account-backend y tests), `src/features/habits/store/habit-store.ts`, `e2e/upgrade.spec.ts` y `src/features/library/use-library.ts`.
4. **Dependencias**: M4b.
5. **Riesgos**:
   - la compatibilidad con copias antiguas (incidente del 27/10);
   - el volumen de la copia (§8.6).
6. **Pruebas**:
   - unitarias de sync (crear, editar y borrar sin conexión; conflictos; nota en un contenido borrado; varias pestañas);
   - `upgrade.spec.ts`;
   - E2E de cuenta con dos navegadores contra PostgreSQL local.
7. **Aceptación**:
   - una idea escrita sin conexión llega una sola vez;
   - dos ediciones de la misma nota conservan las dos versiones;
   - ninguna copia antigua falla al abrirse.
8. **Esfuerzo**: 1,5–2 días.

### M4d · Interfaz de Biblioteca y captura rápida
1. **Objetivo**: Libros y Podcasts usables y premium, con alta manual.
2. **Incluye**:
   - portada de Biblioteca;
   - Libros (estanterías, cuadrícula o lista, filtros y orden);
   - Podcasts (episodios y programas);
   - ficha común;
   - formularios de alta y edición manual (libro, episodio y programa);
   - `CoverArt` tipográfico;
   - `QuickCapture`;
   - editor de notas con autoguardado;
   - estados vacíos;
   - tarjeta en Resumen.
3. **Archivos**: `src/app/(app)/knowledge/library/**`, `src/features/library/components/*`, `src/features/knowledge/components/*`, `src/features/overview/*` y `nav-config.ts`.
4. **Dependencias**: M4c (la demo permite trabajar en paralelo con M4a).
5. **Riesgos**:
   - densidad de la ficha en 375 px;
   - captura accesible sin toasts.
6. **Pruebas**: E2E de demo y de cuenta (alta manual, captura en 1 toque más el texto, edición, borrado con «Deshacer», sin conexión); axe; `screen-error.spec.ts` con Biblioteca; capturas a 375 y 1440 px.
7. **Aceptación**: alta de libro y de episodio solo con el título; idea guardada en ≤ 2 interacciones más el texto; sin violaciones graves de axe.
8. **Esfuerzo**: 2,5–3 días.

### M4e · Conocimiento: vista global, búsqueda, relaciones y aplicaciones
1. **Objetivo**: recuperar lo aprendido.
2. **Incluye**:
   - Cerebro → Ideas;
   - búsqueda global;
   - filtros en la URL;
   - agrupación por contenido o tema;
   - enlaces manuales y relacionados por temas;
   - vista de aplicaciones con estado y vínculo a un hábito u objetivo;
   - historia en la ficha.
3. **Archivos**: `src/app/(app)/knowledge/brain/**`, `src/features/brain/*` (sustituye la demo antigua), `src/features/knowledge/*`.
4. **Dependencias**: M4d.
5. **Riesgos**: rendimiento con miles de notas (Worker si hace falta).
6. **Pruebas**: unitarias del índice; E2E de búsqueda (acentos, sin conexión), filtros que sobreviven a recargar, enlazar y desenlazar en dos dispositivos.
7. **Aceptación**: encontrar una idea por palabra en < 100 ms con 5.000 notas (medido); filtros reproducibles por URL.
8. **Esfuerzo**: 1,5–2 días.

### M4f · Despliegue 1 (Release 1: Biblioteca manual y conocimiento)
1. **Objetivo**: usar M4 en producción cuanto antes.
2. **Incluye**: validación `ci/m4` (2 pasadas), copia cifrada, simulacro, `push-dry`, migración, comprobaciones en solo lectura, push, smoke (+2 pruebas: Biblioteca y Cerebro en demo), CI de `main` y tu prueba manual.
3. **Archivos**: `e2e/smoke.spec.ts` y documentación.
4. **Dependencias**: M4a–e y tu autorización paso a paso.
5. **Riesgos**: los de siempre, cubiertos por D48 y las reglas de parada.
6. **Pruebas**: CI completa, smoke 24/24 y prueba manual en móvil y ordenador.
7. **Aceptación**: como en M3.4e.
8. **Esfuerzo**: 0,5–1 día, más unos 25 min de CI.

### M4g · Metadatos externos y portadas
1. **Objetivo**: alta asistida y portadas reales, sin bloquear nunca la entrada manual.
2. **Incluye**: rutas `/api/metadata/*` (Open Library, Google Books, iTunes y oEmbed), proxy `/api/covers`, revisión previa con atribución, aviso de duplicados por ISBN o id externo y, si se aprueba (P11), subida con Storage.
3. **Archivos**: `src/app/api/metadata/**`, `src/app/api/covers/**`, `src/features/library/metadata/*` (adaptadores puros con fixtures grabados) y `next.config.ts` (sin cambiar la CSP).
4. **Dependencias**: M4d. Antes de escribir rutas, leer la guía de route handlers de Next 16 (`node_modules/next/dist/docs/`, AGENTS.md).
5. **Riesgos**:
   - SSRF (mitigado con la lista cerrada);
   - cambios en APIs públicas (adaptadores con tests de contrato sobre respuestas grabadas);
   - cuotas.
6. **Pruebas**:
   - unitarias de los adaptadores con respuestas grabadas: ningún test llama a Internet;
   - E2E con el servidor de metadatos simulado **solo en el test**, nunca en la app;
   - fallo de la API → formulario manual intacto.
7. **Aceptación**: alta por ISBN y por enlace de Spotify o YouTube con revisión; con la API caída el alta manual funciona; CSP sin orígenes nuevos.
8. **Esfuerzo**: 1,5–2 días (+0,5 con subida a Storage).

### M4h · Sesiones, hábito derivado y estadísticas
1. **Objetivo**: cumplir A5 y A9 y medir el aprendizaje.
2. **Incluye**:
   - migración `…_library_sessions.sql`;
   - `library.session.*`;
   - hábito con `activity_source = 'library'` (derivado y sin doble conteo);
   - registrar una sesión desde la ficha (minutos, páginas y progreso);
   - estadísticas de Biblioteca;
   - sección «Aprendizaje» en Análisis.
3. **Archivos**: migración, `apply_library_op`, `src/features/library/*`, `src/features/analytics/*` y `src/features/habits/*` (fuente `library`).
4. **Dependencias**: M4f. Recomendado: tu confirmación de la prueba manual de Deep Work (D33).
5. **Riesgos**: el día local (D34) y el cambio de hora; editar o borrar sesiones recalcula el día.
6. **Pruebas**: integración (20 min de lectura → 1 registro de hábito, una sola vez; criterio §9.3 del PRD), DST de Europe/Madrid, E2E.
7. **Aceptación**: criterio §9.3 del PRD demostrado; cifras reproducibles con N/D correcto.
8. **Esfuerzo**: 1,5–2 días.

### M4i · Repaso espaciado básico (Cerebro → Repaso), si se aprueba P2
1. **Objetivo**: salida de M4 aprobada («basic spaced recall»), sin IA.
2. **Incluye**:
   - `recall_cards` y `recall_attempts` (spec), creadas a mano desde una nota (pregunta y respuesta, o cita para completar);
   - Again/Hard/Good/Easy;
   - algoritmo SM-2 simplificado y versionado (`algorithm_version`);
   - cola de pendientes y contador;
   - suspender una tarjeta.
3. **Archivos**: migración `…_recall.sql`, `src/features/brain/*` y operaciones `recall.*`.
4. **Dependencias**: M4e.
5. **Riesgos**: una cola alimentada sin control → límite diario configurable.
6. **Pruebas**: unitarias del algoritmo (intervalos deterministas), integración e E2E.
7. **Aceptación**: una tarjeta vuelve en la fecha prevista y el historial se conserva.
8. **Esfuerzo**: 1,5 días.

### M4j · Despliegue 2 (Release 2)
Como M4f: migraciones de sesiones y repaso, smoke ampliado y prueba manual. **0,5–1 día.**

### Resumen y orden recomendado
| Subfase | Días | Acumulado |
|---|---|---|
| M4a Dominio y demo | 1–1,5 | 1–1,5 |
| M4b Base de datos | 1,5–2 | 2,5–3,5 |
| M4c Sync cliente | 1,5–2 | 4–5,5 |
| M4d Interfaz y captura | 2,5–3 | 6,5–8,5 |
| M4e Conocimiento y búsqueda | 1,5–2 | 8–10,5 |
| **M4f Despliegue 1** | 0,5–1 | 8,5–11,5 |
| M4g Metadatos y portadas | 1,5–2,5 | 10–14 |
| M4h Sesiones y estadísticas | 1,5–2 | 11,5–16 |
| M4i Repaso (opcional) | 1,5 | 13–17,5 |
| **M4j Despliegue 2** | 0,5–1 | **13,5–18,5** |

**Por qué este orden**:
1. Primero lo compartido (dominio, base de datos y sync), para que Libros y Podcasts nazcan sobre la misma arquitectura.
2. Después la interfaz de los dos formatos a la vez (una ficha común).
3. Luego la recuperación.
4. Lo que depende de terceros (metadatos) va **después** del primer despliegue: el valor principal, capturar y recuperar, no depende de ninguna API externa.

## 14. Riesgos y mitigaciones
| # | Riesgo | Mitigación |
|---|---|---|
| K1 | Volumen de texto: copia local y pull completo (R2) | Medición en M4a con umbrales (§8.6); división por dominio o paginación solo si se supera |
| K2 | Pérdida de texto por conflictos, borrados o pestañas | Una nota por fila; D47/D55 con «Guardar las dos»; borrar algo editado en otro sitio da conflicto; D58; E2E de dos navegadores y dos pestañas |
| K3 | Copias antiguas de IndexedDB | `upgradePersisted` aditivo y la forma M3.4 en `upgrade.spec.ts` (D39) |
| K4 | SSRF o contenido malicioso en metadatos | Lista cerrada de hosts, sin redirecciones abiertas, límites de tamaño y tiempo, Zod, texto plano, validación de imágenes por bytes mágicos |
| K5 | Privacidad (IP o lecturas expuestas a terceros por las portadas) | Proxy del mismo origen y CSP sin cambios |
| K6 | APIs públicas que cambian, limitan o caen | Adaptadores con tests de contrato; respaldo en Open Library; la entrada manual siempre funciona |
| K7 | Derechos de autor (citas o portadas) | Fragmentos breves escritos por ti (límite de 2.000); portadas de proveedores que lo permiten, con atribución; sin importación masiva |
| K8 | Alcance excesivo en la primera versión | Dos despliegues; IA, Storage, Goodreads y RSS fuera; estadísticas sencillas |
| K9 | RAM del PC con Storage y E2E | E2E dirigidas con 1 worker; validación completa en CI (D48); Storage solo si se aprueba |
| K10 | Arranque sin conexión imposible sin service worker (R1) | P17: service worker del shell, propuesto como subfase pequeña y opcional |
| K11 | Migraciones en producción | El mismo procedimiento de M3.4e: copia, simulacro, `push-dry`, comprobaciones y reglas de parada |
| K12 | Minutos de CI | Dos validaciones previstas (unos 50 min) más los pushes a `main`; muy por debajo de los 2.000 |

## 15. Decisiones que necesitan tu aprobación antes de M4a
Las recomendaciones están en negrita. Ninguna se considera aprobada.

1. **P1 · Alcance de M4**: **Biblioteca (libros y podcasts), capa de conocimiento, búsqueda, sesiones con hábito y repaso básico. Descubrir (curado y con IA) pasa a M6** con la IA. Alternativa: mantener en M4 un Descubrir solo curado.
2. **P2 · Repaso espaciado**: **en M4 como subfase opcional M4i, solo con tarjetas manuales**, o aplazado a M6.
3. **P3 · Modelo de datos**: **tabla única `library_items` con `CHECK` por tipo, `podcast_shows` aparte y capa común `knowledge_notes` y `knowledge_links`**, frente a tablas separadas por formato (spec) o herencia por tablas.
4. **P4 · Estados**: **5 estados comunes (pendiente, en curso, en pausa, terminado, abandonado) con etiquetas por tipo** («Leyendo» o «Escuchando»…) y favorito independiente.
5. **P5 · Tipos de nota**: **idea, aprendizaje, cita, aplicación, nota y pregunta; «curiosidad» se fusiona con idea; se permiten notas sueltas sin contenido**.
6. **P6 · Valoración**: propuesto 1–5; **aprobado 1–10, opcional** (D61).
7. **P7 · Temas**: **lista libre `topics` normalizada (sin tabla de etiquetas)**, que sirve también como «categoría». Renombrar un tema en bloque llegaría después.
8. **P8 · Formato de texto**: **texto plano con saltos de línea** en M4 (sin Markdown ni editor enriquecido).
9. **P9 · Episodios sin programa**: **permitidos**, para charlas o vídeos sueltos.
10. **P10 · Metadatos**: **Open Library y Google Books sin clave; iTunes Search y oEmbed de Spotify y YouTube**, solo por el servidor y con revisión previa. Sin Podcast Index, Spotify API ni YouTube Data API (credenciales nuevas).
11. **P11 · Portadas**: **proxy del mismo origen para portadas externas, con la portada tipográfica de respaldo; subida desde el dispositivo (Supabase Storage) aplazada**. Alternativa: incluir la subida en M4g (+0,5 días y más RAM local).
12. **P12 · Búsqueda**: **en el cliente sobre la copia local, sin servidor ni embeddings**.
13. **P13 · Conflictos**: **una nota por fila; textos con las dos versiones (D47) y la opción «Guardar las dos»; campos simples por sello; un borrado sobre algo editado en otro sitio genera conflicto**.
14. **P14 · Borrado**: **lápida con «Deshacer»; borrar un contenido con notas pide confirmación y borra sus notas (restaurables con Deshacer); sin papelera en M4**.
15. **P15 · Integraciones en M4**: **tarjeta en Resumen, sección Aprendizaje en Análisis, hábito alimentado por sesiones y vínculo de aplicaciones a hábitos u objetivos. Aplazados: cifras de aprendizaje en Life Review (snapshot v2) y objetivos con progreso derivado de la Biblioteca**.
16. **P16 · Vista global**: **«Cerebro» pasa a ser el centro de conocimiento (pestañas Ideas y Repaso)**, manteniendo la navegación actual. Alternativa: una entrada nueva, «Conocimiento».
17. **P17 · Service worker** para arrancar sin conexión (shell y recursos estáticos, sin push): **subfase pequeña tras M4f (unos 0,5 días)**, o aplazado a M5, donde el push lo exige.
18. **P18 · Despliegues**: **dos, tras M4e y tras M4i**, cada uno con validación `ci/m4` y el procedimiento completo.
19. **P19 · Límites de contenido**: **título 300, nota 10.000, cita 2.000, temas ≤ 10 × 40; sin importar texto completo**.
20. **P20 · Sesiones**: **una tabla `library_sessions` para lectura y escucha** (generaliza `reading_sessions` de la spec), en M4h.

**Recomendación del primer paso**: aprobar P1–P8, P12, P13, P19 y P20, que son las que fijan el modelo, y empezar **M4a**. Es solo código local y pruebas, incluye la medición de volumen y no toca la nube. El resto puede aprobarse antes de la subfase que lo necesita (P10 y P11 antes de M4g; P15 antes de M4h; P2 antes de M4i; P17 y P18 antes de M4f).

---

## 16. M4a · Fundamentos del dominio (30/10/2026, hecho en local)
### 16.1 Decisiones aprobadas
| Tu aprobación | Registro |
|---|---|
| 1–3. Biblioteca con Libros y Podcasts; modelo de contenido común y capa de conocimiento común; programas con entidad propia y episodios sin programa | **D59** |
| 4. Estados: pendiente, en curso, en pausa, terminado y abandonado | **D60** |
| 6. Valoración de 1 a 10, opcional (**cambia P6**, que proponía 1–5) | **D61** |
| 5. Notas, ideas, citas y aplicaciones en un modelo compartido, con ideas independientes | **D62** |
| 8. Texto plano preparado para evolucionar a contenido enriquecido | **D63** |
| 12. Modelo compartido para las sesiones de lectura y escucha | **D64** |
| 11. Límites de 10.000 caracteres por nota y 2.000 por cita, revisables con datos | **D65** |
| 7. Temas libres | **D66** |
| 9. Búsqueda local y sin conexión | **D67** |
| 10. Conflictos con las dos versiones: «Aplicar la mía», «Mantener la otra» o «Guardar las dos» | **D68** |
| 13–18. Repaso opcional con tarjetas propias; IA y Descubrir con IA en M6; integraciones externas y portadas subidas en sus subfases; prioridad a la captura y al uso sin conexión; arquitectura de sincronización actual; dos despliegues | **D69** |

**Siguen abiertas, como P**:
- antes de M4g: **P10** (proveedores concretos) y **P11** (proxy de portadas);
- antes de M4d: **P14** (borrado con «Deshacer» y sin papelera) y **P16** (Cerebro como vista global);
- antes de M4h: **P15** (integraciones);
- antes de M4f: **P17** (service worker);
- antes de M4b y M4c: las nuevas **N1–N2** de §16.10.

### 16.2 Conflictos con requisitos anteriores y su resolución
- **Valoración 1–10 frente a la propuesta P6 (1–5)**: se aplica tu decisión. Es coherente con la escala 1–10 que ya tenía Descubrir (D10), así que la app usa una sola escala.
- **Estados del PRD** (Quiero leer, Leyendo, Terminado, En pausa): se cubren todos y se añade **Abandonado**. «Quiero leer» es «Pendiente».
- **Tipos de nota del PRD**: se conservan idea, cita, reflexión (como «nota personal»), pregunta y aplicación, y se añade «aprendizaje». «Curiosidad» pasa a ser una idea; si algún día se necesita, es un tipo nuevo sin migrar datos.
- **`books`, `book_notes` y `reading_sessions` de la spec**: generalizados como D59, D62 y D64, con las mismas garantías (RLS, propietario, deduplicación por id externo, notas conservadas al editar metadatos, páginas desconocidas admitidas).
- **Relecturas** (detectado en las pruebas): al reabrir algo terminado, la app ya no rellena la fecha de inicio con hoy, porque contradiría la fecha de fin registrada. Conserva las fechas y no borra nada; se cambian a mano. Registrar varias lecturas de un mismo libro queda **pendiente** (§16.10).

### 16.3 Arquitectura de M4a
```
src/features/knowledge/
  domain/                      ← lógica pura, sin React ni E/S, común a todos los formatos
    types.ts                   tipos, estados, etiquetas por formato, límites (D59–D66)
    text.ts                    normalización, tokens, texto limpio, temas, URLs seguras, ISBN, marcas de tiempo, resaltado
    validation.ts              esquemas Zod de las entidades (los mismos invariantes que los CHECK de M4b)
    ops.ts                     reductores: crear, editar por campo, borrar con «Deshacer», mover notas, enlaces
    relations.ts               enlaces canónicos, episodios de un programa, secciones de la ficha, relacionados por temas
    library.ts                 estanterías, filtros, orden, progreso y «En curso»
    search.ts                  índice invertido local, incremental (D67)
    stats.ts                   cifras sencillas con N/D
    synthetic.ts               biblioteca SINTÉTICA para tests y medición (nunca en la app)
  demo.ts                      biblioteca DEMO para las pantallas de M4d
scripts/bench-knowledge.mjs    medición de volumen en Chromium (npm run bench:knowledge)
scripts/bench/knowledge-volume.entry.ts
```
- **Funciones puras**: los reductores no leen el reloj (`now` y `today` llegan del llamador) y devuelven el mismo estado si nada cambia. Son las que la demo usará en M4d y el motor repetirá en M4c.
- **Validación en un solo sitio**: cada reductor construye la entidad limpia y la comprueba con su esquema. Los errores son tipados (`invalid`, `not_found`, `kind_mismatch`, `duplicate`).
- **Sin dependencias externas nuevas**: solo Zod, que ya estaba. `rolldown` (ya instalado con Vite) solo se usa en la medición.

### 16.4 Libros y Podcasts
- **`ContentItem = Book | Episode`**: campos comunes más un bloque propio (`book` o `episode`).
  - **Comunes**: título, subtítulo, creadores (autores o invitados), descripción, temas, idioma, estado, favorito, valoración, fechas, portada, enlace y referencia externa.
  - **`book`**: ISBN-13 y ISBN-10 con dígito de control (el 13 se deriva del 10), páginas, página actual, % manual, editorial y año.
  - **`episode`**: programa (opcional), plataforma, duración, fecha de publicación, número y minuto en que te quedaste.
- **`PodcastShow`**: datos del programa guardados una vez; sus episodios apuntan a él. Borrar un programa **no borra conocimiento**: los episodios quedan sin programa, y «Deshacer» los vuelve a asociar.
- **Comportamiento común** en un solo código: estanterías, orden, filtros, progreso y sugerencia de «terminado» al llegar al final (nunca automática). Solo cambian las palabras («Leyendo» / «En curso», «Cita» / «Momento destacado»).

### 16.5 Modelo compartido de conocimiento
- **`KnowledgeNote`**: una fila por nota.
  - Tipo (idea, aprendizaje, cita, aplicación, nota o pregunta).
  - Texto con `format: "plain"`. Un formato enriquecido futuro añadirá su documento junto a `body`, y `body` seguirá siendo la proyección en texto plano para búsqueda, exportación y clientes antiguos (D63).
  - Localizador: página **solo** en libros y minuto **solo** en episodios, dentro de su longitud, con una etiqueta libre en ambos.
  - Destacada y temas propios.
  - En las aplicaciones: estado (pendiente, en marcha, hecha o descartada) y vínculo opcional a un hábito u objetivo.
  - `itemId` nulo para una idea suelta.
- **Mover una nota** a otro formato descarta solo el localizador que no encaja; conserva la etiqueta y siempre el texto.
- **`KnowledgeLink`**: enlace no dirigido con clave canónica (sin duplicados A–B y B–A), en estado deseado. Se borra con su extremo y se restaura con «Deshacer».
- **Relaciones derivadas, sin copiar datos**:
  - las secciones de la ficha;
  - las notas de un programa, sacadas de sus episodios;
  - los temas de un programa;
  - los relacionados por temas compartidos, con el motivo explicado y sin IA.

### 16.6 Búsqueda local (D67)
- **Índice invertido** de palabras normalizadas (sin acentos ni mayúsculas) con peso por campo: título e ISBN 8, temas y autores 5, subtítulo y editorial 4, programa 3, etiqueta 2, texto 1.
- **Consultas**:
  - todas las palabras deben coincidir, enteras o como prefijo, y nunca en mitad de una palabra;
  - las letras sueltas se ignoran;
  - las destacadas suben;
  - resaltado sobre el texto original con acentos.
- **Filtros**: tipo de nota, formato (libro, episodio o suelta), contenido, programa, valoración mínima, destacadas, estado de aplicación, temas (los de la nota, su contenido y su programa) y periodo. Orden por relevancia, recientes o antiguas.
- **Actualización incremental** tras cada edición, comprobada por tests contra un índice nuevo.
- **No sale nada del dispositivo**: ni consultas ni texto.

### 16.7 Preparado para formatos futuros, IA y búsqueda semántica (sin implementarlos)
- **Un formato nuevo** (artículo, vídeo, curso) es un `kind` más con su bloque. Notas, enlaces, búsqueda, estadísticas y sincronización no cambian.
- **Contenido enriquecido**: `format` y `body` como proyección plana (D63).
- **IA**:
  - los enlaces llevan `origin` (`manual` hoy; `suggested` reservado para propuestas que tú aprobarías);
  - la referencia externa lleva atribución;
  - las notas privadas no salen del dispositivo salvo hacia tu propia cuenta.
- **Búsqueda semántica**: el índice es una pieza separada (`search.ts`). Podría añadirse un segundo índice vectorial detrás de la misma interfaz `search()` sin tocar el modelo.

### 16.8 Prototipo de M1 y componentes
- **`normalize` del prototipo** ahora viene del dominio nuevo (una sola implementación). La pantalla de Biblioteca de M1 sigue igual hasta M4d.
- **Se reutilizarán en M4d**:
  - `BookCover`: portada tipográfica 2:3 sin deformación, que pasará a ser `CoverArt` con 1:1 para podcasts;
  - el patrón de estanterías, búsqueda, orden y cuadrícula o lista de `library-view.tsx`;
  - `PageHeader`, `EmptyState`, `Segmented`, `ChoiceGroup`, `SaveIndicator`, `useAutosave` y `ConflictPanel` (Life Review).
- **Se sustituye** la hoja de detalle por fichas con ruta propia.
- **La demo nueva** (`demo.ts`, «Demo»):
  - **libros reales** con estados, fechas, valoraciones y notas **ficticios**, en palabras del usuario de la demo y sin citas atribuidas a autores;
  - **programas y episodios inventados** que lo dicen en su nombre;
  - sin ISBN, portadas ni enlaces. Un test lo comprueba.

### 16.9 Pruebas y medición
- **Unitarias**: **90 pruebas nuevas en 6 ficheros** (suite completa: 449/449 en 39 ficheros).
  - Modelos, validación y límites (incluidos 10.000 y 2.000).
  - Valoración de 1 a 10.
  - Los 5 estados en los dos formatos y las fechas automáticas, incluida la relectura.
  - Localizadores por formato.
  - Aplicaciones.
  - Mover notas.
  - Borrado con «Deshacer» exacto.
  - Programas y episodios.
  - Enlaces canónicos.
  - Relacionados.
  - Estanterías, orden y progreso.
  - Búsqueda: acentos, prefijos, varias palabras, pesos, todos los filtros, límite y total.
  - Índice incremental igual a uno nuevo.
  - Estadísticas con N/D.
  - Demo sin datos «verificables» inventados.
  - Generador sintético válido y determinista.
  - Normalización rápida idéntica a la de referencia.
- **Cobertura del dominio**: ~99 % de líneas.
- **Volumen**: `docs/reports/m4a-volume.md`, con medidas reales en Chromium con 5.000 y 10.000 notas.

### 16.10 Problemas detectados, riesgos y decisiones nuevas
1. **N1 · Guardado local** (medido): el motor reescribe el registro entero en cada guardado. Con 5.000 notas dentro, son **122 ms (p95 149) con la CPU ×4**, y lo pagaría también cada toque en un hábito.
   - **Propuesta**: almacén propio de IndexedDB para el conocimiento, por entidad, escribiendo solo lo que cambió.
   - La cola, `pendingNotes` y D58 no cambian.
   - Hay que decidirlo **antes de M4c**.
2. **N2 · Pull completo** al arrancar: 1,10 MB comprimidos con 5.000 notas y 2,07 MB con 10.000.
   - **Propuesta**: pull incremental del conocimiento desde el cursor guardado. El servidor se prepara en M4b.
   - Hay que decidirlo **antes de M4b**: afecta a `pull_changes`.
3. **Índice en frío**: 932 ms (×4).
   - Se construirá de forma perezosa (al abrir la búsqueda o Cerebro), por partes o en un Worker (M4e). Después, incremental: 27 ms (×4).
4. **Reductor**: 21,9 ms (×4) por operación con 5.000 notas.
   - Optimización interna en M4c: aplicar la cola en bloque.
5. **Relecturas**: un contenido guarda una sola pareja de fechas. Registrar varias lecturas pide sesiones (M4h) o un historial de lecturas. Pendiente de decidir, sin urgencia.
6. **Medición en móvil real pendiente**: la CPU ×4 es una aproximación. Se propone una página de diagnóstico sintético en M4d.
7. **Copias antiguas de IndexedDB**: M4a no toca el estado persistido. `upgradePersisted` y `upgrade.spec.ts` se amplían en M4c (D38/D39).

### 16.11 Plan concreto de M4b (base de datos, solo en el stack local; requiere tu autorización)
**Objetivo**: persistencia segura de la Biblioteca, con las mismas garantías que M3.

1. **Migración `supabase/migrations/20261101090000_library.sql`** (aditiva, solo local):
   - **Tablas** `podcast_shows`, `library_items`, `knowledge_notes` y `knowledge_links`:
     - columnas planas para los bloques `book` y `episode`;
     - `CHECK` iguales a `validation.ts`: longitudes, valoración 1–10, 5 estados, nulos por tipo, fechas ordenadas, página o minuto dentro de la longitud, citas ≤ 2.000 y estado solo en aplicaciones;
     - ISBN con dígito de control en una función SQL inmutable;
     - URLs solo `http(s)`.
   - **Claves e índices**:
     - FK compuestas `(id, user_id)`: episodio → programa, nota → contenido, y vínculo de una aplicación → hábito u objetivo;
     - únicos parciales por id externo;
     - índices `(user_id, server_seq)` y `(user_id, item_id)`, y GIN en `topics`.
   - **Triggers**:
     - marca local de transacción (D54): solo `apply_ops` escribe;
     - `field_seqs` por campo, `server_seq` y `updated_at`;
     - propiedad de los dos extremos de un enlace;
     - auditoría sin textos.
   - **RLS**: `select`, `insert` y `update` propios; sin `delete` ni `truncate`; `anon` sin permisos; las cuatro tablas en `supabase_realtime`.
2. **`private.apply_library_op`** (`security invoker`, `search_path` vacío) con las operaciones de §8.1:
   - `library.item.create|update|delete|restore`;
   - `library.show.create|update|delete`;
   - `library.note.create|update|move|delete`;
   - `library.link.set`.
   - **Semántica D68**:
     - campos simples por base y sello;
     - `body` y `description` en conflicto devuelven las dos versiones;
     - borrar algo cambiado después de la versión vista da conflicto;
     - borrar un contenido deja lápida a sus notas y enlaces en la misma transacción;
     - borrar un programa desasocia sus episodios.
3. **`apply_ops` y `pull_changes`**: ampliación estrictamente aditiva (rama `library.%` y bloques nuevos), comprobada contra la versión de la nube como en M3.4. Diseño del **pull incremental del conocimiento** si se aprueba N2.
4. **Formato de red** `src/features/sync/domain/library-wire.ts`: conversión pura entre camelCase y las columnas, con tests. Todavía no se conecta al motor (eso es M4c).
5. **Integración** (`tests/integration/library.int.test.ts`; la puerta pasa a 7/7 ficheros):
   - idempotencia;
   - cada `CHECK` frente a `validation.ts`, con las mismas entradas (paridad);
   - conflictos por campo y por texto;
   - borrar con una versión vieja;
   - cascadas y desasociación;
   - lápidas en pulls completos e incrementales;
   - **aislamiento entre usuarios**: leer, escribir, enlazar o vincular hábitos u objetivos ajenos;
   - realtime;
   - la biblioteca sintética de 5.000 notas cargada por `apply_ops` y leída por `pull_changes` (tiempo y tamaño reales en PostgreSQL local).
6. **Sin nube, sin UI y sin tocar el motor del cliente.**

**Aceptación**:
- integración completa en verde (los 6 ficheros actuales y el nuevo);
- migración aditiva demostrada;
- ninguna `security definer`;
- `npm run check` limpio.

**Esfuerzo**: 1,5–2 días.

**Riesgos**:
- la paridad entre `CHECK` y Zod (cubierta por tests);
- la ampliación de `apply_ops` y `pull_changes` (cubierta por la comparación con la versión de la nube).

**Necesita de ti**: autorización de M4b y decisión sobre N2. N1 puede esperar a M4c.
