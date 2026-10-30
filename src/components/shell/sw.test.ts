import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * public/sw.js caches the HTML of an allowlist of routes (M4f). This keeps the list honest: every
 * static page of the app is in it, and nothing with a dynamic segment, the login page, the
 * development diagnostics or a redirect is.
 */
const root = join(process.cwd(), "src", "app", "(app)")
const sw = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8")

function pages(dir: string, base = ""): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...pages(p, name.startsWith("(") ? base : `${base}/${name}`))
    else if (name === "page.tsx") out.push(base || "/")
  }
  return out
}

const shell = JSON.parse(/const SHELL = (\[[\s\S]*?\])/.exec(sw)![1].replace(/,\s*\]/, "]")) as string[]

describe("service worker allowlist", () => {
  it("is exactly the static pages of the app (no dynamic segments, no /dev, no redirects)", () => {
    const redirects = ["/knowledge"]
    const expected = pages(root)
      .filter((p) => !p.includes("[") && !p.startsWith("/dev") && !redirects.includes(p))
      .sort()
    expect([...shell].sort()).toEqual(expected)
  })

  it("never handles other origins, writes, auth, RSC or Authorization; deletes only its own caches", () => {
    expect(sw).toContain('if (req.method !== "GET") return')
    expect(sw).toContain("if (url.origin !== self.location.origin) return")
    expect(sw).toMatch(/startsWith\("\/auth\/"\)/)
    expect(sw).toMatch(/headers\.has\("authorization"\)/)
    expect(sw).toMatch(/get\("rsc"\) === "1"/)
    expect(sw).toMatch(/name\.startsWith\(PREFIX\) && name !== CACHE\) await caches\.delete\(name\)/)
    expect(sw).not.toMatch(/indexedDB\.|localStorage\.|deleteDatabase\(/)
    expect(shell).not.toContain("/login")
  })
})
