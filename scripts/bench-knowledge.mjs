#!/usr/bin/env node
/**
 * M4a volume benchmark (requirement F/G): the knowledge domain with a SYNTHETIC library of 5.000
 * and 10.000 notes, measured in real Chromium (Playwright's browser, real IndexedDB):
 * - sizes of the state (JSON, gzip) and clone cost;
 * - IndexedDB write, read and the engine's save cycle (read + write of the whole record);
 * - search index build, rebuild after one edit, queries and list filters;
 * - JS heap used by the state and the index.
 * Each scenario runs at normal speed and with the CPU slowed 4× through DevTools (an approximation
 * of a mid-range phone, not a real device).
 *
 *   npm run bench:knowledge [-- --out docs/reports/m4a-volume.json]
 *
 * Local only: no network (the page is served from memory), no account, no cloud.
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
  input: fileURLToPath(new URL("./bench/knowledge-volume.entry.ts", import.meta.url)),
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
  return (await cdp.send("Runtime.getHeapUsage")).usedSize
}

for (const preset of ["5k", "10k"]) {
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
    const heap0 = await heap(cdp)
    const size = await page.evaluate((p) => globalThis.bench.presets[p], preset)
    const generated = await page.evaluate((s) => globalThis.bench.generate(s), size)
    const heapState = (await heap(cdp)) - heap0
    const sizes = await page.evaluate(() => globalThis.bench.sizes())
    const indexedDb = await page.evaluate(() => globalThis.bench.indexedDb(7))
    const heap1 = await heap(cdp)
    const index = await page.evaluate(() => globalThis.bench.index())
    const heapIndex = (await heap(cdp)) - heap1
    const queries = await page.evaluate(() => globalThis.bench.queries(25))
    const lists = await page.evaluate(() => globalThis.bench.lists(25))
    results.runs.push({ preset, cpuThrottle: throttle, generated, heapMB: { state: heapState / 2 ** 20, index: heapIndex / 2 ** 20 }, sizes, indexedDb, index, queries, lists })
    console.error(`✔ ${preset} ×${throttle}`)
    await context.close()
  }
}
await browser.close()

const f = (n) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2))
for (const r of results.runs) {
  console.log(`\n## ${r.preset} notas · CPU ×${r.cpuThrottle}`)
  console.log(`notas ${r.generated.notes}, contenidos ${r.generated.items}, programas ${r.generated.shows}, enlaces ${r.generated.links}, media ${f(r.generated.noteChars / r.generated.notes)} car./nota`)
  console.log(`estado: JSON ${f(r.sizes.jsonBytes / 2 ** 20)} MB · gzip ${f(r.sizes.gzipBytes / 2 ** 20)} MB · heap estado ${f(r.heapMB.state)} MB · heap índice ${f(r.heapMB.index)} MB`)
  console.log(`stringify ${f(r.sizes.stringifyMs)} ms · parse ${f(r.sizes.parseMs)} ms · structuredClone ${f(r.sizes.cloneMs)} ms`)
  const s = r.indexedDb
  console.log(`IndexedDB put ${f(s.put.median)} ms (p95 ${f(s.put.p95)}) · get ${f(s.get.median)} ms (p95 ${f(s.get.p95)}) · ciclo de guardado ${f(s.saveCycle.median)} ms (p95 ${f(s.saveCycle.p95)}) · registro vacío ${f(s.baselinePut.median)} ms`)
  console.log(`índice: frío ${f(r.index.coldMs)} ms · reductor 1 edición ${f(r.index.reducerMs)} ms · actualización incremental ${f(r.index.incrementalMs)} ms · reconstrucción completa ${f(r.index.fullRebuildMs)} ms · ${r.index.tokens} tokens`)
  for (const [k, v] of Object.entries(r.queries)) console.log(`  búsqueda «${k}»: mediana ${f(v.median)} ms · p95 ${f(v.p95)} ms · ${v.hits} notas`)
  for (const [k, v] of Object.entries(r.lists)) console.log(`  lista «${k}»: mediana ${f(v.median)} ms · p95 ${f(v.p95)} ms`)
}
if (out) {
  writeFileSync(out, JSON.stringify(results, null, 2) + "\n")
  console.log(`\nResultados en ${out}`)
}
