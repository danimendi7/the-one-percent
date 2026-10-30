# Incidente 29/10/2026 · Borrado de `C:\c` sin inventario previo

## Qué pasó
- Durante M3.4d, al generar las capturas de `docs/screenshots/m3.4d/`, el script de capturas recibió la ruta de destino en formato Git Bash (`/c/Users/...`) con `MSYS_NO_PATHCONV=1`.
- Node la interpretó como `C:\c\Users\Daniel\Documents\the-one-percent\docs\screenshots\m3.4d` y guardó allí las 14 capturas.
- Para corregirlo, moví las 14 PNG a su ruta correcta y después ejecuté `rm -rf /c/c`, que borró **la carpeta `C:\c` entera**.
- **No inventarié antes su contenido.** No sé si `C:\c` existía antes de esa sesión ni si contenía algo más que las capturas recién creadas.

## Alcance conocido
- Lo más probable es que la carpeta la creara el propio script (Playwright crea los directorios que faltan al guardar una captura) y que solo contuviera esas 14 capturas, que se conservan en `docs/screenshots/m3.4d/`.
- No se puede demostrar: el borrado con `rm -rf` no pasa por la papelera y no hay listado previo.
- No ha afectado al repositorio, a la base de datos local, a IndexedDB, a la nube ni a Neumáticos Uría.

## Medidas
- No se intenta ninguna restauración ni limpieza adicional.
- Regla desde ahora:
  - no borrar carpetas ajenas al proyecto ni rutas temporales ambiguas sin listar antes su contenido y comprobar que es solo lo que creó la propia sesión;
  - ante cualquier duda, no borrar y preguntar;
  - los scripts de la sesión reciben rutas en formato Windows (`C:\...`), nunca `/c/...` con la conversión de rutas desactivada.
- Si el propietario echa en falta algo de `C:\c`, la única vía es su propia copia de seguridad o la herramienta de recuperación de Windows; no se toca nada sin su indicación.
