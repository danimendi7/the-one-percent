/*
 * THE ONE PERCENT · service worker (M4f, P17 option A). Small on purpose: read it top to bottom.
 *
 * What it does: lets the app START with no connection on a device that already loaded it online.
 * - Caches ONLY the static app shell: the HTML of an allowlist of prerendered routes (the same for
 *   every user: personal data is rendered on the client from IndexedDB) and the hashed static files.
 * - Never touches: other origins (Supabase: REST, Auth, Realtime), non-GET requests, /auth, /api,
 *   RSC data requests, requests with an Authorization header. They go to the network untouched.
 * - Stored HTML keeps only safe headers (type and security headers): no cookies, nothing private.
 * - Never reads, writes or deletes IndexedDB, localStorage or the offline queue: the user's data
 *   and pending changes stay where the app keeps them.
 * - Versioned by the build (`/sw.js?v=<build>`). All cached HTML belongs to ONE version, the newest
 *   seen: an older app is never started over data that a newer one may have upgraded.
 * - Deletes only its own caches (names starting with `top-shell-`).
 * - Shows push notifications and opens the app when one is tapped (E8, at the end of this file).
 */

const VERSION = new URL(self.location.href).searchParams.get("v") || "0"
const PREFIX = "top-shell-"
const CACHE = PREFIX + VERSION
const OFFLINE = "/offline.html"

/** Prerendered app routes whose HTML is identical for everyone. Keep in sync with sw.test.ts. */
const SHELL = [
  "/",
  "/habits",
  "/analytics",
  "/goals",
  "/focus",
  "/mind",
  "/reviews",
  "/reviews/decisions",
  "/intelligence",
  "/knowledge/library",
  "/knowledge/library/books",
  "/knowledge/library/podcasts",
  "/knowledge/library/item",
  "/knowledge/library/show",
  "/knowledge/brain",
  "/knowledge/brain/repaso",
  "/knowledge/discover",
  "/more",
  "/settings",
  "/settings/notifications",
]
const SHELL_SET = new Set(SHELL)

/** Response headers kept on a cached page (everything else, including Set-Cookie, is dropped). */
const KEEP = ["content-type", "content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy", "x-robots-tag"]

const isStatic = (url) =>
  url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest" || url.pathname === "/icon.svg" || url.pathname === "/apple-icon.png" || url.pathname === OFFLINE

/** The app version a page was built with (`<meta name="top-version">`), or null. */
const versionOf = (html) => /<meta name="top-version" content="([^"]*)"/.exec(html)?.[1] ?? null

/** Static files referenced by a page, so a prepared route can start with no connection. */
const assetsOf = (html) => [...new Set([...html.matchAll(/["'(](\/_next\/static\/[^"'()\s\\]+)/g)].map((m) => m[1]))]

async function putPage(cache, path, res) {
  const html = await res.text()
  const version = versionOf(html)
  const headers = new Headers()
  for (const k of KEEP) {
    const v = res.headers.get(k)
    if (v) headers.set(k, v)
  }
  headers.set("x-top-version", version ?? "")
  // One version of the shell at a time: a newer page drops the pages of other versions.
  for (const req of await cache.keys()) {
    const url = new URL(req.url)
    if (!SHELL_SET.has(url.pathname) || url.pathname === path) continue
    const old = await cache.match(req)
    if (old && old.headers.get("x-top-version") !== (version ?? "")) await cache.delete(req)
  }
  await cache.put(path, new Response(html, { status: 200, headers }))
  return html
}

/** A page is cacheable only if it is a same-origin, successful, non-redirected answer (a session
 * that expired redirects to /login: that is never stored as the page). */
const cacheablePage = (res) => res.ok && !res.redirected && res.type === "basic" && (res.headers.get("content-type") || "").includes("text/html")

/** Prepares the shell: every allowlisted page and the static files it references. Best effort. */
async function warm() {
  const cache = await caches.open(CACHE)
  await cache.add(OFFLINE).catch(() => {})
  for (const path of SHELL) {
    if (await cache.match(path)) continue
    try {
      const res = await fetch(path, { credentials: "same-origin", cache: "no-store" })
      if (!cacheablePage(res)) continue
      const html = await putPage(cache, path, res)
      for (const asset of assetsOf(html)) if (!(await cache.match(asset))) await cache.add(asset).catch(() => {})
    } catch {
      // offline or failed: the page is prepared on a later visit
    }
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await cache.add(OFFLINE).catch(() => {})
      await self.skipWaiting()
    })()
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name)
      await self.clients.claim()
    })()
  )
})

// The app asks for the shell to be prepared once it has started online (see sw-register.tsx).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "top:warm") event.waitUntil(warm())
})

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith("/auth/") || url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return
  if (req.headers.has("authorization") || req.headers.get("rsc") === "1" || url.searchParams.has("_rsc")) return

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req)
          if (SHELL_SET.has(url.pathname) && cacheablePage(res)) {
            const cache = await caches.open(CACHE)
            event.waitUntil(putPage(cache, url.pathname, res.clone()).catch(() => {}))
          }
          return res
        } catch {
          const cache = await caches.open(CACHE)
          // Same page whatever the query (?id=, ?q=): the app reads it on the client.
          return (SHELL_SET.has(url.pathname) && (await cache.match(url.pathname))) || (await cache.match(OFFLINE)) || Response.error()
        }
      })()
    )
    return
  }

  if (isStatic(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE)
        const hit = await cache.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok && res.type === "basic") event.waitUntil(cache.put(req, res.clone()).catch(() => {}))
        return res
      })()
    )
  }
})

/*
 * Push (E8). Shows what the server sends and nothing else: the text arrives in the message and is
 * cut to a sane length. A notification only ever opens a path of this app (never another origin).
 * The server sends no personal data, so what shows on a lock screen is safe.
 */
const NOTIFY_ICON = "/icons/icon-192.png"

/** A path of this app (`/x`, not `//host` or `https://...`), or the home page. */
const appPath = (v) => (typeof v === "string" && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/")

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = (event.data && event.data.json()) || {}
  } catch {
    data = {}
  }
  const title = typeof data.title === "string" && data.title.trim() ? data.title.slice(0, 100) : "THE ONE PERCENT"
  const options = {
    body: typeof data.body === "string" ? data.body.slice(0, 300) : "",
    icon: NOTIFY_ICON,
    badge: NOTIFY_ICON,
    data: { url: appPath(data.url) },
  }
  if (typeof data.tag === "string" && data.tag) options.tag = data.tag.slice(0, 64)
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const target = new URL(appPath(event.notification.data && event.notification.data.url), self.location.origin)
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      const open = windows.find((c) => new URL(c.url).origin === self.location.origin)
      if (open) {
        await open.focus()
        if (new URL(open.url).pathname !== target.pathname) await open.navigate(target.href).catch(() => {})
        return
      }
      await self.clients.openWindow(target.href)
    })()
  )
})
