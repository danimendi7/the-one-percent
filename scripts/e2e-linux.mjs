#!/usr/bin/env node
/**
 * Full E2E validation in a disposable Linux container (M3.3 decision 7), the procedure used for
 * M3.2d. Needed before deploys because Node on this Windows machine can die with 0xC0000409 under
 * sustained load (docs/reports/m3.2d-e2e-crash-investigation.md).
 *
 *   npm run e2e:linux                       2 consecutive full runs, 3 workers
 *   npm run e2e:linux -- --runs 1 --workers 2
 *   npm run e2e:linux -- --remove-image     also delete the Playwright image afterwards
 *
 * Isolation guarantees:
 * - Validates the committed HEAD (git archive), built with `npm ci` and `next build` inside Linux.
 * - Own container and network (unique names, label com.theonepercent.purpose), no published ports,
 *   no volumes, memory/CPU limits. Other containers are never stopped, restarted or modified.
 * - The container reaches ONLY THE ONE PERCENT's local Supabase (55321 API, 55322 DB, 55324 Mailpit)
 *   through a loopback forwarder, so the tests' loopback guards stay on. The other local stack's
 *   ports (5432x) are never forwarded. Any non-local target aborts before anything is created.
 * - Secrets: only the two public values of .env.local are copied; the local stack status (with its
 *   local service key) is copied into the container and deleted from the host at once. Logs are
 *   scanned for those values before they are kept. Nothing is committed or pushed.
 * - The container and network are always removed at the end, also on failure. A run killed abruptly
 *   (e.g. by memory pressure) cannot clean up, so each run first removes leftovers of earlier runs:
 *   only resources carrying this script's label, and its own temp folders older than one hour.
 */
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkStatus, FORWARDED_PORTS, imageFor, LABEL, leaks, publicEnv, resourceNames, summarize } from "./lib/e2e-linux.mjs"

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : fallback
}
const RUNS = Number(arg("--runs", "2"))
const WORKERS = Number(arg("--workers", "3"))
const REMOVE_IMAGE = process.argv.includes("--remove-image")
if (!Number.isInteger(RUNS) || RUNS < 1 || RUNS > 5 || !Number.isInteger(WORKERS) || WORKERS < 1 || WORKERS > 6) {
  console.error("✖ --runs 1–5 y --workers 1–6")
  process.exit(2)
}

const log = (m) => console.log(m)
const fail = (m) => {
  console.error(`✖ ${m}`)
  process.exitCode = 1
}

function docker(args, opts = {}) {
  const r = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 1 << 28, ...opts })
  if (r.status !== 0 && !opts.allowFail) throw new Error(`docker ${args[0]} ${args[1] ?? ""}: ${(r.stderr || r.stdout || "").trim().split("\n").slice(-3).join(" | ")}`)
  return r
}

// ── Tools that run inside the container ─────────────────────────────────
const PROXY = `import net from "node:net"
const HOST = "host.docker.internal"
for (const port of ${JSON.stringify(FORWARDED_PORTS)}) for (const bind of ["127.0.0.1", "::1"]) {
  net.createServer((c) => {
    const u = net.connect(port, HOST)
    c.pipe(u); u.pipe(c)
    c.on("error", () => u.destroy()); u.on("error", () => c.destroy())
    c.on("close", () => u.destroy()); u.on("close", () => c.destroy())
  }).on("error", (e) => console.error("listen", bind, port, e.code)).listen(port, bind)
}
`
const SUPERVISOR = `import { spawn } from "node:child_process"
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
const log = "/work/out/server.log", mem = "/work/out/memory.csv", ts = () => new Date().toISOString()
writeFileSync(log, ts() + " supervisor node=" + process.version + "\\n")
writeFileSync(mem, "time,available_mb,server_rss_mb,alive\\n")
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3100"], { cwd: "/work/app", stdio: ["ignore", "pipe", "pipe"] })
child.stdout.on("data", (d) => appendFileSync(log, ts() + " OUT " + d))
child.stderr.on("data", (d) => appendFileSync(log, ts() + " ERR " + d))
let alive = true
child.on("exit", (code, signal) => { alive = false; appendFileSync(log, ts() + " SERVER EXITED code=" + code + " signal=" + signal + "\\n") })
const kb = (t, k) => Number(new RegExp(k + ":\\\\s+(\\\\d+)").exec(t)?.[1] ?? 0)
setInterval(() => {
  let avail = "", rss = ""
  try {
    const max = readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim()
    const used = Number(readFileSync("/sys/fs/cgroup/memory.current", "utf8"))
    avail = max === "max" ? Math.round(kb(readFileSync("/proc/meminfo", "utf8"), "MemAvailable") / 1024) : Math.round((Number(max) - used) / 1048576)
    if (alive) rss = Math.round(kb(readFileSync("/proc/" + child.pid + "/status", "utf8"), "VmRSS") / 1024)
  } catch {}
  appendFileSync(mem, ts() + "," + avail + "," + rss + "," + alive + "\\n")
}, 5000)
process.on("SIGTERM", () => { child.kill(); setTimeout(() => process.exit(0), 1500) })
`
const SHIM = `#!/bin/sh
if [ "$1" = "status" ]; then cat /run/top/status.json; exit 0; fi
echo "supabase shim: solo 'status' en el contenedor de validación" >&2
exit 1
`

// ── Preconditions (abort before creating anything) ──────────────────────
const repo = process.cwd()
const version = JSON.parse(readFileSync(join(repo, "node_modules/@playwright/test/package.json"), "utf8")).version
const image = imageFor(version)
const status = checkStatus(execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: process.platform === "win32" }))
const env = publicEnv(readFileSync(join(repo, ".env.local"), "utf8"))
const secrets = [status.SECRET_KEY, status.PUBLISHABLE_KEY, new URL(status.DB_URL.replace(/^postgresql:/, "http:")).password]
const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim()
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()
docker(["version", "--format", "{{.Server.Version}}"])
// Leftovers of an earlier run that was killed before its cleanup: only this script's label.
for (const c of docker(["ps", "-aq", "--filter", `label=${LABEL}`]).stdout.split(/\s+/).filter(Boolean)) docker(["rm", "-f", c], { allowFail: true })
for (const n of docker(["network", "ls", "-q", "--filter", `label=${LABEL}`]).stdout.split(/\s+/).filter(Boolean)) docker(["network", "rm", n], { allowFail: true })
for (const d of readdirSync(tmpdir()).filter((d) => d.startsWith("top-e2e-linux-"))) {
  const full = join(tmpdir(), d)
  if (Date.now() - statSync(full).mtimeMs > 3600_000) rmSync(full, { recursive: true, force: true })
}
const { container, network, stamp } = resourceNames()
if (docker(["ps", "-a", "--filter", `name=^${container}$`, "--format", "{{.Names}}"]).stdout.trim()) throw new Error(`Ya existe ${container}`)

const tmp = mkdtempSync(join(tmpdir(), "top-e2e-linux-"))
const out = join(tmp, "results")
mkdirSync(out)
log(`Validación Linux de ${head}${dirty ? " (hay cambios sin commit: se valida solo el commit)" : ""}`)
log(`  imagen ${image} · ${RUNS} ejecuciones · ${WORKERS} workers · contenedor ${container}`)

let created = false
const results = []
try {
  writeFileSync(join(tmp, "proxy.mjs"), PROXY)
  writeFileSync(join(tmp, "supervisor.mjs"), SUPERVISOR)
  writeFileSync(join(tmp, "supabase-shim.sh"), SHIM)
  writeFileSync(join(tmp, "env.local"), env, { mode: 0o600 })
  execFileSync("git", ["archive", "HEAD", "-o", join(tmp, "repo.tar")])

  docker(["pull", "-q", image])
  docker(["network", "create", "--label", LABEL, network])
  created = true
  docker([
    "create", "--name", container, "--label", LABEL, "--network", network,
    "--memory", "4g", "--cpus", "6", "--shm-size", "1g", "-e", "TZ=Europe/Madrid", "-w", "/work/app",
    // The forwarder is copied in after start: wait for it (up to 60 s), or the container could exit first.
    image, "bash", "-c", "for i in $(seq 1 300); do [ -f /work/tools/proxy.mjs ] && exec node /work/tools/proxy.mjs; sleep 0.2; done; exit 1",
  ])
  docker(["start", container])
  docker(["exec", container, "mkdir", "-p", "/work/tools", "/work/app", "/work/out", "/run/top"])
  for (const f of ["proxy.mjs", "supervisor.mjs", "supabase-shim.sh"]) docker(["cp", join(tmp, f), `${container}:/work/tools/${f}`])
  docker(["cp", join(tmp, "repo.tar"), `${container}:/work/repo.tar`])
  docker(["cp", join(tmp, "env.local"), `${container}:/work/app/.env.local`])
  // The local stack status goes straight into the container; the host copy is deleted at once.
  const statusFile = join(tmp, "status.json")
  writeFileSync(statusFile, JSON.stringify(status), { mode: 0o600 })
  try {
    docker(["cp", statusFile, `${container}:/run/top/status.json`])
  } finally {
    rmSync(statusFile, { force: true })
  }

  log("Instalando y compilando dentro de Linux…")
  const prep = docker(["exec", container, "bash", "-c", [
    "set -e",
    "tar -xf /work/repo.tar -C /work/app && rm /work/repo.tar",
    "cd /work/app",
    "npm ci --no-audit --no-fund > /work/out/npm-ci.log 2>&1",
    "rm -f node_modules/.bin/supabase && cp /work/tools/supabase-shim.sh node_modules/.bin/supabase && chmod +x node_modules/.bin/supabase",
    "npm run build > /work/out/build.log 2>&1",
    "nohup node /work/tools/supervisor.mjs >/dev/null 2>&1 &",
    "for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3100/ && exit 0; sleep 1; done; exit 1",
  ].join("\n")], { allowFail: true })
  if (prep.status !== 0) throw new Error("Falló la instalación, la compilación o el arranque del servidor (ver npm-ci.log, build.log, server.log)")

  for (let run = 1; run <= RUNS; run++) {
    log(`Ejecución ${run}/${RUNS}…`)
    const r = docker(["exec", container, "bash", "-c", `cd /work/app && npx playwright test --grep-invert @screens --workers=${WORKERS} --reporter=list > /work/out/run${run}.txt 2>&1; echo $?`], { allowFail: true })
    const text = docker(["exec", container, "cat", `/work/out/run${run}.txt`]).stdout
    const alive = docker(["exec", container, "bash", "-c", "pgrep -f 'next start' >/dev/null && echo yes || echo no"]).stdout.trim() === "yes"
    const s = { run, exit: Number(r.stdout.trim()), serverAlive: alive, ...summarize(text) }
    results.push(s)
    log(`  ${s.passed} superadas · ${s.failed} fallidas · ${s.flaky} inestables · ${s.skipped} omitidas · servidor ${alive ? "vivo" : "CAÍDO"}`)
    if (s.exit !== 0 || !alive) break
  }

  // Keep the logs (after checking that no secret value appears in them).
  for (const f of docker(["exec", container, "ls", "/work/out"]).stdout.trim().split("\n")) docker(["cp", `${container}:/work/out/${f}`, join(out, f)])
  for (const f of readdirSync(out)) {
    if (leaks(readFileSync(join(out, f), "utf8"), secrets)) {
      rmSync(join(out, f))
      fail(`${f} contenía un valor secreto y se ha borrado`)
    }
  }
  const serverLog = readFileSync(join(out, "server.log"), "utf8")
  const serverErrors = serverLog.split("\n").filter((l) => / ERR |EXITED/.test(l)).length
  writeFileSync(join(out, "summary.json"), JSON.stringify({ head, image, workers: WORKERS, results, serverErrors, stamp }, null, 2))
  const ok = results.length === RUNS && results.every((r) => r.exit === 0 && r.failed === 0 && r.flaky === 0 && r.interrupted === 0 && r.serverAlive) && serverErrors === 0
  log(ok ? `✔ ${RUNS} ejecuciones completas consecutivas sin fallos en Linux.` : "✖ La validación no es limpia: revisa los registros.")
  if (!ok) process.exitCode = 1
} catch (e) {
  fail(e instanceof Error ? e.message : String(e))
} finally {
  // Only this validation's resources; nothing else is ever touched.
  if (created) {
    docker(["rm", "-f", container], { allowFail: true })
    docker(["network", "rm", network], { allowFail: true })
  }
  if (REMOVE_IMAGE) docker(["rmi", image], { allowFail: true })
  rmSync(join(tmp, "repo.tar"), { force: true })
  rmSync(join(tmp, "env.local"), { force: true })
  log(`Registros: ${out}`)
}
