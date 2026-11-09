/**
 * Cover identifiers (M4g.2, docs/m4g-plan.md §15). The Library stores the provider's canonical URL
 * (`cover.url`); the browser never loads it. It asks the same-origin `/api/covers` with an
 * IDENTIFIER, and the server rebuilds the upstream URL from that identifier alone, so no endpoint
 * ever takes a URL. Pure and shared by client and server.
 *
 * - Open Library: the numeric cover id (never an ISBN: those lookups are rate limited and answer
 *   a placeholder).
 * - Apple: the `isN-ssl.mzstatic.com` host number and the artwork path, in the exact shape Apple
 *   returns (`Podcasts…/v4/xx/xx/xx/<uuid>/<file>`), checked part by part.
 */
export type CoverSize = "sm" | "md" | "lg"
export const COVER_SIZES: readonly CoverSize[] = ["sm", "md", "lg"]

export type CoverKey = { provider: "openlibrary"; id: number } | { provider: "apple"; host: number; path: string }

/** Open Library letter and Apple pixels per size. The list row (`sm`) is ~48 px but needs 2× pixels. */
const OL_SIZE: Record<CoverSize, "M" | "L"> = { sm: "M", md: "M", lg: "L" }
const APPLE_PX: Record<CoverSize, number> = { sm: 100, md: 300, lg: 600 }

const OL_ID_MAX = 999_999_999
const OL_URL = /^https:\/\/covers\.openlibrary\.org\/b\/id\/([1-9]\d{0,8})-[SML]\.jpg$/
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
const APPLE_PATH = new RegExp(`^Podcasts\\d{1,4}/v4/[0-9a-f]{2}/[0-9a-f]{2}/[0-9a-f]{2}/${UUID}/[A-Za-z0-9_-]{1,80}\\.(?:jpg|jpeg|png)$`)
const APPLE_URL = /^https:\/\/is([1-5])-ssl\.mzstatic\.com\/image\/thumb\/(.+)\/\d{2,4}x\d{2,4}bb\.jpg$/

/** The identifier of a stored cover URL, or null when it is not a cover the app can show. */
export function coverKeyOf(url: string): CoverKey | null {
  if (url.length > 2048) return null
  const ol = OL_URL.exec(url)
  if (ol) return { provider: "openlibrary", id: Number(ol[1]) }
  const ap = APPLE_URL.exec(url)
  if (ap && APPLE_PATH.test(ap[2])) return { provider: "apple", host: Number(ap[1]), path: ap[2] }
  return null
}

/** Same-origin address of a cover at one size. */
export function coverSrc(key: CoverKey, size: CoverSize): string {
  const q = new URLSearchParams(key.provider === "openlibrary" ? { ol: String(key.id) } : { apple: `${key.host}:${key.path}` })
  q.set("s", size)
  return `/api/covers?${q}`
}

/** Parameters of `/api/covers`, validated; null for anything else (unknown, repeated or extra values). */
export function parseCoverRequest(params: URLSearchParams): { key: CoverKey; size: CoverSize } | null {
  const keys = [...params.keys()]
  if (keys.length !== 2 || new Set(keys).size !== 2 || !params.has("s")) return null
  const size = params.get("s") as CoverSize
  if (!COVER_SIZES.includes(size)) return null
  const ol = params.get("ol")
  if (ol !== null) {
    if (!/^[1-9]\d{0,8}$/.test(ol) || Number(ol) > OL_ID_MAX) return null
    return { key: { provider: "openlibrary", id: Number(ol) }, size }
  }
  const apple = params.get("apple")
  const m = apple === null ? null : /^([1-5]):(.+)$/.exec(apple)
  if (!m || !APPLE_PATH.test(m[2])) return null
  return { key: { provider: "apple", host: Number(m[1]), path: m[2] }, size }
}

/** The only upstream address a key can produce. */
export function coverUpstreamUrl(key: CoverKey, size: CoverSize): string {
  if (key.provider === "openlibrary") return `https://covers.openlibrary.org/b/id/${key.id}-${OL_SIZE[size]}.jpg`
  const px = APPLE_PX[size]
  return `https://is${key.host}-ssl.mzstatic.com/image/thumb/${key.path}/${px}x${px}bb.jpg`
}

/** First hop's hosts (exact names). Redirects are judged by `coverRedirectAllowed`, not by this list. */
export const COVER_HOSTS: readonly string[] = ["covers.openlibrary.org", "is1-ssl.mzstatic.com", "is2-ssl.mzstatic.com", "is3-ssl.mzstatic.com", "is4-ssl.mzstatic.com", "is5-ssl.mzstatic.com"]

/**
 * Open Library's measured redirect chain (31/10/2026), and nothing else:
 *   covers.openlibrary.org/b/id/{n}-{T}.jpg
 *   → archive.org/download/{t}_covers_{dddd}/{t}_covers_{dddd}_{dd}.zip/{n:10}-{T}.jpg
 *   → ia{dddddd}.us.archive.org/view_archive.php?archive=/{d}/items/{t}_covers_{dddd}/{t}_covers_{dddd}_{dd}.zip&file={n:10}-{T}.jpg
 * Each step must come from the previous host and name the SAME cover id and size; the storage
 * node is only accepted as the target of archive.org with exactly that path and query. Apple
 * artwork is served directly: any redirect from it is refused. Recent covers are served by
 * covers.openlibrary.org itself, without redirects.
 */
export function coverRedirectAllowed(key: CoverKey, size: CoverSize, from: URL, to: URL): boolean {
  if (key.provider !== "openlibrary") return false
  const t = OL_SIZE[size]
  const file = `${String(key.id).padStart(10, "0")}-${t}.jpg`
  const lower = t.toLowerCase()
  const box = `${lower}_covers_(\\d{4})`
  if (from.hostname === "covers.openlibrary.org" && to.hostname === "archive.org") {
    const m = new RegExp(`^/download/${box}/${box}_\\d{2}\\.zip/(\\d{10}-[SML]\\.jpg)$`).exec(to.pathname)
    return !!m && m[1] === m[2] && m[3] === file && to.search === "" && to.hash === ""
  }
  if (from.hostname === "archive.org" && /^ia\d{6}\.us\.archive\.org$/.test(to.hostname)) {
    if (to.pathname !== "/view_archive.php" || to.hash !== "") return false
    const q = to.searchParams
    if ([...q.keys()].join(",") !== "archive,file" || q.get("file") !== file) return false
    const m = new RegExp(`^/\\d{1,3}/items/${box}/${box}_\\d{2}\\.zip$`).exec(q.get("archive") ?? "")
    return !!m && m[1] === m[2]
  }
  return false
}
