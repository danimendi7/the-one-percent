import { describe, expect, it } from "vitest"
import { appleArtwork, creatorsOf, description, isbnsOf, isCanonicalCoverUrl, languageOf, openLibraryCover, plainText, providerUrl, textLine, topicSuggestionsOf, yearOf } from "./clean"

describe("provider text becomes plain, clean text", () => {
  it("tags are removed (never rendered) and entities decoded afterwards", () => {
    expect(plainText("<p>Hola&nbsp;<b>mundo</b></p><script>alert(1)</script>&amp; más")).toBe("Hola mundo\n& más")
    // An encoded tag stays visible text: decoding happens after tags are gone.
    expect(plainText("&lt;img src=x onerror=alert(1)&gt;")).toBe("<img src=x onerror=alert(1)>")
    expect(plainText("caf&eacute; &#241; &#x00e9; &#0; &#xD800;")).toBe("café ñ é")
    expect(plainText("a\u0007b\u0000c")).toBe("abc")
  })

  it("one line, within the limit, cut at a word; non-strings and empty values are null", () => {
    expect(textLine("  Cien   años\nde soledad ", 300)).toBe("Cien años de soledad")
    expect(textLine("uno dos tres cuatro", 12)).toBe("uno dos tres")
    expect(textLine(42, 300)).toBeNull()
    expect(textLine("<br>", 300)).toBeNull()
  })

  it("descriptions: blank runs collapsed, cut at a sentence end with «…» (D7)", () => {
    expect(description("Uno.\n\n\n\nDos.")).toBe("Uno.\n\nDos.")
    const long = "Primera frase completa. ".repeat(120)
    const d = description(long)!
    expect(d.length).toBeLessThanOrEqual(2000)
    expect(d.endsWith(".…")).toBe(true)
    expect(description(123)).toBeNull()
  })

  it("years from numbers or free text, never invented", () => {
    expect(yearOf("2020-03-23")).toBe(2020)
    expect(yearOf("January 23, 2024")).toBe(2024)
    expect(yearOf("c1967")).toBe(1967)
    expect(yearOf(1967)).toBe(1967)
    expect(yearOf("s.f.")).toBeNull()
    expect(yearOf(12)).toBeNull()
    expect(yearOf("12345")).toBeNull()
  })

  it("languages: Open Library codes to ISO 639-1, unknown kept as the provider's code", () => {
    expect(languageOf("/languages/spa")).toBe("es")
    expect(languageOf("eng")).toBe("en")
    expect(languageOf("/languages/ast")).toBe("ast")
    expect(languageOf("not a code")).toBeNull()
  })

  it("ISBNs: only valid ones; an ISBN-10 alone gives its ISBN-13", () => {
    expect(isbnsOf(["9788417860790", "8417860797"])).toEqual({ isbn13: "9788417860790", isbn10: "8417860797" })
    expect(isbnsOf(["8417860797"])).toEqual({ isbn13: "9788417860790", isbn10: "8417860797" })
    expect(isbnsOf(["9788417860791", "123"])).toEqual({ isbn13: null, isbn10: null })
    expect(isbnsOf("9788417860790")).toEqual({ isbn13: null, isbn10: null })
  })

  it("creators and topic suggestions are deduplicated and within the domain limits (D6)", () => {
    expect(creatorsOf(["Irene Vallejo", "irene vallejo", "", 7])).toEqual(["Irene Vallejo"])
    expect(creatorsOf(Array.from({ length: 30 }, (_, i) => `Autor ${i}`))).toHaveLength(20)
    expect(topicSuggestionsOf(["History", "history", "Spain -- History -- 20th century", "Podcasts", "x".repeat(41)], ["Podcasts"])).toEqual(["History"])
    expect(topicSuggestionsOf(Array.from({ length: 15 }, (_, i) => `Tema ${i}`))).toHaveLength(10)
  })

  it("covers: only canonical provider URLs", () => {
    expect(openLibraryCover(9689877)).toBe("https://covers.openlibrary.org/b/id/9689877-L.jpg")
    expect(openLibraryCover(-1)).toBeNull()
    expect(openLibraryCover("9689877")).toBeNull()
    const art = "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/2b/1a/09/mza_1.jpg/600x600bb.jpg"
    expect(appleArtwork(art)).toBe(art)
    expect(appleArtwork("https://evil.example/600x600bb.jpg")).toBeNull()
    expect(appleArtwork("http://is1-ssl.mzstatic.com/image/thumb/a.jpg/600x600bb.jpg")).toBeNull()
    expect(isCanonicalCoverUrl("https://covers.openlibrary.org/b/id/1-M.jpg")).toBe(true)
    expect(isCanonicalCoverUrl("https://covers.openlibrary.org/b/isbn/9788417860790-M.jpg")).toBe(false)
    expect(isCanonicalCoverUrl("https://covers.openlibrary.org/b/id/1-M.jpg?redirect=http://127.0.0.1")).toBe(false)
  })

  it("links: https on the expected hosts, tracking parameter removed", () => {
    expect(providerUrl("https://podcasts.apple.com/es/podcast/x/id1?i=2&uo=4", ["podcasts.apple.com"])).toBe("https://podcasts.apple.com/es/podcast/x/id1?i=2")
    expect(providerUrl("https://user:pw@podcasts.apple.com/x", ["podcasts.apple.com"])).toBeNull()
    expect(providerUrl("javascript:alert(1)", ["podcasts.apple.com"])).toBeNull()
    expect(providerUrl("https://podcasts.apple.com.evil.example/x", ["podcasts.apple.com"])).toBeNull()
    expect(providerUrl("https://podcasts.apple.com:8443/x", ["podcasts.apple.com"])).toBeNull()
  })
})
