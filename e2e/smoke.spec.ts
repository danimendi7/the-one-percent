/**
 * Deployment smoke tests (read-only, no account needed).
 *   BASE_URL=https://<app>.vercel.app npm run smoke
 * Also runs locally against the production build: npm run smoke
 */
import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const https = (process.env.BASE_URL ?? "").startsWith("https://")

test.describe("deployment smoke", () => {
  test("anonymous visitors are redirected to login", async ({ page }) => {
    const res = await page.goto("/")
    expect(res?.ok()).toBe(true)
    await expect(page).toHaveURL(/\/login$/)
    if (https) expect(page.url()).toMatch(/^https:\/\//)
  })

  test("security headers are present", async ({ request }) => {
    const res = await request.get("/login")
    const h = res.headers()
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'")
    expect(h["content-security-policy"]).toContain("connect-src 'self'")
    expect(h["x-content-type-options"]).toBe("nosniff")
    expect(h["x-frame-options"]).toBe("DENY")
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin")
    expect(h["x-powered-by"]).toBeUndefined()
    if (https) expect(h["strict-transport-security"]).toContain("max-age=")
  })

  test("login page renders without CSP violations or accessibility blockers", async ({ page }) => {
    const violations: string[] = []
    page.on("console", (m) => {
      if (m.type() === "error") violations.push(m.text())
    })
    await page.goto("/login")
    await expect(page.getByLabel("Email")).toBeVisible()
    await page.waitForLoadState("networkidle")
    expect(violations.filter((v) => /Content Security Policy|Refused to/i.test(v))).toEqual([])
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([])
  })

  test("an invalid magic link lands on login with an explanation", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=invalid&type=email")
    await expect(page).toHaveURL(/\/login\?error=link$/)
    await expect(page.getByRole("alert").filter({ hasText: "no es válido" })).toBeVisible()
  })

  test("PWA manifest and icons are served", async ({ request }) => {
    const manifest = await (await request.get("/manifest.webmanifest")).json()
    expect(manifest.display).toBe("standalone")
    for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true)
  })

  test("the demo works without an account and talks to no server", async ({ page }) => {
    const supabaseCalls: string[] = []
    page.on("request", (r) => {
      if (/supabase|:55321/.test(r.url())) supabaseCalls.push(r.url())
    })
    await page.goto("/login")
    await page.getByRole("button", { name: "Explorar la demo sin cuenta" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Resumen" })).toBeVisible()
    await expect(page.getByText("Demo", { exact: true }).first()).toBeVisible()
    expect(supabaseCalls.filter((u) => !u.includes("/auth/v1/user"))).toEqual([])
  })

  test("Life Analytics (demo): figures open their records and filters live in the URL", async ({ page }) => {
    const errors: string[] = []
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text())
    })
    await page.goto("/login")
    await page.getByRole("button", { name: "Explorar la demo sin cuenta" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Resumen" })).toBeVisible()
    await page.goto("/analytics?periodo=90")
    await expect(page.getByRole("heading", { level: 1, name: "Analítica" })).toBeVisible()
    await expect(page.getByRole("radio", { name: "90 días" })).toHaveAttribute("aria-checked", "true")

    const stat = page.getByRole("button", { name: /^Cumplimiento.*Ver detalle$/ })
    const [, fulfilled, applicable] = /(\d+) de (\d+) oportunidades/.exec(await stat.innerText())!
    await stat.click()
    const sheet = page.getByRole("dialog", { name: /Cumplimiento en los últimos 90 días/ })
    await expect(sheet.getByTestId("drill-summary")).toContainText(`${fulfilled} cumplidas de ${applicable} aplicables`)
    expect(errors.filter((e) => /Content Security Policy|Refused to|Hydration/i.test(e))).toEqual([])
  })
})
