# Estrategia de copias cifradas

Estado: **preparada, sin programar**. Programar tareas o conectar almacenamiento externo requiere tu autorización.

## Qué existe hoy
| Pieza | Comando | Qué hace |
| --- | --- | --- |
| Copia | `npm run backup -- --source cloud` | `pg_dump` de solo datos (public, private, auth.users/identities) desde el pooler de sesión, con huellas por tabla. Cifrada con AES-256-GCM y una clave derivada con scrypt de `BACKUP_PASSPHRASE`. Se guarda en `~/Documents/the-one-percent-backups/` |
| Simulacro | `npm run restore:drill -- <fichero>` | Restaura en un stack local aislado y desechable, compara recuentos y sumas de control, lo destruye y deja `<fichero>.drill.json` |
| Verificar la frase | `npm run backup:verify -- <fichero>` | Descifra en memoria y confirma que la frase abre la copia (entrada oculta) |
| Regla antes de migrar | `npm run cloud -- push` | **Se niega a migrar** si no hay una copia cloud del proyecto destino de las últimas 24 h con simulacro superado |

## Política propuesta
- **Semanal:** domingo a las 20:00, copia cloud y simulacro aislado. Si el PC estaba apagado, se ejecuta en cuanto vuelva a estar disponible.
- **Antes de cada migración o cambio de esquema:** copia y simulacro manuales. Ya es obligatorio por la regla de `cloud push`.
- **Retención:** las últimas 8 semanales, la primera de cada mes durante 12 meses y todas las previas a migraciones durante 6 meses. Una tarea de limpieza propondría qué borrar y nunca borraría sin listarlo antes.
- **Frase de cifrado:** una sola, guardada en tu gestor de contraseñas. Si la rotas, las copias antiguas siguen necesitando la frase anterior, así que guarda las dos con fecha.

## Opciones de automatización (elige una cuando quieras)
| | A. Programador de tareas de Windows (recomendada) | B. GitHub Actions (cron semanal) |
| --- | --- | --- |
| Dónde se ejecuta | Tu PC (necesita Docker Desktop en marcha) | Servidores de GitHub |
| Secretos | Contraseña de la base en `.env.cloud.local`. Frase en el Administrador de credenciales de Windows (DPAPI, ligada a tu usuario) | Contraseña de la base y frase como *secrets* del repo: un segundo lugar donde vive la contraseña |
| Dónde quedan las copias | Tu disco y, opcionalmente, una carpeta sincronizada de tu nube personal (siempre cifradas) | Artefactos del repo privado (máximo 90 días) |
| Coste | 0 € | 0 € (minutos gratuitos de sobra) |
| Punto débil | Si el PC está días apagado, no hay copia; se avisaría al volver | Las copias salen de tu equipo (cifradas) y el simulacro es más complejo |

Para la opción A haría falta, con tu autorización:
1. Un script `scripts/backup-scheduled.mjs` (copia, simulacro, retención y registro en `backups/log.json`) que comprueba antes que Docker está en marcha.
2. Guardar la frase en el Administrador de credenciales con un comando que ejecutes tú, sin que pase por el chat.
3. Crear la tarea semanal con `schtasks`, ejecutándose como tu usuario y solo si hay sesión iniciada.
4. Opcional: copiar los `.topbak` a una carpeta de OneDrive o Google Drive (es almacenamiento externo, así que requiere autorización aparte).

## Recuperación
1. `npm run backup:verify -- <copia>` para confirmar la frase.
2. `npm run restore:drill -- <copia>` para ver qué contiene y comprobar que restaura.
3. La restauración real en el cloud **no está automatizada a propósito**. Se haría en un proyecto nuevo o tras una decisión explícita, con un plan escrito en el momento.
