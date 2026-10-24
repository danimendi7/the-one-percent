# Guía de validación del prototipo (M1)

Objetivo: revisar la calidad visual y funcional antes de empezar M2. Se tarda unos 20 minutos.

## 1. Cómo abrirlo

**En el ordenador**
```bash
cd C:\Users\Daniel\Documents\the-one-percent
npm run build
npm start                    # http://localhost:3000
```

**En el móvil (misma wifi)**
```bash
npm start -- -H 0.0.0.0
```
1. Averigua la IP del PC con `ipconfig` («Dirección IPv4», p. ej. `192.168.1.40`).
2. En el móvil abre `http://192.168.1.40:3000`.
3. Si Windows pregunta por el firewall, permite el acceso en **redes privadas**.

Notas:
- Al ser HTTP local, **no** se puede instalar como app ni recibir notificaciones. Es lo esperado hasta el despliegue con HTTPS.
- Los datos de la demo son independientes en cada navegador y dispositivo. Para empezar de cero: **Ajustes → Restablecer demo**.

## 2. Leyenda

| Marca | Significado |
| --- | --- |
| ✅ **Funcional** | Funciona de verdad y se guarda en este navegador |
| 🟡 **Interactivo sin guardar** | Responde a tus acciones, pero se pierde al recargar |
| 🧪 **Demo** | Datos de ejemplo fijos (etiqueta «Demo» visible en pantalla) |
| ⏳ **Pendiente** | Se desarrolla en la fase indicada |

## 3. Estado por pantalla

### Resumen (Inicio)
| Elemento | Estado |
| --- | --- |
| Anillo de progreso de hoy, semana y 30 días | ✅ calculado con tus registros |
| Checklist de hoy (un toque, cantidades, deshacer) | ✅ |
| Top 3 de hoy | 🟡 |
| Accesos a Enfoque, Descubrir y Cerebro | ✅ navegación · 🧪 contenido |
| Dimensiones (30 días y tendencia de 8 semanas) | ✅ calculado |
| Objetivos activos | 🧪 resultado de ejemplo |

### Hábitos (pieza central de M1)
| Elemento | Estado |
| --- | --- |
| Marcar y desmarcar con un toque, con deshacer | ✅ |
| Cantidades: valores rápidos de un toque, +/− y entrada exacta | ✅ |
| Matriz semanal y navegación entre semanas | ✅ |
| Registro retroactivo de días pasados (futuros bloqueados) | ✅ |
| Crear, editar, archivar y restaurar hábitos | ✅ |
| Horarios: cada día, días concretos, N veces por semana | ✅ versionados desde el día del cambio |
| Días de descanso (tocar la cabecera del día) | ✅ |
| Métricas y «Cómo se calcula» | ✅ |
| Persistencia y sincronización entre pestañas del mismo navegador | ✅ |
| Historial previo | 🧪 120 días de ejemplo generados |
| Sincronización entre dispositivos, cuenta, cola offline | ⏳ M2 |
| Vínculo con sesiones de lectura y enfoque | ⏳ M3/M4 |

### Analítica
| Elemento | Estado |
| --- | --- |
| Tarjetas, tendencia semanal, constancia por día, calendario | ✅ calculado |
| Periodo 7/30/90 días, filtro por hábito, vista de tabla | ✅ |
| Check-ins, enfoque y lectura en la analítica | ⏳ M3/M4 |

### Biblioteca
| Elemento | Estado |
| --- | --- |
| Rejilla de portadas o lista, estanterías, búsqueda (ignora tildes), orden | ✅ sobre datos de ejemplo |
| Ficha del libro (progreso, notas, etiquetas) | 🧪 |
| Libros, notas y valoraciones | 🧪 títulos reales, datos ficticios |
| Portadas | Diseño tipográfico propio (es la alternativa cuando falta la portada) |
| Añadir libro (Google Books / Open Library / manual), notas, sesiones | ⏳ M4 |

### Resto de pantallas
| Pantalla | Estado |
| --- | --- |
| Objetivos | 🧪 resultado · ✅ esfuerzo calculado con los hábitos vinculados · ⏳ crear y editar (M3) |
| Enfoque | ✅ temporizador (25/50/90, pausar, reanudar) · ⏳ guardar sesiones (M3) |
| Descubrir | 🧪 tema curado, marcado «Síntesis sin verificar» · 🟡 valoración 1–10 y acciones · ⏳ generación y fuentes (M4) |
| Cerebro | 🧪 3 tarjetas · 🟡 repaso · ⏳ algoritmo de repetición espaciada (M4) |
| Mente y energía | 🟡 formulario · ⏳ guardado (M3) |
| Revisiones | ✅ cifras de la semana anterior · 🟡 decisiones y reflexión · ⏳ guardado (M6) |
| Notificaciones | 🟡 configuración · ⏳ permiso, push y envíos (M5). Nunca pide permiso al navegador |
| Inteligencia | Informativa · ⏳ M6 |
| Ajustes | ✅ exportar JSON y restablecer demo |

## 4. Recorrido de validación en el móvil

**Inicio**
- [ ] Sin desplazarte ves el progreso de hoy y casi toda la checklist.
- [ ] Marca un hábito con el pulgar: responde al instante (con vibración ligera en Android) y el anillo se actualiza.
- [ ] El botón «Hoy 2/7» de la cabecera lleva a la checklist desde cualquier pantalla.

**Hábitos**
- [ ] La franja de métricas ocupa una sola fila. Al tocar ⓘ se abre una hoja con las explicaciones.
- [ ] Toca **Pasos**: se abre una hoja inferior con valores rápidos (8000 / 10.000 / 12.000). Un toque guarda.
- [ ] Toca **Semana**: siete celdas por hábito sin desplazamiento lateral. Toca un día pasado para un registro retroactivo.
- [ ] Toca la cabecera de un día → «Marcar como descanso». Ese día deja de contar en el porcentaje.
- [ ] Toca **Nuevo hábito** → crea uno de «Días concretos: L y X». Hoy aparece solo si es lunes o miércoles.
- [ ] Toca el nombre de un hábito en la vista Semana → edítalo o archívalo. Restáuralo desde «Archivados».
- [ ] Recarga la página: todo sigue igual.

**Biblioteca**
- [ ] Las estanterías se desplazan en horizontal con el dedo; cada chip muestra su contador.
- [ ] Busca «seneca» (sin tilde): aparece *Cartas a Lucilio*.
- [ ] Toca una portada: la ficha sube desde abajo y se cierra con la X o deslizando fuera.
- [ ] Cambia entre portadas y lista.

**General**
- [ ] Nada se corta ni obliga a desplazarse en horizontal.
- [ ] Las pestañas inferiores no tapan contenido al final de cada pantalla.
- [ ] Cada elemento con datos de ejemplo muestra la etiqueta «Demo».

## 5. Ajustes de usabilidad móvil hechos en esta revisión

| Pantalla | Antes | Ahora |
| --- | --- | --- |
| Hábitos | 4 tarjetas de métricas y un botón a ancho completo empujaban la checklist fuera de la pantalla | Franja de métricas compacta y botón en la fila del título: unos 6 hábitos visibles sin desplazar |
| Hábitos | Las explicaciones «ⓘ» eran tooltips: no se abrían con un toque | Hoja inferior en móvil y popover con un toque en escritorio |
| Hábitos | Cantidades en un popover flotante, solo escritura y +/− | Hoja inferior al alcance del pulgar con valores rápidos de un toque |
| Hábitos | Celdas de la vista Semana de 40 px; las pendientes eran un cuadro vacío | 43×44 px; las pendientes de hoy muestran un check tenue como pista |
| Hábitos | Sin respuesta física | Vibración breve en Android (respeta «reducir movimiento») |
| Resumen | «Ver todos» y los enlaces de aprendizaje de 20–32 px | Zonas táctiles de 44 px |
| Biblioteca | Estanterías y selector de vista de 36 px | 44 px y 40 px dentro de un contenedor de 44 px |
| General | Botón «Cerrar» de las hojas de 36 px; botones de cabecera de 36 px | 44 px; cabecera de 40 px con área táctil ampliada a 48 px |

Medición automática a 375 px: ningún control principal de Resumen, Hábitos o Biblioteca tiene una zona táctil efectiva menor de 44 px.

## 6. Qué anotar durante la revisión

Para cada observación indica la pantalla, el dispositivo y el navegador, qué esperabas y qué ocurrió. Si es posible, adjunta una captura. Clasifícala como **bloqueante**, **importante** o **detalle**. La incorporaré antes de empezar M2.
