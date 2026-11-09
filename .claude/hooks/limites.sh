#!/usr/bin/env bash
# Guardián: se ejecuta antes de cada comando o acceso a archivos de Claude, también sin permisos.
# Salir con código 2 bloquea la acción y le explica a Claude el motivo.
entrada=$(cat)
cmd=$(printf '%s' "$entrada" | jq -r '.tool_input.command // ""')
ruta=$(printf '%s' "$entrada" | jq -r '.tool_input.file_path // .tool_input.path // ""')

bloquea() { echo "Bloqueado por limites.sh: $1" >&2; exit 2; }

# Comandos peligrosos o que tocan producción
peligrosos='git push .*(--force|-f)( |$)|git push .*(origin|upstream) main( |$)|git push .*:main( |$)|rm -rf (/|~|\$HOME)( |$)|supabase (db reset|projects delete|link)|--linked|DROP (DATABASE|SCHEMA)|vercel .*--prod|gh repo (delete|edit)|gh api .*-X (DELETE|PUT)|gh secret|gh auth (logout|login|token)|git config --global'
if [ -n "$cmd" ] && printf '%s' "$cmd" | grep -Eiq "$peligrosos"; then
  bloquea "$cmd"
fi

# Modo protegido: nada contra main/master ni comandos de publicación
if [ -n "$cmd" ] && [ -f "$CLAUDE_PROJECT_DIR/.skynet.conf" ] && grep -q '^MODO=protegido' "$CLAUDE_PROJECT_DIR/.skynet.conf"; then
  if printf '%s' "$cmd" | grep -Eiq -- '--base[ =](main|master|production|prod)( |$)|git (merge|rebase|reset|checkout -B|branch -[fD]) .*(main|master)( |$)|git push .*(main|master|production)|db push.*PROD|PROD_DB_URL'; then
    bloquea "modo protegido: no se toca main ni producción ($cmd)"
  fi
fi

# Credenciales y archivos del sistema que no son del proyecto
privadas='\.perfil|\.skynet\.conf|proyectos/_sistema|proyectos/_plantilla|\.config/autonomo|\.ssh/|\.aws/|\.config/gh/'
if printf '%s %s' "$cmd" "$ruta" | grep -Eq "$privadas"; then
  bloquea "acceso a credenciales fuera del proyecto"
fi

exit 0
