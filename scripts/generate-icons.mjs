// Renders the brand mark to PNG icons for the PWA manifest using Playwright's Chromium.
// Usage: node scripts/generate-icons.mjs
import { chromium } from "@playwright/test"
import { mkdir } from "node:fs/promises"

const mark = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0b0f14"/>
  <g transform="translate(${pad} ${pad}) scale(${(512 - 2 * pad) / 512})">
    <circle cx="256" cy="256" r="150" fill="none" stroke="#26313d" stroke-width="52"/>
    <circle cx="256" cy="256" r="150" fill="none" stroke="#b9f36a" stroke-width="52" stroke-linecap="round"
      stroke-dasharray="86 1000" transform="rotate(-90 256 256)"/>
  </g>
</svg>`

const targets = [
  { file: "public/icons/icon-192.png", size: 192, pad: 40 },
  { file: "public/icons/icon-512.png", size: 512, pad: 40 },
  { file: "public/icons/icon-maskable-512.png", size: 512, pad: 110 },
  { file: "src/app/apple-icon.png", size: 180, pad: 50 },
]

await mkdir("public/icons", { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage()
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size })
  await page.setContent(`<style>html,body{margin:0;background:#0b0f14}svg{display:block;width:${t.size}px;height:${t.size}px}</style>${mark(t.pad)}`)
  await page.screenshot({ path: t.file, omitBackground: false })
  console.log("wrote", t.file)
}
await browser.close()
