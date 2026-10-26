#!/usr/bin/env node
/**
 * Restore drill into the LOCAL stack only, with verification.
 *
 *   npm run restore:drill -- <file.topbak>
 *
 * 1. Takes an automatic encrypted safety backup of the current local data (nothing is lost).
 * 2. Recreates the local database from migrations (supabase db reset, local only).
 * 3. Loads the backup's data with triggers disabled (as superuser, inside the container).
 * 4. Compares row counts and checksums per table with the backup's manifest.
 * Requires BACKUP_PASSPHRASE.
 */
import { readFileSync } from "node:fs"
import { assertContainer, compareManifests, CONTAINER, decrypt, docker, LOCAL_URL_IN_CONTAINER, manifest } from "./lib/backup-core.mjs"
import { runBackup } from "./backup.mjs"
import { supabaseCli } from "./lib/supabase-cli.mjs"

function fail(msg) {
  console.error(`\n✖ ${msg}\n`)
  process.exit(1)
}

const file = process.argv[2]
if (!file) fail("Uso: npm run restore:drill -- <fichero .topbak>")
if (!process.env.BACKUP_PASSPHRASE) fail("Define BACKUP_PASSPHRASE en esta terminal.")

let backup
try {
  backup = decrypt(readFileSync(file), process.env.BACKUP_PASSPHRASE)
} catch (e) {
  fail(e.message)
}
console.log(`Copia: origen=${backup.meta.source} ref=${backup.meta.ref} fecha=${backup.meta.startedAt}`)
assertContainer()

// 1. Safety net for whatever is in the local database right now.
const safety = runBackup("local")
console.log(`✔ Copia de seguridad previa del estado local: ${safety.file}`)

// 2. Fresh local schema from migrations (local stack only: the CLI targets this repo's local project).
console.log("Recreando la base local desde las migraciones…")
const reset = supabaseCli(["db", "reset", "--local"], { stdio: "inherit" })
if (reset.status !== 0) fail("supabase db reset --local falló.")

// 3. Load data. The local seed allowlist is replaced by the backup's own rows.
const script = ["SET session_replication_role = replica;", "TRUNCATE private.allowed_emails;", backup.sql].join("\n")
docker(["exec", "-i", CONTAINER, "psql", "-U", "supabase_admin", "-d", "postgres", "-q", "-v", "ON_ERROR_STOP=1"], script)
console.log("✔ Datos cargados.")

// 4. Verify.
const report = compareManifests(backup.manifest, manifest(LOCAL_URL_IN_CONTAINER))
for (const r of report) console.log(`${r.ok ? "✔" : "✖"} ${r.table.padEnd(34)} ${String(r.rows).padStart(6)} filas${r.ok ? "" : `  (restauradas: ${r.restoredRows})`}`)
const bad = report.filter((r) => !r.ok)
if (bad.length) fail(`${bad.length} tablas no coinciden.`)
console.log(`\n✔ Restauración verificada: ${report.length} tablas idénticas a la copia.`)
console.log(`  Para volver al estado local anterior: npm run restore:drill -- "${safety.file}"`)
