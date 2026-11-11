import type { Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { expect, FIXED_NOW, isMobile, test } from "./fixtures"

const ROUTES = ["/login", "/", "/habits", "/analytics", "/focus", "/knowledge/library", "/knowledge/library/books", "/knowledge/library/podcasts", "/knowledge/library/item?id=demo-book-outlive", "/knowledge/library/show?id=demo-show-ritmo", "/knowledge/discover", "/knowledge/brain", "/settings/notifications", "/more", "/intelligence", "/settings"]

/** Views whose controls must be easy to tap (F2): every main screen and a detail. */
const TOUCH_ROUTES = ["/", "/habits", "/analytics", "/focus", "/goals", "/goals/demo-goal-10k", "/mind", "/reviews", "/intelligence", "/knowledge/library", "/knowledge/brain", "/knowledge/brain/repaso", "/knowledge/discover", "/settings", "/settings/notifications", "/more"]

/**
 * Controls in the main content whose tappable area is smaller than `size` px in height (or in width,
 * for narrow ones). The area is what a finger hits: `elementFromPoint` at the edges of a `size` band
 * around the centre, so an invisible enlarged area (the switches' `::after`) counts. Links inside a
 * sentence are exempt, as in WCAG 2.5.8.
 */
async function smallTargets(page: Page, size: number) {
  return page.evaluate((size) => {
    const out: string[] = []
    const reach = size / 2 - 1
    const hits = (e: Element, x: number, y: number) => {
      const at = document.elementFromPoint(x, y)
      return !!at && (at === e || e.contains(at))
    }
    for (const e of document.querySelectorAll<HTMLElement>("main a[href], main button, main [role=switch], main [role=radio], main [role=tab], main input:not([type=hidden]), main select")) {
      if (e.closest("[inert],[aria-hidden=true]") || (e.tagName === "A" && getComputedStyle(e).display === "inline")) continue
      let b = e.getBoundingClientRect()
      if (b.width === 0 || b.height === 0) continue
      e.scrollIntoView({ block: "center", inline: "center" })
      b = e.getBoundingClientRect()
      const cx = b.left + b.width / 2
      const cy = b.top + b.height / 2
      if (!hits(e, cx, cy)) continue // covered by something else (a sticky bar): not this check's business
      const tallEnough = b.height >= size || (hits(e, cx, cy - reach) && hits(e, cx, cy + reach))
      const wideEnough = b.width >= size || (hits(e, cx - reach, cy) && hits(e, cx + reach, cy))
      if (!tallEnough || !wideEnough) out.push(`${e.tagName.toLowerCase()} «${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 40)}» ${Math.round(b.width)}×${Math.round(b.height)}`)
    }
    return out
  }, size)
}

async function blocking(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)
}

test.describe("accessibility (axe, WCAG 2.1 AA)", () => {
  for (const route of ROUTES) {
    test(`${route} has no serious or critical violations`, async ({ page }) => {
      await page.goto(route)
      await expect(page.locator("h1").first()).toBeVisible()
      await page.waitForLoadState("networkidle")
      expect(await blocking(page)).toEqual([])
    })
  }

  // F2: 44 px to tap on a phone (project rule); 24 px with a mouse (WCAG 2.5.8).
  for (const route of TOUCH_ROUTES) {
    test(`${route} has controls big enough to tap`, async ({ page }, info) => {
      await page.goto(route)
      await expect(page.locator("h1").first()).toBeVisible()
      await page.waitForLoadState("networkidle")
      expect(await smallTargets(page, isMobile(info.project.name) ? 44 : 24)).toEqual([])
    })
  }

  // F2: the inbox open over the Resumen (E7), not only the bell.
  test("the inbox open has no serious or critical violations", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId("overview-day")).toBeVisible()
    await page.getByTestId("inbox-button").locator("visible=true").click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.waitForTimeout(400) // sheet animation
    expect(await blocking(page)).toEqual([])
  })

  // M3.2: the timer states and the close sheet, not only the idle screen.
  test("/focus running, paused and closing have no serious or critical violations", async ({ page }) => {
    await page.goto("/focus")
    await page.getByRole("button", { name: /^Empezar/ }).click()
    await expect(page.getByRole("region", { name: "Bloque en curso" })).toBeVisible()
    expect(await blocking(page)).toEqual([])
    await page.clock.setFixedTime(new Date(FIXED_NOW.getTime() + 30 * 60_000))
    await page.getByRole("button", { name: "Terminar" }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.waitForTimeout(400) // sheet animation
    expect(await blocking(page)).toEqual([])
  })
})
