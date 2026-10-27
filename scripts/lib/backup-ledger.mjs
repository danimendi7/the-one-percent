/**
 * Backup ledger: a successful restore drill leaves `<file>.drill.json` next to the backup
 * (origin, ref, backup time, result). `npm run cloud -- push` requires a recent cloud backup
 * of the target project with a passed drill before migrating (pre-migration rule).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export const BACKUP_DIR = join(homedir(), "Documents", "the-one-percent-backups")
export const PRE_MIGRATION_MAX_AGE_H = 24

export function recordDrill(file, meta, report) {
  const record = { source: meta.source, ref: meta.ref, startedAt: meta.startedAt, verifiedAt: new Date().toISOString(), tables: report.length, ok: report.every((r) => r.ok) }
  writeFileSync(`${file}.drill.json`, JSON.stringify(record, null, 2))
  return record
}

/** Pure: newest drill-verified cloud backup of `ref` taken within maxAgeH. */
export function pickVerifiedBackup(records, { ref, now = Date.now(), maxAgeH = PRE_MIGRATION_MAX_AGE_H }) {
  return (
    records
      .filter((r) => r.ok && r.source === "cloud" && r.ref === ref)
      .filter((r) => now - Date.parse(r.startedAt) <= maxAgeH * 3_600_000 && Date.parse(r.startedAt) <= now)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0] ?? null
  )
}

export function listDrillRecords(dir = BACKUP_DIR) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith(".topbak.drill.json"))
    .map((f) => {
      try {
        return { file: join(dir, f.replace(/\.drill\.json$/, "")), ...JSON.parse(readFileSync(join(dir, f), "utf8")) }
      } catch {
        return null
      }
    })
    .filter(Boolean)
}
