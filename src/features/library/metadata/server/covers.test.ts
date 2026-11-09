import { EventEmitter } from "node:events"
import type { request as httpsRequest, RequestOptions } from "node:https"
import { Readable } from "node:stream"
import { NextRequest } from "next/server"
import { describe, expect, it } from "vitest"
import { coverSrc, type CoverKey } from "../covers"
import type { Caller } from "./auth"
import { COVER_LIMITS, createCoverService } from "./cover-service"
import { COVER_CACHE, COVER_USER_LIMIT, createCoverRoute } from "./routes"
import { pinnedFetch, safeFetchImage, sniffImage, UpstreamError, validatingLookup, type FetchDeps, type Resolver } from "./safe-fetch"
import type { ServiceDeps } from "./service"

const JPEG = (n = 2_000) => Uint8Array.from({ length: n }, (_, i) => [0xff, 0xd8, 0xff, 0xe0][i] ?? i % 251)
const PNG = (n = 2_000) => Uint8Array.from({ length: n }, (_, i) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][i] ?? 7)
const WEBP = (n = 2_000) => Uint8Array.from({ length: n }, (_, i) => [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50][i] ?? 9)
const GIF_PLACEHOLDER = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...Array(37).fill(0)])

const APPLE_PATH = "Podcasts221/v4/2b/1a/09/2b1a09d7-c6dc-22c2-d2f6-2a34ef83a6dd/mza_16581116865991017367.jpg"
const OL: CoverKey = { provider: "openlibrary", id: 12627383 }
const APPLE: CoverKey = { provider: "apple", host: 1, path: APPLE_PATH }
const OL_M = "https://covers.openlibrary.org/b/id/12627383-M.jpg"
const ARCHIVE = "https://archive.org/download/m_covers_0012/m_covers_0012_62.zip/0012627383-M.jpg"
const NODE = "https://ia600505.us.archive.org/view_archive.php?archive=/5/items/m_covers_0012/m_covers_0012_62.zip&file=0012627383-M.jpg"
const APPLE_300 = `https://is1-ssl.mzstatic.com/image/thumb/${APPLE_PATH}/300x300bb.jpg`

type Reply = { status?: number; body?: Uint8Array | string; headers?: Record<string, string> } | (() => Promise<Response>)

function upstream(routes: Record<string, Reply>, dns: Record<string, string[]> = {}) {
  const seen: string[] = []
  const inits: RequestInit[] = []
  const deps: FetchDeps = {
    lookup: async (host) => dns[host] ?? ["93.184.216.34"],
    fetch: async (input, init) => {
      seen.push(input)
      inits.push(init)
      const r = routes[input]
      if (!r) throw new TypeError("fetch failed")
      if (typeof r === "function") return r()
      return new Response(r.body === undefined ? JPEG() : (r.body as Uint8Array<ArrayBuffer>), { status: r.status ?? 200, headers: { "content-type": "image/jpeg", ...r.headers } })
    },
  }
  return { deps, seen, inits }
}

const opts = { hosts: ["covers.openlibrary.org", "is1-ssl.mzstatic.com"], ...COVER_LIMITS }
const kind = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e) => (e instanceof UpstreamError ? `${e.kind}${e.status ? ` ${e.status}` : ""}` : String(e))
  )

describe("image checks", () => {
  it("the bytes must prove JPEG, PNG or WebP", () => {
    expect(sniffImage(JPEG())).toBe("image/jpeg")
    expect(sniffImage(PNG())).toBe("image/png")
    expect(sniffImage(WEBP())).toBe("image/webp")
    expect(sniffImage(GIF_PLACEHOLDER)).toBeNull()
    expect(sniffImage(new TextEncoder().encode("<!doctype html><title>x</title>"))).toBeNull()
    expect(sniffImage(new Uint8Array(0))).toBeNull()
  })

  it("accepts a valid image of each type, with its proven type", async () => {
    for (const [body, type] of [[JPEG(), "image/jpeg"], [PNG(), "image/png"], [WEBP(), "image/webp"]] as const) {
      const { deps } = upstream({ [OL_M]: { body, headers: { "content-type": type } } })
      expect((await safeFetchImage(OL_M, opts, deps)).type).toBe(type)
    }
  })

  it.each([
    ["Open Library's 43-byte placeholder GIF", { body: GIF_PLACEHOLDER, headers: { "content-type": "image/gif" } }, "bad_image"],
    ["a large real GIF", { body: Uint8Array.from({ length: 5000 }, (_, i) => [0x47, 0x49, 0x46, 0x38][i] ?? 1), headers: { "content-type": "image/gif" } }, "bad_image"],
    ["the same GIF declared as JPEG", { body: GIF_PLACEHOLDER }, "bad_image"],
    ["an HTML page", { body: "<html>login</html>", headers: { "content-type": "text/html" } }, "bad_type"],
    ["HTML declared as an image", { body: "<html>" + "x".repeat(2000) }, "bad_image"],
    ["a PNG declared as JPEG", { body: PNG() }, "bad_image"],
    ["an empty answer", { body: new Uint8Array(0) }, "bad_image"],
    ["a too small image", { body: JPEG(500) }, "bad_image"],
    ["SVG", { body: "<svg/>", headers: { "content-type": "image/svg+xml" } }, "bad_type"],
    ["a compressed body", { headers: { "content-encoding": "gzip" } }, "bad_type"],
    ["a declared size over 2 MB", { headers: { "content-length": String(3 * 1024 * 1024) } }, "too_large"],
    ["a body over 2 MB", { body: JPEG(2 * 1024 * 1024 + 1) }, "too_large"],
    ["206 partial content", { status: 206 }, "status 206"],
    ["404", { status: 404 }, "status 404"],
  ] as const)("refuses %s", async (_, reply, expected) => {
    const { deps } = upstream({ [OL_M]: reply as Reply })
    expect(await kind(safeFetchImage(OL_M, opts, deps))).toBe(expected)
  })

  it("timeout: 5 s for the whole request", async () => {
    const hang = upstream({ [OL_M]: () => new Promise(() => {}) })
    const t = Date.now()
    expect(await kind(safeFetchImage(OL_M, { ...opts, timeoutMs: 50 }, { ...hang.deps, fetch: (u, i) => new Promise((_, rej) => i.signal?.addEventListener("abort", () => rej(new Error("aborted")))) }))).toBe("timeout")
    expect(Date.now() - t).toBeLessThan(1_000)
    expect(COVER_LIMITS).toEqual({ timeoutMs: 5_000, maxBytes: 2 * 1024 * 1024, minBytes: 1_024, maxRedirects: 2 })
  })
})

describe("pinned connection (DNS rebinding)", () => {
  const resolver = (answers: { address: string; family: number }[][]): Resolver & { calls: number } => {
    const r = Object.assign(async () => answers[Math.min(r.calls++, answers.length - 1)], { calls: 0 })
    return r
  }
  const call = (lookup: ReturnType<typeof validatingLookup>, options: { all?: boolean; family?: number }) =>
    new Promise<{ err: Error | null; address?: unknown; family?: number }>((done) => lookup("covers.openlibrary.org", options as never, ((err: Error | null, address?: unknown, family?: number) => done({ err, address, family })) as never))

  it("the socket gets exactly the addresses that were checked", async () => {
    const lookup = validatingLookup(resolver([[{ address: "93.184.216.34", family: 4 }, { address: "2606:4700::1", family: 6 }]]))
    expect(await call(lookup, {})).toEqual({ err: null, address: "93.184.216.34", family: 4 })
    expect((await call(lookup, { all: true })).address).toEqual([{ address: "93.184.216.34", family: 4 }, { address: "2606:4700::1", family: 6 }])
    expect(await call(lookup, { family: 6 })).toEqual({ err: null, address: "2606:4700::1", family: 6 })
  })

  it.each([
    [[{ address: "127.0.0.1", family: 4 }]],
    [[{ address: "10.0.0.8", family: 4 }]],
    [[{ address: "169.254.169.254", family: 4 }]],
    [[{ address: "::ffff:192.168.1.1", family: 6 }]],
    [[{ address: "93.184.216.34", family: 4 }, { address: "::1", family: 6 }]],
    [[]],
  ])("refuses to connect when the name resolves to %j", async (answer) => {
    const r = await call(validatingLookup(resolver([answer])), { all: true })
    expect(r.err).toMatchObject({ code: "EBLOCKEDADDR" })
  })

  /** A stand-in for node:https.request that connects through the given lookup, like a socket does. */
  function fakeHttps(serve: (address: string) => { status: number; headers: Record<string, string>; body: Uint8Array }) {
    const seen: RequestOptions[] = []
    const request = ((options: RequestOptions, onResponse: (res: Readable & { statusCode: number; headers: Record<string, string> }) => void) => {
      seen.push(options)
      const req = new EventEmitter() as EventEmitter & { end: () => void }
      req.end = () =>
        (options.lookup as ReturnType<typeof validatingLookup>)(options.hostname!, { all: true } as never, ((err: Error | null, list: { address: string }[]) => {
          if (err) return req.emit("error", err)
          const r = serve(list[0].address)
          onResponse(Object.assign(Readable.from([r.body]), { statusCode: r.status, headers: r.headers }))
        }) as never)
      return req
    }) as unknown as typeof httpsRequest
    return { request, seen }
  }

  it("a name that turns private after the first check is not reached (check ≠ connection)", async () => {
    // First answer (the pre-check) is public; the socket's own resolution is private.
    const flip = resolver([[{ address: "93.184.216.34", family: 4 }], [{ address: "127.0.0.1", family: 4 }]])
    const https = fakeHttps(() => ({ status: 200, headers: { "content-type": "image/jpeg" }, body: JPEG() }))
    const deps: FetchDeps = { fetch: pinnedFetch(flip, https.request), lookup: async (h) => (await flip(h)).map((a) => a.address) }
    expect(await kind(safeFetchImage(OL_M, opts, deps))).toBe("blocked")
  })

  it("normal case: https on 443, no connection reuse, own lookup, no user headers", async () => {
    const stable = resolver([[{ address: "93.184.216.34", family: 4 }]])
    const https = fakeHttps(() => ({ status: 200, headers: { "content-type": "image/jpeg" }, body: JPEG() }))
    const deps: FetchDeps = { fetch: pinnedFetch(stable, https.request), lookup: async (h) => (await stable(h)).map((a) => a.address) }
    expect((await safeFetchImage(OL_M, opts, deps)).type).toBe("image/jpeg")
    expect(https.seen[0]).toMatchObject({ protocol: "https:", hostname: "covers.openlibrary.org", port: 443, path: "/b/id/12627383-M.jpg", method: "GET", agent: false })
    expect(typeof https.seen[0].lookup).toBe("function")
    expect(Object.keys(https.seen[0].headers as object).map((k) => k.toLowerCase()).sort()).toEqual(["accept", "user-agent"])
  })
})

// ---------- service and route ----------

function harness(routes: Record<string, Reply>, dns: Record<string, string[]> = {}) {
  let t = 0
  const up = upstream(routes, dns)
  const deps: ServiceDeps = { now: () => t, sleep: async () => {}, random: () => 0, fetch: up.deps }
  return { service: createCoverService(deps), up, advance: (ms: number) => (t += ms) }
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code ?? String(e)
  )

describe("cover service", () => {
  it("Open Library: served directly, or through its measured two-step chain", async () => {
    const direct = harness({ [OL_M]: {} })
    expect((await direct.service.get(OL, "md")).type).toBe("image/jpeg")
    const chain = harness({ [OL_M]: { status: 302, headers: { location: ARCHIVE } }, [ARCHIVE]: { status: 302, headers: { location: NODE } }, [NODE]: {} })
    expect((await chain.service.get(OL, "md")).bytes.byteLength).toBe(2_000)
    expect(chain.up.seen).toEqual([OL_M, ARCHIVE, NODE])
  })

  it("Apple: direct, at the size asked", async () => {
    const h = harness({ [APPLE_300]: {} })
    expect((await h.service.get(APPLE, "md")).type).toBe("image/jpeg")
    expect(h.up.seen).toEqual([APPLE_300])
  })

  it.each([
    ["to another host", "https://evil.example/x.jpg"],
    ["to localhost", "https://localhost/x.jpg"],
    ["to a private IP", "https://192.168.1.10/x.jpg"],
    ["to plain http", "http://archive.org/download/m_covers_0012/m_covers_0012_62.zip/0012627383-M.jpg"],
    ["to another cover", "https://archive.org/download/m_covers_0012/m_covers_0012_62.zip/0012627384-M.jpg"],
    ["to a storage node directly", NODE],
  ])("a redirect %s is refused before requesting it", async (_, location) => {
    const h = harness({ [OL_M]: { status: 302, headers: { location } } })
    expect(await code(h.service.get(OL, "md"))).toBe("provider_unavailable")
    expect(h.up.seen).toEqual([OL_M])
  })

  it("an Apple redirect is refused, whatever the target", async () => {
    const h = harness({ [APPLE_300]: { status: 301, headers: { location: `https://is2-ssl.mzstatic.com/image/thumb/${APPLE_PATH}/300x300bb.jpg` } } })
    expect(await code(h.service.get(APPLE, "md"))).toBe("provider_unavailable")
    expect(h.up.seen).toHaveLength(1)
  })

  it("a storage node that resolves to a private address is not contacted", async () => {
    const h = harness({ [OL_M]: { status: 302, headers: { location: ARCHIVE } }, [ARCHIVE]: { status: 302, headers: { location: NODE } }, [NODE]: {} }, { "ia600505.us.archive.org": ["10.1.1.1"] })
    expect(await code(h.service.get(OL, "md"))).toBe("provider_unavailable")
    expect(h.up.seen).toEqual([OL_M, ARCHIVE])
  })

  it("no cover there (404 or the placeholder GIF): not_found, and the provider is not penalised", async () => {
    // As Open Library really sends it (declared image/gif), and disguised as JPEG.
    const real = harness({ [OL_M]: { body: GIF_PLACEHOLDER, headers: { "content-type": "image/gif" } } })
    for (let i = 0; i < 5; i++) expect(await code(real.service.get(OL, "md"))).toBe("not_found")
    expect(real.up.seen).toHaveLength(5)
    const gif = harness({ [OL_M]: { body: GIF_PLACEHOLDER, headers: { "content-type": "image/jpeg" } } })
    for (let i = 0; i < 5; i++) expect(await code(gif.service.get(OL, "md"))).toBe("not_found")
    const missing = harness({ [APPLE_300]: { status: 404, body: "{}", headers: { "content-type": "application/json" } } })
    expect(await code(missing.service.get(APPLE, "md"))).toBe("not_found")
  })

  it("429: provider paused; 5xx and timeouts open the breaker after 3; no retries", async () => {
    const busy = harness({ [OL_M]: { status: 429, headers: { "retry-after": "30" } } })
    expect(await code(busy.service.get(OL, "md"))).toBe("provider_busy")
    expect(await code(busy.service.get({ provider: "openlibrary", id: 5 }, "md"))).toBe("provider_unavailable")
    expect(busy.up.seen).toHaveLength(1)
    const down = harness({ [OL_M]: { status: 503 } })
    for (let i = 0; i < 3; i++) await down.service.get(OL, "md").catch(() => {})
    expect(down.up.seen).toHaveLength(3)
    await down.service.get(OL, "md").catch(() => {})
    expect(down.up.seen).toHaveLength(3)
    const slow = harness({ [APPLE_300]: () => Promise.reject(new UpstreamError("timeout")) })
    expect(await code(slow.service.get(APPLE, "md"))).toBe("provider_unavailable")
    expect(slow.up.seen).toHaveLength(1)
    // Timeouts (archive.org is slow) never pause the provider: the next cover is still asked.
    for (let i = 0; i < 4; i++) await slow.service.get(APPLE, "md").catch(() => {})
    expect(slow.up.seen).toHaveLength(5)
  })

  it("one provider failing does not affect the other", async () => {
    const h = harness({ [OL_M]: { status: 500 }, [APPLE_300]: {} })
    for (let i = 0; i < 4; i++) await h.service.get(OL, "md").catch(() => {})
    expect(await code(h.service.get(APPLE, "md"))).toBe("ok")
  })
})

describe("/api/covers route", () => {
  const req = (search: string, cookie?: string) => new NextRequest(`http://localhost:3000/api/covers${search}`, { headers: cookie ? { cookie } : {} })
  const asUser = (id: string) => async (): Promise<Caller> => ({ kind: "user", id })
  function route(caller: (r: NextRequest) => Promise<Caller>, routes: Record<string, Reply> = { [OL_M]: {}, [APPLE_300]: {} }) {
    const h = harness(routes)
    return { handle: createCoverRoute({ caller, covers: h.service, now: () => 0 }), up: h.up }
  }

  it("anonymous, demo (no verified user) and Auth down: refused before any outside call, never cached", async () => {
    for (const [caller, status] of [[async (): Promise<Caller> => ({ kind: "anonymous" }), 401], [async (): Promise<Caller> => ({ kind: "unavailable" }), 503]] as const) {
      const { handle, up } = route(caller)
      const r = await handle(req(coverSrc(OL, "md").slice("/api/covers".length), "top_mode=demo"))
      expect(r.status).toBe(status)
      expect(r.headers.get("cache-control")).toBe("no-store")
      expect(await r.text()).toBe("")
      expect(up.seen).toEqual([])
    }
  })

  it("signed in: the image with its proven type, cacheable only by the browser, without cookies", async () => {
    const { handle, up } = route(asUser("user-a"))
    const r = await handle(req(coverSrc(OL, "md").slice("/api/covers".length), "sb-top-auth-token=secret-session"))
    expect(r.status).toBe(200)
    expect(r.headers.get("content-type")).toBe("image/jpeg")
    expect(r.headers.get("cache-control")).toBe(COVER_CACHE)
    expect(COVER_CACHE).toMatch(/^private,/)
    expect(r.headers.get("set-cookie")).toBeNull()
    expect(new Uint8Array(await r.arrayBuffer()).byteLength).toBe(2_000)
    // Nothing of the user goes upstream: no cookie, no authorization, no id.
    const sent = new Headers(up.inits[0].headers)
    expect(sent.has("cookie") || sent.has("authorization")).toBe(false)
    expect(up.seen.join(" ")).not.toMatch(/user-a|secret-session/)
  })

  it("bad requests: 400 before any outside call", async () => {
    const { handle, up } = route(asUser("u"))
    for (const q of ["", "?ol=1", "?url=https://127.0.0.1/x&s=md", "?src=https://covers.openlibrary.org/b/id/1-L.jpg&s=md", "?ol=1&ol=2&s=md", "?apple=9:x&s=md"]) expect((await handle(req(q))).status).toBe(400)
    expect(up.seen).toEqual([])
  })

  it("errors keep their meaning and are never cached", async () => {
    const { handle } = route(asUser("u"), { [OL_M]: { status: 404 }, [APPLE_300]: { status: 429, headers: { "retry-after": "9" } } })
    const missing = await handle(req("?ol=12627383&s=md"))
    expect([missing.status, missing.headers.get("cache-control")]).toEqual([404, "no-store"])
    const busy = await handle(req(coverSrc(APPLE, "md").slice("/api/covers".length)))
    expect([busy.status, busy.headers.get("cache-control"), busy.headers.get("retry-after")]).toEqual([503, "no-store", "9"])
  })

  it("per-user quota; another user is unaffected", async () => {
    let who = "a"
    const { handle } = route(async () => ({ kind: "user", id: who }))
    for (let i = 0; i < COVER_USER_LIMIT.capacity; i++) await handle(req("?ol=1"))
    const limited = await handle(req("?ol=12627383&s=md"))
    expect([limited.status, limited.headers.get("cache-control")]).toEqual([429, "no-store"])
    who = "b"
    expect((await handle(req("?ol=12627383&s=md"))).status).toBe(200)
  })
})
