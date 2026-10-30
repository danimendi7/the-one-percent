import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { countRows, newAccount, removeAccount, signIn, type Account } from "./support/account"

/**
 * M4f · the service worker (public/sw.js, P17 option A), turned on only here. A device that
 * already loaded the app online starts it again with NO connection, in the demo and in an account;
 * nothing private is cached; a new version replaces the shell; other caches are left alone.
 * A brand-new device still needs one load with a connection (not tested as offline: it cannot work).
 */
test.use({ serviceWorkers: "allow" })

const SHELL_PAGES = 19
const offlineNoise = (e: string) => /ERR_INTERNET_DISCONNECTED|net::ERR_FAILED|Failed to fetch|NetworkError|ERR_NAME_NOT_RESOLVED/.test(e)

/** Waits for the worker to control the page, asks it to prepare the shell and waits until it has. */
async function prepared(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true)
  await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.postMessage({ type: "top:warm" }))
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const names = (await caches.keys()).filter((n) => n.startsWith("top-shell-"))
          if (names.length !== 1) return -1
          const keys = await (await caches.open(names[0])).keys()
          return keys.filter((k) => !new URL(k.url).pathname.includes(".") && !new URL(k.url).pathname.startsWith("/_next/")).length
        }),
      { timeout: 60_000 }
    )
    .toBe(SHELL_PAGES)
}

/** Everything the worker stored, for the privacy checks. */
async function cacheReport(page: Page) {
  return page.evaluate(async () => {
    const out: { cache: string; url: string; headers: string[]; body: string }[] = []
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      for (const req of await cache.keys()) {
        const res = (await cache.match(req))!
        const type = res.headers.get("content-type") ?? ""
        out.push({ cache: name, url: req.url, headers: [...res.headers.keys()], body: type.includes("html") ? await res.text() : "" })
      }
    }
    return out
  })
}

test.describe("service worker · demo", () => {
  test("a prepared device starts with no connection, navigates, captures and reloads; an unprepared route says so; back online it works as before", async ({ page, context, consoleErrors }) => {
    await page.goto("/")
    await prepared(page)
    await context.setOffline(true)

    // cold start of another prepared route, with the device's own demo data
    await page.goto("/knowledge/library")
    await expect(page.getByRole("heading", { level: 1, name: "Biblioteca" })).toBeVisible()
    await expect(page.getByTestId("door-Libros")).toContainText("7 libros")
    await page.getByTestId("door-Libros").click()
    await expect(page.getByRole("heading", { level: 1, name: "Libros" })).toBeVisible()
    await page.getByTestId("item-tile").filter({ hasText: "Outlive" }).first().click()
    await expect(page.getByRole("heading", { level: 1, name: "Outlive" })).toBeVisible()
    await page.getByTestId("capture-open").locator("visible=true").click()
    await page.getByTestId("capture-text").locator("visible=true").fill("Idea con la app abierta sin red")
    await expect(page.getByTestId("capture-save").locator("visible=true")).toHaveText("Guardado en este navegador · demo")

    // a full reload with no connection keeps working, the idea is there
    await page.reload()
    await expect(page.getByTestId("note").locator("visible=true").filter({ hasText: "Idea con la app abierta sin red" })).toBeVisible()
    // search works too (device copy)
    await page.goto("/knowledge/brain?q=regularidad")
    await expect(page.getByTestId("brain-count")).toHaveText("1 nota")

    // a route that is not part of the prepared shell: an honest page, no data
    await page.goto("/reviews/week/2026-10-19")
    await expect(page.getByRole("heading", { name: "Sin conexión" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Ir al inicio" })).toBeVisible()

    await context.setOffline(false)
    await page.goto("/reviews/week/2026-10-12")
    await expect(page.getByRole("heading", { name: "Sin conexión" })).toHaveCount(0)
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    expect(consoleErrors.filter((e) => !offlineNoise(e))).toEqual([])
  })

  test("privacy: only this origin's static shell is cached; no API, auth, RSC or cookies; headers limited", async ({ page }) => {
    await page.goto("/")
    await prepared(page)
    const report = await cacheReport(page)
    const origin = new URL(page.url()).origin
    expect(report.length).toBeGreaterThan(SHELL_PAGES)
    for (const r of report) {
      expect(r.cache).toMatch(/^top-shell-/)
      expect(new URL(r.url).origin).toBe(origin)
      expect(r.url).not.toMatch(/\/auth\/|\/api\/|_rsc=|\/rest\/v1|\/realtime/)
      expect(r.headers).not.toContain("set-cookie")
      // stored pages keep only the type, the security headers and the version; static files keep their own technical headers
      const page = r.body && !r.url.endsWith("/offline.html")
      if (page) for (const h of r.headers) expect(["content-type", "content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy", "x-robots-tag", "x-top-version"]).toContain(h)
    }
    // pages are the static shell: the demo data lives in localStorage, never in the cached HTML
    const pages = report.filter((r) => r.body)
    expect(pages.length).toBeGreaterThanOrEqual(SHELL_PAGES)
    for (const p of pages) expect(p.body).not.toMatch(/Outlive|La base aeróbica|demo-note-|@theonepercent\.local/)
  })

  test("a new version replaces the shell as a whole and deletes only its own old cache", async ({ page }) => {
    await page.goto("/")
    await prepared(page)
    const before = await page.evaluate(async () => {
      await (await caches.open("someone-elses-cache")).put("/x", new Response("not ours"))
      return (await caches.keys()).filter((n) => n.startsWith("top-shell-"))
    })
    expect(before).toHaveLength(1)
    // what a deploy does: the page registers the worker with the new version
    await page.evaluate(() => navigator.serviceWorker.register("/sw.js?v=e2e-next-version", { scope: "/" }))
    await expect
      .poll(() => page.evaluate(async () => (await caches.keys()).sort()), { timeout: 20_000 })
      .toEqual(["someone-elses-cache", "top-shell-e2e-next-version"])
    // the stored pages of an older version never mix with the newest one
    await page.evaluate(async () => {
      const c = await caches.open("top-shell-e2e-next-version")
      await c.put("/habits", new Response("<html>old</html>", { headers: { "content-type": "text/html", "x-top-version": "older" } }))
    })
    await page.goto("/")
    await expect
      .poll(() => page.evaluate(async () => !!(await (await caches.open("top-shell-e2e-next-version")).match("/habits"))), { timeout: 15_000 })
      .toBe(false)
    expect(await page.evaluate(async () => (await (await caches.open("someone-elses-cache")).match("/x"))?.text())).toBe("not ours")
  })
})

test.describe("service worker · account", () => {
  test.use({ mode: "account" })
  let account: Account
  test.beforeEach(async ({}, info) => {
    account = await newAccount(`sw-${info.project.name}`)
  })
  test.afterEach(async () => {
    await removeAccount(account)
  })

  test("a prepared device starts the account with no connection; changes wait honestly and reach the server once when it returns", async ({ page, context, consoleErrors }) => {
    await signIn(page, account)
    await page.goto("/knowledge/library/books")
    await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
    await page.getByTestId("add-book").click()
    await page.getByTestId("form-title").fill("Libro de arranque sin red")
    await page.getByTestId("form-save").click()
    await expect(page.getByTestId("item-save")).toHaveText("Sincronizado", { timeout: 15_000 })
    const itemUrl = page.url()
    await prepared(page)

    await context.setOffline(true)
    await page.goto(itemUrl)
    await expect(page.getByRole("heading", { level: 1, name: "Libro de arranque sin red" })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("button", { name: /Estado de datos/ }).first()).not.toHaveAccessibleName(/Sincronizado/)
    await page.getByTestId("capture-open").locator("visible=true").click()
    await page.getByTestId("capture-text").locator("visible=true").fill("Capturada tras arrancar sin red")
    await expect(page.getByTestId("capture-save").locator("visible=true")).toHaveText("Guardado en este dispositivo · se enviará al recuperar la conexión")
    expect(await countRows("select count(*)::int n from public.knowledge_notes where user_id = $1", [account.id])).toBe(0)

    await context.setOffline(false)
    await expect(page.getByTestId("capture-save").locator("visible=true")).toHaveText("Sincronizado", { timeout: 20_000 })
    expect(await countRows("select count(*)::int n from public.knowledge_notes where user_id = $1 and body = 'Capturada tras arrancar sin red'", [account.id])).toBe(1)
    expect(await countRows("select count(*)::int n from public.sync_operations where user_id = $1 and operation_type = 'library.note.create'", [account.id])).toBe(1)
    // the cached shell never holds the account's data
    const pages = (await cacheReport(page)).filter((r) => r.body)
    for (const p of pages) expect(p.body).not.toMatch(/Libro de arranque sin red|Capturada tras arrancar|@theonepercent\.local/)
    expect(consoleErrors.filter((e) => !offlineNoise(e))).toEqual([])
  })

  test("signed out: the redirect to the login page is never stored as an app page", async ({ browser }, info) => {
    const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL, serviceWorkers: "allow" })
    const page = await ctx.newPage()
    await page.goto("/login")
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.postMessage({ type: "top:warm" }))
    // the warm-up asked for every page and got redirects: none may be stored
    await page.waitForTimeout(3000)
    const stored = await page.evaluate(async () => {
      const out: string[] = []
      for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) out.push(new URL(req.url).pathname)
      return out
    })
    expect(stored.filter((p) => !p.startsWith("/_next/") && p !== "/offline.html")).toEqual([])
    await ctx.close()
  })
})
