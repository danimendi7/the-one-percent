#!/usr/bin/env node
/**
 * F2 · Load and response of the key views, measured in real Chromium against a production build
 * (PRD §7: daily tracker usable in < 3 s on decent 4G with a warm cache; one-tap feedback < 100 ms).
 *
 * Phone profile: 375×812, touch, CPU slowed 4× and a «decent 4G» network (9 Mbps down, 1.5 up,
 * 85 ms RTT) through DevTools. An approximation of a mid-range phone, not a real device.
 * Demo mode (no account, no cloud): the views render the same components an account does.
 *
 *   npm run build && npx next start -p 3100    (in another terminal; or any BASE_URL)
 *   npm run measure:views [-- --runs 5 --out docs/reports/f2-views.json] [-- --view /habits]
 *
 * Per view and run: cold (empty cache) and warm (same browser, second visit) — first contentful
 * paint, largest contentful paint, layout shift (CLS) and the time until the view shows its data
 * (`ready`). No time to first byte: DevTools network emulation does not show in it. On the Resumen it also times a tap on a habit until the screen shows it.
 */
import { writeFileSync } from "node:fs"
import { chromium } from "@playwright/test"

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const BASE = process.env.BASE_URL ?? "http://localhost:3100"
const RUNS = Number(arg("runs", "5"))
const OUT = arg("out", null)
const ONLY = arg("view", null)
const NETWORK = { offline: false, latency: 85, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 }

/** What «the view shows its data» means for each one: an element that only exists with data. */
const VIEWS = [
  { path: "/", ready: '[data-testid="overview-day"]' },
  { path: "/habits", ready: '[aria-label="Hoy"] button, [role="region"][aria-label="Matriz semanal"] button' },
  { path: "/analytics", ready: "main h2" },
  { path: "/knowledge/library", ready: 'a[href*="/knowledge/library/item"]' },
  { path: "/goals", ready: 'a[href^="/goals/"]' },
]

/** Collects paint and layout-shift entries from the start of the page. */
const OBSERVE = () => {
  const w = window
  w.__perf = { lcp: 0, cls: 0, fcp: 0 }
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) w.__perf.lcp = e.startTime
  }).observe({ type: "largest-contentful-paint", buffered: true })
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (!e.hadRecentInput) w.__perf.cls += e.value
  }).observe({ type: "layout-shift", buffered: true })
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (e.name === "first-contentful-paint") w.__perf.fcp = e.startTime
  }).observe({ type: "paint", buffered: true })
}

async function visit(page, view) {
  const t0 = Date.now()
  await page.goto(BASE + view.path, { waitUntil: "commit" })
  await page.locator(view.ready).first().waitFor({ timeout: 30_000 })
  const ready = Date.now() - t0
  await page.waitForTimeout(1500) // late shifts and the final LCP candidate
  const m = await page.evaluate(() => window.__perf)
  return { ready, fcp: Math.round(m.fcp), lcp: Math.round(m.lcp), cls: Number(m.cls.toFixed(3)) }
}

/** From the tap to the frame that shows the habit as done (the button's aria-pressed flips). */
async function tap(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const button = document.querySelector('[aria-label="Hoy"] button[aria-pressed="false"]')
        if (!button) return resolve(null)
        const t0 = performance.now()
        const obs = new MutationObserver(() => {
          if (button.getAttribute("aria-pressed") === "true") {
            obs.disconnect()
            requestAnimationFrame(() => resolve(Math.round(performance.now() - t0)))
          }
        })
        obs.observe(button, { attributes: true, attributeFilter: ["aria-pressed"] })
        button.click()
      })
  )
}

const median = (xs) => {
  const s = xs.filter((x) => x !== null).sort((a, b) => a - b)
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null
}

const browser = await chromium.launch()
const results = {}
for (const view of VIEWS.filter((v) => !ONLY || v.path === ONLY)) {
  const cold = []
  const warm = []
  const taps = []
  for (let r = 0; r < RUNS; r++) {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "es-ES", timezoneId: "Europe/Madrid", serviceWorkers: "block" })
    await context.addCookies([{ name: "top_mode", value: "demo", url: BASE }])
    await context.addInitScript(OBSERVE)
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    await cdp.send("Network.enable")
    await cdp.send("Network.emulateNetworkConditions", NETWORK)
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })
    cold.push(await visit(page, view))
    warm.push(await visit(page, view))
    if (view.path === "/") taps.push(await tap(page))
    await context.close()
  }
  const summary = (list) => Object.fromEntries(["ready", "fcp", "lcp", "cls"].map((k) => [k, median(list.map((x) => x[k]))]))
  results[view.path] = { cold: summary(cold), warm: summary(warm), ...(taps.length ? { tapMs: median(taps) } : {}), runs: RUNS }
  console.log(view.path.padEnd(20), "cold", JSON.stringify(results[view.path].cold), "warm", JSON.stringify(results[view.path].warm), taps.length ? `tap ${results[view.path].tapMs} ms` : "")
}
await browser.close()

const report = { measuredAt: new Date().toISOString(), base: BASE, profile: { viewport: "375x812", cpuSlowdown: 4, network: "9 Mbps / 1.5 Mbps / 85 ms" }, medians: results }
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")
