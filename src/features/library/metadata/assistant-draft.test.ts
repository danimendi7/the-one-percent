import { describe, expect, it } from "vitest"
import { clearAssistantDraft, clearAssistantDrafts, DRAFT_MAX_AGE_MS, draftKey, readAssistantDraft, writeAssistantDraft, type DraftStorage } from "./assistant-draft"

function memory(): DraftStorage & { keys(): string[] } {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    keys: () => [...m.keys()],
  }
}

function refusing(): DraftStorage {
  const no = () => {
    throw new DOMException("denied", "SecurityError")
  }
  return { length: 0, key: no, getItem: no, setItem: no, removeItem: no }
}

const NOW = 1_000_000_000

describe("assistant drafts", () => {
  it("keeps one draft per assistant and user", () => {
    expect(draftKey("book", "u1")).toBe("top:draft:book:u1")
    const s = memory()
    writeAssistantDraft(s, "book", "u1", { text: "libro" }, NOW)
    writeAssistantDraft(s, "podcast", "u1", { text: "programa" }, NOW)
    expect(readAssistantDraft(s, "book", "u1", NOW)).toEqual({ text: "libro" })
    expect(readAssistantDraft(s, "podcast", "u1", NOW)).toEqual({ text: "programa" })
  })

  it("another account in the same tab does not see it", () => {
    const s = memory()
    writeAssistantDraft(s, "book", "u1", { text: "libro" }, NOW)
    expect(readAssistantDraft(s, "book", "u2", NOW)).toBeNull()
  })

  it("is still there just before 24 hours", () => {
    const s = memory()
    writeAssistantDraft(s, "book", "u1", { text: "libro" }, NOW)
    expect(readAssistantDraft(s, "book", "u1", NOW + DRAFT_MAX_AGE_MS - 1)).toEqual({ text: "libro" })
  })

  it("expires at 24 hours and leaves nothing behind", () => {
    const s = memory()
    writeAssistantDraft(s, "book", "u1", { text: "libro" }, NOW)
    expect(readAssistantDraft(s, "book", "u1", NOW + DRAFT_MAX_AGE_MS)).toBeNull()
    expect(s.keys()).toEqual([])
  })

  it("a clock that went backwards does not keep a draft forever", () => {
    const s = memory()
    writeAssistantDraft(s, "book", "u1", { text: "libro" }, NOW + DRAFT_MAX_AGE_MS * 2)
    expect(readAssistantDraft(s, "book", "u1", NOW)).toBeNull()
  })

  it.each(["no es json", "null", "[]", '{"v":1,"savedAt":"ayer","data":{}}', '{"v":1,"savedAt":1000000000,"data":null}', '{"v":99,"savedAt":1000000000,"data":{}}'])("drops what it cannot read: %s", (raw) => {
    const s = memory()
    s.setItem(draftKey("book", "u1"), raw)
    expect(readAssistantDraft(s, "book", "u1", NOW)).toBeNull()
    expect(s.keys()).toEqual([])
  })

  it("clears one assistant's draft and leaves the other", () => {
    const s = memory()
    writeAssistantDraft(s, "book", "u1", { text: "libro" }, NOW)
    writeAssistantDraft(s, "podcast", "u1", { text: "programa" }, NOW)
    clearAssistantDraft(s, "book", "u1")
    expect(s.keys()).toEqual([draftKey("podcast", "u1")])
  })

  it("on signing out clears every draft and nothing else in the tab", () => {
    const s = memory()
    s.setItem("otra-cosa", "1")
    writeAssistantDraft(s, "book", "u1", { text: "libro" }, NOW)
    writeAssistantDraft(s, "podcast", "u2", { text: "programa" }, NOW)
    clearAssistantDrafts(s)
    expect(s.keys()).toEqual(["otra-cosa"])
  })

  it("on changing user clears the drafts of everyone else", () => {
    const s = memory()
    writeAssistantDraft(s, "book", "u1", { text: "mío" }, NOW)
    writeAssistantDraft(s, "book", "u2", { text: "ajeno" }, NOW)
    writeAssistantDraft(s, "podcast", "u2", { text: "ajeno" }, NOW)
    clearAssistantDrafts(s, "u1")
    expect(s.keys()).toEqual([draftKey("book", "u1")])
  })

  it("does not confuse a user whose id ends like another's", () => {
    const s = memory()
    writeAssistantDraft(s, "book", "x-u1", { text: "ajeno" }, NOW)
    clearAssistantDrafts(s, "u1")
    expect(s.keys()).toEqual([])
  })

  it("a browser that refuses the storage never throws", () => {
    const s = refusing()
    expect(writeAssistantDraft(s, "book", "u1", { text: "libro" }, NOW)).toBe(false)
    expect(readAssistantDraft(s, "book", "u1", NOW)).toBeNull()
    expect(() => clearAssistantDraft(s, "book", "u1")).not.toThrow()
    expect(() => clearAssistantDrafts(s)).not.toThrow()
  })

  it("no storage at all (private browsing) never throws", () => {
    expect(writeAssistantDraft(null, "book", "u1", { text: "libro" }, NOW)).toBe(false)
    expect(readAssistantDraft(null, "book", "u1", NOW)).toBeNull()
    expect(() => clearAssistantDraft(null, "book", "u1")).not.toThrow()
    expect(() => clearAssistantDrafts(null)).not.toThrow()
  })
})
