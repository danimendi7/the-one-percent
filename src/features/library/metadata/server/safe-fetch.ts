import { lookup as dnsLookup } from "node:dns/promises"
import { request as httpsRequest, type RequestOptions } from "node:https"
import type { LookupFunction } from "node:net"
import { Readable } from "node:stream"

/**
 * The only way the metadata and cover services reach the Internet (docs/m4g-plan.md §5.9, §15).
 * Every hop of a request — the first one and each redirect — must pass the same checks:
 *
 * - `https:` on the default port, no credentials in the URL, no IP literal;
 * - the first hop on a closed list of exact host names; a redirect only where the caller's rule
 *   allows that exact step (covers), or again on the list (metadata);
 * - every address the host resolves to is public (no loopback, private, link-local, CGNAT,
 *   multicast, documentation or IPv4-mapped/translated private addresses).
 *
 * The connection itself is pinned (M4g.2): the default transport is `node:https` with a lookup
 * that resolves, refuses any blocked address and hands the socket only the addresses it checked,
 * so a name that changes to a private address between the check and the connection (DNS
 * rebinding) cannot be reached. The certificate is still verified against the host name.
 *
 * Redirects are followed by hand, at most `maxRedirects`. One deadline covers the whole request;
 * the body is read as a stream and cut at `maxBytes`; compressed bodies are refused (nothing asks
 * for them); the content type must be one of the expected ones.
 */
export const METADATA_HOSTS: readonly string[] = ["openlibrary.org", "itunes.apple.com"]

/** Technical identification without personal data (D-UA). */
export const USER_AGENT = "TheOnePercent/1.0 (private personal library app; metadata lookups)"

export type UpstreamKind = "blocked" | "redirects" | "timeout" | "aborted" | "network" | "status" | "too_large" | "bad_type" | "invalid_json" | "bad_image"

export class UpstreamError extends Error {
  constructor(
    readonly kind: UpstreamKind,
    readonly status?: number,
    /** Seconds, from the provider's Retry-After. */
    readonly retryAfter?: number
  ) {
    super(`upstream ${kind}${status ? ` ${status}` : ""}`)
    this.name = "UpstreamError"
  }
}

export interface FetchDeps {
  fetch: (input: string, init: RequestInit) => Promise<Response>
  /** Addresses of a host name (all of them), for the check before connecting. */
  lookup: (host: string) => Promise<string[]>
}

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>

const systemResolver: Resolver = (host) => dnsLookup(host, { all: true, verbatim: true })

/**
 * `lookup` for the socket: the addresses it connects to are exactly the ones checked here. One
 * blocked address refuses the whole name (a mixed answer is suspicious, not a fallback).
 */
export function validatingLookup(resolve: Resolver): LookupFunction {
  return (hostname, options, callback) => {
    const done = callback as unknown as (err: Error | null, address?: string | { address: string; family: number }[], family?: number) => void
    resolve(hostname).then(
      (list) => {
        const wanted = options.family === 4 || options.family === 6 ? list.filter((a) => a.family === options.family) : list
        if (list.length === 0 || list.some((a) => isBlockedAddress(a.address)) || wanted.length === 0)
          return done(Object.assign(new Error("blocked destination"), { code: "EBLOCKEDADDR" }))
        if (options.all) done(null, wanted)
        else done(null, wanted[0].address, wanted[0].family)
      },
      (e: Error) => done(e)
    )
  }
}

/**
 * GET over `node:https` with the validating lookup, as a WHATWG Response. No connection reuse
 * (`agent: false`): every socket is created, and checked, for its own request.
 */
export function pinnedFetch(resolve: Resolver = systemResolver, request: typeof httpsRequest = httpsRequest): FetchDeps["fetch"] {
  return (input, init) =>
    new Promise<Response>((done, fail) => {
      const u = new URL(input)
      const options: RequestOptions = {
        protocol: "https:",
        hostname: u.hostname,
        port: 443,
        path: u.pathname + u.search,
        method: "GET",
        headers: Object.fromEntries(new Headers(init.headers)),
        lookup: validatingLookup(resolve),
        agent: false,
        ...(init.signal && { signal: init.signal }),
      }
      const req = request(options, (res) => {
        const headers = new Headers()
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) for (const x of Array.isArray(v) ? v : [v]) headers.append(k, x)
        const status = res.statusCode ?? 502
        if (status < 200 || status > 599) {
          res.destroy()
          return fail(new Error("unexpected status"))
        }
        done(new Response(status === 204 || status === 304 ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), { status, headers }))
      })
      req.on("error", fail)
      req.end()
    })
}

export const defaultFetchDeps: FetchDeps = {
  fetch: pinnedFetch(),
  lookup: async (host) => (await systemResolver(host)).map((a) => a.address),
}

export interface SafeFetchOptions {
  hosts: readonly string[]
  timeoutMs: number
  maxBytes: number
  /** Accepted media types (before `;`). */
  types: readonly string[]
  maxRedirects?: number
  signal?: AbortSignal
  /** When set, a redirect is followed only if this accepts that exact step (instead of `hosts`). */
  redirect?: (from: URL, to: URL) => boolean
}

// ---------- addresses ----------

function v4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return null
  const parts = m.slice(1).map(Number)
  if (parts.some((p) => p > 255)) return null
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]

function blockedV4(n: number): boolean {
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
    return ((n & mask) >>> 0) === ((v4ToInt(base)! & mask) >>> 0)
  })
}

/** Eight 16-bit groups of an IPv6 address (with an embedded dotted IPv4 tail), or null. */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "")
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s)
  if (dotted) {
    const n = v4ToInt(dotted[1])
    if (n === null) return null
    s = s.slice(0, -dotted[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`
  }
  const halves = s.split("::")
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(":") : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : []
  const missing = 8 - head.length - tail.length
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail]
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return groups.map((g) => parseInt(g, 16))
}

/** True for any address a server-side request must never reach. Unparseable counts as blocked. */
export function isBlockedAddress(ip: string): boolean {
  const n = v4ToInt(ip)
  if (n !== null) return blockedV4(n)
  const g = v6Groups(ip)
  if (!g) return true
  const embeddedV4 = ((g[6] << 16) >>> 0) + g[7]
  if (g.slice(0, 7).every((x) => x === 0)) return true // :: and ::1 (and IPv4-compatible)
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return blockedV4(embeddedV4) // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b) return true // NAT64
  if ((g[0] & 0xfe00) === 0xfc00) return true // unique local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true // link-local fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true // documentation
  if (g[0] === 0x2002) return true // 6to4 can wrap a private IPv4
  return false
}

const IP_LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|\[.*\])$/

/** Scheme, port, credentials and IP literal: required of every hop. */
export function basicDestination(url: URL): boolean {
  return url.protocol === "https:" && url.port === "" && url.username === "" && url.password === "" && !IP_LITERAL.test(url.hostname)
}

/** The URL is acceptable as a destination (before resolving its name). */
export function checkDestination(url: URL, hosts: readonly string[]): boolean {
  return basicDestination(url) && hosts.includes(url.hostname)
}

// ---------- request ----------

function retryAfterOf(v: string | null, now = Date.now()): number | undefined {
  if (!v) return undefined
  if (/^\d{1,6}$/.test(v.trim())) return Number(v.trim())
  const t = Date.parse(v)
  return Number.isNaN(t) ? undefined : Math.max(0, Math.ceil((t - now) / 1000))
}

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {})
    throw new UpstreamError("too_large")
  }
  if (!res.body) return new Uint8Array(0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new UpstreamError("too_large")
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    all.set(c, at)
    at += c.byteLength
  }
  return all
}

const mediaType = (res: Response) => (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()

/**
 * GET with every hop checked; returns the final 2xx answer and a body reader that keeps the
 * same deadline and error mapping.
 */
async function safeGet(start: string, opts: SafeFetchOptions, accept: string, deps: FetchDeps): Promise<{ res: Response; read: () => Promise<Uint8Array> }> {
  const deadline = AbortSignal.timeout(opts.timeoutMs)
  const signal = opts.signal ? AbortSignal.any([deadline, opts.signal]) : deadline
  const failure = (e: unknown): UpstreamError =>
    e instanceof UpstreamError
      ? e
      : new UpstreamError(opts.signal?.aborted ? "aborted" : deadline.aborted ? "timeout" : e instanceof Error && "code" in e && e.code === "EBLOCKEDADDR" ? "blocked" : "network")
  let url: URL
  try {
    url = new URL(start)
  } catch {
    throw new UpstreamError("blocked")
  }
  if (!checkDestination(url, opts.hosts)) throw new UpstreamError("blocked")
  for (let hop = 0; ; hop++) {
    let addresses: string[]
    try {
      addresses = await deps.lookup(url.hostname)
    } catch (e) {
      throw failure(e)
    }
    if (addresses.length === 0 || addresses.some(isBlockedAddress)) throw new UpstreamError("blocked")
    let res: Response
    try {
      res = await deps.fetch(url.href, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        credentials: "omit",
        signal,
        headers: { "User-Agent": USER_AGENT, Accept: accept },
      })
    } catch (e) {
      throw failure(e)
    }
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel().catch(() => {})
      const location = res.headers.get("location")
      if (!location || hop >= (opts.maxRedirects ?? 3)) throw new UpstreamError(location ? "redirects" : "status", res.status)
      let next: URL
      try {
        next = new URL(location, url)
      } catch {
        throw new UpstreamError("blocked")
      }
      const allowed = opts.redirect ? basicDestination(next) && opts.redirect(url, next) : checkDestination(next, opts.hosts)
      if (!allowed) throw new UpstreamError("blocked")
      url = next
      continue
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {})
      throw new UpstreamError("status", res.status, retryAfterOf(res.headers.get("retry-after")))
    }
    const encoding = (res.headers.get("content-encoding") ?? "identity").trim().toLowerCase()
    if (!opts.types.includes(mediaType(res)) || encoding !== "identity") {
      await res.body?.cancel().catch(() => {})
      throw new UpstreamError("bad_type")
    }
    return {
      res,
      read: () =>
        readCapped(res, opts.maxBytes).catch((e) => {
          throw failure(e)
        }),
    }
  }
}

/** GET a JSON document from an allowed host, following at most `maxRedirects` checked redirects. */
export async function safeFetchJson(start: string, opts: SafeFetchOptions, deps: FetchDeps = defaultFetchDeps): Promise<unknown> {
  const { read } = await safeGet(start, opts, "application/json", deps)
  const body = await read()
  try {
    return JSON.parse(new TextDecoder("utf-8").decode(body)) as unknown
  } catch {
    throw new UpstreamError("invalid_json")
  }
}

export type ImageType = "image/jpeg" | "image/png" | "image/webp"

/** The image type its first bytes prove, or null (GIF, HTML, text, anything else). */
export function sniffImage(b: Uint8Array): ImageType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg"
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) return "image/png"
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp"
  return null
}

const IMAGE_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp"]

/**
 * An image from an allowed host: exactly 200, declared as JPEG, PNG or WebP, at least `minBytes`
 * (Open Library answers a 43-byte GIF for a missing cover), and its bytes must prove the type it
 * declares. Returns the bytes and the proven type.
 */
export async function safeFetchImage(
  start: string,
  opts: Omit<SafeFetchOptions, "types"> & { minBytes: number },
  deps: FetchDeps = defaultFetchDeps
): Promise<{ bytes: Uint8Array; type: ImageType }> {
  // A declared GIF is read (it is small) so that it counts as «no image», not as a provider fault.
  const { res, read } = await safeGet(start, { ...opts, types: [...IMAGE_TYPES, "image/jpg", "image/gif"] }, "image/jpeg, image/png, image/webp", deps)
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => {})
    throw new UpstreamError("status", res.status)
  }
  const bytes = await read()
  const declared = mediaType(res) === "image/jpg" ? "image/jpeg" : mediaType(res)
  const type = sniffImage(bytes)
  if (bytes.length < opts.minBytes || !type || type !== declared) throw new UpstreamError("bad_image")
  return { bytes, type }
}
