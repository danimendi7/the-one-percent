import { NextRequest } from "next/server"
import { describe, expect, it } from "vitest"
import { callerOf, type Caller } from "./auth"
import { createMetadataRoutes, USER_LIMIT } from "./routes"
import { createMetadataService, type ServiceDeps } from "./service"
import olTitleEs from "../__fixtures__/ol-search-title-es.json"

const req = (path: string, cookie?: string) => new NextRequest(`http://localhost:3000/api/metadata/${path}`, { headers: cookie ? { cookie } : {} })

function setup(caller: (r: NextRequest) => Promise<Caller>) {
  const upstream: string[] = []
  const deps: ServiceDeps = {
    now: () => 0,
    sleep: async () => {},
    random: () => 0,
    fetch: {
      lookup: async () => ["93.184.216.34"],
      fetch: async (input, init) => {
        upstream.push(String(input))
        // What leaves the server: no cookie, no authorization, nothing about the user.
        const h = new Headers(init?.headers)
        if (h.has("cookie") || h.has("authorization")) throw new Error("user data sent upstream")
        return new Response(JSON.stringify(olTitleEs), { headers: { "content-type": "application/json" } })
      },
    },
  }
  return { routes: createMetadataRoutes({ caller, service: createMetadataService(deps), now: () => 0 }), upstream }
}

const asUser = (id: string) => async (): Promise<Caller> => ({ kind: "user", id })
const read = async (r: Response) => ({ status: r.status, body: await r.json(), headers: Object.fromEntries(r.headers) })

describe("metadata routes", () => {
  it("anonymous: 401 before any outside call", async () => {
    const { routes, upstream } = setup(async () => ({ kind: "anonymous" }))
    const r = await read(await routes.booksSearch(req("books/search?q=cien+años")))
    expect(r).toMatchObject({ status: 401, body: { ok: false, error: { code: "unauthorized" } } })
    expect(upstream).toEqual([])
  })

  it("auth not configured or unreachable: 503, no outside call", async () => {
    const { routes, upstream } = setup(async () => ({ kind: "unavailable" }))
    expect((await routes.showsSearch(req("podcasts/search?q=la+ruina"))).status).toBe(503)
    expect(upstream).toEqual([])
  })

  it("the demo cookie alone is anonymous: the real check never reads it as a session", async () => {
    // Real callerOf, with an Auth server that does not exist: it must not even be contacted.
    const caller = (r: NextRequest) => callerOf(r, { url: "http://127.0.0.1:9", key: "k", cookieName: "sb-top-auth-token" })
    expect(await caller(req("books/search?q=x", "top_mode=demo"))).toEqual({ kind: "anonymous" })
    const { routes, upstream } = setup(caller)
    expect((await routes.booksSearch(req("books/search?q=cien", "top_mode=demo"))).status).toBe(401)
    expect(upstream).toEqual([])
  })

  it("a session cookie that the Auth server cannot verify is never trusted", async () => {
    const forged = "sb-top-auth-token=base64-" + Buffer.from(JSON.stringify({ access_token: "x.y.z", refresh_token: "r", user: { id: "00000000-0000-0000-0000-000000000001" } })).toString("base64url")
    const caller = (r: NextRequest) => callerOf(r, { url: "http://127.0.0.1:9", key: "k", cookieName: "sb-top-auth-token" })
    expect((await caller(req("books/search?q=x", forged))).kind).not.toBe("user")
    expect(await callerOf(req("x", forged), { url: "", key: "", cookieName: "sb-top-auth-token" })).toEqual({ kind: "unavailable" })
  })

  it("signed in: 200 with private, non-cached JSON and nothing about the user", async () => {
    const { routes, upstream } = setup(asUser("user-a"))
    const r = await read(await routes.booksSearch(req("books/search?q=cien+a%C3%B1os+de+soledad&by=title")))
    expect(r.status).toBe(200)
    expect(r.headers["cache-control"]).toBe("private, no-store")
    expect(r.body.ok).toBe(true)
    expect(r.body.data[0].workId).toBe("OL274505W")
    expect(JSON.stringify(r.body)).not.toContain("user-a")
    expect(upstream).toHaveLength(1)
    expect(new URL(upstream[0]).host).toBe("openlibrary.org")
  })

  it("bad parameters: 400 before any outside call; no endpoint takes a URL", async () => {
    const { routes, upstream } = setup(asUser("u"))
    for (const r of [
      routes.booksSearch(req("books/search?q=a")),
      routes.booksSearch(req("books/search")),
      routes.booksSearch(req(`books/search?q=${"x".repeat(250)}`)),
      routes.bookDetail(req("books/detail?work=https://127.0.0.1/")),
      routes.bookDetail(req("books/detail?work=OL1W&edition=../../x")),
      routes.bookEditions(req("books/editions?work=OL1M")),
      routes.showEpisodes(req("podcasts/episodes?show=http://169.254.169.254")),
      routes.showsSearch(req("podcasts/search?q=%00")),
    ])
      expect((await r).status).toBe(400)
    expect(upstream).toEqual([])
  })

  it("per-user quota: 429 with Retry-After; another user is not affected", async () => {
    let who = "a"
    const { routes } = setup(async () => ({ kind: "user", id: who }))
    const statuses: number[] = []
    for (let i = 0; i <= USER_LIMIT.capacity; i++) statuses.push((await routes.booksSearch(req("books/search?q=x"))).status)
    expect(statuses.slice(0, USER_LIMIT.capacity).every((s) => s === 400)).toBe(true)
    const limited = await read(await routes.booksSearch(req("books/search?q=x")))
    expect(limited).toMatchObject({ status: 429, body: { ok: false, error: { code: "rate_limited" } } })
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0)
    who = "b"
    expect((await routes.booksSearch(req("books/search?q=cien+años"))).status).toBe(200)
  })

  it("provider errors keep their meaning: 404 not found, 502 unavailable, 503 busy with Retry-After", async () => {
    const make = (status: number, headers: Record<string, string> = {}) =>
      createMetadataRoutes({
        caller: asUser("u"),
        now: () => 0,
        service: createMetadataService({
          now: () => 0,
          sleep: async () => {},
          random: () => 0,
          fetch: { lookup: async () => ["93.184.216.34"], fetch: async () => new Response("{}", { status, headers: { "content-type": "application/json", ...headers } }) },
        }),
      })
    expect((await make(404).bookDetail(req("books/detail?work=OL1W"))).status).toBe(404)
    expect((await make(500).booksSearch(req("books/search?q=dune"))).status).toBe(502)
    const busy = await read(await make(429, { "retry-after": "7" }).booksSearch(req("books/search?q=dune")))
    expect(busy).toMatchObject({ status: 503, body: { ok: false, error: { code: "provider_busy", retryAfter: 7 } }, headers: { "retry-after": "7" } })
  })
})
