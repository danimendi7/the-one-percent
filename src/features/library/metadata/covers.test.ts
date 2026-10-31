import { describe, expect, it } from "vitest"
import { COVER_HOSTS, coverKeyOf, coverRedirectAllowed, coverSrc, coverUpstreamUrl, parseCoverRequest, type CoverKey } from "./covers"

const APPLE_PATH = "Podcasts221/v4/2b/1a/09/2b1a09d7-c6dc-22c2-d2f6-2a34ef83a6dd/mza_16581116865991017367.jpg"
const APPLE_URL = `https://is1-ssl.mzstatic.com/image/thumb/${APPLE_PATH}/600x600bb.jpg`
const ol: CoverKey = { provider: "openlibrary", id: 12627383 }
const params = (s: string) => new URLSearchParams(s)

describe("cover identifiers: stored URL → key → same-origin address → upstream URL", () => {
  it("Open Library by cover id and Apple by host number and exact artwork path", () => {
    expect(coverKeyOf("https://covers.openlibrary.org/b/id/12627383-L.jpg")).toEqual(ol)
    expect(coverKeyOf(APPLE_URL)).toEqual({ provider: "apple", host: 1, path: APPLE_PATH })
    expect(coverSrc(ol, "md")).toBe("/api/covers?ol=12627383&s=md")
    expect(coverSrc({ provider: "apple", host: 1, path: APPLE_PATH }, "sm")).toBe(`/api/covers?apple=1%3A${encodeURIComponent(APPLE_PATH)}&s=sm`)
    expect(coverUpstreamUrl(ol, "sm")).toBe("https://covers.openlibrary.org/b/id/12627383-M.jpg")
    expect(coverUpstreamUrl(ol, "lg")).toBe("https://covers.openlibrary.org/b/id/12627383-L.jpg")
    expect(coverUpstreamUrl({ provider: "apple", host: 3, path: APPLE_PATH }, "md")).toBe(`https://is3-ssl.mzstatic.com/image/thumb/${APPLE_PATH}/300x300bb.jpg`)
  })

  it.each([
    "https://covers.openlibrary.org/b/isbn/9788417860790-L.jpg",
    "https://covers.openlibrary.org/b/olid/OL1M-L.jpg",
    "https://covers.openlibrary.org/b/id/0-L.jpg",
    "http://covers.openlibrary.org/b/id/1-L.jpg",
    "https://covers.openlibrary.org/b/id/1-L.jpg?x=1",
    "https://evil.example/b/id/1-L.jpg",
    "https://is6-ssl.mzstatic.com/image/thumb/" + APPLE_PATH + "/600x600bb.jpg",
    "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/2b/1a/09/mza_1.jpg/600x600bb.jpg",
    "https://is1-ssl.mzstatic.com/image/thumb/../../" + APPLE_PATH + "/600x600bb.jpg",
    "https://is1-ssl.mzstatic.com.evil.example/image/thumb/" + APPLE_PATH + "/600x600bb.jpg",
  ])("%s is not a cover the app can show", (url) => expect(coverKeyOf(url)).toBeNull())

  it("requests: exactly one identifier and a size; never a URL, never extra or repeated values", () => {
    expect(parseCoverRequest(params("ol=12627383&s=md"))).toEqual({ key: ol, size: "md" })
    expect(parseCoverRequest(params(new URL(`http://x${coverSrc({ provider: "apple", host: 2, path: APPLE_PATH }, "lg")}`).search))).toEqual({ key: { provider: "apple", host: 2, path: APPLE_PATH }, size: "lg" })
    for (const bad of [
      "ol=12627383",
      "ol=12627383&s=xl",
      "ol=0&s=md",
      "ol=1e9&s=md",
      "ol=1234567890&s=md",
      "ol=12&s=md&x=1",
      "ol=12&ol=13&s=md",
      "ol=12&apple=1:x&s=md",
      `apple=6:${APPLE_PATH}&s=md`,
      `apple=1:${APPLE_PATH}/../x&s=md`,
      `apple=${encodeURIComponent(APPLE_URL)}&s=md`,
      "url=https://127.0.0.1/&s=md",
      "src=https://covers.openlibrary.org/b/id/1-L.jpg&s=md",
    ])
      expect(parseCoverRequest(params(bad))).toBeNull()
  })

  it("first hop hosts are six exact names", () => {
    expect(COVER_HOSTS).toEqual(["covers.openlibrary.org", "is1-ssl.mzstatic.com", "is2-ssl.mzstatic.com", "is3-ssl.mzstatic.com", "is4-ssl.mzstatic.com", "is5-ssl.mzstatic.com"])
  })
})

describe("Open Library's redirect chain, step by step (measured 31/10/2026)", () => {
  const u = (s: string) => new URL(s)
  const start = u("https://covers.openlibrary.org/b/id/12627383-M.jpg")
  const archive = u("https://archive.org/download/m_covers_0012/m_covers_0012_62.zip/0012627383-M.jpg")
  const node = u("https://ia600505.us.archive.org/view_archive.php?archive=/5/items/m_covers_0012/m_covers_0012_62.zip&file=0012627383-M.jpg")

  it("the real chain for this cover and size is allowed", () => {
    expect(coverRedirectAllowed(ol, "md", start, archive)).toBe(true)
    expect(coverRedirectAllowed(ol, "md", archive, node)).toBe(true)
    const large = u("https://archive.org/download/l_covers_0012/l_covers_0012_62.zip/0012627383-L.jpg")
    expect(coverRedirectAllowed(ol, "lg", u("https://covers.openlibrary.org/b/id/12627383-L.jpg"), large)).toBe(true)
  })

  it.each([
    ["another cover id", archive, u("https://archive.org/download/m_covers_0012/m_covers_0012_62.zip/0012627384-M.jpg")],
    ["another size", archive, u("https://archive.org/download/l_covers_0012/l_covers_0012_62.zip/0012627383-L.jpg")],
    ["mismatched boxes", archive, u("https://archive.org/download/m_covers_0012/m_covers_0013_62.zip/0012627383-M.jpg")],
    ["another archive.org path", archive, u("https://archive.org/details/m_covers_0012")],
    ["a query on the archive.org step", archive, u("https://archive.org/download/m_covers_0012/m_covers_0012_62.zip/0012627383-M.jpg?x=1")],
    ["a storage node straight from the cover host", node, node],
  ])("refuses a step to %s", (_, _a, to) => expect(coverRedirectAllowed(ol, "md", start, to)).toBe(false))

  it.each([
    ["a host that only looks like a storage node", "https://ia600505.us.archive.org.evil.example/view_archive.php?archive=/5/items/m_covers_0012/m_covers_0012_62.zip&file=0012627383-M.jpg"],
    ["a node outside the measured form", "https://ia60050.us.archive.org/view_archive.php?archive=/5/items/m_covers_0012/m_covers_0012_62.zip&file=0012627383-M.jpg"],
    ["another node domain", "https://ia600505.eu.archive.org/view_archive.php?archive=/5/items/m_covers_0012/m_covers_0012_62.zip&file=0012627383-M.jpg"],
    ["another file", "https://ia600505.us.archive.org/view_archive.php?archive=/5/items/m_covers_0012/m_covers_0012_62.zip&file=0099999999-M.jpg"],
    ["another script", "https://ia600505.us.archive.org/download.php?archive=/5/items/m_covers_0012/m_covers_0012_62.zip&file=0012627383-M.jpg"],
    ["an extra parameter", "https://ia600505.us.archive.org/view_archive.php?archive=/5/items/m_covers_0012/m_covers_0012_62.zip&file=0012627383-M.jpg&next=http://127.0.0.1"],
    ["a traversal in the archive", "https://ia600505.us.archive.org/view_archive.php?archive=/5/items/../../etc/m_covers_0012_62.zip&file=0012627383-M.jpg"],
  ])("refuses the storage step to %s", (_, to) => expect(coverRedirectAllowed(ol, "md", archive, u(to))).toBe(false))

  it("Apple artwork never redirects; nothing else redirects either", () => {
    const apple: CoverKey = { provider: "apple", host: 1, path: APPLE_PATH }
    expect(coverRedirectAllowed(apple, "md", u(APPLE_URL), u("https://is2-ssl.mzstatic.com/x.jpg"))).toBe(false)
    expect(coverRedirectAllowed(ol, "md", node, u("https://archive.org/"))).toBe(false)
    expect(coverRedirectAllowed(ol, "md", start, u("https://localhost/x"))).toBe(false)
  })
})
