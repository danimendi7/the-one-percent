/**
 * Pure helpers for scripts/e2e-linux.mjs (M3.3 decision 7). Exported for tests.
 * The validation runs the full E2E suite inside a disposable Linux container (official Playwright
 * image), connected ONLY to THE ONE PERCENT's local Supabase through a loopback forwarder.
 */

/** THE ONE PERCENT's local stack (supabase/config.toml): API, DB, Mailpit. Nothing else is forwarded. */
export const FORWARDED_PORTS = [55321, 55322, 55324]
/** Ports of the other local stack on this machine (default Supabase ports). Never forwarded or touched. */
export const FORBIDDEN_PORTS = [54321, 54322, 54323, 54324]
export const LABEL = "com.theonepercent.purpose=e2e-linux-validation"

/** Official image matching the project's Playwright version exactly. */
export function imageFor(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Versión de Playwright no válida: ${version}`)
  return `mcr.microsoft.com/playwright:v${version}-noble`
}

/** Unique, recognisable names (container and network) for one validation. */
export function resourceNames(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-").toLowerCase()
  return { container: `top-e2e-linux-${stamp}`, network: `top-e2e-linux-net-${stamp}`, stamp }
}

const LOOPBACK = new Set(["127.0.0.1", "localhost"])

/**
 * The status the tests read (`supabase status -o json`), reduced to what they need. Refuses anything
 * that is not THE ONE PERCENT's local stack on loopback: never a cloud URL, never the other stack.
 */
export function checkStatus(raw) {
  const json = JSON.parse(raw.slice(raw.indexOf("{")))
  const s = { API_URL: json.API_URL, DB_URL: json.DB_URL, PUBLISHABLE_KEY: json.PUBLISHABLE_KEY, SECRET_KEY: json.SECRET_KEY }
  for (const [k, v] of Object.entries(s)) if (typeof v !== "string" || !v) throw new Error(`supabase status sin ${k}`)
  for (const url of [s.API_URL, s.DB_URL]) {
    const u = new URL(url.replace(/^postgresql:/, "http:"))
    if (!LOOPBACK.has(u.hostname)) throw new Error(`Destino no local (${u.hostname}): se aborta`)
    if (!FORWARDED_PORTS.includes(Number(u.port))) throw new Error(`Puerto ${u.port} no pertenece al stack local de THE ONE PERCENT: se aborta`)
  }
  return s
}

/**
 * The app's build env for the container: ONLY the two public Supabase values, and only when they
 * point to the local stack. Any other line (secrets, cloud values) is dropped, never copied.
 */
export function publicEnv(text) {
  const keep = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)=(.*)$/.exec(line.trim())
    if (m) keep[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
  }
  if (!keep.NEXT_PUBLIC_SUPABASE_URL || !keep.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) throw new Error(".env.local sin la URL o la clave pública local")
  const u = new URL(keep.NEXT_PUBLIC_SUPABASE_URL)
  if (!LOOPBACK.has(u.hostname) || !FORWARDED_PORTS.includes(Number(u.port))) throw new Error(".env.local no apunta al stack local de THE ONE PERCENT: se aborta")
  return `NEXT_PUBLIC_SUPABASE_URL=${keep.NEXT_PUBLIC_SUPABASE_URL}\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${keep.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}\n`
}

/** Counts from Playwright's list reporter summary («158 passed», «2 failed»…). */
export function summarize(output) {
  const n = (word) => Number(new RegExp(`(\\d+) ${word}\\b`).exec(output)?.[1] ?? 0)
  return { passed: n("passed"), failed: n("failed"), flaky: n("flaky"), skipped: n("skipped"), interrupted: n("interrupted") }
}

/** True when any secret value appears in a text (logs are checked before they are kept). */
export function leaks(text, secrets) {
  return secrets.filter((s) => s && s.length > 6).some((s) => text.includes(s))
}
