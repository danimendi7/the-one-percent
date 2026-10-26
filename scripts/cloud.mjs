#!/usr/bin/env node
/**
 * Guarded Supabase Cloud commands for THE ONE PERCENT.
 *
 *   npm run cloud -- check                  verify the token's account and the target project
 *   npm run cloud -- link                   link this repo to the verified project (needs SUPABASE_DB_PASSWORD)
 *   npm run cloud -- push-dry               list migrations that would be applied
 *   npm run cloud -- push --confirm <ref>   apply migrations (only after an explicit confirmation)
 *   npm run cloud -- lint                   lint the linked remote database
 *
 * Safety rules:
 * - Requires SUPABASE_ACCESS_TOKEN in the environment of this terminal only. It never uses
 *   (or changes) the global CLI login, which belongs to another account on this machine.
 * - Aborts if the token can see the forbidden project/organization, or if ref, name,
 *   organization, region or the local link do not match supabase/cloud-project.json.
 */
import { existsSync, readFileSync } from "node:fs"
import { evaluateCloudTarget } from "./lib/cloud-guard.mjs"
import { loadLocalSecrets, SECRETS_FILE } from "./lib/local-secrets.mjs"
import { supabaseCli } from "./lib/supabase-cli.mjs"

const cfg = JSON.parse(readFileSync("supabase/cloud-project.json", "utf8"))
const [command = "check", ...args] = process.argv.slice(2)

function fail(msg) {
  console.error(`\n✖ ${msg}\n`)
  process.exit(1)
}

const loaded = loadLocalSecrets(["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD"])
if (loaded.length) console.log(`(secretos leídos de ${SECRETS_FILE}: ${loaded.join(", ")}; valores no mostrados)`)

if (!process.env.SUPABASE_ACCESS_TOKEN) {
  fail(
    "Define SUPABASE_ACCESS_TOKEN (token personal de la cuenta de THE ONE PERCENT) solo en esta terminal.\n" +
      "  PowerShell:  $env:SUPABASE_ACCESS_TOKEN = '<token>'\n" +
      `  o en el fichero ignorado por git ${SECRETS_FILE}:  SUPABASE_ACCESS_TOKEN=<token>\n` +
      "Así no se usa ni se modifica la sesión global de la CLI."
  )
}

function supabase(cliArgs, { capture = false } = {}) {
  const r = supabaseCli(cliArgs, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: process.env,
  })
  if (r.status !== 0) fail(`supabase ${cliArgs.join(" ")} falló${capture ? `:\n${r.stderr}` : ""}`)
  return r.stdout
}

function linkedRef() {
  const f = "supabase/.temp/project-ref"
  return existsSync(f) ? readFileSync(f, "utf8").trim() : ""
}

function verify({ requireLink }) {
  const raw = supabase(["projects", "list", "-o", "json"], { capture: true })
  const projects = JSON.parse(raw.slice(raw.search(/[[{]/)))
  const result = evaluateCloudTarget(projects, cfg, requireLink ? linkedRef() : null)
  console.log("\nDestino verificado contra supabase/cloud-project.json:")
  console.log(result.target ?? "(sin proyecto)")
  if (!result.ok) fail(result.problems.join("\n  "))
  console.log("✔ Destino correcto.\n")
  return result.target
}

switch (command) {
  case "check":
    verify({ requireLink: false })
    break
  case "link": {
    const t = verify({ requireLink: false })
    if (!process.env.SUPABASE_DB_PASSWORD) fail("Define SUPABASE_DB_PASSWORD en esta terminal (contraseña de la base de datos del proyecto).")
    supabase(["link", "--project-ref", t.ref])
    if (linkedRef() !== t.ref) fail("El enlace no se guardó con el ref esperado.")
    console.log(`✔ Repo enlazado a ${t.ref}.`)
    break
  }
  case "push-dry":
    verify({ requireLink: true })
    supabase(["db", "push", "--dry-run"])
    break
  case "push": {
    const t = verify({ requireLink: true })
    const i = args.indexOf("--confirm")
    if (i < 0 || args[i + 1] !== t.ref) fail(`Para aplicar migraciones repite el ref exacto: npm run cloud -- push --confirm ${t.ref}`)
    supabase(["db", "push"])
    console.log("✔ Migraciones aplicadas.")
    break
  }
  case "lint":
    verify({ requireLink: true })
    supabase(["db", "lint", "--linked", "--level", "warning"])
    break
  default:
    fail(`Comando desconocido: ${command}`)
}
