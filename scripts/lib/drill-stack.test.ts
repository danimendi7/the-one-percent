import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { drillConfig, migrationUpTo } from "./drill-stack.mjs"

describe("drillConfig", () => {
  const dev = readFileSync("supabase/config.toml", "utf8")
  const drill = drillConfig(dev)

  it("uses its own project id, so containers and volumes never collide with the dev stack", () => {
    expect(drill).toMatch(/^project_id = "the-one-percent-drill"$/m)
    expect(drill).not.toMatch(/^project_id = "the-one-percent"$/m)
  })

  it("moves every dev port (553xx) to the drill range (556xx)", () => {
    expect(drill).not.toMatch(/port\s*=\s*553\d\d/)
    for (const p of [55620, 55621, 55622, 55623, 55624, 55629]) expect(drill).toContain(String(p))
  })

  it("disables the seed: restored rows come only from the backup", () => {
    expect(drill).toMatch(/\[db\.seed\][^[]*?enabled\s*=\s*false/)
  })
})

describe("migrationUpTo (pre-migration drills restore onto the backed-up schema)", () => {
  it("keeps migrations up to the given version, and everything without a cut", () => {
    expect(migrationUpTo("supabase/migrations/20261028090000_goals.sql", "20261028090000")).toBe(true)
    expect(migrationUpTo("supabase/migrations/20261029090000_focus.sql", "20261028090000")).toBe(false)
    expect(migrationUpTo("supabase/migrations", "20261028090000")).toBe(true)
    expect(migrationUpTo("supabase/migrations/20261029090000_focus.sql", null)).toBe(true)
  })
})
