/**
 * M4g.1: who may reach the metadata providers, checked against the LOCAL Auth server with real
 * sessions of two synthetic users. Upstream calls are answered by a recorded fixture; no test here
 * contacts Open Library or Apple.
 */
import { createServerClient } from "@supabase/ssr"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { callerOf, type AuthConfig } from "@/features/library/metadata/server/auth"
import { createCoverService } from "@/features/library/metadata/server/cover-service"
import { COVER_CACHE, createCoverRoute, createMetadataRoutes, USER_LIMIT } from "@/features/library/metadata/server/routes"
import { createMetadataService } from "@/features/library/metadata/server/service"
import { AUTH_COOKIE_NAME, DEMO_COOKIE } from "@/lib/supabase/env"
import olTitleEs from "../../src/features/library/metadata/__fixtures__/ol-search-title-es.json"
import { createTestUser, deleteTestUser, localStatus, type TestUser } from "./setup"

let a: TestUser
let b: TestUser
let cfg: AuthConfig

/** The cookies a browser signed in as `u` would send (written by @supabase/ssr itself). */
async function cookiesOf(u: TestUser): Promise<string> {
  const { data } = await u.client.auth.getSession()
  const jar = new Map<string, string>()
  const ssr = createServerClient(cfg.url, cfg.key, {
    cookieOptions: { name: AUTH_COOKIE_NAME },
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (list) => list.forEach((c) => jar.set(c.name, c.value)) },
  })
  const { error } = await ssr.auth.setSession({ access_token: data.session!.access_token, refresh_token: data.session!.refresh_token })
  if (error) throw error
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ")
}

const req = (path: string, cookie?: string) => new NextRequest(`http://localhost:3000/api/metadata/${path}`, { headers: cookie ? { cookie } : {} })

function routes() {
  const upstream: string[] = []
  const r = createMetadataRoutes({
    caller: (q) => callerOf(q, cfg),
    now: () => 0,
    service: createMetadataService({
      now: () => 0,
      sleep: async () => {},
      random: () => 0,
      fetch: {
        lookup: async () => ["93.184.216.34"],
        fetch: async (input, init) => {
          upstream.push(String(input))
          const h = new Headers(init?.headers)
          if (h.has("cookie") || h.has("authorization")) throw new Error("user data sent upstream")
          return new Response(JSON.stringify(olTitleEs), { headers: { "content-type": "application/json" } })
        },
      },
    }),
  })
  return { r, upstream }
}

beforeAll(async () => {
  const s = localStatus()
  cfg = { url: s.API_URL, key: s.PUBLISHABLE_KEY, cookieName: AUTH_COOKIE_NAME }
  a = await createTestUser("meta-a")
  b = await createTestUser("meta-b")
})

afterAll(async () => {
  if (a) await deleteTestUser(a)
  if (b) await deleteTestUser(b)
})

describe("metadata endpoints and real sessions (local stack)", () => {
  it("a real session is verified by the Auth server and identifies its own user", async () => {
    expect(await callerOf(req("x", await cookiesOf(a)), cfg)).toEqual({ kind: "user", id: a.id })
    expect(await callerOf(req("x", await cookiesOf(b)), cfg)).toEqual({ kind: "user", id: b.id })
  })

  it("no cookie, the demo cookie, or a forged session: anonymous, and 401 before any outside call", async () => {
    const forgedToken = (await a.client.auth.getSession()).data.session!.access_token.replace(/\.[^.]+$/, ".invalidsignature")
    // User A's real token with its signature replaced, in the cookie format @supabase/ssr reads.
    const forged = `${AUTH_COOKIE_NAME}=base64-${Buffer.from(JSON.stringify({ access_token: forgedToken, refresh_token: "x", token_type: "bearer", expires_at: 4102444800, user: { id: a.id } })).toString("base64url")}`
    const { r, upstream } = routes()
    for (const cookie of [undefined, `${DEMO_COOKIE}=demo`, forged, `${DEMO_COOKIE}=demo; ${forged}`]) {
      const caller = await callerOf(req("x", cookie), cfg)
      expect(caller.kind).toBe("anonymous")
      expect((await r.booksSearch(req("books/search?q=cien+años", cookie))).status).toBe(401)
    }
    expect(upstream).toEqual([])
  })

  it("with a real session the endpoint answers; one user's quota never affects the other", async () => {
    const { r, upstream } = routes()
    const ca = await cookiesOf(a)
    const cb = await cookiesOf(b)
    const ok = await r.booksSearch(req("books/search?q=cien+años+de+soledad", ca))
    expect(ok.status).toBe(200)
    const body = await ok.text()
    expect(body).not.toContain(a.id)
    expect(body).not.toContain(a.email)
    for (let i = 1; i < USER_LIMIT.capacity; i++) await r.booksSearch(req("books/search?q=a", ca))
    expect((await r.booksSearch(req("books/search?q=cien", ca))).status).toBe(429)
    expect((await r.booksSearch(req("books/search?q=cien", cb))).status).toBe(200)
    // Only parameters went upstream: no ids, emails or tokens of either user.
    for (const u of upstream) for (const secret of [a.id, b.id, a.email, b.email]) expect(u).not.toContain(secret)
  })

  it("covers (M4g.2): a real session gets the image; anonymous, demo and forged sessions get 401 without any outside call", async () => {
    const upstream: string[] = []
    const jpeg = Uint8Array.from({ length: 4_000 }, (_, i) => [0xff, 0xd8, 0xff, 0xe0][i] ?? 1)
    const handle = createCoverRoute({
      caller: (q) => callerOf(q, cfg),
      now: () => 0,
      covers: createCoverService({
        now: () => 0,
        sleep: async () => {},
        random: () => 0,
        fetch: {
          lookup: async () => ["93.184.216.34"],
          fetch: async (input, init) => {
            upstream.push(input)
            const h = new Headers(init?.headers)
            if (h.has("cookie") || h.has("authorization")) throw new Error("user data sent upstream")
            return new Response(jpeg, { headers: { "content-type": "image/jpeg" } })
          },
        },
      }),
    })
    const cover = (cookie?: string) => handle(new NextRequest("http://localhost:3000/api/covers?ol=12627383&s=md", { headers: cookie ? { cookie } : {} }))
    const forgedToken = (await a.client.auth.getSession()).data.session!.access_token.replace(/.[^.]+$/, ".invalidsignature")
    const forged = `${AUTH_COOKIE_NAME}=base64-${Buffer.from(JSON.stringify({ access_token: forgedToken, refresh_token: "x", token_type: "bearer", expires_at: 4102444800, user: { id: a.id } })).toString("base64url")}`
    for (const cookie of [undefined, `${DEMO_COOKIE}=demo`, forged]) {
      const r = await cover(cookie)
      expect([r.status, r.headers.get("cache-control")]).toEqual([401, "no-store"])
    }
    expect(upstream).toEqual([])
    const ok = await cover(await cookiesOf(b))
    expect(ok.status).toBe(200)
    expect(ok.headers.get("content-type")).toBe("image/jpeg")
    expect(ok.headers.get("cache-control")).toBe(COVER_CACHE)
    expect(ok.headers.get("set-cookie")).toBeNull()
    expect(upstream).toEqual(["https://covers.openlibrary.org/b/id/12627383-M.jpg"])
  })
})
