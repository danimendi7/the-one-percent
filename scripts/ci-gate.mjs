#!/usr/bin/env node
/**
 * CI gates for the pre-deploy validation (D48). Three modes, all read-only except `scan`:
 *
 *   node scripts/ci-gate.mjs isolation
 *     Refuses to continue unless the job only talks to the ephemeral LOCAL Supabase of the runner:
 *     no cloud credentials in the environment, no linked project, .env.local with public loopback
 *     values only, and no workflow that reads repository secrets.
 *
 *   node scripts/ci-gate.mjs report <playwright.json> [--all-specs]
 *     Acceptance criterion: 0 failed, 0 flaky, 0 interrupted, no global errors, at least one test
 *     passed. With --all-specs, every e2e/*.spec.ts (except smoke and screenshots) must have passed
 *     at least one test, so a spec that silently stops running also fails the gate.
 *
 *   node scripts/ci-gate.mjs scan <dir>...
 *     Removes any file that contains a key of the local stack before the artifacts are uploaded.
 *
 * Writes a Markdown summary to $GITHUB_STEP_SUMMARY when it exists.
 */
import { execSync } from "node:child_process"
import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { basename, join } from "node:path"

const [mode, ...args] = process.argv.slice(2)
const problems = []
const summary = []

const LOOPBACK = ["127.0.0.1", "localhost"]
// Names of the cloud credentials used by scripts/cloud.mjs, backup.mjs and Vercel: never present in CI.
const FORBIDDEN_ENV = ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_DB_URL", "BACKUP_PASSPHRASE", "VERCEL_TOKEN", "BASE_URL"]
const ALLOWED_ENV_LOCAL = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]
const CLOUD_HOST = /supabase\.(co|com|in)\b|vercel\.app\b|pooler\./i

function writeSummary() {
  const file = process.env.GITHUB_STEP_SUMMARY
  if (file) appendFileSync(file, summary.join("\n") + "\n\n")
  console.log(summary.join("\n"))
}

function finish() {
  if (problems.length) {
    summary.push("", "**✖ No cumple:**", ...problems.map((p) => `- ${p}`))
    writeSummary()
    process.exit(1)
  }
  writeSummary()
}

function localStatus() {
  const raw = execSync("npx supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  return JSON.parse(raw.slice(raw.indexOf("{")))
}

function isolation() {
  summary.push("### Aislamiento")
  for (const name of FORBIDDEN_ENV) if (process.env[name]) problems.push(`la variable ${name} existe en el entorno`)
  for (const [name, value] of Object.entries(process.env)) {
    if (value && CLOUD_HOST.test(value) && !/^(GITHUB_|RUNNER_|ACTIONS_)/.test(name)) problems.push(`la variable ${name} apunta a un servicio en la nube`)
  }
  if (existsSync("supabase/.temp/project-ref")) problems.push("hay un proyecto Supabase enlazado (supabase/.temp/project-ref)")

  const env = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : ""
  const entries = env.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
  for (const [k] of entries) if (!ALLOWED_ENV_LOCAL.includes(k)) problems.push(`.env.local contiene ${k}; solo se admiten los dos valores públicos`)
  const url = Object.fromEntries(entries).NEXT_PUBLIC_SUPABASE_URL ?? ""
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) problems.push("NEXT_PUBLIC_SUPABASE_URL no es el Supabase local del runner")

  const s = localStatus()
  for (const key of ["API_URL", "DB_URL"]) {
    const host = new URL(String(s[key]).replace(/^postgres(ql)?:/, "http:")).hostname
    if (!LOOPBACK.includes(host)) problems.push(`supabase status ${key} no es local (${host})`)
  }

  for (const f of readdirSync(".github/workflows")) {
    if (/\$\{\{\s*secrets\./.test(readFileSync(join(".github/workflows", f), "utf8"))) problems.push(`${f} lee secretos del repositorio`)
  }
  summary.push(`- Supabase: ${url || "(sin URL)"} (efímero, dentro del runner)`, "- Credenciales de la nube en el entorno: ninguna", "- Secretos del repositorio en los workflows: ninguno")
  finish()
}

function collect(suites, out = []) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) out.push({ file: spec.file, title: spec.title, project: t.projectName, status: t.status, results: t.results ?? [] })
    }
    collect(suite.suites, out)
  }
  return out
}

function report() {
  const [file, ...flags] = args
  if (!file || !existsSync(file)) {
    summary.push(`### Resultado E2E`, `No hay informe en \`${file}\`: la suite no llegó a ejecutarse.`)
    problems.push("sin informe de Playwright")
    return finish()
  }
  const json = JSON.parse(readFileSync(file, "utf8"))
  const st = json.stats ?? {}
  const tests = collect(json.suites)
  const interrupted = tests.filter((t) => t.results.some((r) => r.status === "interrupted")).length
  const globalErrors = (json.errors ?? []).length
  const minutes = Math.round((st.duration ?? 0) / 600) / 100

  summary.push(
    `### Resultado E2E · \`${basename(file)}\``,
    "| Superadas | Fallidas | Inestables | Interrumpidas | Omitidas | Errores globales | Duración |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    `| ${st.expected ?? 0} | ${st.unexpected ?? 0} | ${st.flaky ?? 0} | ${interrupted} | ${st.skipped ?? 0} | ${globalErrors} | ${minutes} min |`,
  )
  if ((st.unexpected ?? 0) > 0) problems.push(`${st.unexpected} pruebas fallidas: ${tests.filter((t) => t.status === "unexpected").map((t) => `${t.file} › ${t.title} [${t.project}]`).join("; ")}`)
  if ((st.flaky ?? 0) > 0) problems.push(`${st.flaky} pruebas inestables (fallaron y pasaron al reintentar): ${tests.filter((t) => t.status === "flaky").map((t) => `${t.file} › ${t.title} [${t.project}]`).join("; ")}`)
  if (interrupted > 0) problems.push(`${interrupted} pruebas interrumpidas`)
  if (globalErrors > 0) problems.push(`${globalErrors} errores globales (servidor, configuración o tiempo agotado)`)
  if ((st.expected ?? 0) === 0) problems.push("ninguna prueba superada")

  if (flags.includes("--all-specs")) {
    const passedFiles = new Set(tests.filter((t) => t.status === "expected").map((t) => basename(t.file)))
    const specs = readdirSync("e2e").filter((f) => f.endsWith(".spec.ts") && !["smoke.spec.ts", "screenshots.spec.ts"].includes(f))
    const missing = specs.filter((f) => !passedFiles.has(f))
    summary.push("", `Specs con al menos una prueba superada: ${specs.length - missing.length}/${specs.length}`)
    if (missing.length) problems.push(`specs sin ninguna prueba superada: ${missing.join(", ")}`)
  }
  finish()
}

function scan() {
  let secrets = []
  try {
    const s = localStatus()
    secrets = ["SECRET_KEY", "SERVICE_ROLE_KEY", "JWT_SECRET", "S3_PROTOCOL_ACCESS_KEY_SECRET"].map((k) => s[k]).filter((v) => typeof v === "string" && v.length >= 16)
  } catch {
    // The stack is already gone: nothing local can leak.
  }
  summary.push("### Revisión de secretos en los artefactos")
  let files = 0
  const walk = (p) => {
    if (!existsSync(p)) return
    if (statSync(p).isDirectory()) return readdirSync(p).forEach((f) => walk(join(p, f)))
    files++
    const text = readFileSync(p).toString("latin1")
    if (secrets.some((v) => text.includes(v))) {
      rmSync(p)
      problems.push(`${p} contenía una clave del stack local y se ha eliminado antes de subirlo`)
    }
  }
  args.forEach(walk)
  summary.push(`- ${files} ficheros revisados, ${problems.length} eliminados`)
  finish()
}

if (mode === "isolation") isolation()
else if (mode === "report") report()
else if (mode === "scan") scan()
else {
  console.error("Uso: ci-gate.mjs isolation | report <json> [--all-specs] | scan <dir>...")
  process.exit(2)
}
