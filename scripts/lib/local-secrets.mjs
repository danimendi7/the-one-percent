import { existsSync, readFileSync } from "node:fs"

export const SECRETS_FILE = ".env.cloud.local"

/**
 * Load cloud secrets from the git-ignored .env.cloud.local (KEY=value lines) into
 * process.env, without ever printing them. Values already in the environment win.
 * Only the listed keys are read.
 */
export function loadLocalSecrets(keys) {
  if (!existsSync(SECRETS_FILE)) return []
  const loaded = []
  for (const line of readFileSync(SECRETS_FILE, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!m || !keys.includes(m[1]) || process.env[m[1]]) continue
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
    loaded.push(m[1])
  }
  return loaded
}
