import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { evaluateCloudTarget, evaluateDbUrl } from "./cloud-guard.mjs"

const sha = (v: string) => createHash("sha256").update(v).digest("hex")
const cfg = {
  name: "the-one-percent",
  ref: "abcdefghijklmnopqrst",
  organizationId: "personal-org",
  region: "eu-central-1",
  forbiddenRefHashes: [sha("zzzzforbiddenrefzzzz")],
  forbiddenOrganizationHashes: [sha("forbidden-org")],
}
const ours = { id: "abcdefghijklmnopqrst", ref: "abcdefghijklmnopqrst", name: "the-one-percent", organization_id: "personal-org", region: "eu-central-1" }
const other = { id: "zzzzforbiddenrefzzzz", ref: "zzzzforbiddenrefzzzz", name: "other-project", organization_id: "forbidden-org", region: "eu-west-1" }

describe("cloud guard", () => {
  it("accepts only the exact expected project", () => {
    expect(evaluateCloudTarget([ours], cfg, "abcdefghijklmnopqrst")).toMatchObject({ ok: true, target: { ref: ours.ref } })
  })

  it("refuses a token that can see the forbidden account (wrong CLI session)", () => {
    const r = evaluateCloudTarget([other], cfg)
    expect(r.ok).toBe(false)
    expect(r.problems.join(" ")).toContain("prohibidos")
  })

  it("refuses when the repo is linked to another project", () => {
    expect(evaluateCloudTarget([ours], cfg, "zzzzforbiddenrefzzzz").ok).toBe(false)
  })

  it("refuses name, organization or region mismatches", () => {
    expect(evaluateCloudTarget([{ ...ours, name: "otro" }], cfg).ok).toBe(false)
    expect(evaluateCloudTarget([{ ...ours, organization_id: "x" }], cfg).ok).toBe(false)
    expect(evaluateCloudTarget([{ ...ours, region: "us-east-1" }], cfg).ok).toBe(false)
  })

  it("without a configured ref it only lists candidates", () => {
    const r = evaluateCloudTarget([ours], { ...cfg, ref: null })
    expect(r.ok).toBe(false)
    expect(r.problems[0]).toContain("abcdefghijklmnopqrst")
  })

  it("database URLs must contain the expected ref and never a forbidden one", () => {
    expect(evaluateDbUrl("postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres", cfg).ok).toBe(true)
    expect(evaluateDbUrl("postgresql://postgres.zzzzforbiddenrefzzzz:pw@x/postgres", cfg).ok).toBe(false)
    expect(evaluateDbUrl("", cfg).ok).toBe(false)
  })
})
