import { describe, expect, it } from "vitest"
import { checkDestination, isBlockedAddress, safeFetchJson, USER_AGENT, UpstreamError, type FetchDeps } from "./safe-fetch"

const HOSTS = ["openlibrary.org", "itunes.apple.com"]
const opts = { hosts: HOSTS, timeoutMs: 1_000, maxBytes: 10_000, types: ["application/json"] }
const PUBLIC = "93.184.216.34"

type Reply = { status?: number; body?: string | ReadableStream<Uint8Array>; headers?: Record<string, string> }

function deps(routes: Record<string, Reply | ((init: RequestInit) => Promise<Response>)>, dns: Record<string, string[]> = {}): FetchDeps & { seen: string[]; inits: RequestInit[] } {
  const seen: string[] = []
  const inits: RequestInit[] = []
  return {
    seen,
    inits,
    lookup: async (host) => dns[host] ?? [PUBLIC],
    fetch: async (input, init) => {
      const url = String(input)
      seen.push(url)
      inits.push(init ?? {})
      const r = routes[url]
      if (!r) throw new TypeError("fetch failed")
      if (typeof r === "function") return r(init ?? {})
      return new Response(r.body ?? "{}", { status: r.status ?? 200, headers: { "content-type": "application/json", ...r.headers } })
    },
  }
}

const kind = async (p: Promise<unknown>) => {
  try {
    await p
    return "ok"
  } catch (e) {
    return e instanceof UpstreamError ? `${e.kind}${e.status ? ` ${e.status}` : ""}` : String(e)
  }
}

describe("addresses a server request must never reach", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "64:ff9b::7f00:1", "2001:db8::1", "2002:7f00:1::1", "not an ip", "999.1.1.1",
  ])("%s is blocked", (ip) => expect(isBlockedAddress(ip)).toBe(true))

  it.each(["93.184.216.34", "17.253.144.10", "2606:4700::6810:84e5", "::ffff:93.184.216.34", "172.32.0.1"])("%s is public", (ip) => expect(isBlockedAddress(ip)).toBe(false))

  it("destinations: https, default port, no credentials, no IP literal, closed list of hosts", () => {
    const ok = (u: string) => checkDestination(new URL(u), HOSTS)
    expect(ok("https://openlibrary.org/search.json")).toBe(true)
    expect(ok("http://openlibrary.org/")).toBe(false)
    expect(ok("https://openlibrary.org:8443/")).toBe(false)
    expect(ok("https://user:pw@openlibrary.org/")).toBe(false)
    expect(ok("https://127.0.0.1/")).toBe(false)
    expect(ok("https://[::1]/")).toBe(false)
    expect(ok("https://localhost/")).toBe(false)
    expect(ok("https://openlibrary.org.evil.example/")).toBe(false)
    expect(ok("https://covers.openlibrary.org/")).toBe(false)
    expect(ok("file:///etc/passwd")).toBe(false)
  })
})

describe("safeFetchJson", () => {
  const A = "https://openlibrary.org/a.json"

  it("GET with its own User-Agent, no cookies, no cache, manual redirects", async () => {
    const d = deps({ [A]: { body: '{"x":1}' } })
    expect(await safeFetchJson(A, opts, d)).toEqual({ x: 1 })
    expect(d.inits[0]).toMatchObject({ method: "GET", redirect: "manual", cache: "no-store", credentials: "omit", headers: { "User-Agent": USER_AGENT } })
    expect(USER_AGENT).not.toMatch(/@/)
  })

  it("follows a redirect inside the list, checking every hop", async () => {
    const d = deps({ [A]: { status: 302, headers: { location: "/b.json" } }, "https://openlibrary.org/b.json": { body: "[1]" } })
    expect(await safeFetchJson(A, opts, d)).toEqual([1])
    expect(d.seen).toEqual([A, "https://openlibrary.org/b.json"])
  })

  it.each([
    ["to a host outside the list", "https://evil.example/x"],
    ["to localhost", "https://localhost/x"],
    ["to an internal IP", "https://169.254.169.254/latest/meta-data"],
    ["to plain http", "http://openlibrary.org/x"],
    ["to another port", "https://openlibrary.org:444/x"],
    ["with credentials", "https://a:b@openlibrary.org/x"],
  ])("refuses a redirect %s without requesting it", async (_, location) => {
    const d = deps({ [A]: { status: 301, headers: { location } } })
    expect(await kind(safeFetchJson(A, opts, d))).toBe("blocked")
    expect(d.seen).toEqual([A])
  })

  it("refuses an allowed name that resolves to a private address, at the first hop or after a redirect", async () => {
    expect(await kind(safeFetchJson(A, opts, deps({ [A]: {} }, { "openlibrary.org": ["10.0.0.5"] })))).toBe("blocked")
    expect(await kind(safeFetchJson(A, opts, deps({ [A]: {} }, { "openlibrary.org": [PUBLIC, "::1"] })))).toBe("blocked")
    const d = deps({ [A]: { status: 302, headers: { location: "https://itunes.apple.com/x" } } }, { "itunes.apple.com": ["127.0.0.1"] })
    expect(await kind(safeFetchJson(A, opts, d))).toBe("blocked")
    expect(d.seen).toEqual([A])
  })

  it("at most 3 redirects; a redirect without Location is an error", async () => {
    const loop = deps({ [A]: { status: 302, headers: { location: A } } })
    expect(await kind(safeFetchJson(A, opts, loop))).toBe("redirects 302")
    expect(loop.seen).toHaveLength(4)
    expect(await kind(safeFetchJson(A, opts, deps({ [A]: { status: 302 } })))).toBe("status 302")
  })

  it("statuses, Retry-After, content type and JSON", async () => {
    const e = await safeFetchJson(A, opts, deps({ [A]: { status: 429, headers: { "retry-after": "30" } } })).catch((x) => x)
    expect(e).toMatchObject({ kind: "status", status: 429, retryAfter: 30 })
    expect(await kind(safeFetchJson(A, opts, deps({ [A]: { status: 404 } })))).toBe("status 404")
    expect(await kind(safeFetchJson(A, opts, deps({ [A]: { status: 503 } })))).toBe("status 503")
    expect(await kind(safeFetchJson(A, opts, deps({ [A]: { headers: { "content-type": "text/html" }, body: "<html>" } })))).toBe("bad_type")
    expect(await kind(safeFetchJson(A, opts, deps({ [A]: { body: "{oops" } })))).toBe("invalid_json")
  })

  it("too large: by the declared length or while streaming, without reading the rest", async () => {
    expect(await kind(safeFetchJson(A, opts, deps({ [A]: { headers: { "content-length": "999999" } } })))).toBe("too_large")
    let pulled = 0
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++
        c.enqueue(new Uint8Array(4_000))
      },
    })
    expect(await kind(safeFetchJson(A, opts, deps({ [A]: { body: endless } })))).toBe("too_large")
    expect(pulled).toBeLessThan(10)
  })

  it("timeout covers the whole request; a network failure is reported as such", async () => {
    const hang = deps({
      [A]: (init) =>
        new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "TimeoutError")))),
    })
    const t = Date.now()
    expect(await kind(safeFetchJson(A, { ...opts, timeoutMs: 50 }, hang))).toBe("timeout")
    expect(Date.now() - t).toBeLessThan(1_000)
    expect(await kind(safeFetchJson("https://openlibrary.org/missing", opts, deps({})))).toBe("network")
  })

  it("a start URL outside the list is never requested", async () => {
    const d = deps({})
    expect(await kind(safeFetchJson("http://127.0.0.1:54321/rest/v1/", opts, d))).toBe("blocked")
    expect(await kind(safeFetchJson("not a url", opts, d))).toBe("blocked")
    expect(d.seen).toEqual([])
  })
})
