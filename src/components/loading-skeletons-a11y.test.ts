import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = join(process.cwd(), "src")

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name)
    if (e.isDirectory()) return tsxFiles(path)
    return e.name.endsWith(".tsx") ? [path] : []
  })
}

describe("loading skeletons", () => {
  it("a named skeleton has a role: aria-label on a plain div is prohibited, and axe can catch a page while it loads", () => {
    const wrong = tsxFiles(ROOT).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/<div\b[^>]*\baria-busy="true"[^>]*>/g)].filter(([tag]) => tag.includes("aria-label=") && !tag.includes("role=")).map(([tag]) => `${relative(ROOT, file)}: ${tag}`)
    )
    expect(wrong).toEqual([])
  })
})
