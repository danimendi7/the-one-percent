import type { Page, Route } from "@playwright/test"
import { expect, test } from "./fixtures"

/**
 * M4g.2 · Real covers over the typographic ones (demo copy in localStorage). The browser only ever
 * asks the same-origin /api/covers; these tests answer it from the page (route) with an image
 * drawn in the browser, so nothing reaches Open Library or Apple. One test uses the real route:
 * without a verified session it refuses, and the typographic cover stays.
 */

const KEY = "the-one-percent:demo:library:v1"
const OUTLIVE = "demo-book-outlive"
const OL_COVER = "https://covers.openlibrary.org/b/id/13191259-L.jpg"
const APPLE_PATH = "Podcasts221/v4/2b/1a/09/2b1a09d7-c6dc-22c2-d2f6-2a34ef83a6dd/mza_16581116865991017367.jpg"
const APPLE_COVER = `https://is1-ssl.mzstatic.com/image/thumb/${APPLE_PATH}/600x600bb.jpg`

/** The demo copy with external covers on some items or shows (as M4g.3 will save them). */
async function seedCovers(page: Page, covers: { items?: Record<string, string>; shows?: Record<string, string> }) {
  await page.goto("/knowledge/library/books")
  await expect(page.getByTestId("item-tile").first()).toBeVisible()
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k) !== null, KEY)).toBe(true)
  await page.evaluate(
    ([k, c]) => {
      const s = JSON.parse(localStorage.getItem(k)!)
      for (const [id, url] of Object.entries(c.items ?? {})) s.items[id].cover = { source: "external", url }
      for (const [id, url] of Object.entries(c.shows ?? {})) s.shows[id].cover = { source: "external", url }
      localStorage.setItem(k, JSON.stringify(s))
    },
    [KEY, covers] as const
  )
}

/** A real JPEG of the given size, drawn in the page (no image files in the repository). */
async function drawnJpeg(page: Page, w: number, h: number): Promise<Buffer> {
  const b64 = await page.evaluate(
    ([w, h]) => {
      const c = document.createElement("canvas")
      c.width = w
      c.height = h
      const g = c.getContext("2d")!
      g.fillStyle = "#c0392b"
      g.fillRect(0, 0, w, h)
      g.fillStyle = "#f1c40f"
      g.fillRect(w / 4, h / 4, w / 2, h / 2)
      return c.toDataURL("image/jpeg", 0.9).split(",")[1]
    },
    [w, h] as const
  )
  return Buffer.from(b64, "base64")
}

/** Answers /api/covers from the page and records what the app asked for. */
async function serveCovers(page: Page, answer: (route: Route) => Promise<void>) {
  const asked: string[] = []
  await page.route("**/api/covers?**", async (route) => {
    const u = new URL(route.request().url())
    asked.push(u.pathname + u.search)
    await answer(route)
  })
  return asked
}

const tile = (page: Page, id: string) => page.locator(`a[data-testid="item-tile"][href="/knowledge/library/item?id=${id}"]`).locator("[data-cover]")

test.describe("covers (M4g.2)", () => {
  test("a real cover is laid over the typographic one: same box, not distorted, asked only by identifier", async ({ page, consoleErrors }) => {
    await seedCovers(page, { items: { [OUTLIVE]: OL_COVER } })
    const image = await drawnJpeg(page, 200, 300)
    const asked = await serveCovers(page, (route) => route.fulfill({ status: 200, contentType: "image/jpeg", body: image, headers: { "cache-control": "private, max-age=2592000, immutable" } }))
    await page.reload()
    const withCover = tile(page, OUTLIVE)
    await expect(withCover).toHaveAttribute("data-cover", "image")
    // Same box as a tile without a cover (2:3): the image never changes the layout.
    const other = tile(page, "demo-book-junco")
    await expect(other).toHaveAttribute("data-cover", "typographic")
    const [a, b] = [await withCover.boundingBox(), await other.boundingBox()]
    expect(Math.abs(a!.width - b!.width)).toBeLessThan(1)
    expect(Math.abs(a!.height - b!.height)).toBeLessThan(1)
    expect(a!.height / a!.width).toBeCloseTo(1.5, 1)
    expect(await withCover.getByTestId("cover-image").evaluate((img) => getComputedStyle(img).objectFit)).toBe("cover")
    // Decorative in the grid (the title is text next to it).
    await expect(withCover).toHaveAttribute("aria-hidden", "true")
    expect(asked).toContain("/api/covers?ol=13191259&s=md")
    expect(asked.every((q) => /^\/api\/covers\?ol=13191259&s=(md|sm|lg)$/.test(q))).toBe(true)

    // The detail page asks the large size and announces the cover.
    await page.goto(`/knowledge/library/item?id=${OUTLIVE}`)
    const detail = page.getByRole("img", { name: /^Portada de Outlive/ })
    await expect(detail).toHaveAttribute("data-cover", "image")
    expect(asked).toContain("/api/covers?ol=13191259&s=lg")
    expect(consoleErrors).toEqual([])
  })

  test("Apple artwork for an episode (list) and a show (grid), by host and path only", async ({ page }) => {
    await seedCovers(page, { items: { "demo-ep-dormir": APPLE_COVER }, shows: { "demo-show-lab": APPLE_COVER } })
    const image = await drawnJpeg(page, 300, 300)
    const asked = await serveCovers(page, (route) => route.fulfill({ status: 200, contentType: "image/jpeg", body: image }))
    await page.goto("/knowledge/library/podcasts")
    const row = page.locator('a[data-testid="item-row"][href="/knowledge/library/item?id=demo-ep-dormir"]').locator("[data-cover]")
    await expect(row).toHaveAttribute("data-cover", "image")
    await page.getByRole("radiogroup", { name: "Vista de podcasts" }).getByRole("radio", { name: "Programas" }).click()
    const show = page.locator('a[data-testid="show-tile"][href="/knowledge/library/show?id=demo-show-lab"]').locator("[data-cover]")
    await expect(show).toHaveAttribute("data-cover", "image")
    const box = await show.boundingBox()
    expect(Math.abs(box!.width - box!.height)).toBeLessThan(1)
    const apple = `/api/covers?apple=1%3A${encodeURIComponent(APPLE_PATH)}`
    expect(asked).toContain(`${apple}&s=sm`)
    expect(asked).toContain(`${apple}&s=md`)
  })

  test("no image, no connection or no access: the typographic cover stays, never a broken image", async ({ page }) => {
    await seedCovers(page, { items: { [OUTLIVE]: OL_COVER } })
    for (const answer of [
      (r: Route) => r.fulfill({ status: 404, headers: { "cache-control": "no-store" }, body: "" }),
      (r: Route) => r.fulfill({ status: 401, headers: { "cache-control": "no-store" }, body: "" }),
      (r: Route) => r.abort("internetdisconnected"),
      (r: Route) => r.fulfill({ status: 200, contentType: "image/jpeg", body: Buffer.from("not an image") }),
    ]) {
      await page.unrouteAll({ behavior: "ignoreErrors" })
      await serveCovers(page, answer)
      await page.reload()
      const cover = tile(page, OUTLIVE)
      await expect(cover).toHaveAttribute("data-cover", "typographic")
      await expect(cover.getByTestId("cover-image")).toHaveCount(0)
      // The typographic cover is still drawn, with its title.
      await expect(cover).toContainText("Outlive")
    }
  })

  test("demo against the real route: refused without a verified session, the typographic cover stays", async ({ page }) => {
    await seedCovers(page, { items: { [OUTLIVE]: OL_COVER } })
    const answers: { status: number; cache: string | null; cookie: string | null }[] = []
    page.on("response", (r) => {
      if (r.url().includes("/api/covers?")) answers.push({ status: r.status(), cache: r.headers()["cache-control"] ?? null, cookie: r.headers()["set-cookie"] ?? null })
    })
    await page.reload()
    await expect(tile(page, OUTLIVE)).toHaveAttribute("data-cover", "typographic")
    await expect.poll(() => answers.length).toBeGreaterThan(0)
    expect(answers.every((a) => a.status === 401 && a.cache === "no-store" && a.cookie === null)).toBe(true)
  })
})
