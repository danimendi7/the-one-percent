import type { Page, Route } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "./fixtures"
import { countRows, newAccount, removeAccount, signIn, type Account } from "./support/account"
import { setConnection, strictOffline } from "./support/offline"
import { db } from "../tests/integration/setup"

/**
 * M4g.4 · «Añadir podcast» / «Añadir episodio» with search on Apple Podcasts, against the LOCAL
 * stack. /api/metadata and /api/covers are answered from the page with synthetic data (200 recent
 * episodes, one without date or duration, one older than the 200), so no test reaches Apple; an
 * unexpected metadata request fails the test instead of going out.
 */

const ART = "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/2b/1a/09/2b1a09d7-c6dc-22c2-d2f6-2a34ef83a6dd/mza_16581116865991017367.jpg/600x600bb.jpg"
const show = (id: string, title: string, publisher: string, episodeCount: number) => ({
  provider: "itunes",
  id,
  title,
  publisher,
  cover: ART,
  sourceUrl: `https://podcasts.apple.com/es/podcast/x/id${id}`,
  episodeCount,
  latestReleaseAt: "2026-10-28T23:30:00.000Z",
  topicSuggestions: ["Comedia"],
  attribution: "Datos: Apple Podcasts",
})
const RUINA = show("1455818214", "La Ruina", "La Ruina", 356)
const OTHER = show("1551106614", "Samanté de Nadie Sabe Nada", "ElTerrat", 5)

const episode = (i: number, over: Record<string, unknown> = {}) => ({
  provider: "itunes",
  id: String(1000798560432 - i),
  showId: RUINA.id,
  showTitle: RUINA.title,
  title: `${331 - i}. La Ruina (con invitado ${331 - i})`,
  description: `Episodio sintético ${331 - i}: historias que salieron mal, contadas en directo.`,
  durationSeconds: 4596 - i * 7,
  // The first is out at 23:30 UTC: in Madrid it is already the next day.
  publishedAt: new Date(Date.parse("2026-10-28T23:30:00.000Z") - i * 3.5 * 86400_000).toISOString(),
  cover: null,
  sourceUrl: `https://podcasts.apple.com/es/podcast/x/id${RUINA.id}?i=${1000798560432 - i}`,
  attribution: "Datos: Apple Podcasts",
  ...over,
})
const FIRST = episode(0, { title: "331. La Ruina (con Petite Lorena)" })
const BARE = episode(5, { title: "326. Episodio sin datos", description: null, durationSeconds: null, publishedAt: null, sourceUrl: null })
const RECENT = [FIRST, ...Array.from({ length: 199 }, (_, k) => (k + 1 === 5 ? BARE : episode(k + 1)))]
const OLD = episode(250, { title: "89. La Ruina (con Ignatius Farray)", publishedAt: "2022-07-11T08:00:00.000Z", durationSeconds: 3480 })

type Reply = { status?: number; body: unknown }
const ok = (data: unknown): Reply => ({ body: { ok: true, data } })
const fail = (status: number, code: string, retryAfter?: number): Reply => ({ status, body: { ok: false, error: { code, ...(retryAfter && { retryAfter }) } } })

async function providers(page: Page, answer: (path: string, q: URLSearchParams) => Reply | undefined) {
  const calls: string[] = []
  await page.route("**/api/metadata/**", async (route: Route) => {
    const u = new URL(route.request().url())
    calls.push(u.pathname + u.search)
    const r = answer(u.pathname.replace("/api/metadata/", ""), u.searchParams) ?? { status: 599, body: { unexpected: u.pathname + u.search } }
    await route.fulfill({ status: r.status ?? 200, contentType: "application/json", body: JSON.stringify(r.body) })
  })
  await page.route("**/api/covers?**", (route) => route.fulfill({ status: 404, headers: { "cache-control": "no-store" }, body: "" }))
  return calls
}

const apple = (path: string, q: URLSearchParams): Reply | undefined => {
  if (path === "podcasts/search") {
    const text = (q.get("q") ?? "").toLowerCase()
    if (text.includes("ruina")) return ok([RUINA, OTHER])
    if (text.includes("nada que ver")) return ok([])
    return undefined
  }
  if (path === "podcasts/episodes" && q.get("show") === RUINA.id) {
    const text = (q.get("q") ?? "").toLowerCase()
    if (!text) return ok({ show: RUINA, episodes: RECENT, scope: "recent", total: 356, complete: false })
    if (text.includes("ignatius")) return ok({ show: RUINA, episodes: [OLD], scope: "search", total: 356, complete: false })
    return ok({ show: RUINA, episodes: [], scope: "search", total: 356, complete: false })
  }
  if (path === "podcasts/episodes" && q.get("show") === OTHER.id) return ok({ show: OTHER, episodes: [episode(0, { id: "1000700000009", showId: OTHER.id, title: "331. La Ruina (con Petite Lorena)" })], scope: "recent", total: 5, complete: false })
  return undefined
}

const item = async (accountId: string, title: string) =>
  (await db((c) => c.query("select i.title, i.show_id, i.published_on::text, i.duration_seconds, i.status, i.rating, i.favorite, i.description, i.source_url, i.cover_ref, i.external_provider, i.external_id, i.platform from public.library_items i where i.user_id = $1 and i.title = $2 and i.deleted_at is null", [accountId, title]))).rows
const shows = (accountId: string) => db(async (c) => (await c.query("select id, title, external_id from public.podcast_shows where user_id = $1 and deleted_at is null", [accountId])).rows)

async function openAssistant(page: Page) {
  await page.goto("/knowledge/library/podcasts")
  await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
  await page.getByTestId("add-menu").click()
  await page.getByRole("menuitem", { name: "Episodio" }).click()
  await expect(page.getByTestId("show-search")).toBeFocused()
}

async function chooseRuina(page: Page) {
  await page.getByTestId("show-search").fill("la ruina")
  await expect(page.getByTestId("show-result")).toHaveCount(2)
  await page.getByTestId("show-result").first().click()
  await expect(page.getByTestId("episode-row").first()).toBeVisible()
}

async function blocking(page: Page) {
  const results = await new AxeBuilder({ page }).include('[data-testid="add-podcast-sheet"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)
}

test.describe("add a podcast episode with search (account)", () => {
  test.use({ mode: "account" })
  let account: Account
  test.beforeEach(async ({ page }, info) => {
    account = await newAccount(`addpod-${info.project.name}`)
    await signIn(page, account)
  })
  test.afterEach(async () => {
    await removeAccount(account)
  })

  test("show → 200 recent episodes said as such, drawn 30 at a time → filter → local day → edited duration kept → saved once with its new show, synced", async ({ page, consoleErrors }) => {
    const calls = await providers(page, apple)
    const failed: string[] = []
    page.on("response", (r) => {
      if (r.status() >= 400 && !new URL(r.url()).pathname.startsWith("/api/covers")) failed.push(`${r.status()} ${r.url()}`)
    })
    await openAssistant(page)
    await page.getByTestId("show-search").fill("la ruina")
    await expect(page.getByTestId("show-result")).toHaveCount(2)
    // Latest release at 23:30 UTC on the 28th: the 29th in Madrid, as in the episodes.
    await expect(page.getByTestId("show-result").first()).toContainText("356 episodios · último: 29 oct 2026")
    await page.getByTestId("show-result").first().click()
    await expect(page.getByTestId("episodes-status")).toHaveText("Los 200 más recientes de 356. Si no está, búscalo abajo.")
    await expect(page.getByTestId("episode-row")).toHaveCount(30)
    await page.getByTestId("more-episodes").click()
    await expect(page.getByTestId("episode-row")).toHaveCount(60)
    // The first episode was out at 23:30 UTC on the 28th: in Madrid, the 29th.
    await expect(page.getByTestId("episode-row").first()).toContainText("29 oct 2026 · 1 h 17 min")
    await page.getByTestId("episode-filter").fill("petite")
    await expect(page.getByTestId("episodes-status")).toHaveText("1 de 200 coinciden")
    await page.getByTestId("episode-row").first().click()
    await expect(page.getByTestId("confirm-date")).toHaveValue("2026-10-29")
    await expect(page.getByTestId("confirm-duration")).toHaveValue("1:16:36")
    await expect(page.getByTestId("confirm-program")).toHaveValue("__new__")
    await page.getByTestId("confirm-duration").fill("80")
    await page.getByTestId("confirm-status").selectOption("done")
    await page.getByRole("radio", { name: "7 de 10" }).click()
    await page.getByTestId("confirm-save").dblclick()
    await expect(page.getByRole("heading", { level: 1, name: "331. La Ruina (con Petite Lorena)" })).toBeVisible()
    await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 15_000 })

    const saved = await shows(account.id)
    expect(saved).toEqual([{ id: expect.any(String), title: "La Ruina", external_id: RUINA.id }])
    const rows = await item(account.id, "331. La Ruina (con Petite Lorena)")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      show_id: saved[0].id,
      published_on: "2026-10-29",
      duration_seconds: 4800,
      status: "done",
      rating: 7,
      favorite: false,
      description: FIRST.description,
      source_url: FIRST.sourceUrl,
      cover_ref: ART,
      external_provider: "itunes",
      external_id: FIRST.id,
      platform: "apple",
    })
    expect(calls.filter((c) => c.includes("podcasts/episodes"))).toEqual([`/api/metadata/podcasts/episodes?show=${RUINA.id}`])
    expect(failed).toEqual([])
    expect(consoleErrors.filter((e) => !/^Failed to load resource: the server responded with a status of 404/.test(e))).toEqual([])
  })

  test("the saved show is reused, never duplicated; the same episode is blocked; a probable match only warns", async ({ page }) => {
    await providers(page, apple)
    await openAssistant(page)
    await chooseRuina(page)
    await page.getByTestId("episode-row").first().click()
    await page.getByTestId("confirm-save").click()
    await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 15_000 })

    await openAssistant(page)
    await page.getByTestId("show-search").fill("la ruina")
    await expect(page.getByTestId("show-result").first().getByTestId("show-owned")).toHaveText("En tu Biblioteca")
    await page.getByTestId("show-result").first().click()
    await expect(page.getByTestId("open-show")).toBeVisible()
    await expect(page.getByTestId("episode-row").first()).toContainText("En tu Biblioteca")
    // The same episode: blocked, with the way to the existing one.
    await page.getByTestId("episode-row").first().click()
    await expect(page.getByTestId("duplicate")).toHaveAttribute("data-level", "exact")
    await expect(page.getByTestId("confirm-save")).toBeDisabled()
    await page.getByTestId("confirm-back").click()
    // Another episode of the same show: the existing show is used.
    await page.getByTestId("episode-row").nth(1).click()
    await expect(page.getByTestId("confirm-program")).not.toHaveValue("__new__")
    await page.getByTestId("confirm-save").click()
    await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 15_000 })
    expect(await shows(account.id)).toHaveLength(1)

    // Same title in another show is not a duplicate; a show written by hand with the same name is offered.
    await openAssistant(page)
    await page.getByTestId("show-search").fill("la ruina")
    await page.getByTestId("show-result").nth(1).click()
    await page.getByTestId("episode-row").first().click()
    await expect(page.getByTestId("duplicate")).toHaveCount(0)
    await expect(page.getByTestId("confirm-save")).toHaveText("Añadir episodio")
  })

  test("an episode older than the 200 via Apple's search; a bare episode keeps its fields empty", async ({ page }) => {
    const calls = await providers(page, apple)
    await openAssistant(page)
    await chooseRuina(page)
    await page.getByTestId("episode-filter").fill("ignatius")
    await expect(page.getByTestId("episodes-status")).toHaveText("Ninguno de estos 200 coincide con «ignatius».")
    await page.getByTestId("search-older").click()
    await expect(page.getByTestId("episodes-status")).toHaveText("Resultados en Apple para «ignatius», incluidos episodios anteriores")
    expect(calls.at(-1)).toBe(`/api/metadata/podcasts/episodes?show=${RUINA.id}&q=ignatius`)
    await page.getByTestId("episode-row").first().click()
    await expect(page.getByTestId("confirm-date")).toHaveValue("2022-07-11")
    await page.getByTestId("confirm-save").click()
    await expect(page.getByRole("heading", { level: 1, name: "89. La Ruina (con Ignatius Farray)" })).toBeVisible()
    await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 15_000 })

    await openAssistant(page)
    await page.getByTestId("show-search").fill("la ruina")
    await page.getByTestId("show-result").first().click()
    await page.getByTestId("episode-filter").fill("sin datos")
    await expect(page.getByTestId("episode-row").first()).toContainText("Sin fecha ni duración")
    await page.getByTestId("episode-row").first().click()
    await expect(page.getByTestId("confirm-date")).toHaveValue("")
    await expect(page.getByTestId("confirm-duration")).toHaveValue("")
    await expect(page.getByTestId("confirm-description")).toHaveValue("")
    await expect(page.getByTestId("confirm-url")).toHaveValue("")
    await page.getByTestId("confirm-save").click()
    await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 15_000 })
    expect((await item(account.id, "326. Episodio sin datos"))[0]).toMatchObject({ published_on: null, duration_seconds: null, description: null, source_url: null })
  })

  test("Apple limit and down, expired session after choosing a show: clear, nothing lost, manual entry keeps the text", async ({ page }) => {
    let next: Reply = fail(429, "rate_limited", 9)
    let episodes: Reply = fail(401, "unauthorized")
    await providers(page, (path) => (path === "podcasts/search" ? next : path === "podcasts/episodes" ? episodes : undefined))
    await openAssistant(page)
    await page.getByTestId("show-search").fill("la ruina")
    await expect(page.getByTestId("show-search-status")).toHaveText("Demasiadas búsquedas seguidas; espera unos segundos. Vuelve a intentarlo en 9 s.")
    next = fail(502, "provider_unavailable")
    await page.getByTestId("show-search-retry").click()
    await expect(page.getByTestId("show-search-status")).toHaveText("Apple Podcasts no responde ahora.")
    next = ok([RUINA])
    await page.getByTestId("show-search-retry").click()
    await page.getByTestId("show-result").first().click()
    await expect(page.getByTestId("episodes-error")).toContainText("Tu sesión ha caducado")
    await page.getByTestId("episode-filter").fill("Mi episodio de memoria")
    await page.getByTestId("add-manual-episode").click()
    await expect(page.getByTestId("form-title")).toHaveValue("Mi episodio de memoria")
    await page.getByTestId("form-save").click()
    await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 15_000 })
    episodes = ok({ show: RUINA, episodes: RECENT, scope: "recent", total: 356, complete: false })
  })

  test("offline in the assistant: says so, sends nothing, manual entry keeps the text; saved once back", async ({ page, context }) => {
    const calls = await providers(page, apple)
    await openAssistant(page)
    await context.setOffline(true)
    await page.getByTestId("show-search").fill("Programa sin red")
    await expect(page.getByTestId("show-search-status")).toContainText("Sin conexión")
    expect(calls).toEqual([])
    await page.getByTestId("add-manual-show").click()
    await expect(page.getByTestId("form-title")).toHaveValue("Programa sin red")
    await context.setOffline(false)
    await page.getByTestId("form-save").click()
    await expect(page).toHaveURL(/\/knowledge\/library\/show\?id=/)
    await expect.poll(async () => (await shows(account.id)).map((s) => s.title)).toEqual(["Programa sin red"])
  })

  test("keyboard and accessibility: arrows and Enter choose a show; no serious axe issues in the three steps; no horizontal scroll", async ({ page }, info) => {
    await providers(page, apple)
    await openAssistant(page)
    expect(await blocking(page)).toEqual([])
    await page.getByTestId("show-search").fill("la ruina")
    await expect(page.getByTestId("show-result")).toHaveCount(2)
    await page.getByTestId("show-search").press("ArrowDown")
    await page.getByTestId("show-search").press("Enter")
    await expect(page.getByRole("heading", { name: "La Ruina" })).toBeFocused()
    await expect(page.getByTestId("episode-row").first()).toBeVisible()
    expect(await blocking(page)).toEqual([])
    await page.getByTestId("episode-row").first().click()
    await expect(page.getByRole("heading", { name: "Revisa y añade" })).toBeFocused()
    expect(await blocking(page)).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(info.project.name === "mobile" ? 375 : 1440)
    await page.getByTestId("confirm-back").click()
    await expect(page.getByTestId("episode-row")).toHaveCount(30)
  })
})

test.describe("add a podcast offline through the queue (account, service worker)", () => {
  test.use({ mode: "account", serviceWorkers: "allow" })
  let account: Account
  test.beforeEach(async ({ page, context }, info) => {
    // M4-H1: a strict cut, so «nothing on the server yet» cannot be broken by a request that escapes.
    await strictOffline(context)
    account = await newAccount(`addpod-sw-${info.project.name}`)
    await signIn(page, account)
  })
  test.afterEach(async () => {
    await removeAccount(account)
  })

  test("chosen online, saved without connection: show and episode wait in order and reach the server once", async ({ page }) => {
    await providers(page, apple)
    await page.goto("/knowledge/library/podcasts")
    await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
    // The installed shell, as on a prepared phone (offline.spec.ts).
    await page.evaluate(() => navigator.serviceWorker.ready)
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state), { timeout: 15_000 }).toBe("activated")
    await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.postMessage({ type: "top:warm" }))
    await expect
      .poll(() => page.evaluate(async () => {
        const names = (await caches.keys()).filter((n) => n.startsWith("top-shell-"))
        return names.length === 1 ? (await (await caches.open(names[0])).keys()).filter((k) => !new URL(k.url).pathname.includes(".") && !new URL(k.url).pathname.startsWith("/_next/")).length : -1
      }), { timeout: 60_000 })
      .toBe(19)
    await page.getByTestId("add-menu").click()
    await page.getByRole("menuitem", { name: "Episodio" }).click()
    await chooseRuina(page)
    await page.getByTestId("episode-row").first().click()
    await expect(page.getByTestId("confirm-date")).toHaveValue("2026-10-29")

    await setConnection(page, false)
    await page.getByTestId("confirm-save").click()
    await expect(page.getByRole("heading", { level: 1, name: "331. La Ruina (con Petite Lorena)" })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId("item-save")).not.toHaveText("Sincronizado")
    expect(await shows(account.id)).toEqual([])

    await setConnection(page, true)
    await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 20_000 })
    const saved = await shows(account.id)
    expect(saved).toHaveLength(1)
    expect((await item(account.id, "331. La Ruina (con Petite Lorena)"))[0]).toMatchObject({ show_id: saved[0].id })
    expect(await countRows("select count(*)::int n from public.sync_operations where user_id = $1 and operation_type = 'library.show.create'", [account.id])).toBe(1)
    expect(await countRows("select count(*)::int n from public.sync_operations where user_id = $1 and operation_type = 'library.item.create'", [account.id])).toBe(1)
  })
})

test.describe("add a podcast in the demo", () => {
  test("manual forms as before, never a request to the metadata providers", async ({ page }) => {
    const calls: string[] = []
    await page.route("**/api/metadata/**", (route) => (calls.push(route.request().url()), route.abort()))
    await page.goto("/knowledge/library/podcasts")
    await page.getByTestId("add-menu").click()
    await page.getByRole("menuitem", { name: "Episodio" }).click()
    await expect(page.getByTestId("add-podcast-sheet")).toHaveCount(0)
    await page.getByTestId("form-title").fill("Episodio de la demo")
    await page.getByTestId("form-save").click()
    await expect(page.getByRole("heading", { level: 1, name: "Episodio de la demo" })).toBeVisible()
    expect(calls).toEqual([])
  })
})

/**
 * Visual review and timings (M4g.4): `npx playwright test e2e/add-podcast.spec.ts --grep @screens`.
 * Not part of the E2E suite. Timings are Chromium with the mobile viewport and a 4× slower CPU:
 * an emulation, not an iPhone (the iPhone check is /dev/podcasts in development).
 */
test.describe("@screens add a podcast", () => {
  test.use({ mode: "account" })
  test("capture the assistant's states and time 200 episodes", async ({ page }, info) => {
    const account = await newAccount(`addpod-screens-${info.project.name}`)
    try {
      await signIn(page, account)
      let failing = false
      await providers(page, (path, q) => (failing && path === "podcasts/search" ? fail(502, "provider_unavailable") : apple(path, q)))
      const shot = (name: string) => page.screenshot({ path: `docs/screenshots/${info.project.name}-m4g4-${name}.png` })
      const cdp = await page.context().newCDPSession(page)
      await openAssistant(page)
      await page.getByTestId("show-search").fill("la ruina")
      await expect(page.getByTestId("show-result")).toHaveCount(2)
      await shot("shows")
      // Timings with a 4× slower CPU (Event Timing API: input to next paint, entries of 16 ms or more).
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })
      await page.evaluate(() => {
        const w = window as unknown as { __ev: { name: string; d: number }[] }
        w.__ev = []
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) w.__ev.push({ name: e.name, d: Math.round(e.duration) })
        }).observe({ type: "event", buffered: false, durationThreshold: 16 } as PerformanceObserverInit)
      })
      const t0 = Date.now()
      await page.getByTestId("show-result").first().click()
      await expect(page.getByTestId("episode-row").first()).toBeVisible()
      const listMs = Date.now() - t0
      const t1 = Date.now()
      await page.getByTestId("more-episodes").click()
      await expect(page.getByTestId("episode-row")).toHaveCount(60)
      const moreMs = Date.now() - t1
      await page.getByTestId("episode-filter").pressSequentially("ruina con", { delay: 80 })
      await expect(page.getByTestId("episodes-status")).toContainText("coinciden")
      const events = await page.evaluate(() => (window as unknown as { __ev: { name: string; d: number }[] }).__ev)
      const typing = events.filter((e) => /key|input|beforeinput/.test(e.name)).map((e) => e.d)
      const clicks = events.filter((e) => /click|pointer/.test(e.name)).map((e) => e.d)
      console.info(
        `[m4g4-perf] ${info.project.name} cpu×4 · lista de 200 (clic → primera fila, con respuesta simulada): ${listMs} ms · «Mostrar más»: ${moreMs} ms · ` +
          `teclas ≥16 ms: ${typing.length}${typing.length ? ` (máx ${Math.max(...typing)} ms)` : ""} · clics ≥16 ms: ${clicks.length}${clicks.length ? ` (máx ${Math.max(...clicks)} ms)` : ""}`
      )
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 })
      await page.getByTestId("episode-filter").fill("")
      await shot("episodes")
      await page.getByTestId("episode-filter").fill("ignatius")
      await page.getByTestId("search-older").click()
      await expect(page.getByTestId("episodes-status")).toContainText("Resultados en Apple")
      await shot("older")
      await page.getByTestId("episode-row").first().click()
      await expect(page.getByTestId("episode-confirm")).toBeVisible()
      await shot("confirm")
      await page.getByTestId("confirm-back").click()
      await page.getByTestId("episodes-back").click()
      failing = true
      await page.getByTestId("show-search").fill("ruina otra vez")
      await expect(page.getByTestId("show-search-status")).toHaveText("Apple Podcasts no responde ahora.")
      await shot("provider-error")
      await page.getByTestId("add-manual-episode").click()
      await expect(page.getByTestId("form-title")).toBeVisible()
      await page.waitForTimeout(600)
      await shot("manual")
    } finally {
      await removeAccount(account)
    }
  })
})
