# THE ONE PERCENT — Plan Maestro del Producto

> Conversión de `THE_ONE_PERCENT_Plan_Maestro_DESCARGA.docx` (edición de noviembre de 2026; sha256 `dad7b8be…a25a3d`; el original está en la rama `respaldo/sin-confirmar-20261109-1105`). Texto y tablas sin cambios: es la referencia funcional principal del proyecto.

PRODUCT STRATEGY / MASTER DOCUMENT

THE ONE PERCENT

Become 1% better every day.

## PLAN MAESTRO DEL PRODUCTO

Visión · Funcionalidades · Arquitectura · Experiencia de usuario · Roadmap · Estado de desarrollo

Edición consolidada | Noviembre de 2026

Documento dedicado exclusivamente a THE ONE PERCENT. Integra la visión inicial y las decisiones de producto posteriores, distinguiendo planificación y funcionalidades verificadas.

# Índice de contenidos

01 Resumen ejecutivo y visión

02 Principios y criterios de producto

03 Diseño y experiencia de usuario

04 Mapa de módulos y relaciones

05 Especificación funcional de módulos

06 Capacidades transversales

07 Arquitectura tecnológica y privacidad

08 Roadmap estratégico de siete fases

09 Evolución técnica y milestones

10 Estado funcional y próximos bloques

11 Criterios de calidad y versión estable

12 Matriz de trazabilidad y decisiones

13 Resultado esperado y próximos pasos

Nota de lectura: «implementado», «en desarrollo» y «pendiente de verificar» se emplean de forma deliberada; la existencia de un commit no equivale a una validación de producción.

# 01 · Resumen ejecutivo y visión

THE ONE PERCENT es un sistema operativo personal de mejora continua. Su finalidad es reunir en una sola aplicación los hábitos, las metas, la concentración, el aprendizaje y las variables de bienestar; transformar esos registros en analítica útil; y, progresivamente, convertir la información en recomendaciones personalizadas.

La ambición original va más allá de una aplicación de seguimiento de hábitos: el producto debe ayudar a decidir qué mantener, qué modificar y dónde concentrar el esfuerzo para mejorar de forma sostenida.

## Propuesta de valor

- Ejecución: registrar hábitos y actividades con la mínima fricción.
- Medición: visualizar resultados, consistencia y evolución con indicadores interpretables.
- Comprensión: detectar patrones y relaciones entre diferentes dimensiones de la vida.
- Optimización: proponer experimentos y ajustes basados en evidencia personal.

## Definición de producto

| Dimensión | Decisión |
| --- | --- |
| Nombre | THE ONE PERCENT |
| Posicionamiento | Personal Life Operating System |
| Usuario inicial | Uso personal; arquitectura modular y extensible |
| Plataformas | Escritorio y móvil mediante web app instalable (PWA) |
| Identidad visual | Dark Performance: minimalista, oscura y orientada a datos |
| Principio central | La mejora depende de sistemas consistentes, no solo de objetivos |
| Estrategia | Consolidar el núcleo; ampliar módulos; añadir inteligencia sobre datos fiables |

# 02 · Principios y criterios de producto

1. Simplicidad de entrada, profundidad de análisis: registrar una acción debe ser rápido; analizar sus consecuencias puede ser sofisticado.
2. Un único modelo de información: los módulos comparten datos consistentes, evitando silos y duplicidades.
3. Integridad primero: ningún guardado, cambio de pantalla o reconexión debe perder datos silenciosamente.
4. Offline-first cuando corresponda: mantener operativa la aplicación sin conexión y sincronizar después de forma segura.
5. Diseño centrado en decisiones: cada indicador debe poder orientar una acción, no solo decorar una pantalla.
6. Privacidad y control: los datos personales requieren autenticación, autorización y mecanismos de recuperación.
7. Evolución modular: las nuevas capacidades deben añadirse sin degradar las funcionalidades existentes.
8. IA prudente: no presentar correlaciones como causas ni recomendaciones sin suficiente evidencia.

# 03 · Diseño y experiencia de usuario

La identidad visual definida es Dark Performance: fondos oscuros, jerarquía tipográfica clara, componentes compactos, visualizaciones legibles y una estética tecnológica sobria. La interfaz debe transmitir control y claridad, no sobrecarga.

## Experiencia por dispositivo

- Escritorio: navegación lateral, visión global de indicadores y espacio suficiente para gráficos y análisis.
- Móvil: navegación simplificada, acceso inmediato al check-in y acciones frecuentes; diseño adaptado a uso cotidiano.
- PWA: experiencia instalable, tiempos de respuesta reducidos y funcionamiento coherente entre dispositivos.
- Accesibilidad: contraste suficiente, controles utilizables con teclado y táctil, estados de carga y error explícitos.

## Interacciones esenciales

Completar un hábito, registrar energía o añadir una nota no debe exigir navegar por varias pantallas. Los estados de sincronización y cualquier dato pendiente de guardar tienen que mostrarse con claridad, evitando avisos que desaparezcan antes de que la información sea persistente.

# 04 · Mapa de módulos y relaciones

La estructura funcional incluye ocho grandes áreas de trabajo y una capa transversal de inteligencia personal. El Command Center actúa como punto de entrada; Habit Engine aporta una parte fundamental de los registros; Life Analytics los relaciona con el resto de los módulos.

| Área | Propósito | Principales conexiones |
| --- | --- | --- |
| Command Center | Visión diaria y navegación | Todos los módulos |
| Habit Engine | Rutinas y consistencia | Goals, Analytics, Reviews |
| Life Analytics | Tendencias y patrones | Hábitos, energía, Deep Work, conocimiento |
| Goals & Systems | Objetivos vinculados a procesos | Hábitos, revisiones |
| Deep Work | Concentración y productividad | Analytics, energía, objetivos |
| Knowledge OS | Libros, podcasts e ideas | Aprendizaje, Reviews, IA |
| Mind & Energy | Sueño, energía, ánimo, estrés | Analytics, hábitos |
| Life Review | Reflexión y ajustes periódicos | Goals, Analytics, hábitos |
| AI Intelligence | Interpretación y recomendaciones | Capa transversal; fase avanzada |

# 05 · Especificación funcional de módulos

## 5.1 Command Center · Centro de control

Objetivo: mostrar de un vistazo qué requiere atención hoy, qué ha avanzado y qué tendencias merecen revisión.

- Resumen de hábitos completados, pendientes y descansos planificados.
- Porcentaje de cumplimiento del día; evolución semanal y móvil de 30 días.
- Progreso de objetivos e hitos; acceso a sesiones de concentración.
- Resumen de check-ins: sueño, energía, ánimo y estrés.
- Atajos a biblioteca, revisiones y tareas relevantes; avisos no intrusivos.

Criterio de calidad: el panel debe distinguir ausencia de datos, descanso legítimo, incumplimiento y error de sincronización.

## 5.2 Habit Engine · Motor de hábitos

Objetivo: convertir los comportamientos deseados en un registro fiable, sencillo de mantener y útil para evaluar consistencia.

- Creación, edición, organización y archivo de hábitos.
- Frecuencia configurable y calendario de días previstos.
- Registro rápido de cumplimiento y descansos programados.
- Historial consultable, con auditoría de cambios cuando proceda.
- Rachas, tasa de cumplimiento, tendencia semanal y rolling 30D.
- Sincronización entre dispositivos y funcionamiento offline.

Regla clave: un descanso programado no debe computarse de forma automática como un incumplimiento. Las métricas deben explicitar su denominador.

## 5.3 Life Analytics · Inteligencia de datos

Objetivo: transformar registros diarios en conocimiento sobre tendencias, consistencia y posibles relaciones entre variables.

| Nivel | Preguntas / funciones |
| --- | --- |
| Descriptivo | ¿Qué ocurrió? Series temporales, heatmaps, comparaciones y tendencias. |
| Diagnóstico | ¿Qué factores se relacionan? Cruces entre hábitos, sueño, estrés, energía y foco. |
| Predictivo | ¿Qué podría ocurrir? Proyecciones prudentes sujetas a datos suficientes. |
| Prescriptivo | ¿Qué conviene probar? Ajustes y experimentos medibles, posteriormente apoyados por IA. |

Dimensiones: consistencia, rendimiento de hábitos, objetivos, concentración, aprendizaje, equilibrio y recuperación. Las asociaciones estadísticas deben presentarse sin atribuir causalidad automáticamente.

## 5.4 Goals & Systems · Objetivos y procesos

Objetivo: vincular resultados aspiracionales con conductas concretas y revisables.

- Objetivos medibles con métricas, hitos y fechas cuando tengan sentido.
- Vinculación de hábitos y sistemas cotidianos a cada objetivo.
- Progreso real frente a progreso esperado.
- Revisión de obstáculos y ajuste de procesos, no solo de metas.
- Vista de objetivos activos, completados, archivados y en revisión.

Ejemplo: un objetivo anual de lectura se relaciona con un hábito diario de lectura y con los libros registrados en Knowledge OS.

## 5.5 Deep Work · Concentración

Objetivo: fomentar sesiones de atención sostenida y analizar el tiempo de trabajo de calidad.

- Temporizador y registro de sesiones por proyecto, tarea o área.
- Duración prevista y efectiva; anotación de interrupciones.
- Evaluación opcional de calidad percibida.
- Estadísticas diarias, semanales y por proyecto.
- Cruces con sueño, energía, estrés y resultados de objetivos.

## 5.6 Knowledge Vault → Knowledge OS

Este módulo evolucionó desde un repositorio de aprendizaje hacia un sistema de conocimiento personal más completo. El alcance se amplió durante M4 y M4g.

### Biblioteca de libros

- Alta y búsqueda de libros, con metadatos y portadas automáticas cuando estén disponibles.
- Estados de lectura, progreso y organización de biblioteca.
- Notas, conceptos, ideas y aprendizajes asociados.
- Protección frente a duplicados y pérdida de registros durante navegación offline.

### Biblioteca de podcasts

- Registro de podcasts y episodios, con búsqueda asistida.
- Consulta de episodios recientes y antiguos, confirmación editable y controles de duplicados.
- Notas y seguimiento de contenido escuchado o pendiente.
- Recuperación de registros creados sin conexión.

### Cerebro y aprendizaje activo

- Espacio unificado para recopilar y relacionar ideas de distintas fuentes.
- Recuperación activa del conocimiento mediante repasos y preguntas, como capacidad prevista.
- Daily Discovery / Tema de hoy: descubrimiento y aprendizaje de contenidos relevantes.
- Preparación para análisis y recomendaciones futuras basadas en el conocimiento acumulado.

Estado conocido: el primer despliegue de M4 Knowledge OS se aceptó funcionalmente el 31/10/2026 tras comprobaciones manuales. M4g, los requisitos de M4g.5 y las correcciones offline requieren una validación final de alcance y pruebas.

## 5.7 Mind & Energy · Bienestar y autoconocimiento

Objetivo: disponer de señales cotidianas que ayuden a interpretar el rendimiento y la sostenibilidad de las rutinas, sin convertir la aplicación en una herramienta diagnóstica.

- Check-in con sueño, energía, estado de ánimo, estrés y nota libre.
- Evolución por periodos, comparación y filtros.
- Cruces con cumplimiento de hábitos y sesiones de concentración.
- Detección de tendencias recurrentes y posibilidad de reflexión contextual.

## 5.8 Life Review · Revisiones

Objetivo: transformar el seguimiento en un ciclo de reflexión y mejora.

| Cadencia | Contenido |
| --- | --- |
| Diaria | Cumplimiento, observaciones y ajustes inmediatos. |
| Semanal | Tendencias, obstáculos, objetivos y prioridades para la semana siguiente. |
| Mensual | Patrones persistentes, equilibrio general y redefinición de sistemas. |

Los resúmenes automáticos podrán complementarse con revisiones manuales y decisiones registradas por la persona usuaria.

## 5.9 AI Intelligence · Capa transversal

La inteligencia artificial se concibe como una capacidad que utiliza los registros existentes, no como un chatbot aislado.

- Análisis de patrones y detección de cambios relevantes.
- Recomendaciones personalizadas sobre hábitos, foco, equilibrio y aprendizaje.
- Explicaciones basadas en datos, con grado de confianza y limitaciones.
- Propuesta de experimentos de mejora verificables.
- Priorizar reglas e indicadores deterministas cuando no exista suficiente evidencia.

Condición para avanzar: disponer de una base de datos consistente, permisos claros y un modelo de costes compatible con las suscripciones actuales, sin consumo adicional no autorizado.

# 06 · Capacidades transversales

## Motivation Engine y notificaciones

Se planteó una motivación contextual ligada al progreso real: reconocimiento de avances, apoyo al retomar rutinas y mensajes relevantes. Las notificaciones deberían priorizar recordatorios útiles y evitar fatiga o ruido.

## Sincronización y operación offline

El producto debe permitir registrar información sin red, persistirla localmente y sincronizarla posteriormente. La navegación y los mensajes de UI nunca deben sustituir la confirmación real de guardado.

## Integridad y recuperación

- Persistencia local previa a navegación cuando hay datos sin sincronizar.
- Estados de sincronización explícitos y reintentos controlados.
- Pruebas de reconexión, duplicados, conflictos y recuperación.
- Copias de seguridad y procedimientos de restauración verificables.

## Funcionalidad excluida del roadmap activo

Quedó descartada por decisión expresa la incorporación de un botón o mecanismo para bloquear Instagram Reels y YouTube Shorts. No debe reintroducirse sin una nueva decisión.

# 07 · Arquitectura tecnológica y privacidad

| Capa | Elección / criterio |
| --- | --- |
| Frontend | Next.js, React y TypeScript |
| Diseño | Tailwind CSS; componentes reutilizables; enfoque Dark Performance |
| Visualización | Gráficos y componentes analíticos (Recharts como referencia de la estrategia) |
| Datos y autenticación | Supabase / PostgreSQL, Supabase Auth y Row Level Security |
| Ubicación de infraestructura | Región de Supabase eu-west-2 |
| Acceso | Enlace mágico / OTP; lista de acceso autorizada |
| Emails | Resend |
| Hosting | Vercel |
| Versionado | GitHub |
| Aplicación móvil | PWA instalable |
| Persistencia local | IndexedDB, sincronización offline |
| Pruebas | Unitarias e integración con Vitest; end-to-end con Playwright |

Las decisiones de tecnologías concretas deben validarse con el repositorio cuando se prepare una especificación de implementación actualizada. El objetivo funcional permanece independiente de las herramientas empleadas para desarrollarlo.

## Privacidad y condiciones operativas

- Autenticación y control de acceso por usuario.
- Políticas RLS y separación entre entornos de desarrollo y producción.
- Protección de credenciales, registros y datos personales.
- Validación de operaciones de respaldo y restauración.
- Mantener un modelo económico sin créditos adicionales por API o Extra Usage salvo autorización expresa.

# 08 · Roadmap estratégico original de siete fases

| Fase | Propósito | Entregables esperados |
| --- | --- | --- |
| 1. Definición | Especificación del producto | Módulos, requisitos, métricas y criterios de aceptación |
| 2. Diseño | Sistema visual y prototipos | Dark Performance, navegación, componentes, responsive |
| 3. Núcleo | Datos, acceso y hábitos | Autenticación, modelos, Habit Engine e historial |
| 4. Analítica | Comprensión y objetivos | Life Analytics y Goals & Systems |
| 5. Extensiones | Módulos complementarios | Deep Work, Knowledge OS, Mind & Energy, Life Review |
| 6. Consolidación | PWA, seguridad y pruebas | Offline, sincronización, protección, respaldo, QA |
| 7. Inteligencia | Recomendaciones y evolución | AI Intelligence y preparación de versión estable |

Este orden era estratégico; las implementaciones posteriores se organizaron por milestones técnicos que pueden solaparse o cambiar el orden de despliegue.

# 09 · Evolución técnica y milestones

| Milestone | Ámbito | Situación conocida |
| --- | --- | --- |
| M0–M1 | Fundamentos, interfaz y motor de hábitos | Desarrollados; conviene comprobar pruebas actuales |
| M2 | Acceso y sincronización multidispositivo | Desarrollado |
| M2.5 | Seguridad, RLS y respaldo | Cerrado según hitos previos |
| M3 | Life Analytics y dimensiones personales | Trabajos por subfases; auditoría pendiente |
| M4 | Knowledge OS: libros, podcasts y Cerebro | Primera entrega aceptada el 31/10/2026 |
| M4g | Metadatos, portadas y altas asistidas | Desarrollo avanzado; cierre pendiente |
| M4-H1 | Persistencia offline antes de navegar | Corrección desarrollada; requiere validar su integración |
| D108 | Avisos de biblioteca y guardado | Corrección desarrollada; validación final pendiente |
| M4g.5 | Siguiente alcance de Knowledge OS | Consultar especificación técnica para requisitos exactos |

La documentación de milestones y el historial de versiones son fuentes de comprobación del alcance técnico, pero no sustituyen pruebas funcionales de extremo a extremo ni validación de producción.

# 10 · Estado funcional y próximos bloques

| Módulo / área | Estado orientativo | Próxima comprobación |
| --- | --- | --- |
| Command Center | Base existente | Integración final de indicadores |
| Habit Engine | Funcional según pruebas previas | Regresiones y consistencia histórica |
| Life Analytics | Desarrollo parcial M3 | Matriz de métricas implementadas |
| Goals & Systems | Previsto en roadmap | Auditoría funcional |
| Deep Work | Planificado | Auditoría de implementación |
| Knowledge OS | M4 aceptado; M4g pendiente de cierre | Persistencia, altas, duplicados y E2E |
| Mind & Energy | Check-ins previstos y trabajo M3 | Verificación de integración |
| Life Review | Funcionalidad definida | Completitud de revisiones |
| AI Intelligence | Evolución futura | Requisitos, privacidad y costes |
| Motivation / Notificaciones | Ampliaciones previstas | Priorización futura |

## Bloques recomendados de continuación

1. Estabilización: cerrar el alcance existente de Knowledge OS, M4g, M4g.5 y los defectos de persistencia; ejecutar QA.
2. Consolidación analítica: auditar M3 y completar métricas realmente pendientes.
3. Sistemas de progreso: completar Goals & Systems, Deep Work y Life Review.
4. Personalización: inteligencia, motivación y notificaciones tras obtener datos fiables.
5. Calidad integral: validar de extremo a extremo la experiencia en ordenador y móvil.

# 11 · Calidad, criterios de aceptación y versión estable

Una versión candidata estable no debe confundirse con la realización de toda la visión futura. Se considera candidata al cierre del alcance efectivamente acordado, implementado y comprobado.

## Criterios mínimos transversales

- Sin pérdida silenciosa de datos en registros, navegación, modo offline o reconexión.
- Autenticación y controles de acceso efectivos.
- Operaciones principales coherentes en móvil y escritorio.
- Pruebas unitarias, integración, estáticas y E2E relevantes con resultados documentados.
- Errores conocidos clasificados por severidad, sin declarar éxito cuando existen bloqueos críticos.
- Procedimientos de recuperación documentados para incidentes de datos.
- Diferenciación entre funcionalidad desarrollada, verificada y desplegada.

## Recomendaciones analíticas y de IA

Cada insight debe identificar el periodo analizado, las variables consideradas, el tamaño de muestra cuando corresponda y las limitaciones relevantes. Ninguna inferencia debe presentarse como diagnóstico médico o como relación causal demostrada sin evidencia apropiada.

# 12 · Matriz de trazabilidad y control de decisiones

Conviene mantener una matriz única de requisitos que permita rastrear cada compromiso del producto desde su definición hasta su validación.

| Identificador | Funcionalidad | Definido | Implementado | Probado | Publicado | Siguiente acción |
| --- | --- | --- | --- | --- | --- | --- |
| HAB-01 | Registro de hábitos | Sí | Verificar | Verificar | Verificar | Auditar |
| OFF-01 | Persistencia offline | Sí | Verificar | Verificar | Verificar | E2E crítico |
| KNO-01 | Biblioteca de libros | Sí | Parcial/avanzado | Verificar | M4 inicial | Cerrar M4g |
| KNO-02 | Biblioteca de podcasts | Sí | Parcial/avanzado | Verificar | M4 inicial | Cerrar M4g |
| ANA-01 | Análisis multivariable | Sí | Verificar | Verificar | Verificar | Auditar M3 |
| AI-01 | Recomendaciones personalizadas | Sí | Previsto | No confirmado | No confirmado | Fase futura |

Los valores «Verificar» son deliberados: evitan convertir información histórica o avances parciales en una certificación técnica actual.

## Decisiones de producto que deben permanecer explícitas

- La visión es un sistema operativo personal, no solo un tracker.
- El diseño debe ser Dark Performance y responsive.
- El registro diario y la integridad de datos tienen prioridad sobre nuevas funciones.
- La aplicación debe preservar funcionamiento multidispositivo y offline.
- Knowledge OS contiene libros, podcasts y Cerebro; incluye posibilidades de repaso y descubrimiento.
- La capa de IA se introduce progresivamente y depende de datos sólidos.
- Sin costes adicionales de API o créditos de uso no autorizados.
- El bloqueador de Reels y Shorts no forma parte del roadmap activo.

# 13 · Resultado esperado y próximos pasos

THE ONE PERCENT debería permitir responder con evidencia personal a preguntas relevantes: ¿estoy mejorando?, ¿qué hábitos son sostenibles?, ¿cuándo rindo mejor?, ¿cómo se relacionan sueño, energía y concentración?, ¿avanzo en mis objetivos?, ¿qué aprendo y recuerdo?, y ¿qué cambio concreto merece la pena probar?

El producto maduro combinará una experiencia diaria muy simple con un sistema de análisis, revisión y recomendaciones personalizadas que gana valor conforme se acumulan datos consistentes.

## Secuencia práctica recomendada

1. Congelar y documentar el estado actual del código, las versiones y las funcionalidades realmente integradas.
2. Cruzar el inventario técnico con la matriz funcional de este documento.
3. Cerrar las incidencias y validaciones pendientes de M4g y persistencia offline.
4. Publicar únicamente un alcance que esté probado y tenga estrategia de recuperación.
5. Retomar por bloques Life Analytics, Goals & Systems, Deep Work y Life Review.
6. Introducir inteligencia y personalización de forma gradual, con evaluación de utilidad y costes.

Este documento define el producto y sirve como referencia funcional a largo plazo. Cualquier plan operativo de desarrollo debe basarse en él, contrastarse con el código real y mantener separados hechos verificados, decisiones pendientes y propuestas futuras.
