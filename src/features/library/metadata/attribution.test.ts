import { describe, expect, it } from "vitest"
import { dataAttribution } from "./attribution"

const external = (attribution: string | null) => ({ provider: "openlibrary" as const, id: "OL1W", attribution })

describe("dataAttribution", () => {
  it("says the provider's own attribution when the item has an external reference", () => {
    expect(dataAttribution({ external: external("Datos: Open Library"), sourceUrl: null })).toBe("Datos: Open Library")
  })

  it("a separate edition has no reference: its Open Library link says where the data came from (D101)", () => {
    expect(dataAttribution({ external: null, sourceUrl: "https://openlibrary.org/books/OL51103235M" })).toBe("Datos: Open Library")
  })

  it("accepts a subdomain of Open Library", () => {
    expect(dataAttribution({ external: null, sourceUrl: "https://www.openlibrary.org/works/OL1W" })).toBe("Datos: Open Library")
  })

  it("a manual entry says nothing", () => {
    expect(dataAttribution({ external: null, sourceUrl: null })).toBeNull()
  })

  it("a link to anywhere else says nothing", () => {
    expect(dataAttribution({ external: null, sourceUrl: "https://example.com/libro" })).toBeNull()
  })

  it.each(["https://openlibrary.org.evil.example/x", "https://evil.example/openlibrary.org", "https://notopenlibrary.org/x"])("is not fooled by a look-alike: %s", (sourceUrl) => {
    expect(dataAttribution({ external: null, sourceUrl })).toBeNull()
  })

  it("a link typed by hand that is not a URL says nothing", () => {
    expect(dataAttribution({ external: null, sourceUrl: "openlibrary.org sin protocolo" })).toBeNull()
  })

  it("an external reference without attribution falls back on the link", () => {
    expect(dataAttribution({ external: external(null), sourceUrl: "https://openlibrary.org/works/OL1W" })).toBe("Datos: Open Library")
  })
})
