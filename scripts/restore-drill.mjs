#!/usr/bin/env node
/**
 * Restore drill with verification. Never writes to the cloud.
 *
 *   npm run restore:drill -- <file.topbak>                 isolated (default): throwaway stack, dev data untouched
 *   npm run restore:drill -- <file.topbak> --into-local-dev   replaces the dev stack's data (safety backup first)
 *
 * Isolated mode starts a separate Supabase stack (the-one-percent-drill, ports 556xx, own volumes)
 * from this repo's migrations, loads the backup there, compares row counts and checksums per table
 * with the backup's manifest, and destroys the stack. Requires BACKUP_PASSPHRASE.
 */
import { readFileSync } from "node:fs"
import { assertContainer, compareManifests, CONTAINER, decrypt, docker, LOCAL_URL_IN_CONTAINER, manifest } from "./lib/backup-core.mjs"
import { recordDrill } from "./lib/backup-ledger.mjs"
import { DRILL_CONTAINER, startDrillStack, stopDrillStack } from "./lib/drill-stack.mjs"
import { runBackup } from "./backup.mjs"
import { supabaseCli } from "./lib/supabase-cli.mjs"

function fail(msg) {
  console.error(`\n✖ ${msg}\n`)
  process.exit(1)
}

const file = process.argv[2]
const intoDev = process.argv.includes("--into-local-dev")
if (!file || file.startsWith("--")) fail("Uso: npm run restore:drill -- <fichero .topbak> [--into-local-dev]")
if (!process.env.BACKUP_PASSPHRASE) fail("Define BACKUP_PASSPHRASE en esta terminal.")

let backup
try {
  backup = decrypt(readFileSync(file), process.env.BACKUP_PASSPHRASE)
} catch (e) {
  fail(e.message)
}
console.log(`Copia: origen=${backup.meta.source} ref=${backup.meta.ref} fecha=${backup.meta.startedAt}`)

const load = (container) => {
  // The backup's own allowlist replaces whatever the schema/seed put there.
  const script = ["SET session_replication_role = replica;", "TRUNCATE private.allowed_emails;", backup.sql].join("\n")
  docker(["exec", "-i", container, "psql", "-U", "supabase_admin", "-d", "postgres", "-q", "-v", "ON_ERROR_STOP=1"], script)
  console.log("✔ Datos cargados.")
  return compareManifests(backup.manifest, manifest(LOCAL_URL_IN_CONTAINER, container))
}

let report
if (intoDev) {
  assertContainer()
  const safety = runBackup("local")
  console.log(`✔ Copia de seguridad previa del estado local: ${safety.file}`)
  console.log("Recreando la base local de desarrollo desde las migraciones…")
  if (supabaseCli(["db", "reset", "--local"], { stdio: "inherit" }).status !== 0) fail("supabase db reset --local falló.")
  report = load(CONTAINER)
  console.log(`  Para volver al estado local anterior: npm run restore:drill -- "${safety.file}" --into-local-dev`)
} else {
  console.log("Arrancando un stack aislado y desechable (the-one-percent-drill, puertos 556xx)…")
  const dir = startDrillStack()
  try {
    report = load(DRILL_CONTAINER)
  } finally {
    stopDrillStack(dir)
    console.log("✔ Stack aislado eliminado (contenedores y volúmenes).")
  }
}

for (const r of report) console.log(`${r.ok ? "✔" : "✖"} ${r.table.padEnd(34)} ${String(r.rows).padStart(6)} filas${r.ok ? "" : `  (restauradas: ${r.restoredRows})`}`)
const bad = report.filter((r) => !r.ok)
if (bad.length) fail(`${bad.length} tablas no coinciden.`)
recordDrill(file, backup.meta, report)
console.log(`\n✔ Restauración verificada: ${report.length} tablas idénticas a la copia.`)
