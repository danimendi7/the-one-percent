import { describe, expect, it } from "vitest"
import {
  cleanLine,
  cleanText,
  compactIsbn,
  formatTimestamp,
  highlight,
  isbn10to13,
  isValidIsbn10,
  isValidIsbn13,
  normalize,
  normalizeNames,
  normalizeSlow,
  normalizeTopics,
  optionalText,
  parseTimestamp,
  safeUrl,
  tokenize,
} from "./text"

describe("normalisation and tokens", () => {
  it("ignores accents and case", () => {
    expect(normalize("  Pensar RÁPIDO, pensar despacio ")).toBe("pensar rapido, pensar despacio")
    expect(normalize("Ñandú")).toBe("nandu")
  })

  it("the fast path gives exactly the reference result", () => {
    const samples = [
      "¿Cómo? ¡Ñandú, pingüino y ÁRBOL!",
      "«Citas» — “comillas” … 3º y 1ª",
      "Ελληνικά, Øre, Łódź, İstanbul, ﬁn, Æon",
      "é ya descompuesta",
      "  emoji 🙂 y tabs\t",
      "Crème brûlée, Ångström, Señor",
      "",
    ]
    for (const s of samples) expect(normalize(s), s).toBe(normalizeSlow(s))
    // Every Latin-1 and Latin Extended-A letter, one by one.
    for (let cp = 0xc0; cp <= 0x17f; cp++) {
      const ch = String.fromCodePoint(cp)
      expect(normalize(ch), `U+${cp.toString(16)}`).toBe(normalizeSlow(ch))
    }
  })

  it("splits into words of letters and digits", () => {
    expect(tokenize("Zona-2: ¿cómo medirla? (p. 221)")).toEqual(["zona", "2", "como", "medirla", "p", "221"])
    expect(tokenize("")).toEqual([])
  })
})

describe("user text", () => {
  it("keeps paragraphs, drops control characters and trailing spaces", () => {
    expect(cleanText("  Uno  \r\n\r\nDos\u0007\t \n")).toBe("Uno\n\nDos")
  })

  it("one-line text collapses whitespace", () => {
    expect(cleanLine("  Hábitos \n  atómicos ")).toBe("Hábitos atómicos")
  })

  it("empty optional text is null", () => {
    expect(optionalText("   ")).toBeNull()
    expect(optionalText(null)).toBeNull()
    expect(optionalText(" a  b ", true)).toBe("a b")
  })
})

describe("topics and names", () => {
  it("free topics: cleaned, «#» dropped, duplicates by accent/case removed, first spelling wins", () => {
    expect(normalizeTopics(["#Sueño", "sueno", "  Salud mental ", "", "SALUD MENTAL", "##"])).toEqual(["Sueño", "Salud mental"])
  })

  it("names are de-duplicated the same way", () => {
    expect(normalizeNames(["Séneca", "seneca", " Marco  Aurelio "])).toEqual(["Séneca", "Marco Aurelio"])
  })
})

describe("safe links", () => {
  it("accepts http(s) and normalises", () => {
    expect(safeUrl(" https://open.spotify.com/episode/abc ")).toBe("https://open.spotify.com/episode/abc")
    expect(safeUrl("http://example.org")).toBe("http://example.org/")
  })

  it("rejects other schemes, credentials, garbage and over-long links", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://x.org", "https://user:pw@x.org", "no es un enlace", "", null, `https://x.org/${"a".repeat(2100)}`]) {
      expect(safeUrl(bad)).toBeNull()
    }
  })
})

describe("ISBN", () => {
  it("validates ISBN-10 and ISBN-13 checksums, with hyphens and X", () => {
    expect(isValidIsbn10("0-306-40615-2")).toBe(true)
    expect(isValidIsbn10("0-8044-2957-X")).toBe(true)
    expect(isValidIsbn10("0-306-40615-3")).toBe(false)
    expect(isValidIsbn13("978-0-306-40615-7")).toBe(true)
    expect(isValidIsbn13("978-0-306-40615-6")).toBe(false)
    expect(isValidIsbn13("1234567890123")).toBe(false)
  })

  it("converts ISBN-10 to ISBN-13", () => {
    expect(isbn10to13("0-306-40615-2")).toBe("9780306406157")
    expect(isbn10to13("123")).toBeNull()
    expect(compactIsbn("978 0-306")).toBe("9780306")
  })
})

describe("timestamps", () => {
  it("parses s, m:ss and h:mm:ss", () => {
    expect(parseTimestamp("75")).toBe(75)
    expect(parseTimestamp("12:34")).toBe(754)
    expect(parseTimestamp("1:02:03")).toBe(3723)
  })

  it("rejects malformed or out-of-range values", () => {
    for (const bad of ["", "1:60", "1:2:3:4", "-5", "abc", "25:00:00"]) expect(parseTimestamp(bad)).toBeNull()
  })

  it("formats back", () => {
    expect(formatTimestamp(754)).toBe("12:34")
    expect(formatTimestamp(3723)).toBe("1:02:03")
    expect(formatTimestamp(5)).toBe("0:05")
  })
})

describe("highlight", () => {
  it("marks word-prefix matches in the original accented text", () => {
    const segs = highlight("La atención sostenida y la Atencion plena", ["atencion"])
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(["atención", "Atencion"])
    expect(segs.map((s) => s.text).join("")).toBe("La atención sostenida y la Atencion plena")
  })

  it("matches prefixes but not inside a word", () => {
    expect(highlight("hábitos y deshábitos", ["habit"]).filter((s) => s.match).map((s) => s.text)).toEqual(["hábit"])
  })

  it("returns the text whole without terms", () => {
    expect(highlight("hola", [])).toEqual([{ text: "hola", match: false }])
  })
})

describe("highlight · fast folding (M4e)", () => {
  it("folds every character like the Unicode reference", async () => {
    const { foldChar, foldCharSlow } = await import("./text")
    const sample = "AZaz09 ÁÉÍÓÚÜÑáéíóúüñçÇàèìòùâêîôûäëïöÿãõåÅØøßŁłŠšŽžİıĞğ¿¡«»“”‘’—–…·€ºª😀́\t\n"
    for (const ch of sample) expect(foldChar(ch, ch.codePointAt(0)!), JSON.stringify(ch)).toBe(foldCharSlow(ch))
  })
})
