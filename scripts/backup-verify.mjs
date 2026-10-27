#!/usr/bin/env node
/**
 * Check that a passphrase opens a backup (e.g. the one saved in your password manager).
 * Decrypts in memory only and prints the backup's summary; writes nothing.
 *
 *   npm run backup:verify -- <file.topbak>
 *
 * Uses BACKUP_PASSPHRASE if set; otherwise asks for it with hidden input (run it in your own terminal).
 */
import { readFileSync } from "node:fs"
import { decrypt } from "./lib/backup-core.mjs"

function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error("Sin terminal interactiva: define BACKUP_PASSPHRASE o ejecútalo en tu propia ventana de PowerShell."))
    process.stdout.write(prompt)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding("utf8")
    let value = ""
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          process.stdin.setRawMode(false)
          process.stdin.pause()
          process.stdin.off("data", onData)
          process.stdout.write("\n")
          return resolve(value)
        }
        if (ch === "\u0003") process.exit(130)
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1)
        else value += ch
      }
    }
    process.stdin.on("data", onData)
  })
}

const file = process.argv[2]
if (!file) {
  console.error("Uso: npm run backup:verify -- <fichero .topbak>")
  process.exit(1)
}
try {
  const passphrase = process.env.BACKUP_PASSPHRASE || (await askHidden("Frase de cifrado (no se muestra): ")).trim()
  const { meta, manifest } = decrypt(readFileSync(file), passphrase)
  const rows = manifest.filter((t) => t.table !== "public.change_seq").reduce((n, t) => n + t.rows, 0)
  console.log(`✔ La frase abre la copia: origen=${meta.source} ref=${meta.ref} fecha=${meta.startedAt} · ${manifest.length} tablas, ${rows} filas.`)
} catch (e) {
  console.error(`✖ ${e.message}`)
  process.exit(1)
}
