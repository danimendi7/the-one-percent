# Plan M4 · Knowledge OS: Biblioteca (Libros y Podcasts) y conocimiento personal

**Estado (30/10/2026)**:
- **Arquitectura aprobada**, con 18 decisiones registradas como **D59–D69** en `docs/decisions.md`. La valoración pasa a ser **de 1 a 10**, no de 1 a 5 como se propuso.
- **M4a, M4b, M4c, M4d y M4e hechas en local** (§16–§20; decisiones D73–D85). P14 y P16 aprobadas (D77 y D78).
- N2 (D71) y N1 (D72) aprobadas.
- **M4f, etapa 1 (local) hecha** (§21; D86–D88): service worker, CI preparada y auditoría. **La validación remota (A) y el despliegue (B) necesitan tu autorización** (§21.8). Nada de M4 está en la nube ni en producción.
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

**4 y 5. Ficha de libro o de episodio** (`/knowledge/library/item?id=`, una ruta para los dos tipos; era `items/[id]` hasta D79)
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

---

## 17. M4b · Persistencia y descarga incremental (30/10/2026, hecho en local)
Autorizado por el propietario, que además aprobó **N1** (almacenamiento local por elemento, para M4c) y **N2** (descarga incremental con cursores, en M4b). Quedan registradas como **D70–D72**.

Migración `supabase/migrations/20261101090000_library.sql`:
- aplicada **solo al stack local** (`supabase migration up --local`);
- es aditiva: cuatro tablas, funciones `private.lib*`, una RPC nueva (`pull_library`) y ramas nuevas en `apply_ops` y `pull_changes`;
- sin `drop`, `delete` ni `truncate`; no toca datos existentes.

### 17.1 Tablas
| Tabla | Contenido | Claves e índices |
|---|---|---|
| `podcast_shows` | Programa: título, presentador, descripción, temas, portada, enlace, referencia externa | PK `id` (del cliente), `unique (id, user_id)`; `(user_id, server_seq)`; único parcial por id externo |
| `library_items` | Libro o episodio (`kind`): campos comunes y columnas de cada formato | PK `id`, `unique (id, user_id)`; FK `(show_id, user_id)` → programa; `(user_id, server_seq)`; `show_id`; único parcial `(user_id, kind, proveedor, id externo)` |
| `knowledge_notes` | Nota (6 tipos), `format = 'plain'`, localizador, destacada, aplicación con vínculo, temas, `captured_at` (momento real de la captura) | PK `id`, `unique (id, user_id)`; FK `(item_id, user_id)` → contenido; FK `(application_habit_id, user_id)` → hábito; FK `(application_goal_id, user_id)` → objetivo; `(user_id, server_seq)` y `(user_id, item_id)` |
| `knowledge_links` | Enlace no dirigido entre contenido, programa y nota | `unique (user_id, a_type, a_id, b_type, b_id)` en orden canónico (`CHECK`); `(user_id, server_seq)` |

Todas las tablas llevan `server_seq` (secuencia global `change_seq`), `version`, `created_at`, `updated_at` y `deleted_at` (lápida). Las tres editables llevan además `field_seqs` (versión de cada campo: la base de los conflictos) y `field_stamps` (sello del cliente por campo, que solo usa el servidor).

No se ha creado índice GIN de temas: la búsqueda es local (D67) y no habría consultas que lo usaran.

### 17.2 Reglas: las mismas que en TypeScript
- **`CHECK` y funciones `private.lib_*`**, que reproducen `text.ts` y `validation.ts`:
  - líneas limpias (sin espacios en los bordes, sin dobles espacios, sin saltos de línea, sin caracteres de control) y bloques recortados;
  - longitudes de D65: 300, 10.000, 2.000 en citas, 10 temas de 40, 20 creadores de 200, 2.048 en URL;
  - valoración 1–10 y los 5 estados;
  - ISBN-13 e ISBN-10 con dígito de control;
  - URLs solo `http(s)` y sin credenciales;
  - fechas ordenadas;
  - página y minuto dentro del contenido;
  - cada formato solo con sus columnas;
  - el estado de una aplicación solo (y siempre) en aplicaciones, con un vínculo como mucho;
  - una nota suelta, sin localizador;
  - temas y creadores sin duplicados por acentos y mayúsculas.
- **Reglas que necesitan otra fila** van en el trigger `private.guard_library`:
  - el programa de un episodio existe y está vivo;
  - una nota solo se escribe sobre un contenido vivo;
  - la página solo en libros y el minuto solo en episodios, dentro de su longitud;
  - los dos extremos de un enlace existen y son del mismo usuario.
- **Paridad comprobada**: los tests de integración pasan las mismas entidades por Zod y por PostgreSQL. Son 27 casos de contenido y 16 de notas (11 comparados con Zod y 5 de reglas entre filas), y en todos coinciden.
  - La demo completa entra y vuelve idéntica.
  - Para la paridad se añadió a Zod la regla de caracteres de control que aplica la base de datos (`cleanText` ya los quitaba).
- **Diferencia conocida, inocua**: para detectar duplicados, la base de datos quita los acentos del español y del Latin-1, mientras TypeScript los quita de todo Unicode. Lo que TypeScript acepta, la base de datos también. Al revés solo podría pasar con escrituras directas, que no existen (§17.3).

### 17.3 Seguridad
- **Una sola vía de escritura**:
  - las cuatro tablas solo se escriben con `apply_ops` → `private.apply_library_op`, que activa una marca local de la transacción;
  - el trigger rechaza cualquier `insert` o `update` sin ella (`library_via_ops_only`), también desde la API REST con la sesión del propio usuario;
  - no hay permiso `delete` ni `truncate`, y `anon` no tiene ningún permiso.
- **RLS**: `select`, `insert` y `update` solo de filas propias (`user_id = auth.uid()`), en las cuatro tablas.
- **Pertenencia**:
  - FK compuestas `(id, user_id)` para programa, contenido, hábito y objetivo;
  - los enlaces se comprueban en el trigger.
  - Un id de otro usuario responde `not_found`, **igual que uno inexistente**. Así no se puede comprobar si existe (encontrado y corregido en las pruebas: antes respondía «duplicate key»).
  - Una nota sobre contenido ajeno responde igual que sobre contenido borrado.
- **Funciones**:
  - todas `security invoker` (ninguna `security definer`) y con `search_path` vacío;
  - sin ejecución para `anon`;
  - `pull_library` solo para `authenticated`. Un test lo comprueba en el catálogo.
- **Lápidas sin texto personal**: al borrar se vacían título, descripción, cuerpo, temas, enlaces y metadatos.
- **Auditoría sin textos**: crear, cambiar de estado, borrar y restaurar, sin ningún contenido escrito.

### 17.4 Operaciones (`apply_ops`, idempotentes por `op_id`)
| Operación | Cuerpo | Respuesta |
|---|---|---|
| `library.{show\|item\|note}.create` | `id`, `fields` (nombres de columna), `at` (sello), `kind` (contenido), `captured_at` (nota) | `applied` + `seq`. Si el id ya está vivo: `superseded/exists`. Si es una lápida: `conflict/deleted` (**no resucita**). Nota sobre contenido borrado o inexistente: `conflict/item_deleted` |
| `library.{…}.update` | `id`, `fields`, `base_seqs` por campo, `at` | Por campo (D68): sin cambios desde la base, se aplica. Mismo valor, no hace nada. **Texto protegido** (`body`, `description`) cambiado a la vez: `conflict/field_conflict` con `fields` y `current`, y no se escribe nada. Otro campo: gana el sello más reciente; si el tuyo es anterior, `superseded/stale_fields`. Sobre una lápida: `conflict/deleted` |
| `library.{…}.delete` | `id`, `base_seq` (y `notes_seq` en un contenido) | Solo la versión vista: si no, `conflict/changed`. Un contenido con notas cambiadas o añadidas sin ver: `conflict/notes_changed`. En cascada, lápidas de sus notas y enlaces. Borrar un programa **desasocia** sus episodios, que conservan sus notas |
| `library.{…}.restore` | `id`, `fields` completos | La única forma de revivir una lápida («Deshacer»). Si está viva: `superseded/exists` |
| `library.link.set` | `a_*`, `b_*`, `linked` | Estado deseado, en orden canónico. Extremo inexistente o ajeno: `link_target_not_found` |

- **`apply_ops` devuelve ahora `seq`**, la versión de la fila tras escribir. Es aditivo: los clientes publicados lo ignoran. Sirve de base para la siguiente edición sin esperar al pull, y evita falsos conflictos al editar justo después de crear.

### 17.5 Descarga incremental (N2)
- **`pull_library(p_since, p_limit = 500, p_full = false)`**:
  - devuelve, en orden de `server_seq` (único y global, así que el orden es estable), las altas, modificaciones y lápidas de las cuatro tablas con `server_seq > p_since`, como mucho `p_limit` (1–1.000);
  - devuelve también `cursor` (el último `seq` de la página), `has_more`, `full` y `head` (el último cambio del usuario).
- **Cursor**:
  - el cliente guarda el cursor y lo avanza solo **después de persistir la página**. En M4c, la página y el cursor se guardan en la misma transacción de IndexedDB;
  - una fila que cambia durante la descarga recibe un `seq` mayor y llega en una página posterior.
- **Reconstrucción**: `p_since = 0`, o `p_full` en todas las páginas, reconstruye el estado sin lápidas. Es lo que hace un dispositivo sin copia.
- **Sin perder cambios con escrituras concurrentes**:
  - cada escritura de la biblioteca toma un bloqueo transaccional por usuario (`pg_advisory_xact_lock`), y `pull_library` lo toma en modo compartido antes de leer;
  - por eso las escrituras de un usuario se confirman en orden de `server_seq`, y una lectura espera a la que está en curso;
  - **ningún cambio puede quedar detrás del cursor**. Es más fuerte que el solape de 500 posiciones de `pull_changes`.
  - Probado: una lectura espera a una escritura sin confirmar y la recibe al confirmarse, y una segunda escritura espera y obtiene un `seq` mayor.
- **`pull_changes` no cambia**: mismas claves, mismo cursor y sin datos de la biblioteca. Solo añade `library: { head }`, que anuncia que la cuenta guarda la biblioteca (bandera de M4c) y si hay cambios nuevos.
  - Así los clientes publicados no descargan la biblioteca en cada pull.
  - No es un cambio sustancial del protocolo de los módulos ya desplegados: es una clave nueva que ellos ignoran (comprobado: el cliente lee solo sus claves, y las E2E de cuenta pasan contra la base migrada).
- **Filas compactas**: sin el propietario, sin `field_stamps` y sin columnas nulas (una clave ausente es nula). Medido: −43 % de JSON (§17.7).

### 17.6 Pruebas
| Suite | Resultado |
|---|---|
| `npm run check` | Typecheck y lint limpios. Unitarias **454/454** (40 ficheros; +5 de `library-wire.test.ts`) |
| Integración (Supabase local) | **137/137**, 7/7 ficheros. Los 84 anteriores (Hábitos, Objetivos, Deep Work, Mente y energía, Life Review) más **53 nuevos** en `library.int.test.ts`. La puerta de CI (`ci-gate.mjs vitest --dir`) acepta 7/7 |
| E2E en modo cuenta contra la base migrada | `account.spec.ts` y `reviews-account.spec.ts`: **34 superadas, 10 omitidas** (las «covered once» de siempre) |
| Migración desde cero | Aplicada en un stack aislado y desechable (`the-one-percent-drill`): **241 objetos idénticos** al stack local (24 funciones, 87 restricciones, 16 índices, 12 políticas, 4 triggers, 94 columnas, 4 tablas en realtime), 0 diferencias. Stack y volúmenes eliminados |
| Aditividad | `apply_ops`: solo la rama `library.%` y el paso de `seq`. `pull_changes`: solo la clave `library`. En la nube (solo lectura) las dos son idénticas a `20261031090000_reviews`, la base de esta migración, y no existe ningún objeto con los nombres nuevos |

Los 53 tests de integración cubren:
- paridad con Zod;
- formato propio de cada tipo;
- aplicaciones con hábito propio, ajeno o inexistente;
- aislamiento entre usuarios: leer, descargar, escribir, notas, enlaces e ids ajenos;
- `anon`;
- escrituras directas por REST;
- privilegios y `search_path`;
- auditoría sin texto;
- idempotencia;
- campos distintos desde dos dispositivos;
- mismo campo simple (gana el sello);
- mismo texto (conflicto sin escribir nada);
- campos no permitidos y sello obligatorio;
- borrado con versión vista;
- cascada con `notes_seq`;
- lápidas sin texto;
- programa borrado;
- ediciones, altas, notas y enlaces atrasados sin resurrección, y restauración explícita;
- enlaces como estado deseado;
- paginación de unas 1.400 filas en páginas de 250;
- lápidas en el incremental y no en la reconstrucción;
- cambios mientras se descarga;
- dispositivo que pierde la copia;
- espera ante una escritura en curso;
- `pull_changes` intacto;
- y el volumen de §17.7.

**Problemas encontrados y corregidos en M4b**:
1. La página siguiente de una reconstrucción traía lápidas. Se añadió `p_full`.
2. Un id ajeno revelaba que existía. Ahora responde `not_found`.
3. `rowToNote` devolvía las fechas con `+00:00` en vez de ISO. Ahora se normalizan.
4. Las filas del pull llevaban nulos y sellos. Ahora son compactas.

Las funciones corregidas se sustituyeron en el stack local con el texto exacto del fichero, y la comparación desde cero confirma que coinciden.

### 17.7 Rendimiento medido con 5.000 notas (PostgreSQL local, `docs/reports/m4b-sync.json`)
Biblioteca sintética de M4a: 40 programas, 560 contenidos, 5.000 notas y 1.000 enlaces, en total **6.600 filas**. Medido con el cliente Supabase sobre la API REST local (loopback), en este PC.

| Medida | Resultado |
|---|---|
| Carga inicial: 6.600 operaciones en 66 llamadas de 100 | 11,2 s |
| Descarga completa, páginas de 500 | 14 páginas, **1,38 s**, 5,92 MB de JSON (1,56 MB en gzip) |
| Descarga completa, páginas de 1.000 | 7 páginas, **0,80 s**, 5,91 MB de JSON (1,55 MB en gzip) |
| **Descarga incremental tras 5 ediciones** | 1 página, **8,9 ms**, **4.118 bytes** (1.608 en gzip) |
| `pull_changes` de ese usuario | 507 bytes, 11 ms: la biblioteca no viaja por aquí |
| Antes de compactar las filas (misma descarga completa) | 10,3 MB de JSON (1,69 MB en gzip) |

- **Con N2**, abrir la app con la biblioteca al día cuesta una consulta de `head` y, si hay cambios, solo esos cambios: **unas 1.500 veces menos datos** que descargar todo (4,1 KB frente a 5,9 MB).
- La descarga completa queda solo para el primer arranque o una copia perdida.
- Los tamaños en gzip se calculan en el test. No se ha medido si la pasarela de Supabase comprime las respuestas en tránsito.

### 17.8 Riesgos y límites para M4c
1. **Primera sincronización**: 5,9 MB (1,55 MB en gzip) con 5.000 notas. Debe hacerse por páginas de 1.000, guardando cada una, con progreso visible y reanudable desde el cursor si se corta.
2. **`field_seqs`** pesa unos 300 bytes por fila. Hace falta como base de conflictos; no se reduce.
3. **El cliente debe enviar** `at` (sello), `base_seqs`, `notes_seq` al borrar un contenido, `captured_at` en las notas y `restore` para «Deshacer». Usará `seq` de la respuesta como nueva base.
4. **Bloqueo por usuario**: las escrituras de la biblioteca de un mismo usuario se serializan y una descarga espera a la escritura en curso (milisegundos con lotes de 100). Los demás módulos no se ven afectados.
5. **Lápidas**: se conservan indefinidamente, sin texto. La purga queda para la decisión pendiente P14.
6. **Realtime** avisará de cada fila. M4c debe agrupar los avisos y descargar solo cuando cambie `head`.
7. **Sin interfaz todavía** (M4d). El cliente actual no sabe nada de la biblioteca y lo ignora sin problemas.

### 17.9 Plan de M4c (cliente: almacenamiento por elemento y sincronización; requiere tu autorización)
1. **Almacenamiento local por elemento (N1, D72)**: base de IndexedDB propia, `the-one-percent-library`.
   - Almacenes `shows`, `items`, `notes` y `links`, más `meta` con el cursor de cada usuario. Claves `<usuario>:<id>`.
   - Se escriben **solo las entidades que cambiaron** (comparación por identidad de objeto, que es barata con los reductores de M4a) y, **en la misma transacción**, el cursor de la página aplicada.
   - El registro actual `v1:<usuario>` (hábitos, objetivos, enfoque, check-ins, revisiones, cola, `pendingNotes` y D58) no cambia; la cola de operaciones de la biblioteca vive en él. Los guardados de hábitos siguen en ~1 ms.
   - **Medición**: repetir el banco de M4a con 5.000 notas guardadas; guardar una nota debe costar milisegundos, no 122 ms.
2. **Sincronización**:
   - al arrancar y cuando cambie `library.head` (o llegue un aviso de realtime agrupado): `pull_library` desde el cursor guardado, por páginas de 1.000;
   - reconstrucción con `p_full` si no hay copia;
   - progreso y reanudación.
3. **Operaciones desde los reductores**:
   - crear y actualizar con `changedFields` de `library-wire.ts`, `base_seqs` desde `field_seqs` y sello del reloj híbrido;
   - borrar con `base_seq` y `notes_seq`; «Deshacer» con `restore`; enlaces con estado deseado;
   - compactación por fila y campo en la cola (D55);
   - aplicación de la cola en bloque al rehacer la vista (optimización 4 de M4a).
4. **Conflictos sin pérdida (D68)**:
   - `field_conflict` guarda el texto en `pendingNotes` y ofrece «Aplicar la mía», «Mantener la otra» o «Guardar las dos»;
   - `deleted` e `item_deleted` conservan el texto y ofrecen restaurar o guardarlo como idea suelta;
   - `stale_fields` no avisa (gana el más reciente).
5. **Compatibilidad**:
   - `upgradePersisted` con la forma de M3.4 y la forma de M3.4 en `upgrade.spec.ts` (D38/D39);
   - `libraryEnabled()` según `library` en `pull_changes`; sin él, la biblioteca guarda en el dispositivo y lo dice;
   - cerrar sesión borrando el dispositivo también borra la base de la biblioteca de ese usuario, con aviso si hay ideas sin enviar (D27).
6. **Pruebas**:
   - unitarias del almacén (diferencias, transacción con cursor, reanudación) y del motor;
   - integración con dos dispositivos reales contra PostgreSQL local;
   - E2E: idea escrita sin conexión con la app cerrada y reabierta, dos pestañas, dos navegadores con el mismo texto (las dos versiones) y copia antigua;
   - medida de volumen en Chromium con el almacén nuevo.
7. **Esfuerzo**: 2–2,5 días. **Sin nube, sin despliegue y sin interfaz definitiva** (la interfaz es M4d).

---

## 18. M4c · Cliente: almacenamiento por elemento, sincronización y conflictos (30/10/2026, hecho en local)
Decisiones nuevas: **D73–D76** (`docs/decisions.md`). Continuación del trabajo interrumpido en `3ca0ac5`: se conservó todo el código válido y se revisó línea a línea antes de probarlo.

### 18.1 Diseño
```
Registro principal v1:<usuario> (idb-keyval, the-one-percent/sync)   ← sin cambios de forma
  cache (hábitos, objetivos, enfoque, check-ins, revisiones) · cola ÚNICA (también library.*)
  pendingNotes (también textos de la biblioteca) · resolvedNotes · closeIntents · goneOps
Base the-one-percent-library (IndexedDB propia)                      ← nueva (D73)
  show · item · note · link   una entrada por fila confirmada, clave <usuario>:<id>
  meta                        { cursor, rebuildUpto, complete } por usuario
```
- **Vista de la app** = copia confirmada + operaciones de la cola aplicadas encima (`applyLibraryOps`, una copia por registro y reconstrucción).
- **Guardar una nota** solo escribe el registro principal (2,9 KB). La base de la biblioteca solo la escribe la descarga.
- **Sincronización**: `apply_ops` (cola única) → `pull_changes` (sin cambios) → `pull_library` por páginas desde el cursor guardado → las operaciones confirmadas salen de la cola.
  - La biblioteca solo se declara **«sincronizada»** sin ediciones en cola, sin textos por decidir, sin páginas pendientes, con la copia completa y con el cursor ≥ `head`.
  - Estados expuestos (`librarySync`): `disabled`, `local`, `pending`, `synced`, `conflict` y `error`, con fase (`downloading` o `rebuilding`) y progreso.
- **Atomicidad**: página y cursor en una transacción. Solo después cambia la memoria. Un fallo antes del commit no mueve nada; un fallo después deja el disco por delante de la memoria, y el ciclo siguiente converge sin duplicados (por fila solo entra un `seq` mayor).
- **Reanudación**: el cursor y, en una reconstrucción, su `skip_deleted_upto` se guardan con cada página. Al reabrir, la descarga continúa desde ahí (D74).
- **Cuenta sin la migración**: las ediciones esperan en el dispositivo (`local`); el resto de módulos sincroniza con normalidad.
- **Realtime**: 4 suscripciones nuevas con un agrupado de 1,5 s; solo se pagina si `head` avanzó.
- **Cerrar sesión**: el aviso incluye los textos de la biblioteca por decidir (las ediciones ya cuentan como cambios sin sincronizar); borrar el dispositivo borra también su base.

### 18.2 Problemas encontrados y resueltos en M4c
| # | Problema | Cómo se encontró | Solución |
|---|---|---|---|
| 1 | **El contrato de reconstrucción de M4b perdía borrados**: `p_full` omitía todas las lápidas, así que una fila recibida en la página 1 y borrada antes de la página 3 se quedaba en la copia | Al diseñar la reanudación | `p_skip_deleted_upto` (D74), en la migración local y con tests de integración y del motor (fallarían con el contrato anterior) |
| 2 | **Re-entrada en `sync()`**: un `sync()` llamado durante el arranque síncrono de un ciclo iniciaba otro en paralelo, que reenviaba operaciones en curso y mandaba ediciones con bases viejas (falso conflicto con el propio texto). Existía desde antes de M4c | Test de ediciones seguidas | Guarda `starting` (D76) |
| 3 | **Borrar un contenido con notas editadas sin enviar** las descartaba o provocaba un `notes_changed` propio | Revisión del código | Se rechaza con `pending` hasta sincronizar (D75) |
| 4 | **Una fila con una fecha rota vaciaba la copia entera** (la conversión lanzaba y la carga trataba la base como ilegible) | El banco de volumen dio «0 notas» al abrir sin red | Conversión tolerante (D76) y un test. El banco ahora falla si el motor no abre las 5.000 notas |
| 5 | **Chromium (Local Network Access) bloqueaba el arnés de pruebas** contra Supabase local | Primera ejecución en Chromium | Se sirve desde un servidor real en `127.0.0.1`. No se desactivó ninguna protección |
| 6 | Varios errores míos en tests: timing, comillas en SQL, ids | Ejecuciones | Corregidos; ninguno ocultaba un fallo del producto |

### 18.3 Pruebas
| Suite | Resultado |
|---|---|
| `npm run check` | Typecheck y lint limpios. Unitarias **495/495** (43 ficheros; **41 nuevas** en M4c: `library-engine.test.ts` 23, `library-sync.test.ts` 14, `library-store.test.ts` 3 y 1 en `library-wire.test.ts`) |
| **Mutaciones** (cada protección quitada a propósito) | **10/10 detectadas**: guardar antes de la memoria, límite de reconstrucción, re-entrada, borrado con pendientes, bases propias, textos duraderos, `upgradePersisted`, fila más vieja sobre una nueva, reenvío de los otros campos y espera sin migración. Ficheros restaurados y verificados |
| Integración (PostgreSQL local) | **145/145**, 8/8 ficheros: los 84 de M3, 54 de `library.int.test.ts` y 7 nuevos de `library-sync.int.test.ts` (motor real con transporte real). Puerta de CI 8/8 |
| Chromium real (`playwright.browser.config.ts`, IndexedDB real) | **6/6**: contrato del almacén (incluidos aborto real e aislamiento por usuario), D, E, I, K y volumen |
| E2E de la app | `upgrade.spec.ts` **18/18**, con la forma M3.4 nueva; cuenta (account, goals, focus, mind, reviews, screen-error) **57 superadas y 15 omitidas**; demo (habits, goals, focus, mind, reviews, analytics, navigation, a11y) **153 superadas y 5 omitidas**; smoke **22/22** |
| Migración desde cero | Stack aislado y desechable: **241 objetos idénticos** al local, 0 diferencias; stack y volúmenes eliminados |

**Escenarios A–N**:

| Escenario | Dónde se prueba |
|---|---|
| A | Integración: 5.000 notas, primera sincronización del motor real en 0,99 s y 6 páginas |
| B | Motor e integración: 5 filas, 21 ms |
| C | Motor e integración: corte entre páginas, reanudación desde la última guardada |
| D | Motor y Chromium: aborto real antes del commit; fallo después del commit |
| E | Motor, integración y Chromium: recarga a mitad de descarga, reanudación con el mismo límite, borrado entre medias aplicado |
| F, G, H, J | Motor e integración: dos dispositivos |
| I | Motor y Chromium: dos pestañas sin conexión, la primera cerrada antes de enviar; cada nota aplicada una vez |
| K | Motor, integración y Chromium: base de la biblioteca perdida con ediciones en cola |
| L | Integración: otra cuenta no ve ni toca nada. Chromium: claves por usuario en IndexedDB |
| M | `upgrade.spec.ts` M3.4 y `upgradePersisted` |
| N | Toda la regresión anterior |

### 18.4 Rendimiento: comparación con M4a (medido; `docs/reports/m4c-volume.json`)
Chromium 156 en este PC (Ryzen 5 7535HS). «×4» es la CPU ralentizada con DevTools, una aproximación a un móvil medio.

| Medida, con 5.000 notas | M4a (registro único, medido) | M4c ×1 | M4c ×4 |
|---|---|---|---|
| **Guardar una nota** (ciclo de guardado del registro principal) | 44 ms ×1 · **122 ms ×4** | **2,3 ms** (máx. 3,7) | **4,7 ms** (máx. 7,7) |
| **Guardar un hábito** | igual que una nota | **2,4 ms** | **4,4 ms** |
| Tamaño del registro principal | ~4,6 MB (con la biblioteca dentro) | **2,9 KB** | 2,9 KB |
| Escrituras en IndexedDB al descargar 5 cambios | todo el registro | 5 filas, 1,0 ms | 2,6 ms |
| Guardar la copia completa (5.600 filas en 6 transacciones) | — | 507 ms | 1,62 s |
| Leer la copia completa al abrir | — | 80 ms | 123 ms |
| Abrir el motor sin red con la copia | — | 105 ms | 225 ms |
| Recalcular la vista con ediciones pendientes | — | 2,7 ms | 6,7 ms |
| Memoria del motor con la copia (heap) | 4,5 MB de estado + 13,4 MB de índice | 7,9 MB (sin índice, que llega en M4e) | 6,3 MB |
| Copia de la biblioteca en disco | — | 4,1 MB de JSON | — |
| **Dos pestañas guardando a la vez** (Web Lock) | — | 3,1 y 3,4 ms de mediana (1,2 ms con una sola) | — |

Además, contra PostgreSQL local (integración, motor real, copia en memoria):
- primera sincronización de 5.000 notas: **0,99 s** (6 páginas de 1.000);
- descarga incremental de 5 cambios: **21 ms**.

Tamaños de M4b: 5,9 MB de JSON (1,55 MB en gzip) completo y 4,1 KB incremental.

**Variación entre ejecuciones**: en tres ejecuciones, guardar una nota con ×1 osciló entre 1,6 y 2,3 ms, y guardar la copia completa entre 261 y 507 ms (la última, tras la suite completa, con el equipo más cargado). La tabla recoge la última.

**Límites de la medición**: la CPU ×4 es una aproximación, no un móvil real; es Chromium de escritorio (Safari en iOS puede diferir); la red es local; la primera sincronización con IndexedDB se mide por partes (descarga en integración y guardado en Chromium).

### 18.5 Riesgos y límites para las fases siguientes
1. **Escrituras masivas por la cola**: cada edición guarda la cola entera, así que encolar miles de operaciones de golpe es cuadrático (5.600 altas seguidas tardaron 160 s en integración). El uso normal (una idea cada vez) no se ve afectado. Una importación (Goodreads, Kindle) necesitará su propio camino por lotes.
2. **La interfaz aún no existe** (M4d). Deberá mostrar `librarySync` (estado, fase y progreso), el panel de conflictos con sus 5 salidas y las respuestas `pending` e `in_flight` al borrar.
3. **El índice de búsqueda** (13,4 MB y 932 ms en frío con ×4) se construirá de forma perezosa en M4e.
4. **Medición en un móvil real pendiente**: página de diagnóstico sintético en M4d.
5. **Producción sin la migración**: la nube sigue en 10 migraciones. El código de M4c ya funciona contra una cuenta sin migración (las ediciones esperan en el dispositivo).
6. **En el stack local se sustituyó `pull_library` durante el desarrollo**; la aplicación desde cero confirma que coincide con el fichero.

### 18.6 Plan de M4d (interfaz de Biblioteca y captura rápida; requiere tu autorización)
**Antes de empezar, necesito tu decisión** sobre:
- **P14**: borrado con «Deshacer» y sin papelera;
- **P16**: Cerebro como vista global.

**Qué incluye**:
- portada de Biblioteca;
- Libros (estanterías, cuadrícula y lista, filtros, orden);
- Podcasts (episodios y programas);
- ficha común de libro y episodio;
- alta y edición manual;
- `CoverArt` tipográfico;
- `QuickCapture` (una idea con un toque más el texto, también sin conexión);
- editor de notas con autoguardado;
- estado de sincronización y progreso de la primera descarga;
- panel de conflictos con sus 5 salidas;
- estados vacíos;
- tarjeta en Resumen;
- página de diagnóstico sintético para medir en tu móvil.
- La demo usa `demo.ts` (etiquetada).

**Pruebas**: E2E de demo y de cuenta (alta, captura, edición, conflicto y recuperación, sin conexión, dos pestañas), axe, capturas a 375 y 1440 px, y `screen-error.spec.ts` con Biblioteca.

**Esfuerzo**: 2,5–3 días. Sin nube ni despliegue (eso es M4f).


## 19. M4d · Interfaz de la Biblioteca y captura rápida (30/10/2026, hecho en local)

Decisiones nuevas en `docs/decisions.md`:
- **D77** (P14, borrado);
- **D78** (P16, Cerebro);
- **D79** (fichas sin conexión);
- **D80** (honestidad del guardado).

No cambian el protocolo de sincronización ni la base de datos: la interfaz usa el motor de M4c tal cual. Solo se añadieron dos lecturas, `libraryIsConfirmed` y `librarySyncStateOf`.

### 19.1 Pantallas
| Ruta | Qué muestra |
|---|---|
| `/knowledge/library` | Tres puertas (Libros, Podcasts, Cerebro) con recuentos reales, «En curso», ideas recientes y captura de una idea suelta. Estado vacío con «Añadir libro» y «Añadir episodio» |
| `/knowledge/library/books` | Estanterías con recuento (todos, leyendo, pendiente, terminado, en pausa, abandonado, favoritos), orden, cuadrícula o lista |
| `/knowledge/library/podcasts` | Episodios, con y sin programa, y programas |
| `/knowledge/library/item?id=` | Ficha de libro o episodio: portada tipográfica, captura rápida arriba, estado, progreso (página o minuto), valoración 1–10, temas, notas agrupadas por tipo, relacionados, editar y eliminar |
| `/knowledge/library/show?id=` | Programa: episodios, ideas de sus episodios, temas, editar y eliminar (los episodios se conservan sin programa) |
| `/knowledge/brain` | Cerebro (P16): todas las notas, filtros sencillos, origen enlazado e ideas sueltas, de 60 en 60 |
| Resumen | Tarjeta discreta «Sigue con «título»» o «Biblioteca», sin cifras inventadas |

Código en `src/features/library/`:

| Archivo | Contenido |
|---|---|
| `store/` | Contrato común de demo y cuenta |
| `components/library-ui.tsx` | `CoverArt`, `StatusPill`, `ProgressLine`, `RatingInput` y `SyncLine` |
| `components/knowledge-notes.tsx` | `QuickCapture`, `NoteCard` y autoguardado |
| `components/content-form.tsx` | Formulario de alta y edición |
| `components/library-sync.tsx` | Descarga, cuenta sin migración, errores y panel de conflictos |
| `library-views.tsx`, `item-detail.tsx`, `brain-view.tsx` | Vistas |

Se retiró el prototipo de M1: Biblioteca y Cerebro de demostración, `fixtures` y su buscador.

### 19.2 Flujos
- **Libro**:
  1. «Añadir libro» → solo el título → se abre su ficha.
  2. «Añadir idea» → escribir. Se guarda sin botón a los 800 ms, al salir del campo y al ocultar la pestaña. La página es opcional.
  3. Ctrl/Cmd+Enter o «Nueva idea» empiezan otra.
- **Podcast**: «Añadir» → «Programa de podcast» o «Episodio» (con programa o sin él) → ficha → minuto opcional (12:34).
- **Cerebro**: filtros «Todas», por tipo, «Sueltas» y «Destacadas»; cada nota enlaza a su origen; captura de ideas sueltas.
- **Editar una nota**: se toca el texto y se guarda solo. Además se puede destacar, cambiar de tipo, marcar el estado de una aplicación y eliminar con «Deshacer».
- **Borrar** (D77): si hay notas, un diálogo dice cuántas se van; después aparece «Deshacer». Con ediciones sin enviar se rechaza con un mensaje claro.
- **Conflictos**: un panel con las dos versiones y estas salidas:
  - «Aplicar la mía»;
  - «Mantener la otra»;
  - «Guardar las dos»;
  - «Restaurar con mi texto»;
  - «Guardar como idea suelta»;
  - «Descartar mi texto».
- **Formulario**: si se cierra con algo escrito (Esc, tocar fuera o deslizar), pregunta «¿Descartar lo escrito?» dentro de la propia hoja.

### 19.3 Comportamientos validados (E2E)
**Demo** (`e2e/library.spec.ts`, 13 casos en 2 tamaños):
- recuentos reales;
- alta solo con el título, sin metadatos inventados;
- autoguardado que sobrevive a recargar;
- edición, borrado y «Deshacer»;
- confirmación al borrar un libro con notas;
- programa, episodio y episodio sin programa;
- filtros de Cerebro e idea suelta;
- paginación con 136 notas;
- valoración con teclado;
- navegación y captura **sin conexión**;
- formulario que no descarta texto;
- id inexistente o heredado (`constructor`);
- tarjeta de Resumen;
- axe sin violaciones graves;
- zonas táctiles de al menos 44 px.

**Cuenta** contra el stack local (`e2e/library-account.spec.ts`, 9 casos):
- filas reales en la base de datos y una sola operación por captura;
- sin conexión: «se enviará al recuperar la conexión», nunca «Sincronizado», y después llega una sola vez;
- dos navegadores con conflicto resuelto con «Guardar las dos»;
- borrado remoto mientras se editaba sin conexión, resuelto con «Restaurar con mi texto»;
- borrado rechazado con ediciones pendientes, y después borrado y «Deshacer» del libro con sus notas;
- idea suelta con `item_id` nulo;
- aislamiento entre cuentas y respecto a la demo;
- cierre de sesión con un cambio sin enviar: lo avisa, y al borrar el dispositivo advierte antes de perder nada.

**Puerta permanente** (`e2e/screen-error.spec.ts`): si la copia local de una ficha está dañada, el fallo se queda dentro de esa pantalla. La barra, la cola (la nota pendiente llega una vez) y Cerebro siguen funcionando.

### 19.4 Resultados (30/10/2026, build de producción local)
| Prueba | Resultado |
|---|---|
| `npm run check` (tipos, lint y unitarias) | 43 archivos, **495/495**. Incluye 4 nuevas de `account-library` y ya no las del buscador del prototipo M1 |
| Integración contra PostgreSQL local | 8 archivos, **145/145** |
| `npm run e2e` (todo, demo y cuenta, móvil y escritorio) | **279 superadas, 0 fallos, 23 omitidas**. Las omisiones son deliberadas: casos que se cubren en un solo tamaño |
| Biblioteca: demo · cuenta · `screen-error` | 26/26 · 15 superadas y 3 omitidas · 4/4 |
| `npm run smoke` (local) | **22/22** |
| `npm run test:browser` | **6/6** |

**Incidencia del entorno**: dos ejecuciones completas fallaron a partir de cierto punto porque murió el `next start` que la herramienta había lanzado en segundo plano (código 127, sin error de la aplicación). Todos los fallos eran conexiones rechazadas. Con el servidor gestionado por Playwright, la suite completa pasó entera.

### 19.5 Capturas revisadas
Están en `docs/screenshots/m4d/`, solo con datos de demostración, a 375 y 1440 px:
- Biblioteca;
- Libros;
- ficha de libro;
- captura;
- Podcasts;
- episodio;
- programa;
- Cerebro;
- formulario;
- Resumen;
- contenido inexistente.

Revisadas una a una: sin desbordamiento horizontal ni errores de consola.

### 19.6 Incidencias encontradas y corregidas
1. **«Deshacer» tras un borrado ya confirmado** enviaba un alta que el servidor rechaza, y la fila no volvía. Ahora se decide al borrar (D77), con prueba unitaria y E2E.
2. **Sin conexión no se abría una ficha** (R1): el segmento `[id]` pedía la ficha al servidor. Ahora son páginas estáticas con `?id=` (D79), con E2E.
3. **Zonas táctiles de 36–40 px** (estrella, menú de nota, chips y botones pequeños del panel de conflictos): ahora miden 44 px en móvil.
4. **Las notas se anunciaban solo como «Editar nota»** en lectores de pantalla, sin su texto. Ahora se lee el texto.
5. **El formulario descartaba lo escrito al cerrarse**. Ahora pregunta. Una primera versión con un diálogo encima de la hoja se cerraba sola (dos trampas de foco), y se resolvió dentro de la hoja.
6. **Un id como `constructor` en la URL** leía una propiedad heredada del objeto. Ahora cuenta como inexistente.
7. **Visual**:
   - filtros cortados en escritorio (ahora saltan de línea);
   - título de la portada grande cortado a 375 px;
   - desbordamientos y chips ocultos en móvil (corregidos antes de la interrupción).
8. **Cerebro con miles de notas** las pintaba todas. Ahora va de 60 en 60.

### 19.7 Seguridad y datos
- **Aislamiento**: la demo y la cuenta no se mezclan; ni otra cuenta ni la demo ven los datos (E2E).
- **Datos personales**: las capturas son solo de la demo. Las cuentas de prueba son sintéticas (`@theonepercent.local`) y se borran al terminar.
- **Textos**:
  - ningún formulario descarta texto sin preguntar;
  - las notas se guardan solas;
  - si el dominio rechaza un texto, se queda en su campo con el motivo (`role="alert"`).
- **Estado honesto**: «Sincronizado» solo aparece con la fila en el servidor y nada pendiente (D80).
- **Borrados**: nunca quitan operaciones pendientes ni textos en conflicto (D75 y D77).
- **Validación**: la interfaz usa los mismos reductores del dominio que la demo y el motor (título de hasta 300 caracteres, valoración 1–10, página o minuto dentro del contenido). No ofrece nada que el servidor rechazaría.

### 19.8 Límites y riesgos pendientes
1. **Previsto en §18.6 y no implementado: la página de diagnóstico sintético** para medir en un móvil real. Se propone hacerla antes de M4f (§19.9). Los criterios de aceptación de M4d (§13) no dependen de ella.
2. **Arranque en frío sin conexión**: sin service worker (P17, abierta), la aplicación no se abre sin red desde cero. Una vez cargada, sí se navega sin red.
3. **Portadas externas y metadatos**: llegan en M4g. Hoy solo hay portadas tipográficas generadas.
4. **Importación masiva**: la cola la hace cuadrática (§18.5). Necesita su propio camino por lotes.
5. **CI**: todavía no ejecuta `test:browser`.
6. **Páginas anteriores montadas y ocultas**: Next 16 conserva las rutas con `Activity`, así que las pruebas filtran por elementos visibles. El usuario no lo nota, pero hay que tenerlo en cuenta al escribir pruebas.
7. **Propagación entre dispositivos**: en la Biblioteca se ha probado abriendo la ficha en el segundo navegador, no esperando en vivo sin recargar.
8. **Nada está en la nube**: la migración de la Biblioteca solo existe en el stack local y producción sigue en M3.4.

### 19.9 Propuesta de M4e (requiere tu autorización)
**Objetivo**: recuperar lo aprendido, rápido y sin conexión.

**Qué incluye**:
1. **Búsqueda global en Cerebro**:
   - el índice de M4a (`search.ts`, con acentos y prefijos) se construye **de forma perezosa**, al abrir Cerebro o enfocar el buscador;
   - se actualiza con cada cambio, sin reconstruirlo entero;
   - si con la CPU ×4 tarda más de 100 ms, pasa a un **Web Worker**;
   - resultados resaltados y con su origen.
2. **Filtros combinados en la URL** (`?q=&tipo=&tema=`): tipo, contenido, tema, destacadas, sueltas y estado de aplicación. Sobreviven a recargar y se pueden compartir entre pestañas. Se aplican a Cerebro, Libros y Podcasts.
3. **Agrupar** por contenido o por tema.
4. **Relaciones**:
   - enlazar y desenlazar a mano notas y contenidos (`setLink`, que ya existe en el dominio, el servidor y el motor);
   - «Relacionados» por temas;
   - sección «Enlaces» en la ficha.
5. **Aplicaciones**: vista de las aplicaciones prácticas por estado, con vínculo opcional a un hábito u objetivo existente. Sin crear hábitos automáticamente (eso es M4h).
6. **Mover una nota** a otro contenido o dejarla suelta (`moveNote`, ya en el dominio).
7. **Página de diagnóstico sintético** (pendiente de M4d):
   - genera N notas en una base de IndexedDB **propia y separada**;
   - mide en tu móvil el guardado, la búsqueda y el pintado;
   - borra solo esa base al terminar, sin tocar tus datos.

**Pruebas**:
- unitarias del índice incremental;
- E2E de búsqueda: acentos, sin conexión y 5.000 notas;
- filtros tras recargar;
- enlazar y desenlazar en dos navegadores;
- axe y capturas.

**Aceptación**:
- encontrar una idea por palabra en menos de 100 ms con 5.000 notas, medido con la CPU ×1 y ×4;
- filtros reproducibles por URL;
- sin cambios de protocolo.

**Riesgos**:
- memoria del índice (13,4 MB medidos en M4a): se mitiga con la carga perezosa y liberándolo al salir;
- coste de las relaciones con muchas notas.

**Esfuerzo**: 2–2,5 días. Sin nube ni despliegue (eso es M4f).


## 20. M4e · Búsqueda, filtros, conexiones y aplicaciones (30/10/2026, hecho en local)

Decisiones nuevas: **D81** (arquitectura de búsqueda), **D82** (Cerebro en la URL), **D83** (conexiones y movimiento), **D84** (diagnóstico sintético) y **D85** (privacidad de la documentación). No cambian el protocolo de sincronización ni la base de datos, y no hay dependencias nuevas.

### 20.1 Funcionalidades
**Búsqueda en Cerebro**
- Busca en:
  - títulos y subtítulos;
  - autores e invitados;
  - programas y episodios;
  - todos los tipos de nota (ideas, aprendizajes, citas y momentos destacados, preguntas, aplicaciones y notas personales);
  - temas y etiquetas de referencia.
- Cómo busca:
  - sin conexión, sobre la copia del dispositivo;
  - sin distinguir mayúsculas ni acentos;
  - con varias palabras a la vez, cada una como palabra completa o como inicio de palabra;
  - una nota también se encuentra por su origen, de modo que «attia zona» encuentra la nota de Outlive.
- Cómo muestra los resultados:
  - libros, episodios y programas aparte;
  - coincidencias resaltadas;
  - «Coincide en el texto y su origen» cuando hace falta explicarlo.
- Cada resultado abre su ficha o la nota.
- Textos vacíos o especiales no dan error.
- La caja responde al instante (`useDeferredValue`) y la URL se actualiza a los 300 ms.

**Filtros combinables** (hoja «Filtros» y chips con un toque para quitar cada uno):
- origen (libros, podcasts o ideas sueltas);
- tipo de nota;
- tema;
- valoración mínima;
- favoritos y destacadas;
- estado del libro o episodio;
- fecha (7 días, 30 días o 12 meses);
- estado de la aplicación.

**Organización**
- Agrupar por origen o por tema.
- Todo vive en la URL: se conserva al recargar, al volver atrás y con un enlace directo.

**Conexiones**
- Desde el menú de cada nota, desde la nota abierta (`?nota=`) y desde la ficha:
  - nota con nota;
  - nota con libro, episodio o programa;
  - contenido con contenido.
- El selector busca con el mismo índice. Una fila conectada se marca, y pulsarla otra vez la desconecta.
- Nunca aparecen la propia nota ni duplicados.
- «Quitar conexión» tiene «Deshacer».
- «Relacionadas por temas» explica qué temas comparten.

**Mover una nota** a otro contenido, o convertirla en idea suelta, sin perder el texto ni las conexiones.

**Aplicaciones** (`?vista=aplicaciones`)
- Agrupadas por estado: Pendiente, En marcha, Hecha y Descartada.
- Muestran su origen y se pueden filtrar.
- El estado se cambia en la propia tarjeta.
- No tocan hábitos ni objetivos.

**Diagnóstico sintético**: `/dev/knowledge` (D84).

### 20.2 Arquitectura de la búsqueda
| Pieza | Dónde | Qué hace |
|---|---|---|
| Índice invertido | `knowledge/domain/search.ts` | Palabras normalizadas con peso por campo (título 8, autor y tema 5, texto 1, origen 0,5). Lista ordenada de palabras para buscar prefijos con búsqueda binaria |
| Construcción por tramos | `indexBuilder` | Mismo resultado que `buildIndex`, en tramos que miran el reloj cada 16 entidades |
| Actualización incremental | `buildIndex(state, previo)` | Las entidades sin cambios (mismo objeto, mismo origen) se saltan. Las obsoletas se detectan por generación, y las palabras se insertan o quitan sin reordenar |
| Ciclo de vida | `library/search/use-knowledge-index.ts` | Un índice por fuente de datos, solo en memoria. Se construye cuando una pantalla lo pide, y una edición en una ficha no lo recalcula hasta que se vuelve a buscar |
| Consulta | `search` + `brainFilters` | Todas las palabras deben coincidir (AND). Sin palabras, la lista se filtra sin índice |
| Explicación y resaltado | `explainMatch` y `highlight` | Calculados solo para la página visible (60 notas) |

### 20.3 Rendimiento
Ejecutado con `npm run bench:search` en Chromium 156 sobre un Ryzen 5 7535HS. Resultados en `docs/reports/m4e-search.json`. La CPU ×4 es una aproximación de un móvil medio, no un móvil real.

| Medida | 5.000 notas ×1 | 5.000 notas ×4 | 10.000 notas ×1 | 10.000 notas ×4 |
|---|---|---|---|---|
| **Tecleo completo** (búsqueda + explicación + resaltado de 60), p95 | 5,6 ms | **67 ms** ✓ | 8,1 ms | 87 ms ✓ |
| Tecleo, peor caso | 8,3 ms | 80 ms | 10 ms | 101 ms |
| Búsqueda sola, palabra frecuente, p95 | 2,2 ms | 21 ms | 4,3 ms | 25 ms |
| Prefijo corto («en», 2.608 notas), p95 | 2,6 ms | 37 ms | 4,5 ms | 57 ms |
| Filtros combinados con texto, p95 | 4,3 ms | 48 ms | 5,3 ms | 53 ms |
| Índice en frío (de una vez) | 184 ms | 1.142 ms | 331 ms | 2.500 ms |
| **Índice por tramos** (el que usa la app): total · tramo más largo | 189 ms · 8,8 ms | **1.338 ms · 18 ms** | 292 ms · 11 ms | 3.617 ms · 40 ms |
| Incremental: editar · mover · renombrar un contenido | 5 · 4 · 6 ms | **24 · 37 · 65 ms** | 8 · 7 · 10 ms | 66 · 63 · 81 ms |
| Memoria tras GC (estado e índice vivos) | 19,8 MB | 19,8 MB | 36,1 MB | 36,1 MB |

**Cuellos de botella encontrados y resueltos antes de añadir complejidad**:
1. **El resaltado** (normalización Unicode carácter a carácter) era la mayor parte de cada tecla. Ahora usa una vía rápida equivalente, con prueba de equivalencia. Antes: p95 de 94 ms con ×4.
2. **La primera construcción** bloqueaba la página 1,2 s. Ahora va por tramos, con «Preparando la búsqueda… N %».
3. **La actualización incremental** reservaba memoria por entidad y reordenaba 12.791 palabras. Ahora usa una generación y operaciones `splice`: con ×4 pasa de 76–147 ms a 24–65 ms.

**Conclusión**: el objetivo (menos de 100 ms con 5.000 notas y ×4) se cumple sin Web Worker. Con 10.000 notas también, aunque justo. Si la biblioteca real se acerca a esa cifra, el siguiente paso sería un Worker solo para la primera construcción.

**Variación**: entre ejecuciones del mismo equipo, las cifras con ×4 variaron hasta un ±30 % según la carga.

### 20.4 Sincronización entre navegadores (cerrada)
En `e2e/knowledge-live.spec.ts`: dos contextos autenticados en la misma cuenta, contra el stack local con realtime. Cada prueba exige **cero recargas** después de la carga inicial:
1. Lo creado en A aparece en B; lo editado en B se actualiza en A; lo borrado en A desaparece de B. Los estados se muestran correctos. **Latencia medida**: alta 1,9 s, edición 1,9 s y borrado 1,9 s (realtime más la descarga agrupada de 1,5 s).
2. B sin conexión mientras ambos escriben:
   - B muestra «se enviará al recuperar la conexión»;
   - al volver la conexión, cada cambio llega una vez (2 operaciones `create`);
   - los dos navegadores convergen.
3. La misma nota editada en los dos:
   - B conserva ambas versiones hasta que decide;
   - la nota dice «Hay otra versión: decide cuál se queda»;
   - «Guardar las dos» llega a A sin recargar.
4. Una conexión y un movimiento hechos en A aparecen en B. El servidor guarda un solo enlace y el nuevo `item_id`, y la conexión sobrevive al movimiento.

**No apareció ningún fallo del motor realtime**: no hubo que tocar el motor ni el protocolo.

### 20.5 Resultados de las pruebas (30/10/2026)
| Prueba | Resultado |
|---|---|
| `npm run check` (tipos, lint y unitarias) | 45 archivos, **511/511**. Nuevas: búsqueda por origen, filtros, `explainMatch`, relacionadas, construcción por tramos, equivalencia incremental tras 40 ediciones, resaltado y URL de Cerebro |
| Integración con PostgreSQL local | 8 archivos, **145/145** |
| `npm run e2e` (todo: M2, M3 y M4; demo y cuenta; móvil y escritorio) | **301 superadas, 0 fallos, 27 omitidas**. Omisiones deliberadas: los casos de dos navegadores solo se ejecutan en escritorio, incluidos los 4 nuevos de sincronización en vivo |
| Nuevas en M4e | `knowledge.spec.ts`: 9 casos × 2 tamaños (búsqueda, entradas especiales, filtros y grupos, sin conexión, conexiones, conexiones en la ficha, mover, aplicaciones, accesibilidad). `knowledge-live.spec.ts`: 4 casos en escritorio |
| `npm run smoke` (local) | **22/22** |
| `npm run test:browser` | **6/6** |
| `/dev/knowledge` en un build de producción | 404 (comprobado) |

### 20.6 Capturas revisadas
En `docs/screenshots/m4e/`, a 375 y 1440 px y solo con la demo:
- búsqueda con resaltado y explicación;
- contenidos encontrados;
- hoja de filtros;
- agrupado por origen y por tema;
- aplicaciones;
- nota con sus conexiones y relacionadas;
- selector de conexiones;
- ficha con conexiones;
- sin resultados.

Sin desbordamiento ni errores de consola.

**Corregido al revisar**: el contraste del subtítulo de una fila ya conectada en el selector (fallaba axe).

### 20.7 Seguridad y privacidad
- La búsqueda no envía nada: el índice se calcula en el dispositivo y solo vive en memoria.
- El diagnóstico usa datos sintéticos y una base propia que se borra por nombre, y no existe en producción.
- **Correo del propietario**:
  - sustituido en 4 documentos vigentes (9 líneas);
  - no figuraba en el código, la configuración ni las migraciones;
  - **sigue en el historial**: commits `3b88fea`, `a518f90`, `2bc63c6` y `83a0116`, ya publicados en `main`, y en el campo de autor de cada commit;
  - el repositorio es **privado** (comprobado en modo lectura con la API de GitHub);
  - las opciones están en §20.9, paso 9.

### 20.8 Límites y riesgos residuales
1. **10.000 notas con ×4**:
   - el tecleo llega a 101 ms en el peor caso;
   - la primera construcción tarda 3,6 s por tramos;
   - si se alcanza ese volumen, un Worker solo para esa primera construcción.
2. **Con miles de notas, cada edición** actualiza el índice (24 ms con 5.000 y ×4) solo si una pantalla lo usa.
3. **La CPU ×4 no es un móvil real**: falta ejecutar `/dev/knowledge` en tu teléfono (§20.9).
4. **Arranque en frío sin red**: sigue sin service worker (P17).
5. **«Relacionadas por temas»** depende de que los contenidos tengan temas; sin temas, no sugiere nada (y lo dice).
6. **Historial con el correo**: ver §20.9, paso 9.

### 20.9 Plan de M4f · Validación y despliegue de la Biblioteca (requiere tu autorización)
**Objetivo**: publicar M4 (M4a–M4e) en producción con la misma disciplina que M3.4: validación aislada, copia de seguridad cifrada y verificada, migración controlada y pruebas reales en tus dispositivos. **Nada de este plan se ejecuta sin tu autorización explícita para cada paso exterior.**

0. **Estado de partida** (verificar en solo lectura):
   - `origin/main = 85fd1a0`;
   - nube con 10 migraciones (la última, `20261031090000`);
   - local con 9 commits sin publicar (de `3082b4f` a `baa16a4`, M4e) y este de corrección.
1. **Revisión de los commits acumulados**:
   - `git log origin/main..HEAD` y una revisión del diff completo;
   - búsqueda de secretos y de datos personales en el diff;
   - comprobación de que los `.env*` no están en Git;
   - `npm audit` sin altas nuevas.
2. **Revisión de la migración** `20261101090000_library.sql` (la única nueva):
   - aplicar desde cero en el stack de simulacro y comparar con el local (241 objetos);
   - releer RLS, `security invoker`, `search_path` vacío y `revoke` a `anon`;
   - comprobar que `pull_changes` sigue siendo compatible con clientes M3.4, que conviven durante el despliegue (prueba con la forma M3.4 de `upgrade.spec`);
   - ensayar la migración sobre una copia restaurada de producción (paso 5).
3. **Arranque sin conexión (P17, requiere tu decisión)**:
   - **A (recomendada): service worker mínimo propio**, sin dependencias:
     - precarga del shell y de las rutas estáticas;
     - «red primero» para HTML y RSC, con la copia guardada si no hay red;
     - nunca guarda respuestas de Supabase ni datos personales: la biblioteca ya vive en IndexedDB;
     - versión por build y limpieza solo de sus propias cachés;
     - antes de escribirlo, leer la guía de Next 16 sobre PWA en `node_modules/next/dist/docs/`;
     - pruebas: E2E de arranque en frío sin red, actualización de versión y desinstalación.
   - **B: documentarlo como límite** y aplazarlo. Cada arranque necesita red; la navegación posterior sí funciona sin ella.
4. **CI**:
   - añadir `npm run test:browser` a `ci.yml` (Chromium con IndexedDB real);
   - añadir `knowledge-live.spec.ts` (ya entra en `npm run e2e`);
   - mantener las puertas de `ci-gate.mjs`: 0 fallos, 0 inestables y búsqueda de secretos.
5. **Copia de seguridad cifrada y restauración aislada**, con `npm run cloud` y nunca con la sesión global:
   - copia `top-cloud-<fecha>` cifrada;
   - restauración en el stack de simulacro con `--schema-at 20261031090000`;
   - comprobación de tablas idénticas;
   - aplicar allí la migración de la Biblioteca y repetir `upgrade.spec` contra esa base.
6. **Validación en `ci/m4`** (con tu autorización):
   - subir solo esa rama, con `vercel.json` ya excluyendo `ci/**` de los despliegues;
   - dos pasadas completas: unitarias, integración, E2E, smoke, `test:browser` y la puerta;
   - comprobar que no hay Preview en Vercel ni datos personales en los artefactos.
7. **Despliegue controlado** (autorización aparte, en este orden):
   1. copia fresca;
   2. migración de la Biblioteca en la nube;
   3. comprobaciones en solo lectura (11 migraciones, tablas, RLS y publicación realtime);
   4. `push` del commit exacto validado a `main`;
   5. Vercel en verde;
   6. smoke de producción;
   7. CI de `main` en verde;
   8. borrar la rama `ci/m4`.

   **Vuelta atrás** documentada antes de empezar: el código anterior funciona con la base nueva (las tablas nuevas solo añaden), así que se vuelve con un `revert` y sin tocar datos.
8. **Pruebas reales entre móvil y ordenador** (tú, con una lista guiada de 10 casos):
   - libro con solo el título;
   - idea capturada sin red en el móvil, que aparece sola en el ordenador;
   - edición en vivo;
   - conflicto «Guardar las dos»;
   - borrado con «Deshacer»;
   - búsqueda sin red;
   - filtros que sobreviven a recargar;
   - conectar y mover;
   - aplicaciones;
   - cerrar sesión con un cambio pendiente.

   Además, ejecutar `/dev/knowledge` en el móvil con el servidor de desarrollo en la red local (`npx next dev -H 0.0.0.0`) y anotar los p95.
9. **Privacidad del historial (decisión tuya)**:
   - **A (recomendada): no reescribir.** El repositorio es privado y el correo ya está en GitHub. Para los commits futuros, usar la dirección `noreply` de GitHub en la configuración local de Git. Es un cambio de identidad, así que solo con tu permiso.
   - **B: reescribir** con `git filter-repo` (texto y autor) y hacer `push --force` a `main`. Vuelve a desplegar, invalida los hashes registrados en la documentación y en CI, y obliga a reclonar. Solo con tu autorización y después de M4f.
10. **Criterios de aceptación**:
    - CI en verde dos veces;
    - copia y restauración verificadas;
    - smoke de producción en verde;
    - tus 10 pruebas manuales superadas;
    - los p95 de tu móvil anotados;
    - nada de Uría tocado.

**Esfuerzo**: 1,5–2 días más tu tiempo de prueba, o +1 día con el service worker (opción A del paso 3).


## 21. M4f · Etapa 1: preparación y endurecimiento local (30/10/2026, hecho en local)

Aprobadas: **P17, opción A** (service worker mínimo, D86) y **privacidad de Git, opción A** (no reescribir; dirección `noreply` para los commits futuros, D88). Nueva: **D87** (CI de M4). Esta etapa no ha tocado ningún sistema remoto: sin `fetch`, sin `push`, sin Actions, sin nube y sin Vercel. Las únicas lecturas remotas fueron dos `GET` a la API de GitHub (visibilidad del repositorio e identidad del autor) y las comprobaciones habituales de producción.

### 21.1 Auditoría de la release
**Git**
- Sin cambios pendientes al empezar.
- `origin/main` = `85fd1a0`, según la referencia local; no se hizo `fetch`.
- 10 commits locales antes de esta etapa, de `3082b4f` a `47e1ad0`, con 140 ficheros (106 nuevos, 26 modificados y 8 borrados). Los borrados son el prototipo de M1.

**Secretos y datos personales**
- Ninguno en el diff acumulado. Se buscaron claves, JWT, `service_role`, `sb_secret`, contraseñas, claves privadas, rutas personales y el correo.
- `.env.cloud.local` sigue ignorado; solo `.env.example` está en Git.
- Los ficheros grandes son las capturas de la demo.

**La migración `20261101090000_library.sql` es aditiva**
- Crea 4 tablas, con sus índices, RLS (lectura, alta y edición de lo propio; sin `delete`), *triggers* de guarda y funciones privadas con `revoke` a `anon`.
- Añade las 4 tablas a `supabase_realtime`.
- **Sustituye dos funciones existentes**, `apply_ops` y `pull_changes`, con cabeceras idénticas (seguridad y `search_path`). Comparadas línea a línea con la versión de producción (M3.4), solo **añaden**:
  - la rama `library.%`;
  - el campo `seq` en la respuesta;
  - la clave `library.head`.
- Un cliente M3.4 ignora esas claves (cubierto por `upgrade.spec.ts`). No se cambia ni borra ninguna tabla, columna, política ni dato existente.

**Contrato validado**
- `pull_library(p_since, p_limit, p_skip_deleted_upto)`, con el arreglo de las lápidas durante la reconstrucción (D74), está en el fichero.
- **Aplicando todas las migraciones desde cero** en el stack de simulacro, el resultado es idéntico al stack local: **241 objetos, 0 diferencias** (24 funciones, 87 restricciones, 16 índices, 12 políticas, 4 *triggers*, 94 columnas, 4 tablas en realtime).
- El stack de simulacro se destruyó al terminar. Los contenedores de Uría y de desarrollo no se tocaron (9 + 8).

**Compatibilidad con M2 y M3**: la suite E2E completa (§21.4) incluye todos sus módulos, `upgrade.spec.ts` con las copias de M3.0 a M3.4 y `screen-error.spec.ts`.

**Riesgos de la migración** (para la etapa B):
- toma bloqueos breves al crear las tablas y sustituir funciones: hacerla con poco uso;
- **no tiene vuelta atrás automática**. Si hiciera falta volver, el código anterior funciona con las tablas nuevas presentes, porque solo añaden, así que basta un `revert` del código, sin tocar la base;
- la cuota del plan Free: las tablas nuevas empiezan vacías.

### 21.2 Service worker (D86)
| Aspecto | Comportamiento |
|---|---|
| Qué guarda | El HTML de 19 rutas prerenderizadas (la lista coincide con las páginas estáticas de la app, comprobado por `sw.test.ts`) y los ficheros con hash que esas páginas usan, más `offline.html` |
| Qué nunca guarda | Respuestas de Supabase u otros orígenes; peticiones que no sean `GET`; `/auth`; `/api`; RSC (`RSC: 1` o `_rsc`); peticiones con `Authorization`; redirecciones (una sesión caducada que lleva a `/login`); cookies (no se guardan cabeceras salvo tipo, seguridad y versión) |
| Datos del usuario | Siguen en IndexedDB y localStorage, que el SW no lee ni escribe. La cola offline y los estados «Guardado en este dispositivo» y «Sincronizado» no cambian |
| HTML | Primero la red. Sin red, la página guardada de esa ruta, sea cual sea la consulta (`?id=`, `?q=`). Para una ruta no preparada, `offline.html`, sin datos y con «Ir al inicio» y «Reintentar» |
| Preparación | La app, ya arrancada con red, pide al SW que prepare el shell (`top:warm`) a los 3 s |
| Versiones | `/sw.js?v=<versión>` (el commit en CI y Vercel). Una versión nueva se instala, activa su caché y borra solo las `top-shell-*` antiguas. Las páginas guardadas son siempre de una sola versión, la más reciente vista |
| Recuperación | Con red, todo vuelve a la red y la cola se envía como siempre |
| Cabeceras | `/sw.js` con `Cache-Control: no-cache, no-store, must-revalidate`. El proxy no lo intercepta, ni tampoco `offline.html` |
| Límite | **Una instalación nueva necesita una primera carga con conexión.** Las rutas dinámicas (`/reviews/[tipo]/[inicio]`) no se preparan y sin red muestran `offline.html` |

**Pruebas específicas** (`e2e/offline.spec.ts`, 5 casos × 2 tamaños, **10/10**):
1. **Demo**:
   - un dispositivo preparado arranca sin red en otra ruta;
   - navega a Libros y a una ficha y captura una idea;
   - recarga sin red y sigue la idea;
   - busca sin red;
   - una ruta no preparada muestra `offline.html`;
   - con red, vuelve a la normalidad.
2. **Privacidad**:
   - solo se guarda este origen y nada de `/auth`, `/api`, RSC, REST ni realtime;
   - sin `set-cookie`;
   - las páginas guardadas solo tienen las cabeceras permitidas;
   - el HTML guardado no contiene datos de la demo.
3. **Versiones**:
   - una versión nueva sustituye el shell entero y borra solo su propia caché antigua;
   - una caché ajena sigue intacta;
   - una página de otra versión se descarta.
4. **Cuenta**:
   - arranca sin red con la copia local;
   - la píldora no dice «Sincronizado»;
   - una idea capturada dice «se enviará al recuperar la conexión» y no llega a la base de datos hasta que vuelve la red, y entonces llega **una vez**;
   - el HTML guardado no contiene datos de la cuenta.
5. **Sin sesión**: la redirección a `/login` nunca se guarda como página.

### 21.3 Diagnóstico en el iPhone (procedimiento; **todavía no ejecutado por ti**)
`/dev/knowledge` solo existe con `next dev`: con un build de producción responde **404** (comprobado). Usa datos sintéticos en una base de IndexedDB propia que se borra al terminar. Ahora compara cada resultado con la referencia de Chromium de escritorio (×1 y ×4) y llama p50 a la mediana.

**Antes de empezar**
- El PC y el iPhone en la **misma red Wi-Fi privada** (la de casa, no una pública).
- Sin túneles ni exposición a internet: el servidor solo escucha en la red local.
- `next.config.ts` ya admite orígenes de redes privadas (`allowedDevOrigins`) solo en desarrollo.

**Pasos**
1. En el PC, averigua su IP local: `ipconfig`, «Dirección IPv4» del adaptador Wi-Fi, por ejemplo `192.168.1.40`.
2. En la carpeta del proyecto, ejecuta: `npx next dev -H 0.0.0.0 -p 3000`.
3. Si Windows pregunta por el firewall, permite el acceso **solo en redes privadas** (nunca en públicas).
4. En el iPhone, abre Safari y entra en `http://192.168.1.40:3000/login` (con tu IP). Pulsa **«Explorar la demo sin cuenta»**. No inicies sesión con tu cuenta: el diagnóstico no la necesita.
5. Abre `http://192.168.1.40:3000/dev/knowledge`. La primera carga en modo desarrollo tarda unos segundos.
6. Pulsa **«Medir con 5.000 notas»** y espera a «1 medición(es) hechas». La pantalla puede no responder mientras mide.
7. Pulsa **«Medir con 10.000 notas»**.
8. **Apunta** (o haz una captura de pantalla) por cada medición:
   - tecleo p50 y p95, con su ✓ o ✗ frente a 100 ms;
   - índice de una vez y por tramos;
   - editar, mover y renombrar (incremental);
   - la tabla de consultas (p50 y p95), incluidas las filas «Filtros: …»;
   - la tabla «Este dispositivo frente a Chromium de escritorio».
9. Pulsa **«Copiar resultados (JSON)»** y pégalos donde quieras guardarlos. Incluyen el modelo del navegador y el número de núcleos, no datos personales.
10. Pulsa **«Borrar datos sintéticos»** por si una medición se interrumpió. Después cierra el servidor con Ctrl+C en el PC.

**Al interpretarlo**
- **Safari no ofrece `performance.memory`**: la memoria aparecerá como N/D.
- El modo desarrollo no afecta a las funciones medidas (el índice y la búsqueda son JavaScript puro), aunque la página tarde más en abrir.
- Si el p95 del tecleo con 5.000 notas supera 100 ms, la propuesta es la de §20.8 (un Worker solo para la primera construcción), **antes** de añadir nada más.

### 21.4 Resultados (30/10/2026)
| Prueba | Resultado |
|---|---|
| `npm run check` | 46 archivos, **513/513** (incluye `sw.test.ts`) |
| Integración con PostgreSQL local | 8 archivos, **145/145** |
| `test:browser` en modo CI, con la puerta `--expect 6` | **6/6** ✓ |
| E2E completa en modo CI (`CI=1`, servidor gestionado por Playwright y la puerta estricta), **por proyecto** | Móvil: **144 superadas, 25 omitidas, 0 fallos, 0 inestables**; 169/169 listadas ejecutadas.<br>Escritorio: **167 superadas, 2 omitidas, 0 fallos, 0 inestables**; 169/169 listadas ejecutadas.<br>Total: **311 superadas y 27 omitidas deliberadas de 338**. Las 20 specs tienen al menos una prueba superada |
| `e2e/offline.spec.ts` (service worker) | **10/10** (incluidas en el total) |
| `npm run smoke` (local) | **22/22** |
| `/dev/knowledge` en producción | 404 |
| `/dev/knowledge` con `next dev` (Chromium, 5.000 notas) | Funciona, 0 errores y sin base sintética al terminar. Tecleo p95 6,0 ms frente a 5,6 ms de la referencia |

**Incidencias del entorno Windows** (las mismas de M3.2d, 0xC0000409):
1. Una ejecución completa con las dos plataformas a la vez falló a partir de la prueba 199. El servidor `next start` gestionado por Playwright murió sin dar error, y todas las siguientes recibieron conexión rechazada (138 fallos, todos de escritorio).
2. En la primera ejecución por proyecto, en escritorio, el *worker* de Playwright murió (`code=3221226505` = 0xC0000409). La prueba pasó al reintentar y quedó marcada como inestable. La repetición del proyecto salió limpia.

En los dos casos el problema es el proceso Node de Windows, no la aplicación. La CI de Linux no lo ha mostrado nunca (M3.2d, M3.3 y M3.4).

### 21.5 CI preparada (D87; no ejecutada)
- `ci.yml` añade:
  - **«Browser tests (IndexedDB)»** con el criterio *exactamente 6*;
  - **«E2E list»** antes de la suite, para la puerta `--list --repeat --skips` con `E2E_SKIPS_PER_PASS=27`.
- Comprobado en local: el YAML es válido, las dos puertas pasan sobre informes reales y la puerta detecta un recuento que no cuadra.
- Sin cambios en el resto:
  - Supabase efímero dentro del runner;
  - aislamiento (sin secretos del repositorio ni credenciales de la nube);
  - acciones fijadas por SHA;
  - revisión de secretos de los informes antes de subirlos;
  - runner estándar `ubuntu-24.04`;
  - dos pasadas en `ci/**`;
  - Vercel ignora `ci/**`.
- Los informes no llevan datos de Git (`captureGitInfo` desactivado, también en `test:browser`) y las capturas solo existen en los fallos, con cuentas sintéticas.

### 21.6 Privacidad del repositorio (D88)
- **Documentos vigentes**: 0 apariciones del correo personal en los ficheros con seguimiento.
- **Identidad para los commits futuros** (solo en la configuración local de este repositorio): `282313697+danimendi7@users.noreply.github.com`. Es el formato oficial de GitHub; el id y el login se obtuvieron en modo lectura de la API. La configuración global no existe y no se ha creado.
- **Riesgo residual**:
  - el correo sigue en el campo de autor de los **50 commits** ya publicados en `main`;
  - también en el texto de 4 commits antiguos, y en las líneas borradas de `baa16a4`, que es el commit que lo quitó;
  - el repositorio es **privado**, y ningún artefacto de CI lleva datos de Git desde M3.4e.
- **Artefacto antiguo** `12963160670` (contiene el correo): sigue sin borrar a la espera de tu autorización.
- Si algún día el repositorio pasara a público, la solución sería reescribir el historial (opción B, con su `push --force`), y solo con tu autorización.
- **Comprobación pendiente en la etapa B**: en el plan Hobby, Vercel despliega los commits cuyo autor está asociado a la cuenta de GitHub conectada. La dirección `noreply` lo está, pero conviene confirmar el primer despliegue con ella.

### 21.7 Riesgos residuales
1. **Windows (0xC0000409)**: las ejecuciones largas en este PC pueden morir. La validación definitiva es la de GitHub Actions (Linux).
2. **Service worker**:
   - una instalación nueva necesita red;
   - las rutas dinámicas no se preparan;
   - en iOS, Safari puede borrar las cachés de una web que no se usa durante semanas. Los datos de IndexedDB tienen sus propias reglas (y siguen en la nube si se usa una cuenta).
3. **Una pestaña antigua abierta durante un despliegue** puede pedir un fichero de la versión anterior después de que el SW nuevo borre su caché. Con red se sirve desde Vercel si todavía existe; si no, la página pide recargar.
4. **Rendimiento en el iPhone**: sin medir (§21.3).
5. **Migración sin vuelta atrás automática** (ver §21.1). Mitigada: es aditiva y el código anterior funciona con ella.

### 21.8 Siguientes autorizaciones
**A. Validación remota** (necesita tu autorización)
1. Comprobación de partida, solo lectura: `origin/main` sigue en `85fd1a0`, la nube tiene 10 migraciones y `vercel.json` excluye `ci/**`.
2. Subir **solo** la rama `ci/m4`, apuntando al commit de esta etapa: `git push origin <commit>:refs/heads/ci/m4`. Sin tocar `main`.
3. El *push* lanza el workflow, con 2 pasadas en `ci/**`:
   - unitarias e integración con su puerta;
   - `test:browser` (exactamente 6);
   - E2E con 2 pasadas y recuento exacto (2 × 338 listadas; 54 omitidas);
   - smoke;
   - revisión de secretos.
4. Leer el resultado con `gh-api.mjs`, en solo lectura:
   - todas las puertas en verde, 0 inestables;
   - la duración;
   - **ningún** despliegue de Vercel en `ci/m4`;
   - el artefacto sin correo ni datos de Git.
5. Si algo falla: diagnóstico y corrección en local, y un nuevo *push* a `ci/m4` solo con tu permiso.
6. `main`, Vercel y la nube no se tocan en ningún momento.

**B. Despliegue** (necesita otra autorización, después de A)
1. **Copia nueva** cifrada de Supabase Cloud (`npm run backup`, con el token propio por variable de entorno y nunca la sesión global de la CLI).
2. **Restauración aislada** en el stack de simulacro (`npm run restore:drill -- <copia.topbak> --schema-at 20261031090000`). Comprobar que las 17 tablas y sus filas coinciden.
3. **Ensayo**: aplicar `20261101090000_library.sql` sobre esa restauración y repetir `upgrade.spec.ts` y el smoke contra ella. Destruir el simulacro.
4. **Revisión previa**: `npm run cloud -- db push --dry-run`. Debe anunciar exactamente una migración: `20261101090000_library.sql`.
5. **Aplicar solo esa migración**. Después, en solo lectura:
   - 11 migraciones;
   - las 4 tablas con RLS;
   - la publicación realtime;
   - `pull_library` con `p_skip_deleted_upto`;
   - `apply_ops` y `pull_changes` iguales al fichero.
6. **Publicar en `main` exactamente el commit validado en A** (`git push origin <commit>:refs/heads/main`), sin cambios entre medias.
7. **Comprobar**: Vercel en verde, smoke de producción y CI de `main` en verde. Después, borrar `ci/m4`.
8. **Pruebas manuales** entre tu móvil y tu ordenador. Te prepararé una guía de 10 casos:
   - libro con solo el título;
   - idea sin red en el móvil que aparece sola en el ordenador;
   - edición en vivo;
   - «Guardar las dos»;
   - borrar con «Deshacer»;
   - búsqueda sin red;
   - filtros que sobreviven a recargar;
   - conectar y mover;
   - aplicaciones;
   - **arranque en frío sin red** después de una primera carga.

   Además, el diagnóstico del iPhone (§21.3).
9. **Vuelta atrás** preparada antes de empezar: `revert` del código en `main`, sin tocar la base, porque la migración es aditiva.


## 22. M4f · Etapa 2: validación remota en `ci/m4` (31/10/2026)

### 22.1 Antes de subir la rama
- Árbol limpio y HEAD en `027f219`.
- `origin/main` en `85fd1a0`, comprobado con `git ls-remote`, sin cambiar referencias locales. `ci/m4` no existía.
- `85fd1a0` es antecesor de HEAD, es decir, avance directo. Los 11 commits solo tocan ficheros de este proyecto.
- En el diff final no hay secretos, correos, rutas personales ni referencias a Uría en código, scripts o workflow.
- `ci.yml`:
  - se ejecuta en `ci/**`;
  - incluye `test:browser`;
  - no lee `secrets.*` ni `vars.*`.
- `vercel.json`: `ci/**` desactivado.
- Presupuesto: unos 160 minutos de Linux en octubre (14 ejecuciones), dentro de los ~2.000 incluidos para un repositorio privado. La facturación no se consultó, porque necesita otro permiso.

### 22.2 Ejecución
**Rama y commit**: solo `git push origin 027f219:refs/heads/ci/m4`. `main` quedó en `85fd1a0`.

**Run** [41183910815](https://github.com/danimendi7/the-one-percent/actions/runs/41183910815), sobre `027f219`: **suspendido** en la E2E, de 32 minutos. Duración total de unos 37 minutos.

| Paso | Resultado |
|---|---|
| Typecheck y lint | ✓ |
| Unitarias | ✓, 46 ficheros con la puerta superada |
| Supabase efímero y aislamiento | ✓ |
| Integración | ✓, 8 ficheros con la puerta superada |
| `test:browser` | ✓ 6/6, con la puerta `--expect 6` |
| Listado E2E | ✓ |
| E2E (2 pasadas, 684 ejecuciones) | **✗**: 615 superadas, 54 omitidas (exactamente las esperadas), **4 fallidas y 3 inestables** |
| Smoke | Sin ejecutar (el paso anterior falló) |
| Revisión de secretos y subida del artefacto | ✓; artefacto `e2e-41183910815-1`, de 18 MB, que caduca el 30/11 |

**Sin despliegues**: GitHub no muestra ningún *deployment* ni estado de Vercel para `ci/m4` ni para `027f219`.

### 22.3 Diagnóstico (con los registros y las trazas del artefacto)
1. **`library.spec.ts` · «with no connection…» (4 fallos y 1 inestable). Fallo de la prueba.**
   - En el *runner*, Next empezó a precargar `/knowledge/library/books` e `/item` 1,4 s después de cargar la página. Para entonces la prueba ya había esperado a `networkidle` y había cortado la red: esas peticiones salieron con `-1`.
   - Reproducido en local con la CPU ×6: la espera antigua falla 3 de 3.
   - Corrección: esperar a que esas precargas **terminen** (`requestfinished`, con el cuerpo completo) antes de cortar la red. Con la CPU ×6 pasa 3 de 3, y en condiciones normales, 10 de 10.
   - Producción no se ve afectada: el service worker cubre además el arranque sin red.
2. **`screen-error.spec.ts` · Objetivos (1 fallo y 2 inestables). Fallo real del motor (D89).**
   - En la página nueva, la traza muestra que el WebSocket de realtime conectó y, 34 ms después, salió un `pull_changes`, **sin ningún `apply_ops`**: el ciclo lanzado por el canal empezó antes de que `start()` leyera la cola guardada.
   - Ese ciclo no tenía nada que enviar y se quedó esperando la descarga, que la prueba retiene a propósito. El cambio pendiente quedaba para el ciclo siguiente.
   - Reproducido con una prueba unitaria (`engine-startup.test.ts`), que falla sin la corrección y pasa con ella (mutación comprobada).
   - No se perdieron datos: la cola seguía guardada. Pero el envío se retrasaba y ese ciclo prematuro trabajaba sobre un estado vacío.
3. **Durante la revisión local apareció una tercera incidencia, también de la prueba** (no falló en CI).
   - `offline.spec.ts` exigía que el service worker **controlara** la página en curso.
   - Si la navegación empieza mientras el SW todavía se está activando, esa página queda sin controlar hasta la siguiente, como es normal en el navegador.
   - Ahora la prueba espera a que el SW esté **activado**. El arranque sin red es una navegación nueva y siempre pasa por él.
   - 30/30 sin reintentos.

### 22.4 Validación local de las correcciones
| Prueba | Resultado |
|---|---|
| `npm run check` | 47 ficheros, **514/514** (+1, `engine-startup.test.ts`) |
| Integración | **145/145** |
| `test:browser` en modo CI | **6/6**, con la puerta |
| E2E completa en modo CI, por proyecto, con la puerta estricta | Móvil **144 + 25 omitidas**; escritorio **167 + 2 omitidas**; **0 fallos, 0 inestables, 338/338 listadas ejecutadas** |
| Smoke | **22/22** |

**Una ejecución intermedia** en escritorio murió de nuevo por el problema de Windows (0xC0000409): 322 conexiones rechazadas desde un punto de la ejecución. La repetición salió limpia.

### 22.5 Estado
- `027f219` **no queda validado**.
- Las correcciones van en un commit local nuevo, encima de `027f219`.
- Para validarlo hace falta tu autorización para un nuevo `push` de avance directo a `ci/m4` (sin forzar: `git push origin <nuevo>:refs/heads/ci/m4`).
- El plan de despliegue de §21.8 (B) no cambia, salvo que el commit validado será ese nuevo.

### 22.6 Segunda investigación: causa raíz y regresiones deterministas
Encargo del 31/10: reproducir y resolver los dos escenarios sin rebajar las exigencias de la CI. Se trabajó encima de `22ca94d`, el commit local de §22.5, y no sobre `027f219`. No hubo `push` ni ejecuciones remotas.

**Evidencias de la ejecución 41183910815**
| Prueba | Pasada | Móvil | Escritorio |
|---|---|---|---|
| `library.spec.ts:214`, navegación sin red | 1.ª | Fallo; pasa en el reintento | Fallo y fallo |
| | 2.ª | Fallo y fallo | Fallo y fallo |
| `screen-error.spec.ts:21`, Objetivos | 1.ª | Fallo y fallo | Fallo; pasa en el reintento |
| | 2.ª | Fallo; pasa en el reintento | Pasa |

Total: 4 fallidas y 3 inestables.

En todos los fallos de Objetivos se repite lo mismo:
- el fallo está en la línea 75, y la aserción es `habit_entries` = 0 en lugar de 1;
- el aviso de pantalla y la carcasa aparecen bien.

En los 7 intentos fallidos de la Biblioteca, el error es `toBeVisible` del título «Libros» tras el clic sin red: la precarga de Libros no había terminado. El *runner* tiene 4 CPU y es más lento que el PC.

**1. Navegación sin red (Biblioteca).**
- El cliente de Next solo navega sin red a una ruta cuya precarga RSC terminó con conexión.
- Si la petición de datos falla, Next hace una navegación de navegador completa (`fetch-server-response.js`: «Falling back to browser navigation»). En producción, esa navegación la atiende el service worker con la carcasa preparada (§21, D86).
- `library.spec` funciona con el service worker bloqueado (`playwright.config.ts`). Lo que comprueba es el camino del cliente, que depende de la precarga.
- **La espera de §22.3 era insuficiente.** La encontró la comprobación en Linux: 4 fallos de 10 en móvil, ahora en la página del libro y no en Libros.
  - Esa espera aceptaba la *primera* precarga de `/item` que terminase, que es el árbol de `item?id=<otro libro>`.
  - Un libro que nunca se precargó por su propia URL se construye con el árbol de `/knowledge/library/item` **sin parámetros** (`segment-cache/cache.js`), que Next pide con **prioridad de fondo**, la última (`scheduler.js`, `pingRoute`).
  - Con la CPU ×6, la espera de §22.3 falla 6 de 6. **El «3 de 3» de §22.3 no era representativo.**
  - Corrección (`a9f75d9`): esperar al árbol y al segmento de página de Libros, y al árbol sin parámetros y al segmento de página de `item`. Con la CPU ×6 pasa 6 de 6 en móvil y 16 de 16 en móvil y escritorio.
- **Regresión nueva** en `offline.spec.ts`: «links work offline even when Next could not prefetch them».
  - Con el service worker activo, **se rechazan todas las peticiones RSC**, así que no hay ninguna precarga.
  - Después se corta la red y se navega desde la app: Biblioteca → Libros → un libro (`item?id=`) → captura de una idea → Libros → Biblioteca → Cerebro.
  - Una recarga sin red sigue mostrando la idea.
  - La prueba confirma que la app pidió los datos de `books` y de `item` y no los recibió.
  - Resultado: 12/12 en el primer intento y 30/30 en repetición, en móvil y escritorio.
- **Privacidad**: el service worker sigue sin guardar RSC, `/auth`, `/api`, Supabase ni cookies. Lo comprueba la prueba de privacidad, que no se ha tocado.
- **Límite que sigue existiendo**: un dispositivo que todavía no tiene el service worker activado (la primera visita) y que pierde la red antes de terminar la precarga no puede abrir una ruta que nunca recibió. No hay nada que servir, y la app lo dice.

**2. Objetivos con error de pantalla (D89).**
- La traza demostró la carrera, pero en el PC la E2E no la reproducía: con el motor anterior pasó 30 de 30, porque IndexedDB abre muy deprisa.
- **Regresión determinista**: una segunda variante de la puerta permanente abre la copia del dispositivo («the-one-percent») 2,5 s más tarde, como en un móvil lento. Los datos no se tocan y la variante original sigue igual.
  - Con el motor de `027f219`: **6 de 6 fallan con el error exacto de la CI**, en la misma aserción, con 0 en lugar de 1.
  - Con D89: 60 de 60 en repetición (las dos variantes, ×10, en móvil y escritorio).
- Comprobaciones pedidas:
  - **Cola encolada y guardada**: `queued` = 1 antes de cerrar la página.
  - **El motor no se detiene al fallar la pantalla**: la frontera está bajo la carcasa (`error.tsx`) y el motor vive en el proveedor de la carcasa.
  - **Sin ciclos concurrentes ni duplicados**: `engine-startup.test.ts` comprueba un solo envío y una sola descarga para las dos peticiones de arranque.
  - **Exactamente una vez en el servidor**: `sync_operations` `entry.set` = 1 y la cola local vacía al final.
  - **Usuario correcto**: cuenta nueva por prueba (`newAccount`) y consultas por `user_id`; se borra en `afterEach`.
- Nueva prueba unitaria: la cola guardada sobrevive a un primer ciclo sin servidor y después se envía una sola vez.
- **Con el motor anterior no se perdían datos**: `persist()` fusiona con la cola guardada antes de escribir (M3.4d). El problema era el retraso del envío, no la pérdida.

**3. Linux.** `npm run e2e:linux` admite ahora una comprobación dirigida: `--only <specs> --repeat-each N --cpus N`, sin reintentos. Usa el mismo contenedor desechable y el mismo aislamiento que D46. La suite completa no cambia.

**Resultados de Linux** (contenedor desechable, 4 CPU, 2 workers, ×10, sin reintentos; especificaciones `library.spec.ts:214`, `screen-error.spec.ts` y `offline.spec.ts`)
- **`c9a17eb`: 195 de 200 superadas y 5 fallos.**
  - **4 en `library.spec`**, en móvil, en la página del libro. Es la espera insuficiente explicada arriba; la corrige `a9f75d9`.
  - **1 en `offline.spec`**: «signed out», que se agotó a los 30 s en el `beforeEach` (`newAccount`), antes de abrir la app.
    - En los registros de Auth, todas las `createUser` de la ventana respondieron 200 y la más lenta tardó 144 ms: el tiempo se perdió antes de llegar a Auth, en el `insert` de Postgres o en el reenvío TCP del contenedor a `host.docker.internal`.
    - El helper no ha cambiado desde M3 y no falló en ninguna de las 684 ejecuciones de la CI.
    - **No reproducido.** Falta el desglose de tiempos dentro de `newAccount`. Prueba propuesta: la próxima CI, que no usa reenviador.
  - `screen-error.spec` completo: **60 de 60** (Objetivos en sus dos variantes, 40 de 40; la página dañada de la Biblioteca, 20 de 20). Service worker, incluida la prueba nueva sin precarga: 119 de 120; el único fallo es el anterior. Servidor vivo durante toda la ejecución.
- **`a9f75d9`: sin resultado.** Claude Code detuvo la comprobación por falta de memoria en el PC mientras compilaba.
  - El contenedor quedó vivo y lo **detuve** (`docker stop`) sin borrarlo; la red también sigue ahí. La próxima ejecución del script retira ambos por su etiqueta.
  - No se relanzó.

### 22.7 Continuación de la validación local (31/10, tarde)
**Recursos.** El contenedor detenido `top-e2e-linux-20261031-143026` y su red se retiraron después de comprobar que eran del script:
- tenían su etiqueta y su patrón de nombre;
- la hora de creación era la de la ejecución interrumpida;
- no tenían volúmenes ni otros contenedores conectados;
- solo contenían el archivo del commit, registros de una compilación cortada y las herramientas del script.

No se tocó ningún otro contenedor; siguen los 17 habituales.

**Validación Linux dirigida de `800900d`: sin resultado.**
- Se lanzó con un vigilante de memoria que solo detiene los contenedores con la etiqueta del script.
- Con 3,0 GB libres al empezar, la memoria libre del PC bajó a 684 MB durante la ejecución de las pruebas, y el vigilante detuvo el contenedor. El script lo retiró junto con su red.
- No se copiaron resultados.
- Después quedaron 1,4 GB libres. Lo que ocupaba la memoria: WSL con 4,5 GB, que retiene tras el contenedor; Chrome con 2,9 GB; Claude Code con 1,7 GB.

**`newAccount` instrumentado** (`e2e/support/account.ts`):
- mide cinco etapas: estado local, conexión a Postgres, `insert`, cierre y `createUser`;
- avisa cuando la creación pasa de 3 s;
- si el `beforeEach` se agota, `afterEach` dice en qué etapa se quedó y cuánto llevaba, y borra la fila de la lista de permitidos que dejó a medias.

Antes, el `afterEach` fallaba con `TypeError` (sin cuenta), tapaba el error original y dejaba esa fila. Solo se registran nombres de etapa y milisegundos.

Hallazgos de la revisión:
- `localStatus()` ejecuta `npx supabase status` de forma **síncrona** la primera vez en cada proceso *worker*, y Playwright arranca uno nuevo tras cada fallo.
- `pg.Client` no tiene límite de conexión.

Son candidatos, **no causas demostradas**. La causa no está identificada, porque no se ha reproducido.

**Pruebas en este punto**
| Prueba | Resultado |
|---|---|
| `npm run check` | 515/515 |
| Integración y `test:browser` | Sin repetir: no ha cambiado nada que cubran desde las ejecuciones de 145/145 y 6/6 |
| E2E completa en modo CI y smoke | **Pendientes**: no hay memoria para compilar Next y ejecutarlas con margen |

**M4f no está validada.**
