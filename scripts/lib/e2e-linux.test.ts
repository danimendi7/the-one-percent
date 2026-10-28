import { describe, expect, it } from "vitest"
import { checkStatus, imageFor, leaks, publicEnv, resourceNames, summarize } from "./e2e-linux.mjs"

describe("e2e-linux helpers (M3.3 decision 7)", () => {
  it("uses the official image of the project's exact Playwright version", () => {
    expect(imageFor("1.64.1")).toBe("mcr.microsoft.com/playwright:v1.64.1-noble")
    expect(() => imageFor("^1.64")).toThrow()
  })

  it("names resources uniquely and recognisably", () => {
    expect(resourceNames(new Date("2026-10-28T17:05:09.123Z"))).toEqual({
      container: "top-e2e-linux-20261028-170509",
      network: "top-e2e-linux-net-20261028-170509",
      stamp: "20261028-170509",
    })
  })

  it("accepts only THE ONE PERCENT's local stack on loopback", () => {
    const ok = JSON.stringify({ API_URL: "http://127.0.0.1:55321", DB_URL: "postgresql://postgres:postgres@127.0.0.1:55322/postgres", PUBLISHABLE_KEY: "pk", SECRET_KEY: "sk" })
    expect(checkStatus(`Stopped services: [x]\n${ok}`).API_URL).toBe("http://127.0.0.1:55321")
    // The other local stack (default ports) and any remote target are refused.
    expect(() => checkStatus(ok.replace("55321", "54321"))).toThrow(/no pertenece/)
    expect(() => checkStatus(ok.replace("127.0.0.1:55322", "db.example.supabase.co:5432"))).toThrow(/no local/)
  })

  it("copies only the two public values, and only when they point to the local stack", () => {
    const env = "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=pub\nSUPABASE_DB_PASSWORD=secret\nBACKUP_PASSPHRASE=x"
    expect(publicEnv(env)).toBe("NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=pub\n")
    expect(() => publicEnv(env.replace("http://127.0.0.1:55321", "https://abc.supabase.co"))).toThrow(/no apunta/)
    expect(() => publicEnv("FOO=1")).toThrow()
  })

  it("reads Playwright's summary and detects leaked secrets", () => {
    expect(summarize("  12 skipped\n  158 passed (3.0m)")).toEqual({ passed: 158, failed: 0, flaky: 0, skipped: 12, interrupted: 0 })
    expect(summarize("  2 failed\n  1 flaky\n  155 passed")).toMatchObject({ failed: 2, flaky: 1, passed: 155 })
    expect(leaks("token=abcdefghij", ["abcdefghij"])).toBe(true)
    expect(leaks("nothing here", ["abcdefghij", ""])).toBe(false)
  })
})
