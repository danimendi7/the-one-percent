#!/usr/bin/env node
/**
 * Encrypted logical backup (data of public/private + auth users/identities).
 *
 *   npm run backup -- --source local
 *   npm run backup -- --source cloud        (needs SUPABASE_DB_URL in this terminal only)
 *
 * Requires BACKUP_PASSPHRASE (≥12 chars, keep it in your password manager).
 * Output: ~/Documents/the-one-percent-backups/top-<source>-<timestamp>.topbak (outside the repo).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { assertContainer, dumpData, encrypt, LOCAL_URL_IN_CONTAINER, manifest } from "./lib/backup-core.mjs"
import { evaluateDbUrl } from "./lib/cloud-guard.mjs"

export function runBackup(source, { dir } = {}) {
  const passphrase = process.env.BACKUP_PASSPHRASE
  if (!passphrase) throw new Error("Define BACKUP_PASSPHRASE en esta terminal (no se guarda en ningún sitio).")
  let url = LOCAL_URL_IN_CONTAINER
  let ref = "local"
  if (source === "cloud") {
    const cfg = JSON.parse(readFileSync("supabase/cloud-project.json", "utf8"))
    url = process.env.SUPABASE_DB_URL ?? ""
    const check = evaluateDbUrl(url, cfg)
    if (!check.ok) throw new Error(check.problems.join("\n"))
    ref = cfg.ref
  } else if (source !== "local") {
    throw new Error('--source debe ser "local" o "cloud".')
  }
  assertContainer()

  const startedAt = new Date().toISOString()
  const fingerprints = manifest(url)
  const sql = dumpData(url)
  const payload = { meta: { app: "the-one-percent", version: 1, source, ref, startedAt, finishedAt: new Date().toISOString() }, manifest: fingerprints, sql }

  const outDir = dir ?? join(homedir(), "Documents", "the-one-percent-backups")
  mkdirSync(outDir, { recursive: true })
  const file = join(outDir, `top-${source}-${startedAt.replace(/[:.]/g, "-")}.topbak`)
  writeFileSync(file, encrypt(payload, passphrase))
  const rows = fingerprints.filter((t) => t.table !== "public.change_seq").reduce((n, t) => n + t.rows, 0)
  return { file, tables: fingerprints.length, rows }
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("backup.mjs")) {
  const i = process.argv.indexOf("--source")
  const source = i > 0 ? process.argv[i + 1] : "local"
  try {
    const r = runBackup(source)
    console.log(`✔ Copia cifrada: ${r.file}\n  ${r.tables} tablas, ${r.rows} filas.`)
  } catch (e) {
    console.error(`✖ ${e.message}`)
    process.exit(1)
  }
}
