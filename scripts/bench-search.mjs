#!/usr/bin/env node
/**
 * M4e search benchmark: Cerebro's search over the SYNTHETIC library (5.000 and 10.000 notes), in
 * real Chromium at normal speed and with the CPU slowed 4× (DevTools; an approximation of a
 * mid-range phone, not a real device). Same code as the development page /dev/knowledge.
 *
 *   npm run bench:search [-- --out docs/reports/m4e-search.json]
 *
 * Local only: the page is served from memory, no account, no network, no cloud. The synthetic
 * IndexedDB copy is written to its own database and deleted by name at the end.
 */
import { writeFileSync } from "node:fs"
import os from "node:os"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"
import { build } from "rolldown"

const root = fileURLToPath(new URL("..", import.meta.url))
const outArg = process.argv.indexOf("--out")
const out = outArg > 0 ? process.argv[outArg + 1] : null

const bundle = await build({
  input: fileURLToPath(new URL("./bench/search.entry.ts", import.meta.url)),
  resolve: { alias: { "@": `${root}src` } },
  platform: "browser",
  write: false,
  output: { format: "iife", minify: true },
  logLevel: "warn",
})
const code = bundle.output[0].code

const browser = await chromium.launch()
const results = { date: new Date().toISOString(), env: { chromium: browser.version(), cpu: os.cpus()[0]?.model, cores: os.cpus().length, ramGB: Math.round(os.totalmem() / 2 ** 30), node: process.version }, runs: [] }

async function heap(cdp) {
  await cdp.send("HeapProfiler.collectGarbage")
  return (await cdp.send("Runtime.getHeapUsage")).usedSize / 2 ** 20
}

for (const size of ["5k", "10k"]) {
  for (const throttle of [1, 4]) {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.route("http://bench.local/**", (r) =>
      r.request().url().endsWith(".js")
        ? r.fulfill({ contentType: "text/javascript", body: code })
        : r.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><script src="/bench.js"></script>' })
    )
    await page.goto("http://bench.local/")
    const cdp = await context.newCDPSession(page)
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle })
    const before = await heap(cdp)
    const r = await page.evaluate(async (s) => {
      return await globalThis.bench.run(s, { runs: 30 })
    }, size)
    const after = await heap(cdp)
    const leftover = await page.evaluate(async (name) => (await indexedDB.databases()).some((d) => d.name === name), "the-one-percent-bench-synthetic")
    results.runs.push({ size, cpuThrottle: throttle, ...r, heapAfterGcMB: after - before, syntheticDbLeftOver: leftover })
    console.error(`✔ ${size} ×${throttle}`)
    await context.close()
  }
}
await browser.close()

const f = (n) => (n == null ? "N/D" : n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2))
for (const r of results.runs) {
  console.log(`\n## ${r.size} · CPU ×${r.cpuThrottle} · ${r.notes} notas, ${r.items} contenidos`)
  console.log(`índice en frío ${f(r.index.coldMs)} ms (${r.index.docs} documentos, ${r.index.tokens} tokens) · por tramos de ${r.sliced.sliceBudgetMs} ms: ${f(r.sliced.totalMs)} ms en ${r.sliced.slices} tramos, el más largo ${f(r.sliced.longestSliceMs)} ms`)
  console.log(`incremental: editar nota ${f(r.incremental.editNoteMs)} ms · mover nota ${f(r.incremental.moveNoteMs)} ms · renombrar contenido con ${r.incremental.renamedNotes} notas ${f(r.incremental.renameContentMs)} ms`)
  for (const [k, v] of Object.entries(r.queries)) console.log(`  «${k}»: mediana ${f(v.median)} ms · p95 ${f(v.p95)} ms · ${v.hits} notas`)
  console.log(`  tecleo (búsqueda + explicación + resaltado de 60): mediana ${f(r.typing.median)} ms · p95 ${f(r.typing.p95)} ms · máx ${f(r.typing.max)} ms`)
  for (const [k, v] of Object.entries(r.combined)) console.log(`  filtros «${k}»: mediana ${f(v.median)} ms · p95 ${f(v.p95)} ms · ${v.hits} notas`)
  console.log(`memoria tras GC (estado + índice vivos): ${f(r.heapAfterGcMB)} MB · copia sintética: escribir ${f(r.storage?.writeMs)} ms, leer ${f(r.storage?.readMs)} ms, borrada ${r.storage?.deleted} · quedó la base: ${r.syntheticDbLeftOver}`)
}
if (out) {
  writeFileSync(out, JSON.stringify(results, null, 2) + "\n")
  console.log(`\nResultados en ${out}`)
}
