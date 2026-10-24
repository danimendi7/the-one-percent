/**
 * UUID helpers that also work in insecure contexts (http://192.168.x.x), where
 * `crypto.randomUUID` is not exposed but `crypto.getRandomValues` is.
 */

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

function format(h: string): string {
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

export function uuidv4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  return format(hex(b))
}

/** Stable namespace for THE ONE PERCENT name-based ids. */
const NAMESPACE = "6f9c2a1e-4d1b-5c8e-9a7f-1e0b3d2c4a5f"

function parse(uuid: string): Uint8Array {
  const h = uuid.replace(/-/g, "")
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16))
}

/**
 * RFC 4122 v5 (SHA-1, name-based) UUID: the same inputs always give the same id.
 * Used so that re-running an import can never create duplicates.
 */
export async function uuidv5(name: string, namespace = NAMESPACE): Promise<string> {
  const ns = parse(namespace)
  const data = new Uint8Array([...ns, ...new TextEncoder().encode(name)])
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", data)).slice(0, 16)
  digest[6] = (digest[6] & 0x0f) | 0x50
  digest[8] = (digest[8] & 0x3f) | 0x80
  return format(hex(digest))
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
