import { ALL_ROUTES } from "../src/components/shell/nav-config"
import { expect, isMobile, test } from "./fixtures"

test.describe("navigation", () => {
  for (const route of ALL_ROUTES) {
    test(`${route} renders without errors or horizontal overflow`, async ({ page, consoleErrors }, info) => {
      const res = await page.goto(route)
      expect(res?.ok()).toBe(true)
      await expect(page.locator("h1").first()).toBeVisible()
      const width = info.project.use.viewport!.width
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
      expect(scrollWidth, "no horizontal page overflow").toBeLessThanOrEqual(width)
      expect(consoleErrors).toEqual([])
    })
  }

  test("primary navigation has no dead links", async ({ page }, info) => {
    await page.goto("/")
    const nav = page.getByRole("navigation", { name: "Navegación principal" })
    const links = nav.getByRole("link")
    const hrefs = await links.evaluateAll((els) => els.map((e) => e.getAttribute("href")))
    // mobile: 5 tabs; desktop: brand + 11 sections + settings
    expect(hrefs.length).toBe(isMobile(info.project.name) ? 5 : 13)
    for (const href of hrefs) {
      const res = await page.request.get(href!)
      expect(res.status(), href!).toBe(200)
    }
  })

  test("mobile tabs mark the active section", async ({ page }, info) => {
    test.skip(!isMobile(info.project.name), "mobile only")
    await page.goto("/knowledge/library")
    await expect(page.getByRole("link", { name: "Más" })).toHaveAttribute("aria-current", "page")
    await page.getByRole("link", { name: "Hábitos" }).click()
    await expect(page).toHaveURL(/\/habits$/)
    await expect(page.getByRole("heading", { level: 1, name: "Hábitos" })).toBeVisible()
  })

  test("/knowledge redirects to the library", async ({ page }) => {
    await page.goto("/knowledge")
    await expect(page).toHaveURL(/\/knowledge\/library$/)
  })

  test("PWA manifest is served", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest")
    expect(res.ok()).toBe(true)
    const manifest = await res.json()
    expect(manifest.display).toBe("standalone")
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2)
    for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true)
  })
})
