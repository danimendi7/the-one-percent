import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import vm from "node:vm"
import { describe, expect, it } from "vitest"

/**
 * public/sw.js caches the HTML of an allowlist of routes (M4f). This keeps the list honest: every
 * static page of the app is in it, and nothing with a dynamic segment, the login page, the
 * development diagnostics or a redirect is.
 */
const root = join(process.cwd(), "src", "app", "(app)")
const sw = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8")

function pages(dir: string, base = ""): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...pages(p, name.startsWith("(") ? base : `${base}/${name}`))
    else if (name === "page.tsx") out.push(base || "/")
  }
  return out
}

const shell = JSON.parse(/const SHELL = (\[[\s\S]*?\])/.exec(sw)![1].replace(/,\s*\]/, "]")) as string[]

describe("service worker allowlist", () => {
  it("is exactly the static pages of the app (no dynamic segments, no /dev, no redirects)", () => {
    const redirects = ["/knowledge"]
    const expected = pages(root)
      .filter((p) => !p.includes("[") && !p.startsWith("/dev") && !redirects.includes(p))
      .sort()
    expect([...shell].sort()).toEqual(expected)
  })

  it("never handles other origins, writes, auth, RSC or Authorization; deletes only its own caches", () => {
    expect(sw).toContain('if (req.method !== "GET") return')
    expect(sw).toContain("if (url.origin !== self.location.origin) return")
    expect(sw).toMatch(/startsWith\("\/auth\/"\)/)
    expect(sw).toMatch(/headers\.has\("authorization"\)/)
    expect(sw).toMatch(/get\("rsc"\) === "1"/)
    expect(sw).toMatch(/name\.startsWith\(PREFIX\) && name !== CACHE\) await caches\.delete\(name\)/)
    expect(sw).not.toMatch(/indexedDB\.|localStorage\.|deleteDatabase\(/)
    expect(shell).not.toContain("/login")
  })
})

/** The push handlers (E8), run for real in a sandbox with a fake worker scope. */
function worker(windows: { url: string }[] = []) {
  const handlers: Record<string, (e: unknown) => void> = {}
  const shown: [string, Record<string, unknown>][] = []
  const opened: string[] = []
  const focused: string[] = []
  const navigated: string[] = []
  const clients = windows.map((w) => ({
    url: w.url,
    focus: async () => void focused.push(w.url),
    navigate: async (u: string) => void navigated.push(u),
  }))
  const self = {
    location: { href: "https://app.example/sw.js?v=1", origin: "https://app.example" },
    addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn),
    registration: { showNotification: async (title: string, options: Record<string, unknown>) => void shown.push([title, options]) },
    clients: { matchAll: async () => clients, openWindow: async (u: string) => void opened.push(u), claim: async () => {} },
    skipWaiting: async () => {},
  }
  vm.runInNewContext(sw, { self, URL, Headers, Response, caches: {}, fetch: () => Promise.reject(new Error("offline")) })
  const dispatch = async (type: string, event: Record<string, unknown>) => {
    const waits: Promise<unknown>[] = []
    handlers[type]({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) })
    await Promise.all(waits)
  }
  const push = (payload: unknown) => dispatch("push", { data: { json: () => (typeof payload === "string" ? JSON.parse(payload) : payload) } })
  const click = (url: unknown) => {
    let closed = false
    return dispatch("notificationclick", { notification: { data: { url }, close: () => (closed = true) } }).then(() => closed)
  }
  return { shown, opened, focused, navigated, push, click }
}

describe("service worker push", () => {
  it("shows the text the server sends, cut to a sane length, with the app icon", async () => {
    const w = worker()
    await w.push({ title: "THE ONE PERCENT", body: "Notificación de prueba", url: "/settings/notifications", tag: "top-test" })
    expect(w.shown).toEqual([["THE ONE PERCENT", { body: "Notificación de prueba", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { url: "/settings/notifications" }, tag: "top-test" }]])
    await w.push({ title: "x".repeat(500), body: "y".repeat(1000) })
    expect((w.shown[1][0] as string).length).toBe(100)
    expect((w.shown[1][1].body as string).length).toBe(300)
  })

  it("an empty or broken message still shows the app name and opens the home page", async () => {
    const w = worker()
    await w.push("not json {")
    await w.push(null)
    await w.push({ title: 42, body: { html: "<b>" } })
    for (const [title, options] of w.shown) expect([title, options.body, options.data]).toEqual(["THE ONE PERCENT", "", { url: "/" }])
  })

  it("a notification only ever opens a path of this app", async () => {
    for (const url of ["https://evil.example/x", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", 7]) {
      const w = worker()
      expect(await w.click(url)).toBe(true)
      expect(w.opened).toEqual(["https://app.example/"])
    }
  })

  it("focuses an open window of the app and takes it to the page, or opens one", async () => {
    const w = worker([{ url: "https://other.example/" }, { url: "https://app.example/habits" }])
    await w.click("/settings/notifications")
    expect([w.focused, w.navigated, w.opened]).toEqual([["https://app.example/habits"], ["https://app.example/settings/notifications"], []])
    const none = worker()
    await none.click("/settings/notifications")
    expect(none.opened).toEqual(["https://app.example/settings/notifications"])
  })
})
