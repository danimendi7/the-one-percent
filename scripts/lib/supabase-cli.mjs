import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

/**
 * Run the project's Supabase CLI without a shell (arguments are passed verbatim,
 * never re-parsed). On Windows the npm shim is a .cmd that requires a shell, so the
 * platform binary shipped in node_modules is called directly.
 */
export function supabaseCli(args, options = {}) {
  if (process.platform === "win32") {
    const bin = join("node_modules", "@supabase", `cli-windows-${process.arch === "arm64" ? "arm64" : "x64"}`, "bin", "supabase.exe")
    if (!existsSync(bin)) throw new Error(`No se encuentra ${bin}. Ejecuta "npm install".`)
    return spawnSync(bin, args, options)
  }
  return spawnSync("npx", ["supabase", ...args], options)
}
