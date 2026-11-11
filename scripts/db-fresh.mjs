#!/usr/bin/env node
/**
 * Fresh production database (G2, Orden 2 §3): apply every migration to a NEW, EMPTY Supabase
 * project and verify RLS. Procedure in docs/publicacion.md §4.
 *
 *   FRESH_DB_URL='postgresql://…' npm run db:fresh             check the target and list what would be applied
 *   FRESH_DB_URL='postgresql://…' npm run db:fresh -- --apply   apply all migrations, then audit RLS
 *   FRESH_DB_URL='postgresql://…' npm run db:fresh -- --verify  audit RLS only (any database, read-only)
 *
 * Safety:
 * - The connection string is read from FRESH_DB_URL (this terminal only) and never printed.
 * - --apply refuses any database that already has an app table or a migration history, so it can
 *   never run over staging or over a database in use.
 * - The audit writes nothing: its test rows live in a transaction that is always rolled back.
 */
import { readdirSync } from "node:fs"
import pg from "pg"
import { auditDatabase, migrationVersions, targetState } from "./lib/rls-audit.mjs"
import { supabaseCli } from "./lib/supabase-cli.mjs"

const args = new Set(process.argv.slice(2))
const mode = args.has("--apply") ? "apply" : args.has("--verify") ? "verify" : "check"
const url = process.env.FRESH_DB_URL ?? ""

function fail(msg) {
  console.error(`\n✖ ${msg}\n`)
  process.exit(1)
}

if (!/^postgres(ql)?:\/\//.test(url)) {
  fail(
    "Define FRESH_DB_URL solo en esta terminal, con la cadena de conexión del proyecto NUEVO\n" +
      "(Supabase › Connect › Session pooler o Direct connection, con su contraseña).\n" +
      "  bash:        FRESH_DB_URL='postgresql://…' npm run db:fresh\n" +
      "  PowerShell:  $env:FRESH_DB_URL = 'postgresql://…'; npm run db:fresh"
  )
}

const files = readdirSync("supabase/migrations")
const versions = migrationVersions(files)

async function withClient(fn) {
  const client = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

async function inspectTarget(client) {
  const [{ n: publicTables }] = (
    await client.query("select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p')")
  ).rows
  const [{ present }] = (await client.query("select to_regclass('supabase_migrations.schema_migrations') is not null as present")).rows
  const migrationRows = present ? (await client.query("select count(*)::int as n from supabase_migrations.schema_migrations")).rows[0].n : 0
  return { publicTables, migrationRows, state: targetState({ publicTables, migrationRows }) }
}

function cli(cliArgs) {
  // The URL goes as an argument without a shell; the CLI's own output does not include the password.
  const r = supabaseCli(cliArgs, { encoding: "utf8", stdio: ["ignore", "inherit", "inherit"], env: process.env })
  if (r.status !== 0) fail(`supabase ${cliArgs.filter((a) => a !== url).join(" ")} falló`)
}

async function audit() {
  const report = await withClient((c) => auditDatabase(c, { migrationFiles: files }))
  console.log(`\nAuditoría de RLS: ${report.tables} tablas en public, ${report.policies} políticas, ${report.migrations} de ${versions.length} migraciones en el historial.`)
  if (report.problems.length === 0) {
    console.log("✔ Todas las tablas tienen RLS, las políticas dependen de auth.uid() y una persona no ve los datos de otra.\n")
    return
  }
  for (const p of report.problems) console.error(`  ✖ ${p}`)
  fail(`${report.problems.length} problema(s) en la auditoría de RLS`)
}

if (mode === "verify") {
  await audit()
  process.exit(0)
}

const target = await withClient(inspectTarget)
console.log(`Destino: ${target.publicTables} tablas en public, ${target.migrationRows} migraciones en su historial.`)
if (target.state !== "empty") fail("La base de destino no está vacía. Este script solo instala en un proyecto nuevo; para auditar una base existente usa --verify.")

if (mode === "check") {
  console.log(`\nSe aplicarían ${versions.length} migraciones (de ${versions[0]} a ${versions.at(-1)}). Ensayo de la CLI:`)
  cli(["db", "push", "--dry-run", "--include-all", "--db-url", url])
  console.log("\nPara aplicarlas: añade --apply.\n")
  process.exit(0)
}

console.log(`\nAplicando ${versions.length} migraciones…`)
cli(["db", "push", "--include-all", "--yes", "--db-url", url])
await audit()
