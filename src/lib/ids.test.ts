import { describe, expect, it } from "vitest"
import { UUID_RE, uuidv4, uuidv5 } from "./ids"

describe("ids", () => {
  it("v4 produces valid, distinct UUIDs", () => {
    const a = uuidv4()
    expect(a).toMatch(UUID_RE)
    expect(a).not.toBe(uuidv4())
  })

  it("v5 is deterministic and matches the RFC 4122 test vector", async () => {
    // RFC 4122 / Python uuid.uuid5(NAMESPACE_DNS, "python.org")
    expect(await uuidv5("python.org", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe("886313e1-3b8a-5372-9b90-0c9aee199e5d")
    const x = await uuidv5("user-1:demo-training")
    expect(x).toMatch(UUID_RE)
    expect(await uuidv5("user-1:demo-training")).toBe(x)
    expect(await uuidv5("user-2:demo-training")).not.toBe(x)
  })
})
