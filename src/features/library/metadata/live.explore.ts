/**
 * Exploratory checks against the real Open Library and Apple (M4g.1), through the same service and
 * safeFetch as production: closed host list, DNS checks, limits and the 1-per-second spacing.
 * Public catalogue queries only, no user data. NOT run by `npm test` or CI (vitest.explore.config.mts):
 * `npm run explore:metadata`. A failure here means «look at the provider», not «the build is red».
 */
import { describe, expect, it } from "vitest"
import { coverKeyOf } from "./covers"
import { createCoverService } from "./server/cover-service"
import { createMetadataService } from "./server/service"

const service = createMetadataService()

describe("real providers (exploratory)", () => {
  it("Open Library: Spanish title, English title, author, Spanish and English ISBN", async () => {
    const es = await service.searchBooks({ by: "title", q: "el infinito en un junco", lang: "es" })
    expect(es.some((b) => b.workId === "OL20770492W")).toBe(true)
    console.info(`book search, normalized: ${Math.round(JSON.stringify({ ok: true, data: es }).length / 1024)} KB`)
    const en = await service.searchBooks({ by: "title", q: "atomic habits", lang: "en" })
    expect(en[0].creators).toContain("James Clear")
    const author = await service.searchBooks({ by: "author", q: "irene vallejo", lang: "es" })
    expect(author.length).toBeGreaterThan(0)
    const isbnEs = await service.searchBooks({ by: "isbn", q: "9788417860790", lang: "es" })
    expect(isbnEs[0]).toMatchObject({ isbn13: "9788417860790", publisher: "Siruela" })
    const isbnEn = await service.searchBooks({ by: "isbn", q: "9780735211292", lang: "en" })
    expect(isbnEn[0].isbn13).toBe("9780735211292")
  })

  it("Open Library: detail and editions of a work", async () => {
    const d = await service.bookDetail({ work: "OL20770492W", edition: "OL28108908M" })
    expect(d).toMatchObject({ pageCount: 452, language: "es" })
    const eds = await service.bookEditions({ work: "OL20770492W", lang: "es" })
    expect(eds.length).toBeGreaterThan(1)
  })

  it("Apple: Spanish and English shows, recent episodes and an older one by search", async () => {
    const es = await service.searchShows({ q: "la ruina" })
    expect(es[0]).toMatchObject({ id: "1455818214", title: "La Ruina" })
    const en = await service.searchShows({ q: "huberman lab" })
    expect(en[0].title).toBe("Huberman Lab")
    const recent = await service.showEpisodes({ show: "1455818214" })
    expect(recent.episodes.length).toBe(200)
    expect(recent.complete).toBe(false)
    // Size of what the client receives (the provider sent ~460 KB for these 200 episodes).
    console.info(`200 episodes, normalized: ${Math.round(JSON.stringify({ ok: true, data: recent }).length / 1024)} KB`)
    const old = await service.showEpisodes({ show: "1455818214", q: "ignatius" })
    expect(old.episodes.some((e) => e.title.startsWith("89."))).toBe(true)
  })
})

describe("real cover images (exploratory, pinned transport)", () => {
  const covers = createCoverService()

  it("Open Library through its redirect chain, one served directly, Apple at three sizes", async () => {
    // 12627383 went through archive.org on 31/10/2026; 15237820 was served by covers.openlibrary.org.
    for (const id of [12627383, 15237820]) {
      const img = await covers.get({ provider: "openlibrary", id }, "md")
      expect(img.type).toBe("image/jpeg")
      console.info(`Open Library ${id}: ${Math.round(img.bytes.byteLength / 1024)} KB`)
    }
    const key = coverKeyOf("https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/2b/1a/09/2b1a09d7-c6dc-22c2-d2f6-2a34ef83a6dd/mza_16581116865991017367.jpg/600x600bb.jpg")!
    for (const size of ["sm", "md", "lg"] as const) {
      const img = await covers.get(key, size)
      console.info(`Apple ${size}: ${Math.round(img.bytes.byteLength / 1024)} KB`)
    }
  })

  it("a cover id without image is not_found (the placeholder GIF is refused)", async () => {
    await expect(covers.get({ provider: "openlibrary", id: 999_999_999 }, "md")).rejects.toMatchObject({ code: "not_found" })
  })
})
