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

  test("Goals (demo): list, horizon filter, detail metrics and the Analytics filter", async ({ page }) => {
    const errors: string[] = []
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text())
    })
    await page.goto("/login")
    await page.getByRole("button", { name: "Explorar la demo sin cuenta" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Resumen" })).toBeVisible()
    await expect(page.getByRole("region", { name: "Objetivos activos" }).getByRole("link", { name: /Correr 10 km/ })).toBeVisible()

    // List: primary/secondary and a horizon filter that lives in the URL.
    await page.goto("/goals")
    await expect(page.getByRole("region", { name: "Principales" }).getByRole("article")).toHaveCount(3)
    await expect(page.getByRole("region", { name: "Secundarios" }).getByRole("article")).toHaveCount(3)
    await page.getByRole("radio", { name: "Largo" }).click()
    await expect(page).toHaveURL(/\/goals\?plazo=long$/)
    await page.reload()
    await expect(page.getByRole("radio", { name: "Largo" })).toHaveAttribute("aria-checked", "true")

    // Detail: outcome, projection from real data, and an effort figure that opens its records.
    await page.goto("/goals/demo-goal-10k")
    await expect(page.getByRole("heading", { level: 1, name: /Correr 10 km/ })).toBeVisible()
    await expect(page.getByRole("region", { name: "Resultado" })).toBeVisible()
    await expect(page.getByText(/A este ritmo llegarías a la meta/)).toBeVisible()
    const effort = page.getByRole("button", { name: /oportunidades cumplidas/ })
    const [, fulfilled, applicable] = /(\d+) de (\d+) oportunidades/.exec(await effort.innerText())!
    await effort.click()
    const sheet = page.getByRole("dialog", { name: /Esfuerzo · Correr 10 km/ })
    await expect(sheet.getByTestId("drill-summary")).toContainText(`${fulfilled} cumplidas de ${applicable} aplicables`)
    await page.keyboard.press("Escape")

    // Insufficient data is N/D, never 0 %.
    await page.goto("/goals/demo-goal-savings")
    await expect(page.getByRole("region", { name: "Resultado" }).getByText("N/D", { exact: true })).toBeVisible()

    // Analytics filtered by the goal's habits, and back.
    await page.goto("/goals/demo-goal-10k")
    await page.getByRole("link", { name: "Ver estos hábitos en Análisis" }).click()
    await expect(page).toHaveURL(/\/analytics\?objetivo=demo-goal-10k$/)
    await expect(page.getByText(/Hábitos del objetivo/)).toBeVisible()
    await page.getByRole("button", { name: "Quitar filtro" }).click()
    await expect(page).toHaveURL(/\/analytics$/)
    expect(errors.filter((e) => /Content Security Policy|Refused to|Hydration/i.test(e))).toEqual([])
  })

  test("Focus (demo): timer from timestamps, pause, finish, derived habit and Analytics", async ({ page }) => {
    const errors: string[] = []
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text())
    })
    // The demo lives in this browser only: the clock is moved locally, nothing reaches a server.
    const t0 = new Date("2026-10-21T18:30:00+02:00")
    await page.clock.setFixedTime(t0)
    await page.goto("/login")
    await page.getByRole("button", { name: "Explorar la demo sin cuenta" }).click()
    await page.goto("/focus")
    await page.getByRole("button", { name: /^Empezar/ }).click()
    await expect(page.getByTestId("focus-clock")).toHaveText("50:00")
    await page.clock.setFixedTime(new Date(t0.getTime() + 20 * 60_000))
    await expect(page.getByTestId("focus-clock")).toHaveText("30:00")
    await page.getByRole("button", { name: "Pausar" }).click()
    await page.reload()
    await expect(page.getByRole("button", { name: "Reanudar" })).toBeVisible()
    await page.getByRole("button", { name: "Terminar" }).click()
    await expect(page.getByRole("dialog").getByLabel("Minutos efectivos")).toHaveValue("20")
    await page.getByRole("dialog").getByRole("button", { name: "Guardar" }).click()
    await expect(page.getByTestId("focus-today-minutes")).toHaveText("20 min")

    await page.goto("/habits")
    await expect(page.getByText("Se alimenta de Enfoque · 20 de 90 min")).toBeVisible()
    await page.goto("/analytics?proyecto=Escritura")
    await expect(page.getByRole("region", { name: /^Enfoque/ }).getByText("Pocos datos", { exact: true })).toBeVisible()
    expect(errors.filter((e) => /Content Security Policy|Refused to|Hydration/i.test(e))).toEqual([])
  })

  test("Mind & Energy (demo): evening check-in in 3 taps, saved without a button, and the Analytics section", async ({ page }) => {
    const errors: string[] = []
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text())
    })
    await page.clock.setFixedTime(new Date("2026-10-21T18:30:00+02:00"))
    await page.goto("/login")
    await page.getByRole("button", { name: "Explorar la demo sin cuenta" }).click()
    await page.goto("/mind?checkin=pm")
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByTestId("checkin-date")).toHaveText("Hoy, miércoles 21 de octubre")
    await dialog.getByRole("radiogroup", { name: "Energía" }).getByRole("radio", { name: "3, Normal" }).click()
    await dialog.getByRole("radiogroup", { name: "Ánimo" }).getByRole("radio", { name: "4, Bueno" }).click()
    await dialog.getByRole("radiogroup", { name: "Estrés" }).getByRole("radio", { name: "2, Poco" }).click()
    await dialog.getByRole("button", { name: "Listo" }).click()
    await page.reload()
    await expect(page.getByTestId("mind-card-pm")).toContainText("Energía 3 · Ánimo 4 · Estrés 2")
    await page.goto("/analytics#mente")
    await expect(page.getByRole("region", { name: /^Mente y energía/ }).getByText("Descriptivo, no causal")).toBeVisible()
    expect(errors.filter((e) => /Content Security Policy|Refused to|Hydration/i.test(e))).toEqual([])
  })
})
