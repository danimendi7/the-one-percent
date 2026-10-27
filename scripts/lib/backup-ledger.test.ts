import { describe, expect, it } from "vitest"
import { pickVerifiedBackup } from "./backup-ledger.mjs"

const now = Date.parse("2026-10-27T12:00:00Z")
const rec = (startedAt: string, over: Record<string, unknown> = {}) => ({ source: "cloud", ref: "abc", startedAt, ok: true, ...over })

describe("pickVerifiedBackup (pre-migration rule)", () => {
  it("picks the newest drill-verified cloud backup of the target project within 24 h", () => {
    const r = pickVerifiedBackup([rec("2026-10-27T01:00:00Z"), rec("2026-10-27T09:00:00Z"), rec("2026-10-26T13:00:00Z")], { ref: "abc", now })
    expect(r?.startedAt).toBe("2026-10-27T09:00:00Z")
  })

  it("ignores backups that are too old, failed their drill, are local or belong to another project", () => {
    const records = [
      rec("2026-10-26T11:59:00Z"),
      rec("2026-10-27T10:00:00Z", { ok: false }),
      rec("2026-10-27T10:00:00Z", { source: "local" }),
      rec("2026-10-27T10:00:00Z", { ref: "other" }),
    ]
    expect(pickVerifiedBackup(records, { ref: "abc", now })).toBeNull()
  })

  it("does not trust timestamps from the future", () => {
    expect(pickVerifiedBackup([rec("2026-10-28T00:00:00Z")], { ref: "abc", now })).toBeNull()
  })
})
