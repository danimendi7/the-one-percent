#!/usr/bin/env node
/**
 * Orden 3 · Auditoría de secretos por valor. Busca los valores reales de los archivos .env* locales
 * (ignorados por git) en TODOS los objetos de uno o varios repositorios git (también los que no
 * están en ninguna rama) y en carpetas de informes, sin mostrar nunca un valor: solo su nombre y
 * dónde aparece. Complementa a gitleaks, que busca formas conocidas de secretos.
 *
 *   npm run audit:secrets                      → este repo, con los .env* de esta carpeta
 *   npm run audit:secrets -- --repo <ruta.git> → otro repo (p. ej. un espejo de GitHub con refs/pull/*)
 *   npm run audit:secrets -- --dir <carpeta>   → archivos sueltos (artefactos y registros de la CI)
 *   npm run audit:secrets -- --env <archivo>   → otro archivo de variables (se puede repetir)
 *
 * Sale con 1 si encuentra un valor secreto, 2 si no hay nada que buscar o falla una lectura.
 * Los valores públicos por diseño (NEXT_PUBLIC_*, VAPID_SUBJECT…) se listan como información.
 */
import { spawn, spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { buildNeedles, classify, createBatchParser, findIn, parseEnv } from "./lib/secret-scan.mjs"

const MAX_FILE = 200 * 1024 * 1024
const SKIP_DIRS = new Set([".git", "node_modules", ".next"])

function parseArgs(argv) {
  const opts = { repos: [], dirs: [], envs: [] }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (!["--repo", "--dir", "--env"].includes(flag) || !value) {
      console.error(`Argumento no válido: ${flag}`)
      process.exit(2)
    }
    opts[{ "--repo": "repos", "--dir": "dirs", "--env": "envs" }[flag]].push(resolve(value))
    i++
  }
  if (opts.repos.length === 0 && opts.dirs.length === 0) opts.repos.push(resolve("."))
  if (opts.envs.length === 0) {
    opts.envs = readdirSync(".")
      .filter((f) => f.startsWith(".env") && f !== ".env.example" && statSync(f).isFile())
      .map((f) => resolve(f))
  }
  return opts
}

function scanRepo(repo, list) {
  return new Promise((done, fail) => {
    const hits = []
    let objects = 0
    const git = spawn("git", ["-C", repo, "cat-file", "--batch-all-objects", "--batch", "--unordered"], { stdio: ["ignore", "pipe", "pipe"] })
    const feed = createBatchParser(({ oid, type, data }) => {
      objects++
      for (const n of findIn(data, list)) hits.push({ oid, type, needle: n })
    })
    let stderr = ""
    git.stdout.on("data", feed)
    git.stderr.on("data", (d) => (stderr += d))
    git.on("close", (code) => (code === 0 ? done({ hits, objects }) : fail(new Error(`git cat-file en ${repo}: ${stderr.trim()}`))))
  })
}

/** Commits and paths where a blob appears, or the commit itself; empty when nothing reaches it. */
function whereInRepo(repo, { oid, type }) {
  if (type === "commit") return [`commit ${oid.slice(0, 7)} (mensaje o cabecera del commit)`]
  if (type !== "blob") return [`${type} ${oid.slice(0, 7)}`]
  const out = spawnSync("git", ["-C", repo, "log", "--all", "--format=@%h %ad", "--date=short", "--name-only", `--find-object=${oid}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  const places = []
  let commit = null
  for (const line of out.stdout.split("\n")) {
    if (line.startsWith("@")) commit = line.slice(1)
    else if (line.trim() && commit) places.push(`commit ${commit} · ${line.trim()}`)
  }
  return places.length ? places : [`blob ${oid.slice(0, 7)} sin rama que lo alcance (objeto suelto, solo en este clon)`]
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (entry.isFile()) yield path
  }
}

function scanDir(dir, list) {
  const hits = []
  let files = 0
  for (const path of walk(dir)) {
    if (statSync(path).size > MAX_FILE) continue
    files++
    const where = relative(dir, path)
    for (const n of findIn(readFileSync(path), list)) hits.push({ where, needle: n })
    if (path.endsWith(".zip")) {
      // Traces and reports are zips: their entries are searched once uncompressed.
      const unzip = spawnSync("unzip", ["-p", path], { maxBuffer: MAX_FILE })
      if (unzip.stdout) for (const n of findIn(unzip.stdout, list)) hits.push({ where: `${where} (dentro del zip)`, needle: n })
    }
  }
  return { hits, files }
}

function report(title, hits, describe) {
  const secret = hits.filter((h) => h.needle.kind === "secret")
  const pub = hits.filter((h) => h.needle.kind === "public")
  for (const h of secret) for (const place of describe(h)) console.log(`  SECRETO  ${h.needle.label} · ${place}`)
  const byLabel = new Map()
  for (const h of pub) byLabel.set(h.needle.label, [...(byLabel.get(h.needle.label) ?? []), h])
  for (const [label, list] of byLabel) {
    const first = describe(list[0])[0]
    console.log(`  público  ${label} · ${list.length} ${list.length === 1 ? "objeto" : "objetos"} (no es un fallo; p. ej. ${first})`)
  }
  if (hits.length === 0) console.log("  sin coincidencias")
  console.log(`  → ${title}`)
  return secret.length
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const entries = opts.envs.filter((f) => existsSync(f)).flatMap((f) => parseEnv(readFileSync(f, "utf8")))
  const list = buildNeedles(entries)
  const secrets = [...new Set(list.filter((n) => n.kind === "secret").map((n) => n.label))]
  const publics = [...new Set(list.filter((n) => n.kind === "public").map((n) => n.label))]
  console.log("Auditoría de secretos por valor (los valores nunca se muestran)")
  console.log(`Archivos de variables: ${opts.envs.map((f) => relative(".", f) || f).join(", ") || "ninguno"}`)
  console.log(`Secretos buscados (${secrets.length}): ${secrets.join(", ") || "ninguno"}`)
  console.log(`Públicos, solo informativos (${publics.length}): ${publics.join(", ") || "ninguno"}`)
  const skipped = [...new Set(entries.filter((e) => classify(e.name, e.value) === "skip").map((e) => e.name))]
  console.log(`Vacíos o demasiado cortos, no buscados (${skipped.length}): ${skipped.join(", ") || "ninguno"}`)
  if (secrets.length === 0) {
    console.error("No hay ningún valor secreto que buscar: ¿faltan los .env*.local?")
    process.exit(2)
  }
  let found = 0
  for (const repo of opts.repos) {
    console.log(`\nRepositorio ${repo}`)
    const { hits, objects } = await scanRepo(repo, list)
    found += report(`${objects} objetos de git revisados`, hits, (h) => whereInRepo(repo, h))
  }
  for (const dir of opts.dirs) {
    console.log(`\nCarpeta ${dir}`)
    const { hits, files } = scanDir(dir, list)
    found += report(`${files} archivos revisados`, hits, (h) => [h.where])
  }
  console.log(found === 0 ? "\nResultado: ningún valor secreto encontrado." : `\nResultado: ${found} apariciones de valores secretos.`)
  process.exit(found === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(2)
})
