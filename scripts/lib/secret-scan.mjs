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
 * KEY=value entries of a .env file, read as dotenv does: optional `export`, quoted values (a double-
 * quoted one may span several lines and expands \n), and a trailing comment after an unquoted value
 * or after the closing quote. A quote that never closes is kept as part of a one-line value.
 * @param {string} text
 * @returns {EnvEntry[]}
 */
export function parseEnv(text) {
  const entries = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(lines[i])
    if (!m) continue
    const rest = m[2]
    const quote = rest[0]
    if (quote === '"' || quote === "'" || quote === "`") {
      let body = rest.slice(1)
      let last = i
      while (body.indexOf(quote) === -1 && last + 1 < lines.length) body += `\n${lines[++last]}`
      const end = body.indexOf(quote)
      if (end !== -1) {
        i = last
        const value = body.slice(0, end)
        entries.push({ name: m[1], value: quote === '"' ? value.replace(/\\n/g, "\n") : value })
        continue
      }
    }
    entries.push({ name: m[1], value: rest.replace(/\s+#.*$/, "").trim() })
  }
  return entries
}

/**
 * "secret", "public" or "skip" (empty, too short or a boolean; a number only under a public name).
 * @param {string} name
 * @param {string} value
 * @returns {"secret" | "public" | "skip"}
 */
export function classify(name, value) {
  if (value.length < MIN_LENGTH || /^(true|false)$/i.test(value)) return "skip"
  if (name.startsWith("NEXT_PUBLIC_") || PUBLIC_NAMES.has(name)) return /^\d+$/.test(value) ? "skip" : "public"
  return "secret"
}

/**
 * What to look for: the value itself; for a URL with credentials (postgresql://user:pass@host), also
 * its password, decoded and as written; and for a multi-line value (a PEM key), each line on its own
 * and the value with escaped newlines, as JSON or a one-line .env would store it.
 * @param {string} name
 * @param {string} value
 * @returns {Array<{ label: string, text: string, bytes: Buffer }>}
 */
export function needles(name, value) {
  const list = [{ label: name, text: value }]
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^:/@\s]*:([^\s/]+)@[^@/\s?#]+/i.exec(value)
  if (m) {
    const raw = m[1]
    let decoded = raw
    try {
      decoded = decodeURIComponent(raw)
    } catch {
      // A malformed escape: the raw form is still searched.
    }
    for (const text of [raw, decoded]) {
      if (text.length >= MIN_LENGTH) list.push({ label: `${name} (contraseña)`, text })
    }
  }
  if (value.includes("\n")) {
    list.push({ label: `${name} (con \\n)`, text: value.replace(/\n/g, "\\n") })
    for (const line of value.split("\n")) {
      // PEM armour lines (-----BEGIN …-----) are the same in every key.
      if (line.trim().length >= MIN_LENGTH && !line.startsWith("-----")) list.push({ label: `${name} (línea)`, text: line.trim() })
    }
  }
  const seen = new Set()
  return list.filter((n) => !seen.has(n.text) && seen.add(n.text)).map((n) => ({ ...n, bytes: Buffer.from(n.text, "utf8") }))
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
