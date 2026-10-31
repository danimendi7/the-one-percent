import type { NextRequest } from "next/server"
import { parseCoverRequest } from "../covers"
import { PARAMS } from "../query"
import type { MetadataError, MetadataErrorCode, MetadataResponse } from "../types"
import { callerOf, type Caller } from "./auth"
import { KeyedLimiter, type Clock } from "./limits"
import { createCoverService, type CoverService } from "./cover-service"
import { createMetadataService, ServiceError, type MetadataService } from "./service"

/**
 * GET handlers of /api/metadata/* (M4g.1). Order of checks, each one before any outside call:
 * verified user → per-user quota → parameters → service. Answers are JSON `{ ok, data | error }`,
 * private and never stored by caches. Nothing is logged: queries may say what the user reads.
 */
export interface RouteDeps {
  caller: (request: NextRequest) => Promise<Caller>
  service: MetadataService
  now: Clock
}

const STATUS: Record<MetadataErrorCode, number> = {
  unauthorized: 401,
  unavailable: 503,
  bad_request: 400,
  rate_limited: 429,
  provider_busy: 503,
  provider_unavailable: 502,
  not_found: 404,
  network: 502,
}

const HEADERS = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8", Vary: "Cookie" }

function reply<T>(body: MetadataResponse<T>): Response {
  const status = body.ok ? 200 : STATUS[body.error.code]
  const headers: Record<string, string> = { ...HEADERS }
  if (!body.ok && body.error.retryAfter !== undefined) headers["Retry-After"] = String(body.error.retryAfter)
  return new Response(JSON.stringify(body), { status, headers })
}

const failWith = (code: MetadataErrorCode, retryAfter?: number) => reply({ ok: false, error: { code, ...(retryAfter !== undefined && { retryAfter }) } as MetadataError })

/** Per user: 30 calls at once, 30 more per minute (one person typing never gets near it). */
export const USER_LIMIT = { capacity: 30, perMinute: 30 }

export function createMetadataRoutes(deps: RouteDeps) {
  const perUser = new KeyedLimiter(USER_LIMIT.capacity, USER_LIMIT.perMinute, deps.now)

  function route<P>(parse: (p: URLSearchParams) => { success: true; data: P } | { success: false }, run: (p: P) => Promise<unknown>) {
    return async (request: NextRequest): Promise<Response> => {
      const caller = await deps.caller(request)
      if (caller.kind === "unavailable") return failWith("unavailable")
      if (caller.kind !== "user") return failWith("unauthorized")
      const quota = perUser.take(caller.id)
      if (!quota.ok) return failWith("rate_limited", Math.max(1, Math.ceil(quota.retryAfterMs / 1000)))
      const params = parse(request.nextUrl.searchParams)
      if (!params.success) return failWith("bad_request")
      try {
        return reply({ ok: true, data: await run(params.data) })
      } catch (e) {
        if (e instanceof ServiceError) return failWith(e.code, e.retryAfter)
        return failWith("provider_unavailable")
      }
    }
  }

  const s = deps.service
  return {
    booksSearch: route(PARAMS.bookSearch, (p) => s.searchBooks(p)),
    bookDetail: route(PARAMS.bookWork, (p) => s.bookDetail(p)),
    bookEditions: route(PARAMS.bookEditions, (p) => s.bookEditions(p)),
    showsSearch: route(PARAMS.showSearch, (p) => s.searchShows(p)),
    showEpisodes: route(PARAMS.showEpisodes, (p) => s.showEpisodes(p)),
  }
}

// ---------- covers (M4g.2) ----------

/** Per user: a whole grid at once, then two a second. */
export const COVER_USER_LIMIT = { capacity: 120, perMinute: 120 }

/**
 * Caching is decided here, separately from who may ask: only a proven image is cacheable, and
 * only by the browser (`private`: the route needs a session, so no shared cache may keep it).
 * The answer never carries cookies (the proxy skips this route, src/proxy.ts) and the URL holds
 * only the provider's identifier. Every refusal is `no-store` and has no body.
 */
export const COVER_CACHE = "private, max-age=2592000, immutable"

export interface CoverRouteDeps {
  caller: (request: NextRequest) => Promise<Caller>
  covers: CoverService
  now: Clock
}

export function createCoverRoute(deps: CoverRouteDeps) {
  const perUser = new KeyedLimiter(COVER_USER_LIMIT.capacity, COVER_USER_LIMIT.perMinute, deps.now)
  const refuse = (status: number, retryAfter?: number) =>
    new Response(null, { status, headers: { "Cache-Control": "no-store", ...(retryAfter !== undefined && { "Retry-After": String(retryAfter) }) } })

  return async (request: NextRequest): Promise<Response> => {
    const caller = await deps.caller(request)
    if (caller.kind === "unavailable") return refuse(503)
    if (caller.kind !== "user") return refuse(401)
    const quota = perUser.take(caller.id)
    if (!quota.ok) return refuse(429, Math.max(1, Math.ceil(quota.retryAfterMs / 1000)))
    const req = parseCoverRequest(request.nextUrl.searchParams)
    if (!req) return refuse(400)
    try {
      const { bytes, type } = await deps.covers.get(req.key, req.size)
      return new Response(bytes as Uint8Array<ArrayBuffer>, {
        status: 200,
        headers: { "Content-Type": type, "Content-Length": String(bytes.byteLength), "Cache-Control": COVER_CACHE, "Content-Disposition": "inline", "Cross-Origin-Resource-Policy": "same-origin" },
      })
    } catch (e) {
      if (e instanceof ServiceError) return refuse(STATUS[e.code], e.retryAfter)
      return refuse(502)
    }
  }
}

let coverRoute: ReturnType<typeof createCoverRoute> | null = null

/** The process-wide cover handler (created on first use, never at build time). */
export function coverRouteHandler() {
  coverRoute ??= createCoverRoute({ caller: (r) => callerOf(r), covers: createCoverService(), now: () => Date.now() })
  return coverRoute
}

let routes: ReturnType<typeof createMetadataRoutes> | null = null

/** The process-wide handlers used by the route files (created on first use, never at build time). */
export function metadataRoutes() {
  routes ??= createMetadataRoutes({ caller: (r) => callerOf(r), service: createMetadataService(), now: () => Date.now() })
  return routes
}
