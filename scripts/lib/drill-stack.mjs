/**
 * Throwaway Supabase stack for restore drills, isolated from the dev stack and the cloud:
 * own project id (the-one-percent-drill), own ports (556xx), own Docker volumes, no seed.
 * Built in a temp folder from this repo's migrations; destroyed (volumes included) afterwards.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { supabaseCli } from "./supabase-cli.mjs"

export const DRILL_PROJECT = "the-one-percent-drill"
export const DRILL_CONTAINER = `supabase_db_${DRILL_PROJECT}`
// Only Postgres and GoTrue (its migrations create the auth tables the backup restores into).
const EXCLUDE = "realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor"

/** Pure: the drill config derived from the dev config. Exported for tests. */
export function drillConfig(toml) {
  let out = toml.replace(/^project_id\s*=.*$/m, `project_id = "${DRILL_PROJECT}"`)
  // Every dev port is 553xx; the drill uses the same offsets in 556xx.
  out = out.replace(/^(\s*\w*port\s*=\s*)553(\d\d)\b/gm, "$1556$2")
  // No seed: the restored rows (including the allowlist) come only from the backup.
  out = out.replace(/(\[db\.seed\][^[]*?enabled\s*=\s*)true/, "$1false")
  return out
}

export function startDrillStack() {
  const dir = mkdtempSync(join(tmpdir(), "top-drill-"))
  cpSync("supabase/migrations", join(dir, "supabase", "migrations"), { recursive: true })
  cpSync("supabase/templates", join(dir, "supabase", "templates"), { recursive: true })
  writeFileSync(join(dir, "supabase", "config.toml"), drillConfig(readFileSync("supabase/config.toml", "utf8")))
  const r = supabaseCli(["start", "--workdir", dir, "-x", EXCLUDE], { stdio: ["ignore", "ignore", "inherit"] })
  if (r.status !== 0) {
    stopDrillStack(dir)
    throw new Error("No se pudo arrancar el stack aislado del simulacro.")
  }
  return dir
}

export function stopDrillStack(dir) {
  supabaseCli(["stop", "--workdir", dir, "--no-backup"], { stdio: "ignore" })
  rmSync(dir, { recursive: true, force: true })
}
