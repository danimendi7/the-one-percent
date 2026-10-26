import { describe, expect, it } from "vitest"
import { compareManifests, decrypt, encrypt } from "./backup-core.mjs"

describe("backup encryption", () => {
  const payload = { meta: { source: "cloud" }, sql: "COPY public.habits ...", manifest: [] }

  it("round-trips with the right passphrase", () => {
    const enc = encrypt(payload, "correct horse battery")
    expect(enc.subarray(0, 5).toString()).toBe("TOPB1")
    expect(decrypt(enc, "correct horse battery")).toEqual(payload)
  })

  it("fails with a wrong passphrase or tampered bytes", () => {
    const enc = encrypt(payload, "correct horse battery")
    expect(() => decrypt(enc, "wrong passphrase!!")).toThrow(/descifrar/)
    const tampered = Buffer.from(enc)
    tampered[tampered.length - 1] ^= 1
    expect(() => decrypt(tampered, "correct horse battery")).toThrow(/descifrar/)
  })

  it("rejects short passphrases", () => {
    expect(() => encrypt(payload, "short")).toThrow(/12/)
  })
})

describe("manifest comparison", () => {
  it("flags missing tables and row/hash differences", () => {
    const expected = [
      { table: "public.habits", rows: 2, hash: "a" },
      { table: "public.habit_entries", rows: 5, hash: "b" },
      { table: "auth.users", rows: 1, hash: "c" },
    ]
    const actual = [
      { table: "public.habits", rows: 2, hash: "a" },
      { table: "public.habit_entries", rows: 4, hash: "x" },
    ]
    expect(compareManifests(expected, actual).map((r: { ok: boolean }) => r.ok)).toEqual([true, false, false])
  })
})
