import { describe, expect, it } from "vitest"
import { activeFilterCount, brainFilters, brainQueryString, EMPTY_BRAIN_QUERY, parseBrainQuery } from "./brain-query"

const parse = (qs: string) => {
  const p = new URLSearchParams(qs)
  return parseBrainQuery((k) => p.get(k))
}

describe("Cerebro in the URL (M4e)", () => {
  it("an empty URL is the default view", () => {
    expect(parse("")).toEqual(EMPTY_BRAIN_QUERY)
    expect(brainQueryString(EMPTY_BRAIN_QUERY)).toBe("")
  })

  it("round trip of every field, in a stable order", () => {
    const qs = "vista=aplicaciones&q=zona+2&tipo=idea%2Clearning&origen=libros%2Csueltas&tema=Sue%C3%B1o&val=7&fav=1&destacadas=1&estado=active%2Cdone&fecha=30d&app=open%2Cdoing&agrupar=contenido"
    const b = parse(qs)
    expect(b).toMatchObject({
      view: "aplicaciones",
      q: "zona 2",
      types: ["idea", "learning"],
      origins: ["book", "free"],
      topic: "Sueño",
      minRating: 7,
      favorite: true,
      starred: true,
      contentStatus: ["active", "done"],
      period: "30d",
      applications: ["open", "doing"],
      group: "contenido",
    })
    expect(brainQueryString(b)).toBe(qs)
    expect(parse(brainQueryString(b))).toEqual(b)
  })

  it("ignores unknown or malformed values instead of failing", () => {
    const b = parse("tipo=idea,bogus,idea&origen=cine&val=11&fav=yes&estado=active,,x&fecha=1y&app=x&agrupar=autor&vista=otra&q=" + "x".repeat(500))
    expect(b.types).toEqual(["idea"])
    expect(b.origins).toEqual([])
    expect(b.minRating).toBeNull()
    expect(b.favorite).toBe(false)
    expect(b.contentStatus).toEqual(["active"])
    expect(b.period).toBeNull()
    expect(b.applications).toEqual([])
    expect(b.group).toBe("ninguno")
    expect(b.view).toBe("ideas")
    expect(b.q).toHaveLength(200)
    expect(parse("val=0").minRating).toBeNull()
    expect(parse("val=2.5").minRating).toBeNull()
    expect(parse("tema=%20%20").topic).toBeNull()
  })

  it("domain filters: periods from a fixed now, the applications view forces the type", () => {
    const now = new Date("2026-10-30T12:00:00.000Z")
    expect(brainFilters(parse("fecha=7d"), now)).toEqual({ since: "2026-10-23T12:00:00.000Z" })
    expect(brainFilters(parse("fecha=12m"), now).since).toBe("2025-10-30T12:00:00.000Z")
    expect(brainFilters(parse("vista=aplicaciones&app=done"), now)).toEqual({ noteTypes: ["application"], applicationStatus: ["done"] })
    expect(brainFilters(parse("origen=podcasts&tema=Hábitos&val=8&fav=1&estado=paused"), now)).toEqual({
      formats: ["episode"],
      topics: ["Hábitos"],
      minRating: 8,
      favorite: true,
      contentStatus: ["paused"],
    })
  })

  it("counts the active filters (not the text, view or grouping)", () => {
    expect(activeFilterCount(parse("q=a&agrupar=tema&vista=aplicaciones"))).toBe(0)
    expect(activeFilterCount(parse("tipo=idea,quote&origen=libros&fav=1&fecha=7d"))).toBe(4)
  })
})
