# DONE · Orden 3: auditoría de secretos

**Veredicto: APTO PARA PÚBLICO.** No hay ningún secreto en el historial de git (todas las ramas, `refs/pull/*`, `respaldo/*` y la copia del worktree), ni en las PR, los registros o los artefactos de la CI. **No hay que rotar nada.** El informe completo está en [`docs/reports/auditoria-secretos.md`](docs/reports/auditoria-secretos.md).

## Siguiente paso para Dani

1. **Decide sobre tu correo personal.** `danimendiar@gmail.com` sigue en el historial: es el autor de 60 commits (24–30 oct) y aparece en versiones antiguas de 4 documentos (de `3b88fea` a `baa16a4`). No es un secreto. Si no quieres que se vea, hay que reescribir el historial y hacer force-push antes de publicar (procedimiento en el informe). Si te da igual, no hagas nada.
2. **Mira `.perfil`.** Está en el historial y el guardián no deja a Skynet abrirlo. Los barridos automáticos no encontraron nada en él.
3. **Haz público el repo.** Después, en GitHub › Settings › Actions › General, activa «Require approval for all external contributors».
4. En Vercel › Settings › Git, deja activada «Git Fork Protection» (viene activada por defecto).
5. Si entran commits nuevos antes de publicar, repite la comprobación con `npm run audit:secrets -- --repo . --repo <espejo>` y gitleaks (comandos en el informe).

Con el repo público, la CI vuelve a tener minutos y Skynet retoma la Orden 2 (PR #35).
