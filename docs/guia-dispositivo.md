# Guía de prueba en el iPhone: asistentes de búsqueda

Esta guía cubre lo que solo se puede comprobar en un iPhone real: VoiceOver, el teclado de verdad, la prueba sin red y la velocidad (M4g.5 §23, filas 3 a 5). **Nadie la ha ejecutado todavía.** Las pruebas automáticas simulan el teclado, pero no sustituyen a estos pasos.

**Antes de empezar:** abre la app instalada en la pantalla de inicio y entra con tu cuenta. Apunta en cada paso **Bien**, **Mal** o una nota breve. No anotes datos personales.

Capturas de referencia a 375 px con el teclado simulado: `docs/screenshots/iphone-teclado-*.png`.

## 1. Teclado

Prueba en Biblioteca → Libros → Añadir libro, y en Biblioteca → Podcasts → Añadir → Episodio.

| # | Paso | Esperado | Resultado |
| --- | --- | --- | --- |
| 1.1 | Abre el asistente de libros | El campo de búsqueda tiene el foco y el teclado no lo tapa | |
| 1.2 | Escribe un título | La página no hace zoom al enfocar el campo; los resultados se pueden desplazar por encima del teclado | |
| 1.3 | Mira el botón «Introducir manualmente» con el teclado abierto | Se ve entero, sin quedar debajo del teclado | |
| 1.4 | Elige un resultado y toca «Título» en la revisión | El campo queda visible y «Añadir a la Biblioteca» sigue a la vista | |
| 1.5 | En podcasts, elige un programa y toca «Filtrar por título» | Se ven el filtro, varias filas de episodios y «Añadir episodio manualmente» | |
| 1.6 | Observa la parte inferior del panel con el teclado abierto | No queda una franja vacía grande entre el botón y el teclado | |
| 1.7 | Cierra el teclado y gira a horizontal | El panel sigue accesible y se puede desplazar | |

## 2. VoiceOver

Actívalo en Ajustes → Accesibilidad → VoiceOver. Desliza con un dedo para avanzar y toca dos veces para activar.

| # | Paso | Esperado | Resultado |
| --- | --- | --- | --- |
| 2.1 | Abre el asistente de libros | Anuncia el título del panel y que es un diálogo; «Busca por título, autor o ISBN…» se lee aunque no se vea en el móvil | |
| 2.2 | Escribe y espera | Anuncia «2 resultados» (o el número que sea) sin que muevas el foco | |
| 2.3 | Sin resultados | Anuncia que no hay resultados y sigue ofreciendo la entrada manual | |
| 2.4 | Elige un resultado con doble toque | El foco pasa a «Revisa y añade» | |
| 2.5 | Recorre la revisión | Cada campo dice su nombre; el orden sigue al de la pantalla | |
| 2.6 | Añade un libro que ya tengas | Anuncia el aviso de duplicado y el enlace para abrir la ficha | |
| 2.7 | En podcasts, escribe en el filtro | Anuncia «N de M coinciden» | |
| 2.8 | Elige un episodio con doble toque | El foco pasa a «Revisa y añade» | |
| 2.9 | Toca «Introducir manualmente» | Abre el formulario con lo escrito y anuncia su título | |
| 2.10 | Toca Cerrar con algo escrito | Pregunta «¿Descartar lo escrito?» y ambos botones se leen | |

## 3. Sin red

Activa el modo avión **después** de abrir la app.

| # | Paso | Esperado | Resultado |
| --- | --- | --- | --- |
| 3.1 | Busca un libro | Dice que no hay conexión, lo escrito sigue ahí y ofrece la entrada manual | |
| 3.2 | Añádelo manualmente y vuelve a la Biblioteca | La ficha aparece y el estado indica cambios pendientes | |
| 3.3 | Cierra la app por completo y ábrela sin red | La ficha sigue ahí | |
| 3.4 | Borra una ficha creada para esta prueba, pulsa volver y cierra la app | Al abrirla sin red, sigue borrada | |
| 3.5 | Desactiva el modo avión | El estado pasa a «Sincronizado» y los cambios aparecen en el ordenador | |
| 3.6 | Empieza a escribir en un asistente con red y recarga o cierra el panel | Al reabrir en la misma pestaña, ofrece «Recuperar lo que escribías» | |

## 4. Velocidad con `/dev/podcasts`

Es una página solo de desarrollo, con datos sintéticos, que no necesita tu cuenta. Con un build de producción responde 404.

1. Pon el PC y el iPhone en la **misma Wi-Fi privada**.
2. En el PC, en la carpeta del proyecto: `npx next dev -H 0.0.0.0 -p 3000`. Si el firewall pregunta, permite solo redes privadas.
3. En el iPhone, abre Safari en `http://<IP del PC>:3000/login` y pulsa «Explorar la demo sin cuenta».
4. Abre `http://<IP del PC>:3000/dev/podcasts`.
5. Pulsa «Medir el primer dibujo» y después «Medir el filtrado». Escribe también a mano en el filtro.
6. Apunta las cifras:

| Medida | iPhone (modelo) | Resultado |
| --- | --- | --- |
| Primer dibujo (ms) | | |
| Filtrado (ms) | | |
| ¿Se nota retraso al escribir a mano? | | |

Si el filtrado supera **100 ms** en el iPhone, hay que aligerar la lista quitando las descripciones (`docs/m4g-plan.md`, §23, fila 4).

## 5. Qué hacer con el resultado

Añade cada **Mal** a `docs/ORDENES.md` como orden nueva, con el número de paso y lo que viste. Skynet lo convertirá en tareas.
