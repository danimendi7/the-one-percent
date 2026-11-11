/**
 * Pure helpers for scripts/audit-secrets.mjs (Orden 3): look for the real values of the local secret
 * files (.env*.local) inside git objects and report files, without ever printing a value.
 */

/** @typedef {{ name: string, value: string }} EnvEntry */
/** @typedef {{ label: string, kind: "secret" | "public", bytes: Buffer }} Needle */
/** @typedef {{ oid: string, type: string, size: number, data: Buffer }} GitObject */

/** Values shorter than this are too common to mean anything (e.g. "none", "true"). */
export const MIN_LENGTH = 8

/** Public by design: a match is reported as information, never as a leak. Any other name is secret. */
const PUBLIC_NAMES = new Set(["VAPID_SUBJECT", "AI_PROVIDER", "AI_MONTHLY_TOKEN_BUDGET"])

/**
 * KEY=value lines (optionally `export`, quoted or with a trailing comment) of a .env file.
 * @param {string} text
 * @returns {EnvEntry[]}
 */
export function parseEnv(text) {
  const entries = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (!m) continue
    const quoted = /^(["'])(.*)\1$/.exec(m[2])
    entries.push({ name: m[1], value: quoted ? quoted[2] : m[2].replace(/\s+#.*$/, "") })
  }
  return entries
}

/**
 * "secret", "public" or "skip" (empty, too short, a number or a boolean).
 * @param {string} name
 * @param {string} value
 * @returns {"secret" | "public" | "skip"}
 */
export function classify(name, value) {
  if (value.length < MIN_LENGTH || /^\d+$/.test(value) || /^(true|false)$/i.test(value)) return "skip"
  if (name.startsWith("NEXT_PUBLIC_") || PUBLIC_NAMES.has(name)) return "public"
  return "secret"
}

/**
 * What to look for: the value itself and, for a URL with credentials (postgresql://user:pass@host),
 * also its password, decoded and as written, so a password copied on its own is found too.
 * @param {string} name
 * @param {string} value
 * @returns {Array<{ label: string, text: string, bytes: Buffer }>}
 */
export function needles(name, value) {
  const list = [{ label: name, text: value }]
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^:/@\s]+:([^@\s]+)@/i.exec(value)
  if (m) {
    const raw = m[1]
    let decoded = raw
    try {
      decoded = decodeURIComponent(raw)
    } catch {
      // A malformed escape: the raw form is still searched.
    }
    for (const text of new Set([raw, decoded])) {
      if (text.length >= MIN_LENGTH) list.push({ label: `${name} (contraseña)`, text })
    }
  }
  return list.map((n) => ({ ...n, bytes: Buffer.from(n.text, "utf8") }))
}

/**
 * Everything to search for, from the entries of every env file, deduplicated by value.
 * @param {EnvEntry[]} entries
 * @returns {Needle[]}
 */
export function buildNeedles(entries) {
  /** @type {Map<string, Needle>} */
  const seen = new Map()
  for (const { name, value } of entries) {
    const kind = classify(name, value)
    if (kind === "skip") continue
    for (const n of needles(name, value)) {
      const prior = seen.get(n.text)
      // The same value under a secret name and a public one counts as secret.
      if (!prior || (prior.kind === "public" && kind === "secret")) seen.set(n.text, { label: n.label, kind, bytes: n.bytes })
    }
  }
  return [...seen.values()]
}

/**
 * The needles that occur in the buffer.
 * @param {Buffer} buffer
 * @param {Needle[]} list
 * @returns {Needle[]}
 */
export function findIn(buffer, list) {
  return list.filter((n) => buffer.indexOf(n.bytes) !== -1)
}

/**
 * Parser for the output of `git cat-file --batch-all-objects --batch`: "<oid> <type> <size>\n",
 * the object's bytes and "\n". Returns a function that takes chunks and calls onObject for each one.
 * @param {(object: GitObject) => void} onObject
 * @returns {(chunk: Buffer) => void}
 */
export function createBatchParser(onObject) {
  /** @type {Buffer[]} */
  let chunks = []
  let length = 0
  /** @type {{ oid: string, type: string, size: number } | null} */
  let header = null
  /** @param {number} n */
  const take = (n) => {
    const all = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, length)
    const out = all.subarray(0, n)
    const rest = all.subarray(n)
    chunks = rest.length ? [rest] : []
    length = rest.length
    return out
  }
  return (chunk) => {
    chunks.push(chunk)
    length += chunk.length
    for (;;) {
      if (!header) {
        const all = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, length)
        chunks = [all]
        const nl = all.indexOf(10)
        if (nl === -1) return
        const [oid, type, size] = take(nl + 1).subarray(0, nl).toString("utf8").split(" ")
        if (type === "missing") continue
        header = { oid, type, size: Number(size) }
      }
      if (length < header.size + 1) return
      const data = Buffer.from(take(header.size + 1).subarray(0, header.size))
      onObject({ ...header, data })
      header = null
    }
  }
}
