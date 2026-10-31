import { lookup as dnsLookup } from "node:dns/promises"

/**
 * The only way the metadata service reaches the Internet (docs/m4g-plan.md §5.9). Every hop of a
 * request — the first one and each redirect — must pass the same checks:
 *
 * - `https:` on the default port, no credentials in the URL, no IP literal;
 * - a host on the closed list (exact names; no wildcard);
 * - every address the host resolves to is public (no loopback, private, link-local, CGNAT,
 *   multicast, documentation or IPv4-mapped/translated private addresses).
 *
 * Redirects are followed by hand (`redirect: "manual"`), at most `maxRedirects`. One deadline
 * covers the whole request; the body is read as a stream and cut at `maxBytes`; the content type
 * must be one of the expected ones and the JSON must parse.
 *
 * Residual risk (documented): `fetch` resolves the name again after our check, so a provider host
 * that switched to a private address between both lookups (DNS rebinding) is not caught. The list
 * only holds two public provider hosts, which keeps that risk theoretical.
 */
export const METADATA_HOSTS: readonly string[] = ["openlibrary.org", "itunes.apple.com"]

/** Technical identification without personal data (D-UA). */
export const USER_AGENT = "TheOnePercent/1.0 (private personal library app; metadata lookups)"

export type UpstreamKind = "blocked" | "redirects" | "timeout" | "aborted" | "network" | "status" | "too_large" | "bad_type" | "invalid_json"

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
  fetch: typeof fetch
  /** Addresses of a host name (all of them). */
  lookup: (host: string) => Promise<string[]>
}

export const defaultFetchDeps: FetchDeps = {
  fetch: (input, init) => fetch(input, init),
  lookup: async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address),
}

export interface SafeFetchOptions {
  hosts: readonly string[]
  timeoutMs: number
  maxBytes: number
  /** Accepted media types (before `;`). */
  types: readonly string[]
  maxRedirects?: number
  signal?: AbortSignal
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

/** The URL is acceptable as a destination (before resolving its name). */
export function checkDestination(url: URL, hosts: readonly string[]): boolean {
  return (
    url.protocol === "https:" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    !IP_LITERAL.test(url.hostname) &&
    hosts.includes(url.hostname)
  )
}

// ---------- request ----------

function retryAfterOf(v: string | null, now = Date.now()): number | undefined {
  if (!v) return undefined
  if (/^\d{1,6}$/.test(v.trim())) return Number(v.trim())
  const t = Date.parse(v)
  return Number.isNaN(t) ? undefined : Math.max(0, Math.ceil((t - now) / 1000))
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {})
    throw new UpstreamError("too_large")
  }
  if (!res.body) return ""
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
  return new TextDecoder("utf-8").decode(all)
}

/** GET a JSON document from an allowed host, following at most `maxRedirects` checked redirects. */
export async function safeFetchJson(start: string, opts: SafeFetchOptions, deps: FetchDeps = defaultFetchDeps): Promise<unknown> {
  const deadline = AbortSignal.timeout(opts.timeoutMs)
  const signal = opts.signal ? AbortSignal.any([deadline, opts.signal]) : deadline
  const failure = (e: unknown): UpstreamError =>
    e instanceof UpstreamError ? e : new UpstreamError(opts.signal?.aborted ? "aborted" : deadline.aborted ? "timeout" : "network")
  let url: URL
  try {
    url = new URL(start)
  } catch {
    throw new UpstreamError("blocked")
  }
  for (let hop = 0; ; hop++) {
    if (!checkDestination(url, opts.hosts)) throw new UpstreamError("blocked")
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
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      })
    } catch (e) {
      throw failure(e)
    }
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel().catch(() => {})
      const location = res.headers.get("location")
      if (!location || hop >= (opts.maxRedirects ?? 3)) throw new UpstreamError(location ? "redirects" : "status", res.status)
      try {
        url = new URL(location, url)
      } catch {
        throw new UpstreamError("blocked")
      }
      continue
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {})
      throw new UpstreamError("status", res.status, retryAfterOf(res.headers.get("retry-after")))
    }
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()
    if (!opts.types.includes(type)) {
      await res.body?.cancel().catch(() => {})
      throw new UpstreamError("bad_type")
    }
    let body: string
    try {
      body = await readCapped(res, opts.maxBytes)
    } catch (e) {
      throw failure(e)
    }
    try {
      return JSON.parse(body) as unknown
    } catch {
      throw new UpstreamError("invalid_json")
    }
  }
}
