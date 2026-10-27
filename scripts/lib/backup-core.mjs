/**
 * Backup helpers. pg_dump/psql run inside THIS project's local DB container
 * (supabase_db_the-one-percent, PostgreSQL 17), so no client install is needed
 * and the cloud connection string never touches disk.
 */
import { spawnSync } from "node:child_process"
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto"
import { gunzipSync, gzipSync } from "node:zlib"

export const CONTAINER = "supabase_db_the-one-percent"
export const LOCAL_URL_IN_CONTAINER = "postgresql://postgres:postgres@127.0.0.1:5432/postgres"
const MAGIC = Buffer.from("TOPB1")

/** Tables included in a logical backup (data only; schema comes from migrations). */
export const TABLE_PATTERNS = ["public.*", "private.*", "auth.users", "auth.identities"]

/** Per-table fingerprints used to prove a restore is identical. */
export const MANIFEST_SQL = `
select json_agg(x order by x->>'table') from (
  select json_build_object('table', format('%I.%I', n.nspname, c.relname),
    'rows', (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::int,
    'hash', (xpath('/row/h/text()', query_to_xml(format(
       'select coalesce(md5(string_agg(t::text, %L order by t::text)), %L) as h from %I.%I t', '|', '', n.nspname, c.relname), false, true, '')))[1]::text
  ) x
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and n.nspname in ('public', 'private')
  union all
  select json_build_object('table', 'auth.users', 'rows', count(*), 'hash', coalesce(md5(string_agg(id::text, '|' order by id::text)), '')) from auth.users
  union all
  select json_build_object('table', 'public.change_seq', 'rows', 0, 'hash', (select last_value::text from public.change_seq))
) s;`

export function docker(args, input) {
  const r = spawnSync("docker", args, { input, encoding: "utf8", maxBuffer: 1024 * 1024 * 512 })
  if (r.status !== 0) throw new Error(`docker ${args.slice(0, 3).join(" ")} failed: ${r.stderr?.slice(0, 500)}`)
  return r.stdout
}

export function assertContainer() {
  const names = docker(["ps", "--format", "{{.Names}}"]).split(/\r?\n/)
  if (!names.includes(CONTAINER)) throw new Error(`El contenedor ${CONTAINER} no está en marcha. Ejecuta "npm run db:start".`)
}

export function dumpData(url) {
  const tables = TABLE_PATTERNS.flatMap((t) => ["-t", t])
  return docker(["exec", CONTAINER, "pg_dump", url, "--data-only", "--no-owner", "--no-privileges", "--disable-triggers", ...tables])
}

export function manifest(url, container = CONTAINER) {
  const out = docker(["exec", container, "psql", url, "-At", "-v", "ON_ERROR_STOP=1", "-c", MANIFEST_SQL])
  return JSON.parse(out.trim())
}

export function compareManifests(expected, actual) {
  const byTable = new Map(actual.map((t) => [t.table, t]))
  return expected.map((e) => {
    const a = byTable.get(e.table)
    return { table: e.table, rows: e.rows, ok: !!a && a.rows === e.rows && a.hash === e.hash, restoredRows: a?.rows ?? null }
  })
}

function key(passphrase, salt) {
  if (!passphrase || passphrase.length < 12) throw new Error("BACKUP_PASSPHRASE debe tener al menos 12 caracteres.")
  return scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
}

/** AES-256-GCM over gzip(JSON). Authenticated: any tampering or a wrong passphrase fails. */
export function encrypt(payload, passphrase) {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(passphrase, salt), iv)
  const body = Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(payload)))), cipher.final()])
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body])
}

export function decrypt(buf, passphrase) {
  if (!buf.subarray(0, 5).equals(MAGIC)) throw new Error("No es un fichero de copia de THE ONE PERCENT.")
  const salt = buf.subarray(5, 21)
  const iv = buf.subarray(21, 33)
  const tag = buf.subarray(33, 49)
  const decipher = createDecipheriv("aes-256-gcm", key(passphrase, salt), iv)
  decipher.setAuthTag(tag)
  try {
    const plain = Buffer.concat([decipher.update(buf.subarray(49)), decipher.final()])
    return JSON.parse(gunzipSync(plain).toString("utf8"))
  } catch {
    throw new Error("No se pudo descifrar: contraseña incorrecta o fichero alterado.")
  }
}
