#!/usr/bin/env node
/**
 * G1 (Orden 2 §1) · Force-closing the app right after an offline mark, in real Chromium: the real
 * SyncEngine, the real device copy (IndexedDB), the real journal (localStorage), CPU slowed down.
 * Each run: a fresh browser profile, one mark offline, the tab closed the moment the mark is queued
 * (no wait for the device copy), a new tab started over the same storage. Measured without the
 * journal (before G1) and with it, so the result shows the race is real and that G1 closes it.
 *
 *   npm run bench:journal [-- --runs 30 --cpu 6 --out docs/reports/g1-journal.json]
 *
 * Local only: the page is served from memory on a loopback address (a secure context, as the app,
 * so Web Locks and crypto.randomUUID behave the same), no account, no network, no cloud. This is
 * the engine half of the account E2E (e2e/account.spec.ts, «Orden 2 §1»); the server half (one row)
 * needs the CI's local Supabase.
 */
import { writeFileSync } from "node:fs"
import { createServer } from "node:http"
import os from "node:os"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"
import { build } from "rolldown"

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const RUNS = Number(arg("runs", "30"))
const CPU = Number(arg("cpu", "6"))
const OUT = arg("out", null)

const root = fileURLToPath(new URL("..", import.meta.url))
const bundle = await build({
  input: fileURLToPath(new URL("./bench/journal.entry.ts", import.meta.url)),
  resolve: { alias: { "@": `${root}src` } },
  platform: "browser",
  write: false,
  output: { format: "iife" },
  logLevel: "silent",
})
const code = bundle.output[0].code
const server = createServer((req, res) => {
  if (req.url?.endsWith(".js")) res.writeHead(200, { "content-type": "text/javascript" }).end(code)
  else res.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><meta charset="utf-8"><script src="/bench.js"></script>')
})
await new Promise((r) => server.listen(0, "127.0.0.1", r))
const ORIGIN = `http://127.0.0.1:${server.address().port}/`
const call = (page, fn, ...args) => page.evaluate(([f, a]) => globalThis.bench[f](...a), [fn, args])

const browser = await chromium.launch()
const results = {
  date: new Date().toISOString(),
  env: { chromium: browser.version(), cpu: os.cpus()[0]?.model, cores: os.cpus().length, node: process.version },
  runs: RUNS,
  cpuThrottle: CPU,
  modes: [],
}

for (const journal of [false, true]) {
  const mode = { journal, survived: 0, lost: 0, duplicated: 0, deviceCopyHadIt: 0, journalLeftAfterStart: 0, journalLeftAfterNextSave: 0 }
  for (let i = 0; i < RUNS; i++) {
    const context = await browser.newContext()
    let page = await context.newPage()
    await page.goto(ORIGIN)
    await call(page, "start", journal)
    const cdp = await context.newCDPSession(page)
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU })
    const queued = await call(page, "mark", "2026-11-11")
    if (queued !== 1) throw new Error(`expected one queued mark, got ${queued}`)
    // Swiped away: the tab closes without waiting for the device copy.
    await page.close()

    page = await context.newPage()
    await page.goto(ORIGIN)
    const reopened = await call(page, "start", journal)
    if (reopened.inCopy > 0) mode.deviceCopyHadIt++
    if (reopened.queued === 1) mode.survived++
    else if (reopened.queued === 0) mode.lost++
    else mode.duplicated++
    await call(page, "whenSaved")
    // An entry whose operation the device copy already held is adopted, not re-added, and released
    // by the next save (the closed tab saved the copy but not the release that follows it).
    if ((await call(page, "journalKeys")) > 0) mode.journalLeftAfterStart++
    await call(page, "mark", "2026-11-12")
    await call(page, "whenSaved")
    if ((await call(page, "journalKeys")) > 0) mode.journalLeftAfterNextSave++
    await context.close()
  }
  results.modes.push(mode)
  console.log(
    `${journal ? "Con diario (G1)" : "Sin diario (antes de G1)"}: la marca sobrevive en ${mode.survived} de ${RUNS}, se pierde en ${mode.lost}, duplicada en ${mode.duplicated} · la copia del dispositivo ya la tenía en ${mode.deviceCopyHadIt}` +
      (journal ? ` · entradas del diario tras arrancar: ${mode.journalLeftAfterStart}, tras el siguiente guardado: ${mode.journalLeftAfterNextSave}` : "")
  )
}
await browser.close()
server.close()

if (OUT) {
  writeFileSync(OUT, JSON.stringify(results, null, 2) + "\n")
  console.log(`\nResultados en ${OUT}`)
}
const withJournal = results.modes.find((m) => m.journal)
process.exitCode = withJournal.survived === RUNS && withJournal.journalLeftAfterNextSave === 0 ? 0 : 1
