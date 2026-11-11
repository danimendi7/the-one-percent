import { describe, expect, it } from "vitest"
import { migrationVersions, missingMigrations, targetState } from "./rls-audit.mjs"

describe("fresh database helpers (G2)", () => {
  it("reads migration versions from file names, in order, ignoring anything else", () => {
    expect(migrationVersions(["20261111090000_push_schedule.sql", "README.md", "20261020090000_init.sql", "x.sql"])).toEqual(["20261020090000", "20261111090000"])
  })

  it("lists the migrations missing from a database's history", () => {
    const files = ["20261020090000_init.sql", "20261111090000_push_schedule.sql"]
    expect(missingMigrations(files, ["20261020090000"])).toEqual(["20261111090000"])
    expect(missingMigrations(files, ["20261020090000", "20261111090000"])).toEqual([])
  })

  it("only an empty database is a target for a fresh install", () => {
    expect(targetState({ publicTables: 0, migrationRows: 0 })).toBe("empty")
    expect(targetState({ publicTables: 25, migrationRows: 22 })).toBe("not_empty")
    expect(targetState({ publicTables: 0, migrationRows: 1 })).toBe("not_empty")
    expect(targetState({ publicTables: 1, migrationRows: 0 })).toBe("not_empty")
  })
})
