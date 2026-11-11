import { describe, expect, it } from "vitest"
import { buildNeedles, classify, createBatchParser, findIn, needles, parseEnv } from "./secret-scan.mjs"

describe("parseEnv", () => {
  it("reads plain, quoted, exported and commented lines", () => {
    const text = [
      "# comment",
      "PLAIN=abc123456",
      'DOUBLE="with spaces inside"',
      "SINGLE='x#y'",
      "export EXPORTED=value-123",
      "TRAILING=value-456 # note",
      "EMPTY=",
      "not a line",
      "  SPACED = padded-value  ",
    ].join("\r\n")
    expect(parseEnv(text)).toEqual([
      { name: "PLAIN", value: "abc123456" },
      { name: "DOUBLE", value: "with spaces inside" },
      { name: "SINGLE", value: "x#y" },
      { name: "EXPORTED", value: "value-123" },
      { name: "TRAILING", value: "value-456" },
      { name: "EMPTY", value: "" },
      { name: "SPACED", value: "padded-value" },
    ])
  })
})

describe("parseEnv, values that dotenv also accepts", () => {
  it("keeps a quoted value with a trailing comment without its quotes", () => {
    expect(parseEnv('KEY="abcdefgh12345" # prod\nOTHER=\'x y\'   # note')).toEqual([
      { name: "KEY", value: "abcdefgh12345" },
      { name: "OTHER", value: "x y" },
    ])
  })

  it("reads a double-quoted value spread over several lines", () => {
    const text = 'PRIVATE_KEY="-----BEGIN KEY-----\nline-one\n-----END KEY-----"\nNEXT=after-value'
    expect(parseEnv(text)).toEqual([
      { name: "PRIVATE_KEY", value: "-----BEGIN KEY-----\nline-one\n-----END KEY-----" },
      { name: "NEXT", value: "after-value" },
    ])
  })

  it("expands \\n inside double quotes, like dotenv, but not inside single quotes", () => {
    expect(parseEnv('A="one\\ntwo-three"\nB=\'one\\ntwo-three\'')).toEqual([
      { name: "A", value: "one\ntwo-three" },
      { name: "B", value: "one\\ntwo-three" },
    ])
  })
})

describe("classify", () => {
  it("skips empty, short, numeric and boolean values", () => {
    expect(classify("AI_API_KEY", "")).toBe("skip")
    expect(classify("AI_PROVIDER", "none")).toBe("skip")
    expect(classify("AI_MONTHLY_TOKEN_BUDGET", "100000000")).toBe("skip")
    expect(classify("FEATURE_ENABLED", "TRUE")).toBe("skip")
  })

  it("treats NEXT_PUBLIC_* and the known public names as public", () => {
    expect(classify("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_abcdef")).toBe("public")
    expect(classify("VAPID_SUBJECT", "mailto:someone@example.com")).toBe("public")
  })

  it("treats every other name as secret, also unknown ones", () => {
    expect(classify("STAGING_DB_URL", "postgresql://u:p@h/db")).toBe("secret")
    expect(classify("SOMETHING_NEW", "unexpected-value")).toBe("secret")
  })

  it("searches a long number under a secret name (a PIN or numeric token)", () => {
    expect(classify("BACKUP_PIN", "12345678")).toBe("secret")
    expect(classify("AI_MONTHLY_TOKEN_BUDGET", "12345678")).toBe("skip")
  })
})

describe("needles", () => {
  it("adds the password of a URL with credentials, decoded and as written", () => {
    const list = needles("DB", "postgresql://postgres.ref:p%40ss-word-1@host:6543/postgres")
    expect(list.map((n) => [n.label, n.text])).toEqual([
      ["DB", "postgresql://postgres.ref:p%40ss-word-1@host:6543/postgres"],
      ["DB (contraseña)", "p%40ss-word-1"],
      ["DB (contraseña)", "p@ss-word-1"],
    ])
  })

  it("does not add a password that is too short to mean anything", () => {
    expect(needles("DB", "postgresql://postgres:pw@127.0.0.1:54322/postgres")).toHaveLength(1)
  })

  it("keeps a malformed escape in its raw form", () => {
    expect(needles("DB", "postgres://u:bad%zz-password@h/db").map((n) => n.text)).toContain("bad%zz-password")
  })

  it("finds the password of a URL without user, or with an @ inside the password", () => {
    expect(needles("R", "redis://:Sup3rSecretPw@host:6379").map((n) => n.text)).toContain("Sup3rSecretPw")
    expect(needles("D", "postgres://user:p@ss-w0rd-long@host/db").map((n) => n.text)).toContain("p@ss-w0rd-long")
  })

  it("also looks for each line of a multi-line value on its own", () => {
    const texts = needles("PRIVATE_KEY", "-----BEGIN KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END KEY-----").map((n) => n.text)
    expect(texts).toContain("MIIEvQIBADANBgkqhkiG9w0BAQEFAASC")
    expect(texts).not.toContain("-----END KEY-----")
  })

  it("adds nothing for a value that is not a URL", () => {
    expect(needles("KEY", "plain-secret-value").map((n) => n.text)).toEqual(["plain-secret-value"])
  })
})

describe("buildNeedles", () => {
  it("drops skipped values and deduplicates, keeping secret over public", () => {
    const list = buildNeedles([
      { name: "NEXT_PUBLIC_KEY", value: "shared-value-1" },
      { name: "PRIVATE_KEY", value: "shared-value-1" },
      { name: "AI_PROVIDER", value: "none" },
      { name: "OTHER_SECRET", value: "other-value-2" },
      { name: "OTHER_SECRET_COPY", value: "other-value-2" },
    ])
    expect(list.map((n) => [n.label, n.kind])).toEqual([
      ["PRIVATE_KEY", "secret"],
      ["OTHER_SECRET", "secret"],
    ])
  })
})

describe("findIn", () => {
  it("finds a value anywhere in binary content", () => {
    const list = buildNeedles([{ name: "TOKEN", value: "needle-value-9" }])
    const buffer = Buffer.concat([Buffer.from([0, 255, 10]), Buffer.from("…needle-value-9…"), Buffer.from([0])])
    expect(findIn(buffer, list).map((n) => n.label)).toEqual(["TOKEN"])
    expect(findIn(Buffer.from("needle-value-8"), list)).toEqual([])
  })
})

describe("createBatchParser", () => {
  const frame = (oid: string, type: string, body: string) => Buffer.concat([Buffer.from(`${oid} ${type} ${Buffer.byteLength(body)}\n`), Buffer.from(body), Buffer.from("\n")])

  it("splits objects whatever the chunk boundaries, including newlines inside the content", () => {
    const stream = Buffer.concat([frame("a1", "blob", "line 1\nline 2\n"), frame("b2", "commit", "tree x\n\nmessage"), Buffer.from("c3 missing\n"), frame("d4", "blob", "")])
    for (const size of [1, 3, 7, stream.length]) {
      const seen: Array<{ oid: string; type: string; text: string }> = []
      const feed = createBatchParser(({ oid, type, data }: { oid: string; type: string; data: Buffer }) => seen.push({ oid, type, text: data.toString() }))
      for (let i = 0; i < stream.length; i += size) feed(stream.subarray(i, i + size))
      expect(seen).toEqual([
        { oid: "a1", type: "blob", text: "line 1\nline 2\n" },
        { oid: "b2", type: "commit", text: "tree x\n\nmessage" },
        { oid: "d4", type: "blob", text: "" },
      ])
    }
  })

  it("hands over a copy that later chunks cannot overwrite", () => {
    const seen: Buffer[] = []
    const feed = createBatchParser(({ data }: { data: Buffer }) => seen.push(data))
    const chunk = frame("a1", "blob", "abc")
    feed(chunk)
    chunk.fill(0)
    expect(seen[0].toString()).toBe("abc")
  })
})
